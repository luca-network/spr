# AGENTS.md – Luca Records SPR Repository

This file governs how AI coding agents (Claude, Codex, etc.) work in this repository.
Read it before making any changes.

---

## Architectural invariants

1. **SPR signed core is immutable.** `packages/spr/index.mjs` and `python/spr/format.py` implement
   the SPR specification (SPEC.md). Do NOT modify canonicalization, seal/verify logic, or the test
   vectors without a matching spec change and full vector regeneration.

2. **Records are never rewritten.** Corrections create a new version via `supersedes`; old versions
   remain. Never mutate a sealed record in place.

3. **Accounting files are separate from signed SPR files.** `accounting-transactions.csv`,
   `journal-entries.csv`, `exceptions.csv`, and `accounting-export-manifest.json` are ADDITIONAL
   output alongside the unchanged SPR package. They are not part of the sealed manifest.

4. **Classification does not change signed records.** Classification runs over record payloads
   after sealing; results live in accounting output only.

5. **Journal status.** Journals are always DRAFT, NEEDS_REVIEW, or VERIFIED_EVIDENCE. The POSTED
   status does not exist in this codebase. Posting requires an external ERP write.

6. **Settlement confidence.** Local SPR records what the agent reported. Only Luca's hosted
   service can confirm rail settlement. Never assert that a valid seal proves payment settled.

---

## Security constraints

- `key.pem` MUST NEVER appear in any export package or CI artifact.
- Private key material MUST NOT appear in any log, CSV, JSON, or commit.
- No ERP writes in automated tests; use fixtures and test books only.
- Do not hardcode real customer GL account numbers.
- Hook scripts MUST NOT pipe private records or secrets to external services.

---

## Test commands

```bash
# All Node.js tests (vectors + SDK + MCP + accounting):
npm test

# SPR test vectors only:
node packages/spr/bin/spr-verify.mjs --vectors

# Python tests:
cd python && python3 -m unittest discover -s tests

# Security scans:
semgrep --config=auto packages/spr-sdk/ python/spr/
bandit -r python/spr/
```

---

## Source of truth

| Topic | File |
|-------|------|
| SPR format | `SPEC.md` |
| SDK overview | `README.md` |
| Gap analysis | `docs/engineering/SPR_EXPORT_GAP_MATRIX.md` |
| Architecture decisions | `docs/adr/` |
| Hook documentation | `docs/engineering/HOOKS.md` |
| Tutorial content | `docs/tutorials/` |
| Test vectors | `packages/spr/vectors/vectors.json` |

---

## Cost-aware workflow

- Prefer local tests (`npm test`, `python -m unittest`) over CI runs.
- Do not push branches or create PRs without explicit human approval.
- Do not trigger GitHub Actions by accident: CI runs on `push` and `pull_request`.
- The Codex review is a paid one-time step: run it at most once per release cycle.
- Semgrep and Bandit are free and should be run locally before any review.

---

## Not permitted

- Merging to `main` without human approval.
- Pushing to remote without human approval.
- Rewriting signed SPR core (canonicalize, sealWith, verifyPackage, test vectors).
- Exporting or logging private key material.
- Removing the exception queue: missing context must produce an exception record, not a silent default.
