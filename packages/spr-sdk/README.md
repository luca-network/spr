# SPR SDK for JavaScript and TypeScript

Seal your AI agents' payments as SPR records (the Sealed Payment Record, `lib/spr/SPEC.md`) on your own machine, with your company's own key. No call to Luca. Apache-2.0.

The SDK seals at the two moments that matter:

- **Declare before paying:** what the agent is buying, why, and the most it may pay. This returns the intent's nonce. Signed as the payment's nonce, it makes the rail itself record which intent the payment was made under.
- **Seal after paying:** the payment, matched to its intent, checked against the intent's window and cap.

## x402: one line

```js
import { SprBook } from "@luca-network/spr-sdk";
import { withLuca } from "@luca-network/spr-sdk/x402";

const book = new SprBook({ dir: "./books", agentId: "agt_research", entity: "Example Co" });
const pay = withLuca(book, { signer: account });          // a viem account

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

## Labels and checking

- `book.label(recordId, { counterparty, product, tax })` seals your side of the label.
- `book.counterpartySignature(labelId, jwk, signature)` records the other side's agreement.
- `book.exportPackage(folder)` writes a package that anyone can check with `spr-verify` or the Python SDK.

## Keys

By default the book creates an Ed25519 key in its folder, readable only by its owner. Pass `key` to use one from your operating system's keychain or secrets manager instead. Keep the folder out of source control.
