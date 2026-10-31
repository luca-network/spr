// The book's calls as tools an agent framework can hand to a model: plain JSON Schema, so they work with the
// OpenAI Agents SDK, LangChain and any framework that takes JSON Schema, with no dependency on either.
//
//   import { tool } from "@openai/agents";          const tools = toOpenAIAgentsTools(book, tool);
//   import { tool } from "@langchain/core/tools";   const tools = toLangChainTools(book, tool);
//
// Each tool answers JSON text. A tool that fails answers { error } so the model can read why.
const str = { type: "string" };
const int = { type: "integer" };
const feeParams = {};
const CAP = "The most you may pay";
const FEES_NOTE = "";
const obj = (properties, required = []) => ({ type: "object", properties, required });

export function sprTools(book) {
  return [
    { name: "record_intent", description: "Call this first, whenever you are about to pay for anything (an x402 request, an API, data, compute, a card or Stripe payment): declare what you are buying and why, before paying. Sealed in your company's book. Amounts are integers in the currency's minor unit (cents; 6 decimals for USDC).",
      parameters: obj({ purpose: { type: "string", description: "Why you are paying, in one sentence. This is what an auditor reads." }, counterparty: str,
        expected_amount_minor: int, max_amount_minor: { type: "integer", minimum: 1, description: CAP },
        currency: str, rail: str, expires_in: { type: "string", description: "ISO 8601 duration (PT1H, P3D)" } }, ["purpose"]),
      run: (a) => book.declare(a) },
    { name: "check_payment", description: "Call this after record_intent and just before you pay: is the payment inside an open intent, and inside the book's own limits (mandate.json, if the company set one)? Returns approve or decline with the reasons. If it says decline, do not pay. The book's limits are set by whoever keeps the book (authority: self-declared), so an approval is not authority granted by anyone else.",
      parameters: obj({ amount_minor: int, currency: str, counterparty: str, intent_id: str, nonce: str, ...feeParams }, ["amount_minor", "currency"]),
      run: (a) => book.checkPayment(a) },
    { name: "record_settlement", description: "Call this right after each payment succeeds, with the rail's own reference. Records the payment: sealed, matched to its intent, checked against its cap and expiry. The same payment again returns unchanged. Different facts for a payment already sealed return conflict and seal nothing, unless you give correction: { reason }." + FEES_NOTE,
      parameters: obj({ rail: str, source_id: { type: "string", description: "The rail's own reference: transaction hash, charge ID" }, amount_minor: int, currency: str,
        occurred_at: { type: "string", description: "When the rail says the payment was made, in ISO 8601 with its offset (2026-10-28T19:00:00Z or 2026-10-28T12:00:00-07:00)" },
        counterparty: str, intent_id: str, memo: str, nonce: str,
        correction: { type: "object", properties: { reason: { type: "string", description: "Why the sealed record was wrong" } }, required: ["reason"],
          description: "Only to correct a payment already sealed: the new version says why" },
        state: { type: "string", enum: ["cleared", "pending"] }, direction: { type: "string", enum: ["outflow", "inflow"] }, ...feeParams },
        ["rail", "source_id", "amount_minor", "currency", "occurred_at"]),
      run: (a) => {
        if (!a?.occurred_at) throw new Error("occurred_at is required: when the rail says the payment was made, with its offset, such as 2026-10-28T19:00:00Z");
        return book.seal(a);
      } },
    { name: "cancel_intent", description: "Call this when you decide not to pay an intent you declared, or the purchase is no longer needed. Withdraws it; say why.", parameters: obj({ intent_id: str, reason: str }, ["intent_id", "reason"]),
      run: (a) => book.cancelIntent(a.intent_id, a.reason) },
    { name: "get_intent", description: "Look up one of your intents to see whether it is open, matched, expired or withdrawn, such as before paying against an older intent.", parameters: obj({ intent_id: str }, ["intent_id"]),
      run: (a) => book.getIntent(a.intent_id) },
    { name: "verify_record", description: "Call this when someone asks whether a record is genuine: checks that a record in your company's book is intact and signed by its key.", parameters: obj({ record_id: str }, ["record_id"]),
      run: (a) => book.verifyRecord(a.record_id) },
  ];
}
const answer = (fn) => async (a) => { try { return JSON.stringify(await fn(a ?? {})); } catch (e) { return JSON.stringify({ error: String(e?.message ?? e) }); } };

// OpenAI Agents SDK: pass its `tool` function. strict is off because the schemas have optional fields.
export const toOpenAIAgentsTools = (book, tool) =>
  sprTools(book).map((t) => tool({ name: t.name, description: t.description, parameters: { ...t.parameters, additionalProperties: false }, strict: false, execute: answer(t.run) }));

// LangChain: pass the `tool` function from @langchain/core/tools.
export const toLangChainTools = (book, tool) =>
  sprTools(book).map((t) => tool(answer(t.run), { name: t.name, description: t.description, schema: t.parameters }));
