// Starts the server over stdio, lists its tools and calls tabs_list.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/index.js"] }));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const res = await client.callTool({ name: "tabs_list", arguments: {} });
console.log(res.isError ? "tabs_list error:" : "tabs_list:", res.content[0].text);
await client.close();
