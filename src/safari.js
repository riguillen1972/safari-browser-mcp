// Thin layer over Safari's scripting interface (JXA via osascript).
// Every call runs a short JavaScript-for-Automation script and passes
// arguments as JSON through argv, so no AppleScript string escaping is needed.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

async function jxa(body, args = {}) {
  const script = `
    function run(argv) {
      const args = JSON.parse(argv[0]);
      const safari = Application("Safari");
      safari.includeStandardAdditions = true;
      function pickWindow() {
        if (safari.windows.length === 0) throw new Error("Safari has no open windows");
        return args.windowId != null ? safari.windows.byId(args.windowId) : safari.windows[0];
      }
      function pickTab() {
        const w = pickWindow();
        return args.tabIndex != null ? w.tabs[args.tabIndex] : w.currentTab;
      }
      const result = (function () { ${body} })();
      return JSON.stringify(result === undefined ? null : result);
    }`;
  try {
    const { stdout } = await run("osascript", ["-l", "JavaScript", "-e", script, JSON.stringify(args)], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
    return JSON.parse(stdout.trim() || "null");
  } catch (err) {
    throw new Error(explain(err.stderr || err.message));
  }
}

function explain(msg) {
  if (/Allow JavaScript from Apple Events|not allowed|-1743|-10004/i.test(msg) && /JavaScript/i.test(msg)) {
    return (
      "Safari refused to run JavaScript. Enable Safari > Settings > Advanced > " +
      "'Show features for web developers', then Develop > 'Allow JavaScript from Apple Events'. " +
      `(${msg.trim()})`
    );
  }
  if (/-1743|Not authorized to send Apple events/i.test(msg)) {
    return (
      "macOS blocked automation of Safari. Allow it in System Settings > Privacy & Security > " +
      `Automation for the app running this server. (${msg.trim()})`
    );
  }
  return msg.trim();
}

// Tab addressing: "windowId:tabIndex" (both from tabs_list). Omitted = front tab.
export function parseTab(tab) {
  if (!tab) return {};
  const [w, t] = String(tab).split(":").map(Number);
  if (Number.isNaN(w) || Number.isNaN(t)) throw new Error(`Bad tab id "${tab}", expected "windowId:tabIndex"`);
  return { windowId: w, tabIndex: t };
}

export function listTabs() {
  return jxa(`
    return safari.windows().filter(w => { try { return w.document() !== null; } catch (e) { return false; } })
      .map(w => {
        const current = w.currentTab.index();
        return w.tabs().map((t, i) => ({
          id: w.id() + ":" + i,
          title: t.name(),
          url: t.url(),
          active: t.index() === current,
        }));
      }).flat();
  `);
}

export function createTab(url) {
  return jxa(`
    if (safari.windows.length === 0) safari.Document().make();
    const w = safari.windows[0];
    const tab = safari.Tab({ url: args.url || "about:blank" });
    w.tabs.push(tab);
    w.currentTab = tab;
    safari.activate();
    return w.id() + ":" + (w.tabs.length - 1);
  `, { url });
}

export function selectTab(tab) {
  return jxa(`
    const w = pickWindow();
    w.currentTab = w.tabs[args.tabIndex];
    w.index = 1;
    safari.activate();
    return true;
  `, parseTab(tab));
}

export function closeTab(tab) {
  return jxa(`pickTab().close(); return true;`, parseTab(tab));
}

export function setUrl(tab, url) {
  return jxa(`pickTab().url = args.url; return true;`, { ...parseTab(tab), url });
}

export function tabInfo(tab) {
  return jxa(`const t = pickTab(); return { title: t.name(), url: t.url() };`, parseTab(tab));
}

// Run synchronous JS in the page and return its (JSON-serialisable) value.
export async function evalSync(tab, code) {
  const wrapped = `JSON.stringify((function(){ ${code} })() ?? null)`;
  const raw = await jxa(`return safari.doJavaScript(args.code, { in: pickTab() });`, { ...parseTab(tab), code: wrapped });
  return raw == null ? null : JSON.parse(raw);
}

// Safari's do JavaScript can't await, so async code stashes its result on
// window and we poll for it.
export async function evalAsync(tab, code, timeoutMs = 30_000) {
  const key = "__mcp_" + Math.random().toString(36).slice(2);
  await evalSync(tab, `
    window[${JSON.stringify(key)}] = { done: false };
    (async () => { ${code} })().then(
      v => { window[${JSON.stringify(key)}] = { done: true, value: v === undefined ? null : v }; },
      e => { window[${JSON.stringify(key)}] = { done: true, error: String(e && e.stack || e) }; }
    );
    return true;
  `);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await evalSync(tab, `
      const r = window[${JSON.stringify(key)}];
      if (r && r.done) delete window[${JSON.stringify(key)}];
      return r;
    `);
    if (r && r.done) {
      if (r.error) throw new Error(r.error);
      return r.value;
    }
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error(`Script did not finish within ${timeoutMs} ms`);
}

export async function waitForLoad(tab, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  await new Promise((res) => setTimeout(res, 300));
  while (Date.now() < deadline) {
    try {
      if ((await evalSync(tab, "return document.readyState")) === "complete") return true;
    } catch {
      // page mid-navigation
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return false;
}

// Captures the Safari window region. Needs Screen Recording permission.
export async function screenshot(tab) {
  const b = await jxa(`
    const w = pickWindow();
    if (args.tabIndex != null) w.currentTab = w.tabs[args.tabIndex];
    w.index = 1;
    safari.activate();
    return w.bounds();
  `, parseTab(tab));
  await new Promise((res) => setTimeout(res, 250));
  const dir = await mkdtemp(join(tmpdir(), "safari-mcp-"));
  const file = join(dir, "shot.png");
  try {
    await run("screencapture", ["-x", "-o", "-R", `${b.x},${b.y},${b.width},${b.height}`, file]);
    // Keep the image a sensible size for the model.
    await run("sips", ["-Z", "1568", file]);
    return (await readFile(file)).toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const KEY_CODES = {
  return: 36, enter: 36, tab: 48, space: 49, backspace: 51, delete: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121,
  forwarddelete: 117,
};

// Real key presses via System Events. Needs Accessibility permission.
export async function pressKey(combo, repeat = 1) {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop();
  const mods = parts.map((m) => ({ cmd: "command down", command: "command down", meta: "command down",
    ctrl: "control down", control: "control down", alt: "option down", option: "option down",
    shift: "shift down" })[m]).filter(Boolean);
  const using = mods.length ? ` using {${mods.join(", ")}}` : "";
  const action = KEY_CODES[key] != null ? `key code ${KEY_CODES[key]}${using}` : `keystroke ${JSON.stringify(key)}${using}`;
  const lines = ['tell application "Safari" to activate', 'tell application "System Events"'];
  for (let i = 0; i < repeat; i++) lines.push(`  ${action}`);
  lines.push("end tell");
  try {
    await run("osascript", lines.flatMap((l) => ["-e", l]));
  } catch (err) {
    throw new Error(
      "Key press failed. Grant Accessibility permission to the app running this server " +
      `(System Settings > Privacy & Security > Accessibility). (${(err.stderr || err.message).trim()})`
    );
  }
}
