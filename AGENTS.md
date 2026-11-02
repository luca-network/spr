# Guidance for AI coding agents

This repository holds SPR, the Sealed Payment Record: the format (`SPEC.md`), its reference library and checker (`packages/spr`), the JavaScript SDK (`packages/spr-sdk`), the MCP server (`packages/spr-mcp`) and the Python SDK (`python/`). Read `SPEC.md`, `GOVERNANCE.md` and `CONTRIBUTING.md` before changing anything.

## Rules that hold everywhere

1. **A sealed record is never changed.** A correction is a new version with `supersedes`; the earlier version stays.
2. **The format changes only through an RFC** (`rfcs/`, under `GOVERNANCE.md`). Canonical JSON, hashing, seals and the intent nonce are in `packages/spr/index.mjs` and `python/spr/format.py`; a change there needs the specification changed with it and the test vectors regenerated (`npm run vectors`), and must keep every existing record checking.
3. **A seal proves a record is intact and who sealed it.** It does not prove the payment settled. A record the agent reported says `reported_by: "agent"`; never describe it as confirmed by the rail.
4. **The private key never leaves the book's folder.** `key.pem` must not appear in an export, a test fixture, a log or a commit.
5. **Money is an integer in the asset's minor unit** (cents; 6 decimals for USDC). Never a float.
6. **Accounting, classification and posting to an ERP are outside this repository**, as `GOVERNANCE.md` says. They belong in products built on SPR.

## Before opening a pull request

```
npm test
node packages/spr/bin/spr-verify.mjs --vectors
cd python && python -m unittest discover -s tests
```

Every snippet in documentation must run against the current version. Write in American English. Sign off each commit (`git commit -s`).
