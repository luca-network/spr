# Changes

Versions apply to all four packages together: `@luca-network/spr`, `@luca-network/spr-sdk`, `@luca-network/spr-mcp` and `spr-sdk` for Python. The format is draft 1 throughout (`spr/draft-1`); a book written by any of these versions opens in any other.

## 0.1.2 (28 October 2026)

**New**
- **Key rotation.** `book.rotateKey({ reason })` (Python: `rotate_key(reason=...)`) replaces the book's key. The old key seals a handover to the new one in `keys.jsonl`, and records sealed before stay checkable with the old public key. Both checkers verify every handover, and the test vectors include good and bad handovers (SPEC section 3).
- **Several processes, one book.** Each write takes `book.lock` for a moment and first reads what other processes wrote, so two MCP servers, or a script beside a server, no longer risk sealing two versions of the same payment. JavaScript and Python use the same lock, so they can share a book too. A lock left by a killed process clears itself after 30 seconds.
- **Large books.** The book keeps an index and reads each file from where it last stopped, so sealing stays quick as a book grows (about half a millisecond a payment at 20,000 records). `sendToLuca` sends a book over one import's limits (4,000 records or 8 MB) in parts. Each part stands on its own, with every version of each payment it carries and the intents they name. `packageParts()` (Python: `package_parts()`) gives the parts.
- **Docs.** Examples of exporting and checking a package, with the checker's output. A plainer account of what a local check validates: the declared intent, its cap and expiry, and optionally the book's own `mandate.json`, reported as self-declared.

**Changed**
- `verifyRecord` checks a record with the key that sealed it, which after a rotation may be an earlier key.
- A package's manifest may say which part it is (`part: { index, of }`).

Nothing to change on upgrading from 0.1.1.

## 0.1.1 (28 October 2026)

**Changed: check these when upgrading from 0.1.0**
- **A time without its offset is refused.** `occurred_at` must carry `Z` or `±hh:mm`. Before, `2026-10-28T12:00:00` was read in the computer's own time zone, so the same input sealed a different moment on machines set to different zones. The agent tools now require `occurred_at`. A direct SDK call may still leave it out: the record then takes the time of sealing and says so in `occurred_at_source`.
- **A changed retry no longer becomes a new version on its own.** The same facts again still return `unchanged`. Different facts for a payment already sealed now return `status: "conflict"`, list what differs and seal nothing, unless you pass `correction: { reason }`. The reason is sealed into the new version. A pending payment that clears needs no reason.
- **`no_mandate` is now `none`.** Intents and pre-payment checks also carry `authority`: `"self-declared"` when the book's own `mandate.json` was checked, and `"none"` without one.

**New**
- `book.sendToLuca()` and `book.registerWithLuca()` (Python: `send_to_luca()`, `register_with_luca()`) send a book to Luca's hosted service. The MCP server offers `send_to_luca` when `LUCA_URL` and `LUCA_API_KEY` are set.
- A book's own folder checks as a book, with a note to share an export instead. A package holding a private key fails.
- The Python package carries the test vectors, so `python -m spr --vectors` works after `pip install`.
- The P-256 test key is RFC 6979's published key, and `vectors.json` changes only when the format does.
- Published with Trusted Publishing, with provenance on npm and attestations on PyPI.

## 0.1.0 (28 October 2026)

The first release: SPR draft 1, the reference library with its test vectors and `spr-verify`, the JavaScript SDK with `withLuca(fetch)` for x402 and tools for the OpenAI Agents SDK and LangChain, the MCP server, and the Python SDK.
