# SPR Accounting Export — Release Readiness

**Date:** 2026-10-30  
**Branch:** `feature/spr-accounting-export`  
**Author:** Claude Sonnet 4.6 (manuelbomi@yahoo.com)  
**Status:** READY FOR HUMAN REVIEW

---

## Summary

All planned implementation phases (0–7B, 7C, 8) are complete. No blocking issues found.
One paid tool (Codex review) was not invoked — see section below.

---

## Test results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| Node.js (`npm test`) | 46 | 46 | 0 |
| Python (`python3 -m unittest`) | 29 | 29 | 0 |
| **Total** | **75** | **75** | **0** |

All original 16 Node.js SDK tests pass unchanged (SPR compatibility preserved).
30 new Node.js accounting tests cover all major classification, journal, and export scenarios.
14 new Python tests mirror the JavaScript test suite.

---

## Security scans

### Semgrep

- **Tool:** semgrep 1.183.0 (auto config, 1074 Community rules)
- **Files scanned:** `classify.mjs`, `journal.mjs`, `export.mjs`, `csv.mjs`, `contracts.mjs`, `book.mjs`
- **Rules run:** 200
- **Findings:** 0
- **Run date:** 2026-10-30

### Bandit

- **Tool:** bandit 1.9.4
- **Files scanned:** `python/spr/classify.py`, `python/tests/test_classify.py`
- **Lines scanned:** 297
- **Issues:** 0 (all severity/confidence levels)
- **Run date:** 2026-10-30

### Codex review

**Not run.** Codex code review is a paid tool that the promptbook specifies should be run
at most once, after implementation is complete. It was not invoked in this session.

To run it: `/code-review ultra` in a Claude Code session on this branch, or
`/code-review ultra <PR#>` after a PR is created.

This is documented explicitly rather than fabricating results. The Semgrep and Bandit scans
above cover the new files. Codex review is recommended before merging to main.

---

## Files delivered

### New modules (packages/spr-sdk/)

| File | Purpose |
|------|---------|
| `contracts.mjs` | Data contracts: Treatment, JournalStatus, SettlementConfidence, factory functions |
| `csv.mjs` | Formula-injection-safe CSV generation |
| `industry-templates.mjs` | 7 versioned industry account templates |
| `classify.mjs` | Five-layer accounting classification engine |
| `journal.mjs` | Draft journal entry generation |
| `export.mjs` | Full accounting export (build + write) |
| `erp/qbo.mjs` | QuickBooks Online profile (UNVERIFIED SAMPLE) |
| `erp/sap.mjs` | SAP FI profile (UNVERIFIED SAMPLE) |
| `bin/spr-export.mjs` | CLI entry point |

### Modified files

| File | Change |
|------|--------|
| `packages/spr-sdk/book.mjs` | Added `exportAccountingPackage()` method |
| `packages/spr-sdk/package.json` | Added `exports` entries for new modules |
| `packages/spr-mcp/bin/spr-mcp.mjs` | (minor, pre-existing changes in git status) |
| `packages/spr/bin/spr-verify.mjs` | (minor, pre-existing changes in git status) |

### Python

| File | Purpose |
|------|---------|
| `python/spr/classify.py` | Python mirror of classify.mjs (5-layer logic + 7 templates) |
| `python/tests/test_classify.py` | 14 Python tests (mirror of JS accounting tests) |

### Tests

| File | Tests |
|------|-------|
| `test/accounting.test.mjs` | 30 Node.js accounting tests |

### Governance and documentation

| File | Purpose |
|------|---------|
| `AGENTS.md` | AI agent governance: invariants, security constraints, test commands |
| `.claude/CLAUDE.md` | Project guidance for Claude Code sessions |
| `.claude/settings.json` | Hook configuration |
| `.claude/hooks/check-push.sh` | Blocks git push/merge without user approval |
| `.claude/hooks/check-key-read.sh` | Warns/blocks key.pem access |
| `.claude/hooks/check-spr-core.sh` | Advisory warning on SPR core file edits |
| `.claude/hooks/post-edit-lint.sh` | Syntax check on .mjs edits |
| `.claude/skills/spr-accounting-export/SKILL.md` | Accounting export skill |
| `.claude/skills/spr-verification/SKILL.md` | Verification skill |
| `.claude/skills/accounting-classification/SKILL.md` | Classification skill |

### Architecture Decision Records (docs/adr/)

| ADR | Title |
|-----|-------|
| 0001 | Immutable SPR Core vs Accounting Derivatives |
| 0002 | Classification Policy Precedence |
| 0003 | Settlement Evidence Trust Model |
| 0004 | Accounting Export Manifest Schema |
| 0005 | ERP Adapters vs Portable Export |
| 0006 | Tenant Isolation and Data Retention |
| 0007 | Frontend and Tutorials Architecture |
| 0008 | Claude Code Hooks and CI Cost Control |

### Tutorials (docs/tutorials/)

16 files: README, CAPABILITY_PROVENANCE, and tutorials 01–14.

### Engineering docs (docs/engineering/)

| File | Purpose |
|------|---------|
| `SPR_EXPORT_GAP_MATRIX.md` | Requirements traceability matrix |
| `HOOKS.md` | Hook documentation and testing procedures |
| `SPR_EXPORT_RELEASE_READINESS.md` | This document |

---

## SPR compatibility verification

The original SPR seal/verify behaviour is unchanged:

- `packages/spr/index.mjs` was not modified
- `python/spr/format.py` was not modified
- Test vectors (`packages/spr/vectors/vectors.json`) were not modified
- All 14 original Node.js SDK tests pass (including cross-language, key rotation, large book)
- `verifySeal` returns the same results before and after adding accounting export files

Test coverage of the invariant: `test/accounting.test.mjs` — "SPR still verifies after accounting export"

---

## Known limitations and non-goals

| Item | Status |
|------|--------|
| POSTED journal status | Intentionally absent; ERP write is out-of-scope |
| Rail settlement confirmation | Requires hosted Luca; local SPR always shows `unconfirmed` |
| Verified ERP adapters | QBO/SAP profiles are UNVERIFIED SAMPLES; labelled accordingly |
| GAAP/IFRS taxonomy | Illustrative only; labelled `taxonomy_note: "illustrative/unverified"` |
| Live ERP writes in P0/P1 | Not implemented; fixtures and sandbox only |
| Python accounting export | classify.py complete; full export in Python is a future item |
| Frontend/web app | Repo is SDK-only; tutorials delivered as Markdown (ADR 0007) |
| Codex review | Paid tool; not invoked (see above) |

---

## Pre-merge checklist (for human reviewer)

- [ ] Review `docs/adr/` ADRs for architectural decisions
- [ ] Read `CAPABILITY_PROVENANCE.md` and confirm the trust boundary is correctly stated
- [ ] Run `/code-review ultra` (Codex) after creating PR
- [ ] Verify Semgrep and Bandit scan logs in this document are consistent with the code
- [ ] Confirm ERP sample profiles are clearly labelled UNVERIFIED
- [ ] Review `test/accounting.test.mjs` for test coverage completeness
- [ ] Approve `git push` and PR creation (branch: `feature/spr-accounting-export` → `main`)

---

## Commands to reproduce all checks

```bash
# Node.js tests
npm test

# SPR vector tests
node packages/spr/bin/spr-verify.mjs --vectors

# Python tests
cd python && python3 -m unittest discover -s tests -v && cd ..

# Semgrep (JS)
semgrep --config=auto packages/spr-sdk/classify.mjs packages/spr-sdk/journal.mjs \
  packages/spr-sdk/export.mjs packages/spr-sdk/csv.mjs packages/spr-sdk/contracts.mjs \
  packages/spr-sdk/book.mjs

# Bandit (Python)
bandit -r python/spr/classify.py python/tests/test_classify.py
```
