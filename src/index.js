#!/usr/bin/env node
// MCP server that lets Claude (Claude Code, Claude Desktop, any MCP client)
// drive Safari on macOS: tabs, navigation, reading pages, clicking, typing,
// screenshots and arbitrary JavaScript.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as safari from "./safari.js";
import * as page from "./page.js";

const server = new McpServer({ name: "safari-browser", version: "0.1.0" });

const tabArg = z
  .string()
  .optional()
  .describe('Tab id "windowId:tabIndex" from tabs_list. Omit for the active tab of the front window.');

const text = (t) => ({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t, null, 2) }] });

function tool(name, description, schema, handler) {
  server.tool(name, description, schema, async (args) => {
    try {
      return await handler(args);
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: String(err.message || err) }] };
    }
  });
}

tool("tabs_list", "List every open Safari tab with its id, title and URL.", {}, async () =>
  text(await safari.listTabs())
);

tool("tabs_create", "Open a new Safari tab (optionally at a URL) and make it active.", {
  url: z.string().optional(),
}, async ({ url }) => {
  const id = await safari.createTab(url);
  if (url) await safari.waitForLoad(id);
  return text(`Opened tab ${id}`);
});

tool("tabs_select", "Bring a tab to the front.", { tab: z.string() }, async ({ tab }) => {
  await safari.selectTab(tab);
  return text(`Selected ${tab}`);
});

tool("tabs_close", "Close a tab.", { tab: z.string() }, async ({ tab }) => {
  await safari.closeTab(tab);
  return text(`Closed ${tab}`);
});

tool("navigate", 'Load a URL in a tab, or pass "back" / "forward" / "reload".', {
  url: z.string(),
  tab: tabArg,
}, async ({ url, tab }) => {
  if (url === "back") await safari.evalSync(tab, "history.back(); return true");
  else if (url === "forward") await safari.evalSync(tab, "history.forward(); return true");
  else if (url === "reload") await safari.evalSync(tab, "location.reload(); return true");
  else await safari.setUrl(tab, /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
  await safari.waitForLoad(tab);
  const info = await safari.tabInfo(tab);
  return text(`Now at ${info.url} — ${info.title}`);
});

tool("get_page_text", "Get the readable text of the page (main/article first, else body).", {
  tab: tabArg,
  max_chars: z.number().int().positive().default(50_000),
}, async ({ tab, max_chars }) => text(await safari.evalSync(tab, page.pageText(max_chars))));

tool(
  "read_page",
  "Read the page as an outline. Interactive elements get [ref_N] ids usable with click / form_input / scroll.",
  {
    tab: tabArg,
    filter: z.enum(["all", "interactive"]).default("all"),
    max_chars: z.number().int().positive().default(50_000),
  },
  async ({ tab, filter, max_chars }) => text(await safari.evalSync(tab, page.readPage(filter, max_chars)))
);

tool("find", "Find visible elements whose role/name/text contains the query. Returns up to 20 refs.", {
  query: z.string(),
  tab: tabArg,
}, async ({ query, tab }) => text(await safari.evalSync(tab, page.find(query))));

tool("click", "Click an element by ref (from read_page/find) or CSS selector.", {
  ref: z.string().optional(),
  selector: z.string().optional(),
  tab: tabArg,
}, async ({ ref, selector, tab }) => {
  if (!ref && !selector) throw new Error("Pass ref or selector");
  const msg = await safari.evalSync(tab, page.click(ref, selector));
  await safari.waitForLoad(tab, 5_000);
  return text(msg);
});

tool(
  "form_input",
  "Set the value of an input, textarea, select, checkbox or contenteditable. Optionally submit its form.",
  {
    ref: z.string().optional(),
    selector: z.string().optional(),
    value: z.union([z.string(), z.boolean(), z.number()]),
    submit: z.boolean().default(false),
    tab: tabArg,
  },
  async ({ ref, selector, value, submit, tab }) => {
    if (!ref && !selector) throw new Error("Pass ref or selector");
    const msg = await safari.evalSync(tab, page.setValue(ref, selector, value, submit));
    if (submit) await safari.waitForLoad(tab, 10_000);
    return text(msg);
  }
);

tool(
  "press_key",
  'Send real key presses to Safari, e.g. "Return", "Tab", "cmd+l", "shift+tab". Needs Accessibility permission.',
  { key: z.string(), repeat: z.number().int().min(1).max(100).default(1) },
  async ({ key, repeat }) => {
    await safari.pressKey(key, repeat);
    return text(`Pressed ${key}${repeat > 1 ? ` ×${repeat}` : ""}`);
  }
);

tool("scroll", "Scroll the page by ticks in a direction, or scroll an element (ref) into view.", {
  direction: z.enum(["up", "down", "left", "right"]).default("down"),
  amount: z.number().int().min(1).max(50).default(5),
  ref: z.string().optional(),
  tab: tabArg,
}, async ({ direction, amount, ref, tab }) => text(await safari.evalSync(tab, page.scroll(direction, amount, ref ?? null))));

tool(
  "javascript",
  "Run JavaScript in the page. Write a function body and `return` the value you want (await is allowed). Result is JSON-serialised.",
  { code: z.string(), tab: tabArg, timeout_ms: z.number().int().positive().default(30_000) },
  async ({ code, tab, timeout_ms }) => text((await safari.evalAsync(tab, code, timeout_ms)) ?? "undefined")
);

tool(
  "screenshot",
  "Screenshot the Safari window (brings it to the front). Needs Screen Recording permission.",
  { tab: tabArg },
  async ({ tab }) => ({ content: [{ type: "image", data: await safari.screenshot(tab), mimeType: "image/png" }] })
);

await server.connect(new StdioServerTransport());
