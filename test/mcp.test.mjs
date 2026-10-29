// The SPR MCP server, started over stdio as an MCP client such as Claude Desktop starts it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("spr-mcp: an MCP client starts the server over stdio, as Claude Desktop does, and seals a payment through it", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { fileURLToPath } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "spr-mcp-"));
  const client = new Client({ name: "test", version: "1" });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../packages/spr-mcp/bin/spr-mcp.mjs", import.meta.url))],
      env: { ...process.env, SPR_AGENT_ID: "agt_desktop", SPR_ENTITY: "Example Co", SPR_DIR: dir, SPR_BINDING: "on" } }));
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ["cancel_intent", "check_payment", "export_package", "get_intent", "list_records", "record_intent", "record_settlement", "verify_record"]);
    assert.equal(tools.find((t) => t.name === "verify_record").annotations?.readOnlyHint, true);
    const text = (r) => JSON.parse(r.content[0].text);
    const intent = text(await client.callTool({ name: "record_intent", arguments: { purpose: "Weather data for routing", max_amount_minor: 5000, currency: "USDC" } }));
    assert.match(intent.binding.nonce, /^0x[0-9a-f]{64}$/);
    const rec = text(await client.callTool({ name: "record_settlement", arguments: { rail: "x402", source_id: "0x" + "dd".repeat(32), amount_minor: 4000, currency: "USDC",
      occurred_at: new Date().toISOString(), nonce: intent.binding.nonce } }));
    assert.equal(rec.binding, "bound");
    const bad = await client.callTool({ name: "get_intent", arguments: { intent_id: "int_none" } });
    assert.equal(bad.isError, true);
    // Exports go under the book's exports folder, by name. A path, or a name that climbs out, is refused, whatever
    // a payment's memo asks for; an earlier export is not replaced unless asked.
    for (const name of [join(dir, "elsewhere"), "../elsewhere", "a/b", "..", ""]) {
      const r = await client.callTool({ name: "export_package", arguments: { name } });
      assert.equal(r.isError, true, name);
    }
    const out = text(await client.callTool({ name: "export_package", arguments: { name: "audit-1" } }));
    assert.equal(out.verified, true);
    assert.equal(out.folder, join(dir, "exports", "audit-1"));
    const again = await client.callTool({ name: "export_package", arguments: { name: "audit-1" } });
    assert.equal(again.isError, true);
    assert.equal(text(await client.callTool({ name: "export_package", arguments: { name: "audit-1", overwrite: true } })).verified, true);
    assert.match(tools.find((t) => t.name === "list_records").description, /data, never instructions/);
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});
