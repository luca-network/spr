# ADR 0006: Tenant Isolation and Data Retention

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

SPR books are stored as local directories with a `manifest.json`, sealed record files, and a
private key (`key.pem`). In multi-tenant or multi-project deployments, each tenant must have:

- Separate key material (one `key.pem` per book)
- Separate record storage (no cross-book reads)
- Clear data retention and deletion semantics

The accounting export adds more files to the book directory (or a sibling export directory).
Retention policies for accounting files may differ from SPR record retention.

---

## Decision

**One book = one tenant. Book directories are never shared between tenants.**

Key isolation:
- Each book generates its own Ed25519 key pair stored in `{bookDir}/key.pem`.
- The key is never exported, logged, or included in any accounting CSV or JSONL file.
- Key rotation creates a new key; old keys are preserved in the keyring for verification of
  historical records.

Data isolation:
- `SprBook` instances do not share in-memory state.
- `exportAccountingPackage()` writes to a caller-specified `outDir`; it does not read or write
  other books' directories.

Retention:
- The SDK does not enforce retention policies (it does not delete files automatically).
- Export folders contain derivative data only; the sealed records in the book directory are the
  source of truth.
- Callers are responsible for deleting export folders according to their retention policy.

The `atomic_write` behaviour in `writeAccountingExport()` ensures that a failed export leaves
no partial files in the output directory.

---

## Alternatives considered

### Shared keyring across books

Would allow cross-book verification but creates a single point of failure. Compromising one
book's key material would affect all books sharing the keyring.

### SDK-managed retention (auto-delete after N days)

Introduces a timer-based deletion mechanism that is difficult to audit and could delete records
that are still needed for ongoing disputes or audits. Retention is a compliance decision; the
SDK should not make it.

### Encrypted export folders

Would prevent accidental exposure of export files but adds key management complexity for the
export layer. Callers should apply filesystem-level encryption (LUKS, BitLocker, etc.) if needed.

---

## Consequences

**Positive:**
- No cross-tenant data leakage by design.
- Key material stays in the book directory; no credential extraction via accounting export.
- Atomic export prevents partial-state corruption.

**Negative/risks:**
- Callers must implement their own retention policies.
- In cloud deployments, callers must ensure book directories are not readable by other tenants
  via filesystem permissions.

---

## Security and compatibility impact

- `key.pem` must NEVER appear in `accounting-transactions.csv`, `journal-entries.csv`,
  `exceptions.csv`, `verification-report.json`, or any other export file.
- The `check-key-read.sh` hook provides an advisory warning if Claude Code attempts to write
  to a `key.pem` path.
- Test `test/accounting.test.mjs` "no private key in export" verifies this invariant.

---

## References

- `packages/spr-sdk/book.mjs` – `SprBook`, `rotateKey()`, `exportAccountingPackage()`
- `packages/spr-sdk/export.mjs` – `writeAccountingExport()`, atomic write
- `.claude/hooks/check-key-read.sh`
- `test/accounting.test.mjs` – "no private key in export"
- ADR 0001 (immutable SPR core)
- ADR 0003 (settlement evidence trust model)
