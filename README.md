# SPR: the Sealed Payment Record

Your AI agent pays for data, compute and services, and your finance team and auditor can't see what each payment was for. SPR records every payment your agent makes, before and after it pays, sealed with your company's own key on your own machine. Anyone can check the seals. No service has to be trusted, Luca's included.

```
npx -y @luca-network/spr-mcp
```

Free and open: Apache-2.0, with a royalty-free patent commitment ([`PATENTS.md`](PATENTS.md)).

## Use it from your AI tool

Every setup below runs the same MCP server on your machine. Set `SPR_AGENT_ID` (your agent) and `SPR_ENTITY` (the company it pays for); records go to `SPR_DIR`.

**Claude Desktop**: add to `claude_desktop_config.json`:

```json
{ "mcpServers": { "spr": { "command": "npx", "args": ["-y", "@luca-network/spr-mcp"],
  "env": { "SPR_AGENT_ID": "agt_research", "SPR_ENTITY": "Example Co", "SPR_DIR": "/Users/you/spr-books" } } } }
```

**Cursor**: the same block in `.cursor/mcp.json`.

**Claude Code**:

```
claude mcp add spr -e SPR_AGENT_ID=agt_research -e SPR_ENTITY="Example Co" -- npx -y @luca-network/spr-mcp
```

**OpenAI Agents SDK** and **LangChain** (JavaScript):

```js
import { SprBook, toOpenAIAgentsTools, toLangChainTools } from "@luca-network/spr-sdk";
const book = new SprBook({ dir: "./books", agentId: "agt_research", entity: "Example Co" });
const tools = toOpenAIAgentsTools(book, tool);   // tool from "@openai/agents"; or toLangChainTools(book, tool)
```

**CrewAI, Microsoft Agent Framework, Google ADK and the Claude Agent SDK** (Python): each connects to the MCP server in a few lines. See [`examples/`](examples).

**Any other MCP client**: run `npx -y @luca-network/spr-mcp` over stdio with the two settings above.

The agent then calls `record_intent` before it pays, `check_payment` to see whether the payment is inside what it declared, and `record_settlement` after it pays. Each record is sealed in the book's folder.

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
npx spr-verify ./books-export --key company.pem    # a package, and whose it is
python -m spr ./books-export --key company.pem
npx spr-verify --vectors                           # the library against the test vectors
python -m spr --vectors                            # the Python SDK against the same vectors
```

`company.pem` is the company's public key, obtained from the company and never from the package (`book.publicKey()` gives it). Without `--key` the checkers show only that a package is consistent with the keys it carries, and say so.

Security problems: see [`SECURITY.md`](SECURITY.md).

An implementation in any language conforms when it gives the same answers as `packages/spr/vectors/vectors.json`.

## Local SPR and hosted Luca

The packages here run on your own machine and make no call to Luca. Luca's hosted service is a separate product that a book can be sent to.

| | Local SPR (these packages) | Hosted Luca |
|---|---|---|
| Where it runs | Your machine, your folder, your key | Luca's service |
| What it records | The intent before paying and the payment after, as the agent reports them | The same, plus the payment as the rail itself reports it |
| Limits it checks | The declared intent: its cap, its expiry, and whether it was withdrawn. Optionally the book's own `mandate.json`, which whoever keeps the folder writes, so it is reported as `authority: "self-declared"` | Mandates your finance team approves in Luca |
| Confirmation from the rail | None: the record is what the agent reported | The payment read from the rail, and any difference flagged |
| Accounting | None | Classification to your accounts (US GAAP, IFRS, tax), journal entries posted to your ERP, the month's close |
| Evidence | Seals anyone can check with `spr-verify` or `python -m spr` | Evidence your auditor can check, and the month's audit package |
| Cost | Free, Apache-2.0 | A Luca account |

A book moves across with one call once finance has registered its key: `book.sendToLuca()`. Luca checks every seal before it stores anything.

## Send the book to Luca (optional)

Finance registers the book's key with Luca once (`book.registerWithLuca`), and then `book.sendToLuca()` sends the book. Luca checks every seal before it stores anything, and sending the same book again changes nothing. Write to hello@luca.network for an account.

## Changes

What changed in each version, and what you may need to change on upgrading: [`CHANGELOG.md`](CHANGELOG.md).

## Status

This is draft 1 of the format and version 0.1 of the libraries. We expect to change things as people use them. Tell us what breaks or what's missing: open an issue, or write to hello@luca.network.

## License

Apache License 2.0 for the code: see `LICENSE`. Luca's patent commitment, which lets anyone implement the format with or without this code, is in `PATENTS.md`.

Luca (luca.network) uses SPR for its hosted accounting of agent payments. That covers reading the rails, classifying to US GAAP and IFRS, posting to the ERP, labels agreed with counterparties, and the close.
