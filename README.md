# safari-browser-mcp

Let Claude drive **Safari** the way Claude in Chrome drives Chrome.

This is an [MCP](https://modelcontextprotocol.io) server for macOS. Hook it up to Claude Code, the Claude desktop app or any other MCP client, and Claude can open tabs, read pages, click, fill forms, press keys, run JavaScript and take screenshots in your real Safari, with your real sign-ins.

> Unofficial community project. Not affiliated with or endorsed by Anthropic or Apple.

## How it works

Claude in Chrome is a Chrome extension. Safari can't run it, but Safari has a built-in scripting interface, so this server controls Safari from the outside:

- **Tabs and navigation** go through Safari's JavaScript for Automation API (`osascript -l JavaScript`).
- **Reading and interacting with pages** uses Safari's `do JavaScript` to run small scripts inside the tab. Elements get stable `ref_N` ids so Claude can click or type into them later.
- **Screenshots** use `screencapture` on the Safari window.
- **Key presses** use System Events.

No browser extension and no Safari WebDriver session is needed. Claude works in the Safari you already have open.

## Tools

| Tool | What it does |
|---|---|
| `tabs_list` | List open tabs (`windowId:tabIndex`, title, URL) |
| `tabs_create` | Open a new tab, optionally at a URL |
| `tabs_select` / `tabs_close` | Bring a tab to the front / close it |
| `navigate` | Load a URL, or `back` / `forward` / `reload` |
| `get_page_text` | Readable text of the page |
| `read_page` | Outline of the page with `[ref_N]` ids for interactive elements |
| `find` | Search elements by role, name or text |
| `click` | Click by ref or CSS selector |
| `form_input` | Set inputs, textareas, selects, checkboxes; optionally submit |
| `press_key` | Real key presses, e.g. `Return`, `cmd+l`, `shift+tab` |
| `scroll` | Scroll the page or scroll an element into view |
| `javascript` | Run JS in the page (`await` allowed, `return` a value) |
| `screenshot` | PNG of the Safari window |

Every page tool takes an optional `tab`. Without it, it uses the active tab of the front window.

## Setup

Requires macOS and Node.js 18 or newer.

```bash
git clone https://github.com/<you>/safari-browser-mcp.git
cd safari-browser-mcp
npm install
```

### 1. Let Safari run JavaScript from automation

1. Safari > Settings > Advanced > turn on **Show features for web developers**.
2. In the menu bar: **Develop > Allow JavaScript from Apple Events**.

### 2. Add it to Claude

**Claude Code:**

```bash
claude mcp add safari -- node /absolute/path/to/safari-browser-mcp/src/index.js
```

**Claude desktop app:** add this to `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart the app:

```json
{
  "mcpServers": {
    "safari": {
      "command": "node",
      "args": ["/absolute/path/to/safari-browser-mcp/src/index.js"]
    }
  }
}
```

### 3. Approve the macOS prompts

The first time Claude uses it, macOS asks for permission for the app that runs the server (Terminal, iTerm, Claude, …):

| Permission | Needed for | Where |
|---|---|---|
| Automation → Safari | everything | prompted automatically |
| Screen Recording | `screenshot` | System Settings > Privacy & Security |
| Accessibility | `press_key` | System Settings > Privacy & Security |

### Check it works

With Safari open:

```bash
npm run smoke
```

It prints the tool list and your open tabs.

## Try it

> Open a new Safari tab, search Hacker News for "MCP" and summarise the top three results.

> In my current Safari tab, fill in the contact form with test data but don't submit it.

## Limits

- `click` and `form_input` dispatch DOM events. They work on almost all sites, but a site that checks `event.isTrusted` will ignore them. Use `press_key` or `javascript` as a fallback.
- Pages inside cross-origin iframes can't be read or controlled.
- `screenshot` and `press_key` bring Safari to the front.
- Private windows can't be scripted.

## Safety

Claude acts as you, in your signed-in browser. Watch what it does, keep sensitive tabs closed, and don't let it act on instructions it reads on web pages.

## License

MIT
