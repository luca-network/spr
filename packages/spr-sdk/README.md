# SPR SDK for JavaScript and TypeScript

Seal your AI agents' payments as SPR records (the Sealed Payment Record, `lib/spr/SPEC.md`) on your own machine, with your company's own key. No call to Luca. Apache-2.0.

The SDK seals at the two moments that matter:

- **Declare before paying:** what the agent is buying, why, and the most it may pay. This returns the intent's nonce. Signed as the payment's nonce, it makes the rail itself record which intent the payment was made under.
- **Seal after paying:** the payment, matched to its intent, checked against the intent's window and cap.

## Requirements

Node.js 20 or later. The packages are ES modules: load them with `import`, not `require`.

## What the book checks

The book runs on your machine and makes no call to Luca. Before and after each payment it checks the payment against the agent's declared intent: the cap, the expiry, and whether the intent was withdrawn.

Before paying, `check_payment` also checks who is paid and whether it was paid already:

- **The payee.** Give the intent a `payee_id` (`wallet:0x…`, `domain:data.example`) and a payment to anyone else is declined. The x402 wrapper checks the address the seller's payment request actually asks to be paid, before anything is signed, so a tampered request or a prompt-injected payee is refused.
- **The same invoice twice.** Give `invoice_ref` to `check_payment` and `record_settlement`, and a second payment of that invoice is declined, naming the record that paid it.

You can also put an optional `mandate.json` in the book's folder: one limit across all the agent's intents (currency, most per payment, dates), the payees it may pay (`payees`), and how long the same amount to the same payee counts as a repeat (`duplicate_window`, such as `P1D`):

```json
{ "mandate_id": "ap-2026", "currency": "USD", "max_per_payment_minor": 500000,
  "payees": ["domain:acme.example", { "id": "wallet:0x59dd0305c70fdd714d9a022a1b0daf93e7dcec6d", "name": "Veridian Data" }],
  "duplicate_window": "P1D" }
```

Keep `mandate.json` where the agent can't write: an agent that can edit the file can add its own payee. Whoever keeps the folder writes that file, so results report it as `authority: "self-declared"` (or `"none"` without one). It shows the agent kept to limits the company set for itself. Spending authority granted by someone else needs that party's own record, such as a mandate approved in Luca's hosted service.

Times need their offset (`2026-10-28T19:00:00Z`); a time without one is refused. The same payment again returns `unchanged`. Different facts for a payment already sealed return `conflict` and seal nothing, unless you pass `correction: { reason }`, which is sealed into the new version.

## x402: one line

```js
import { SprBook } from "@luca-network/spr-sdk";
import { withLuca } from "@luca-network/spr-sdk/x402";

const book = new SprBook({ dir: "./books", agentId: "agt_research", entity: "Example Co" });
const pay = withLuca(book, { signer: account });          // a viem account
// In each call, luca: { purpose, max_amount_minor, currency, payee_id: "wallet:0x…", invoice_ref } (payee_id and invoice_ref optional)

const res = await pay("https://data.example/prices", {
  luca: { purpose: "Market data for the pricing model", max_amount_minor: 20000, currency: "USDC" },
});
res.luca.record;   // { status: "recorded", binding: "bound", within_consent: true, ... }
```

Each call that carries `luca` options goes through these steps:
1. The intent is declared.
2. The payment is checked before anything is signed. A payment over the cap is declined, nothing is signed, and the intent is withdrawn.
3. The payment is signed with the intent's nonce, with the signature expiring no later than the intent.
4. The record is sealed.

Sellers and facilitators change nothing. A call without `luca` options passes straight through.

## OpenAI Agents SDK and LangChain

```js
import { tool } from "@openai/agents";
import { toOpenAIAgentsTools } from "@luca-network/spr-sdk";
const agent = new Agent({ name: "buyer", tools: toOpenAIAgentsTools(book, tool) });
```

```js
import { tool } from "@langchain/core/tools";
import { toLangChainTools } from "@luca-network/spr-sdk";
const tools = toLangChainTools(book, tool);
```

The tools are `record_intent`, `check_payment`, `record_settlement`, `cancel_intent`, `get_intent` and `verify_record`, all as plain JSON Schema. `sprTools(book)` gives the same tools for any other framework.

## Facts for the Machine Payment Profile

A book can carry the facts the draft Machine Payment Profile for XBRL GL asks for. Each is sealed only when given (`rfcs/0001-machine-payment-profile.md` names them):

```js
const book = new SprBook({ dir: "./books", agentId: "agt_research", entity: "Example Co",
  agentType: "autonomous-agent", agentProvider: "Example Co", agentVersion: "2.3.0",
  entityType: "organization", entityIdentifier: "lei:5493001KJTIIGC8Y1R12" });
book.declare({ purpose: "Market data for the weekly pricing report", product: "pro-monthly", max_amount_minor: 20000000, currency: "USDC" });
book.seal({ rail: "x402", source_id: txHash, amount_minor: 15000000, currency: "USDC", occurred_at, intent_id,
  network: "base", evidence_type: "onchain", settlement_provider: "facilitator.example",
  counterparty_type: "service", counterparty_id: "domain:data.example", receipt: { ref: "s3://receipts/123.pdf", sha256 },
  order_id: "ORD-1042", processor_transaction_id: "ch_3Pz" });
book.exportXbrlCsv("./xbrl");   // mpp-report.json and mpp-payments.csv
```

A `mandate.json` may also name its `issuer` and `scope`; each intent then carries the mandate's reference and a hash of it.

## For merchants: buyer authorization and dispute evidence

A merchant keeps its own book and records each payment it receives (`direction: "inflow"`). When the buyer's agent presents its sealed intent at checkout, record it with the buyer's public key; the book checks the seal with that key and compares the payment with the intent (declared before, not expired, within its cap). Add how the buyer authenticated, and the order and processor references:

```js
const r = shop.seal({ rail: "stripe", source_id: "pi_…", amount_minor: 19999, currency: "USD", occurred_at, direction: "inflow",
  order_id: "ORD-1042", processor_transaction_id: "ch_3Pz…",
  buyer_intent: sealedIntent, buyer_key: { public_pem: buyerPublicPem, entity: "Northwind Analytics" },
  buyer_authentication: { method: "3ds", result: "authenticated", reference: "3ds-tx-…", eci: "05", provider: "Stripe", at } });
const pack = shop.exportDisputePack(r.record_id, "./dispute-ORD-1042", { delivery: { method: "digital", delivered_at, reference: "download-5521" } });
pack.summary;   // the evidence in plain words, for the dispute response
```

The folder holds every version of the record, the buyer's sealed intent and key, a sealed `dispute.json` and the same statement in `summary.txt`, under a sealed manifest. Anyone checks it with `spr-verify <folder> --key <merchant key> --buyer-key <buyer key>`. The evidence supports a dispute response; whether to submit it is the merchant's decision, and the outcome is the card network's.

## Labels

- `book.label(recordId, { counterparty, product, tax })` seals your side of the label.
- `book.counterpartySignature(labelId, jwk, signature)` records the other side's agreement.

## Export and check a package

Give an auditor or a counterparty an export, never the book's folder, which holds the private key.

```js
const out = book.exportPackage("./books-export");
out.verified;   // true: the export checked itself before returning
```

Anyone can then check it with no Luca code, in either language. Give the checker the company's public key, obtained from the company and never from the package, to check whose package it is:

```
npx spr-verify ./books-export --key company-public-key.pem     # or --key ed25519:<key ID>
python -m spr ./books-export --key company-public-key.pem
```

`book.publicKey()` gives the key to hand out. Without `--key`, the result ends "consistency only": the package agrees with the keys it carries, which anyone can arrange with a key of their own.

For a book with one intent and one payment bound to it:

```
  PASS  manifest.json is present
  PASS  the manifest is sealed
  PASS  keys.jsonl is the file the manifest names
  PASS  intents.jsonl is the file the manifest names
  PASS  records.jsonl is the file the manifest names
  PASS  intent int_8aadb8e14f8aed2da11d is sealed
  PASS  intent int_8aadb8e14f8aed2da11d has the core fields
  PASS  record LR-X402-79F5ABBB13-v1 is sealed
  PASS  record LR-X402-79F5ABBB13-v1 has the core fields
  PASS  record LR-X402-79F5ABBB13-v1: its intent is in the package
  PASS  record LR-X402-79F5ABBB13-v1: it names the intent's sealed hash
  PASS  record LR-X402-79F5ABBB13-v1: bound only when the nonce is the intent's fingerprint

12 passed, 0 failed · verified against the company key you gave
```

Change one byte of a record and the same command reports `FAIL` for that record's seal and for the file's hash in the manifest, and exits with code 1. Pointed at the book's own folder, the checkers check every seal and say to share an export instead.

## Send the book to Luca (optional)

The book works on its own. To have each payment kept as accounting (confirmed from the rail, classified to your accounts, posted to your ERP), send it to Luca's hosted service. Luca checks every seal before it stores anything.

```js
// Once: finance registers the book's key with Luca.
await book.registerWithLuca({ url: "https://sandbox.luca.network", apiKey: FINANCE_KEY, entityId: "acme-us" });

// Then, whenever you like (each day, after each payment): sending the same book again changes nothing.
const sent = await book.sendToLuca({ url: "https://sandbox.luca.network", apiKey: LUCA_API_KEY });
sent.created; sent.versioned; sent.unchanged;
```

`url` and `apiKey` default to `LUCA_URL` and `LUCA_API_KEY`. The address must be https: the book and the key are never sent unencrypted, and a redirect is refused. For a Luca running on your own computer during development, set `LUCA_ALLOW_INSECURE_LOCAL=1`. Only the package's files are sent, never the private key. A book over one import's limits (4,000 records or 8 MB) goes in parts, each of which checks on its own; the answer then says how many parts went and adds up their counts.

## Keys

By default the book creates an Ed25519 key in its folder, readable only by its owner (on Windows, the file's access list names only you). Pass `key` to use one from your operating system's keychain or secrets manager instead. Keep the folder out of source control. A folder inside OneDrive, Dropbox, iCloud or Google Drive is refused, because the key would be uploaded; pass `allowSyncedFolder: true` only if you accept that. The vectors' published test keys are refused.

To replace the key, call `book.rotateKey({ reason })`. The book seals a handover with the old key, adds the new public key to `keys.jsonl`, and seals from then on with the new key. Records sealed before stay checkable with the old public key. If Luca keeps the book, the next send registers the new key through the handover. If you passed the key in, pass the new one too: `book.rotateKey({ key })`.

## Several processes, one book

An MCP server and a script, or an agent run twice, can use the same folder. Each write takes `book.lock` for a moment and reads what the others wrote first, so nothing is lost and each payment is sealed once. If a process is killed while holding the lock, the lock clears itself after 30 seconds.
