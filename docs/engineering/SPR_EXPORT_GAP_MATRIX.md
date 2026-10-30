# SPR Accounting Export – Gap Matrix

Generated: 2026-10-30 | Branch: feature/spr-accounting-export | SPEC: spr/draft-1

This matrix maps every requirement from the Luca Records Accounting Export Promptbook v2 to
the current repository state before implementation, then to the target state.

---

## Legend

| Status | Meaning |
|--------|---------|
| ✅ Implemented | Code present and tested |
| 🔶 Partial | Exists but incomplete or untested |
| ❌ Missing | Not present in repo |
| 🔍 Unverified | Present but conformance not confirmed by test |

---

## Phase 0 – Baseline inventory

| Component | File(s) | Status | Notes |
|-----------|---------|--------|-------|
| SPR canonical JSON | `packages/spr/index.mjs:canonicalize` | ✅ | 80 vectors pass |
| Ed25519 seal/verify | `packages/spr/index.mjs:sealWith,verifySeal` | ✅ | Both algorithms |
| Merkle trees | `packages/spr/index.mjs:merkleRoot,merklePath` | ✅ | Vectors pass |
| Intent nonce | `packages/spr/index.mjs:intentNonce` | ✅ | |
| Two-sided labels | `packages/spr/index.mjs:signLabel,verifyLabelSignature` | ✅ | |
| SPR package verify | `packages/spr/index.mjs:verifyPackage` | ✅ | |
| SprBook (JS) | `packages/spr-sdk/book.mjs` | ✅ | declare/seal/export |
| SprBook.exportPackage | `packages/spr-sdk/book.mjs:exportPackage` | ✅ | Signed SPR package only |
| SprBook (Python) | `python/spr/book.py` | ✅ | Feature-parity with JS |
| MCP server | `packages/spr-mcp/server.mjs` | ✅ | |
| Key rotation | `book.mjs:rotateKey` / `book.py:rotate_key` | ✅ | |
| Test vectors | `packages/spr/vectors/vectors.json` | ✅ | |
| CI workflow | `.github/workflows/ci.yml` | ✅ | Triggers on push/PR |
| **Accounting classification** | — | ❌ | Target: Phase 2 |
| **Journal generation** | — | ❌ | Target: Phase 3 |
| **Accounting CSV export** | — | ❌ | Target: Phase 4 |
| **ERP import profiles** | — | ❌ | Target: Phase 5 |
| **Frontend / tutorials** | — | ❌ | SDK-only repo; tutorials as docs |
| **AGENTS.md** | — | ❌ | Target: Phase 7 |
| **.claude/CLAUDE.md** | — | ❌ | Target: Phase 7 |
| **Claude Code hooks** | — | ❌ | Target: Phase 7A |
| **ADRs** | — | ❌ | Target: Phase 7B |

---

## Phase 1 – Data contracts

| Requirement | File | Status |
|-------------|------|--------|
| Versioned AccountingTransaction contract | `packages/spr-sdk/contracts.mjs` | ❌→✅ |
| DraftJournalLine schema | `packages/spr-sdk/contracts.mjs` | ❌→✅ |
| ExceptionRecord schema | `packages/spr-sdk/contracts.mjs` | ❌→✅ |
| VerificationOutcome schema | `packages/spr-sdk/contracts.mjs` | ❌→✅ |
| ExportManifest schema (separate from SPR manifest) | `packages/spr-sdk/contracts.mjs` | ❌→✅ |
| Settlement confidence fields (not equated to proof) | contracts + classification | ❌→✅ |
| Formula-injection-safe CSV serialiser | `packages/spr-sdk/csv.mjs` | ❌→✅ |

## Phase 2 – Classification engine

| Requirement | File | Status |
|-------------|------|--------|
| 5-layer classification | `packages/spr-sdk/classify.mjs` | ❌→✅ |
| 7 industry templates as versioned data | `packages/spr-sdk/industry-templates.mjs` | ❌→✅ |
| Python mirror | `python/spr/classify.py` | ❌→✅ |
| $15 data internal-use vs customer-delivery | test/accounting.test.mjs | ❌→✅ |
| $3,200 laptop capitalization | test/accounting.test.mjs | ❌→✅ |
| Exception queue for missing context | classify.mjs | ❌→✅ |
| GAAP/IFRS account reference (unverified taxonomy) | industry-templates.mjs | ❌→🔍 (marked unverified) |

## Phase 3 – Journal generation

| Requirement | File | Status |
|-------------|------|--------|
| Draft journal generator | `packages/spr-sdk/journal.mjs` | ❌→✅ |
| Debit = credit enforcement | journal.mjs | ❌→✅ |
| DRAFT/NEEDS_REVIEW/VERIFIED_EVIDENCE status | journal.mjs | ❌→✅ |
| Traceable links to SPR ID and digest | journal.mjs | ❌→✅ |
| Missing GL mapping → exception | journal.mjs | ❌→✅ |
| Prepaid/fixed-asset stubs | journal.mjs | ❌→✅ (stub, no auto-amortisation) |

## Phase 4 – Accounting export package

| Requirement | File | Status |
|-------------|------|--------|
| SprBook.exportAccountingPackage() | `packages/spr-sdk/book.mjs` | ❌→✅ |
| accounting-transactions.csv | export.mjs | ❌→✅ |
| journal-entries.csv | export.mjs | ❌→✅ |
| exceptions.csv | export.mjs | ❌→✅ |
| verification-report.json | export.mjs | ❌→✅ |
| accounting-export-manifest.json | export.mjs | ❌→✅ |
| Atomic write (cleanup on failure) | export.mjs | ❌→✅ |
| Overwrite protection | book.mjs | ❌→✅ |
| spr-export CLI | `packages/spr-sdk/bin/spr-export.mjs` | ❌→✅ |

## Phase 5 – ERP profiles

| Requirement | File | Status |
|-------------|------|--------|
| QuickBooks Online CSV profile | `packages/spr-sdk/erp/qbo.mjs` | ❌→🔍 (UNVERIFIED, no sandbox) |
| SAP FI CSV profile | `packages/spr-sdk/erp/sap.mjs` | ❌→🔍 (UNVERIFIED, no sandbox) |

## Phase 6 – Tests

| Test | File | Status |
|------|------|--------|
| Classification positive/negative cases | `test/accounting.test.mjs` | ❌→✅ |
| Journal balance property | test/accounting.test.mjs | ❌→✅ |
| Export SPR still verifies | test/accounting.test.mjs | ❌→✅ |
| No private key in export | test/accounting.test.mjs | ❌→✅ |
| CSV injection prevention | test/accounting.test.mjs | ❌→✅ |
| Python classification | `python/tests/test_classify.py` | ❌→✅ |

## Phase 7 – Skills/guardrails

| Item | File | Status |
|------|------|--------|
| AGENTS.md | `/AGENTS.md` | ❌→✅ |
| .claude/CLAUDE.md | `/.claude/CLAUDE.md` | ❌→✅ |
| Skill: spr-accounting-export | `.claude/skills/spr-accounting-export/SKILL.md` | ❌→✅ |
| Skill: spr-verification | `.claude/skills/spr-verification/SKILL.md` | ❌→✅ |
| Skill: accounting-classification | `.claude/skills/accounting-classification/SKILL.md` | ❌→✅ |
| Hooks (executable) | `.claude/hooks/` | ❌→✅ |
| Claude settings.json (hook config) | `.claude/settings.json` | ❌→✅ |
| HOOKS.md | `docs/engineering/HOOKS.md` | ❌→✅ |
| ADRs (8 records) | `docs/adr/` | ❌→✅ |
| Tutorial content (14 topics) | `docs/tutorials/` | ❌→✅ |

---

## Compatibility decisions (pre-implementation)

1. **SPR signed core is immutable.** `exportAccountingPackage()` calls the existing `exportPackage()` unchanged. Accounting files are additional, with a separate `accounting-export-manifest.json`.
2. **Classification fields are not added to signed records.** Classification runs over the *payload* of existing records; results live only in accounting output files.
3. **No schema migration.** SPEC.md `luca.record/0.7` is unchanged.
4. **`exportPackage()` callers unaffected.** The new method is additive; existing API is unchanged.
5. **Settlement confidence.** `VerificationOutcome.settlement_confidence` is always `"unconfirmed"` for local-only books; only hosted Luca can confirm rail settlement.
