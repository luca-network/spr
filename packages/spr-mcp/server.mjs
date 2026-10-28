// SPR as an MCP server: the book's calls as tools for any MCP client (Claude Desktop, Cursor, an agent of
// your own). Records are sealed with your company's own key in a folder on your own machine; no call to
// Luca. The tools are the SDK's own (sdk/js/tools.mjs), so the server gains whatever the SDK gains.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { sprTools, SDK_PRODUCER } from "@luca-network/spr-sdk";

const obj = (properties, required = []) => ({ type: "object", properties, required });

// The SDK's tools, and two that only make sense on a long-running server: listing the book and exporting it.
// With Luca's address and an API key (opts.luca, or LUCA_URL and LUCA_API_KEY for the command), a third sends the
// book to Luca's hosted service.
export function mcpTools(book, opts = {}) {
  return [
    ...sprTools(book),
    { name: "list_records", description: "The current version of each payment in your company's book (all versions with all: true).",
      parameters: obj({ all: { type: "boolean" } }), run: (a) => book.listRecords({ all: a?.all }), readOnly: true },
    { name: "export_package", description: "Copy the book to a folder with a sealed manifest, for an auditor, a counterparty or Luca. Anyone checks it with spr-verify.",
      parameters: obj({ folder: { type: "string", description: "Where to write the package" } }, ["folder"]), run: (a) => book.exportPackage(a.folder) },
    ...(opts.luca ? [{ name: "send_to_luca", description: "Send the book to Luca, which checks every seal, then classifies each payment and posts it to the company's books. Sending it again changes nothing.",
      parameters: obj({}), run: () => book.sendToLuca(opts.luca) }] : []),
  ];
}
const READ_ONLY = new Set(["get_intent", "verify_record", "list_records"]);

export function createSprMcpServer(book, opts = {}) {
  const tools = mcpTools(book, opts);
  const server = new Server({ name: opts.name ?? "spr", version: opts.version ?? SDK_PRODUCER.version }, {
    capabilities: { tools: {} },
    instructions: "SPR keeps the accounting record of what you pay for, sealed with your company's own key in your company's own folder. " +
      "Call record_intent just before paying, with the purpose and the most you may pay (max_amount_minor). " +
      (opts.binding ? "When paying over x402, sign with the nonce returned in binding.nonce so the payment is bound to the intent on chain. " : "") +
      "Call check_payment before paying if you can, and do not pay if it declines. Call record_settlement after paying. " +
      "Amounts are integers in the currency's minor unit (cents; 6 decimals for USDC). Nothing here moves or blocks money.",
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters,
      ...(READ_ONLY.has(t.name) ? { annotations: { readOnlyHint: true } } : {}) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const t = tools.find((x) => x.name === req.params.name);
    if (!t) return { isError: true, content: [{ type: "text", text: `No tool ${req.params.name}` }] };
    try { return { content: [{ type: "text", text: JSON.stringify(await t.run(req.params.arguments ?? {}), null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] }; }
  });
  return server;
}
