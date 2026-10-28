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
python -m spr --vectors                # the Python SDK against the same vectors
```

An implementation in any language conforms when it gives the same answers as `packages/spr/vectors/vectors.json`.

## Local SPR and hosted Luca

The packages here run on your own machine and make no call to Luca. Luca's hosted service is a separate product that a book can be sent to.

| | Local SPR (these packages) | Hosted Luca |
|---|---|---|
| Where it runs | Your machine, your folder, your key | Luca's service |
| What it records | The intent before paying and the payment after, as the agent reports them | The same, plus the payment as the rail itself reports it |
| Limits it checks | The intent's cap and expiry, and the book's own `mandate.json`, which whoever keeps the book writes (`authority: "self-declared"`) | Mandates finance approves in Luca, checked before and after each payment |
| Confirmation from the rail | None: the record is what the agent reported | The payment read from the rail, and any difference flagged |
| Accounting | None | Classification to your accounts (US GAAP, IFRS, tax), journal entries posted to your ERP, the month's close |
| Evidence | Seals anyone can check with `spr-verify` or `python -m spr` | Hourly evidence with outside timestamps, and the audit package |
| Cost | Free, Apache-2.0 | A Luca account |

A book moves across with one call once finance has registered its key: `book.sendToLuca()`. Luca checks every seal before it stores anything.

## Send the book to Luca (optional)

A finance user registers the book's key once (`book.registerWithLuca`), a second person approves it, and then `book.sendToLuca()` sends the book. Luca checks every seal before it stores anything, and sending the same book again changes nothing. Write to hello@luca.network for an account.

## Status

This is draft 1 of the format and version 0.1 of the libraries. We expect to change things as people use them. Tell us what breaks or what's missing: open an issue, or write to hello@luca.network.

## Licence

Apache License 2.0. See `LICENSE` and the front page of `SPEC.md`.

Luca (luca.network) uses SPR for its hosted accounting of agent payments. That covers reading the rails, classifying to US GAAP and IFRS, posting to the ERP, labels agreed with counterparties, and the close.
