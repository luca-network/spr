# SPR: the Sealed Payment Record

SPR is an open format for the accounting record of a payment made or received by an AI agent. The company that makes the record seals it with its own key, and anyone holding the company's public key can check it. No service has to be trusted, Luca's included.

A record shows:
- what the agent declared before it paid: the purpose, the most it could spend, and when the permission expired;
- what was actually paid, on which rail, to whom and when;
- whether the payment stayed inside what was declared;
- for x402 payments, whether the chain itself recorded which declaration the payment was made under. The payer signs a fingerprint of the sealed intent as the payment's nonce.

This repository holds:

| Path | What it is |
|---|---|
| [`SPEC.md`](SPEC.md) | The format, draft 1 |
| [`packages/spr`](packages/spr) | `@luca-network/spr`, the reference library for JavaScript and TypeScript, with no dependencies, plus the test vectors and `spr-verify` |
| [`packages/spr-sdk`](packages/spr-sdk) | `@luca-network/spr-sdk`: seal your agents' payments locally, with `withLuca(fetch)` for x402 and tools for the OpenAI Agents SDK and LangChain |
| [`packages/spr-mcp`](packages/spr-mcp) | `@luca-network/spr-mcp`: the same calls as an MCP server, for Claude Desktop, Cursor or your own agent (`npx @luca-network/spr-mcp`) |
| [`python`](python) | `spr-sdk` for Python: the same format and the same books |

## Seal an x402 payment in one line

```js
import { SprBook } from "@luca-network/spr-sdk";
import { withLuca } from "@luca-network/spr-sdk/x402";

const book = new SprBook({ dir: "./books", agentId: "agt_research", entity: "Example Co" });
const pay = withLuca(book, { signer: account });

const res = await pay("https://data.example/prices", {
  luca: { purpose: "Market data for the pricing model", max_amount_minor: 20000, currency: "USDC" },
});
res.luca.record;   // sealed, matched to its intent, bound on chain
```

## Check anything without Luca

```
npx spr-verify ./books-export          # a package of records
npx spr-verify --vectors               # the library against the test vectors
python -m spr ./books-export
```

An implementation in any language conforms when it gives the same answers as `packages/spr/vectors/vectors.json`.

## Status

This is draft 1 of the format and version 0.1 of the libraries. We expect to change things as people use them. Tell us what breaks or what's missing: open an issue, or write to hello@luca.network.

## Licence

Apache License 2.0. See `LICENSE` and the front page of `SPEC.md`.

Luca (luca.network) uses SPR for its hosted accounting of agent payments. That covers reading the rails, classifying to US GAAP and IFRS, posting to the ERP, labels agreed with counterparties, and the close.
