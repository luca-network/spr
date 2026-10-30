# ADR 0004: Accounting Export Manifest Schema

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

The SPR `exportPackage()` method writes a `manifest.json` that seals the SPR package.
This manifest uses schema `luca.spr/0.1` and is included in the Merkle root.

The accounting export adds several derivative files:
- `spr-records.jsonl`
- `verification-report.json`
- `accounting-transactions.csv`
- `journal-entries.csv`
- `exceptions.csv`
- `README.md`

These files need their own integrity manifest so consumers can verify that all files in an
accounting export folder are present and unmodified. They must not be included in the SPR manifest
(which is already sealed) nor share its schema.

---

## Decision

**Write a separate `accounting-export-manifest.json` with schema `luca.accounting-export/0.1`.**

The manifest records:
- `schema` – `luca.accounting-export/0.1`
- `export_id` – UUIDv4 linking all accounting files in this export
- `generated_at` – ISO 8601 timestamp
- `files` – array of `{ name, sha256, size_bytes }` for each accounting file
- `record_count`, `exception_count` – summary statistics
- `settlement_confidence_summary` – counts per confidence level
- `spr_manifest_sha256` – hash of the SPR `manifest.json` (cross-reference, not inclusion)
- `classify_version` – SDK version used for classification

The accounting manifest is NOT sealed with Ed25519. It is a tamper-evident integrity check
(SHA-256 of each file) but does not carry cryptographic authority.

---

## Alternatives considered

### Include accounting files in the SPR manifest

Would require re-sealing after every accounting export. The signing key would be needed at
export time. Violates ADR 0001 (immutable core).

### No manifest for accounting files

Simpler, but consumers cannot verify that the export folder is complete or unmodified.
Accounting auditors require file-level integrity evidence.

### Combine both manifests into one file

A single manifest would couple the two schemas and make each independently harder to verify.
Also, the SPR manifest is produced by `exportPackage()`, which is owned by core SPR; the
accounting manifest is produced by `buildAccountingExport()`, owned by the accounting module.

---

## Consequences

**Positive:**
- Consumers can verify the accounting export is complete without needing the signing key.
- The two manifests are independently verifiable and independently extensible.
- `spr_manifest_sha256` cross-references the sealed SPR package without including its files.

**Negative/risks:**
- Users may conflate the accounting manifest (SHA-256 integrity) with the SPR manifest
  (Ed25519 seal). Documentation must distinguish them clearly.
- The accounting manifest is not an auditable artifact in the legal sense; it is a convenience
  integrity check.

---

## Security and compatibility impact

- `accounting-export-manifest.json` MUST NOT be written inside the sealed SPR package folder.
- SHA-256 is used for file hashing. A future version may switch to SHA-3 or BLAKE3; any such
  change requires a schema version bump.
- The `export_id` enables deduplication in downstream systems.

---

## References

- `packages/spr-sdk/contracts.mjs` – `makeExportManifest()`
- `packages/spr-sdk/export.mjs` – `buildAccountingExport()`, manifest generation
- `test/accounting.test.mjs` – "manifest SHA-256 verification"
- ADR 0001 (immutable SPR core)
- ADR 0003 (settlement evidence trust model)
