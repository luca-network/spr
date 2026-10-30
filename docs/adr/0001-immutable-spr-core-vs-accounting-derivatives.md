# ADR 0001: Immutable SPR Core vs Accounting Derivatives

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

The SPR format uses Ed25519 signatures over RFC 8785 canonical JSON to seal payment records.
Once sealed, the record bytes are fixed — any change to the canonical JSON invalidates the signature.

The accounting export feature needs to attach classification metadata (treatment, account codes,
journal lines) to each record. Two approaches were considered:

1. **Mutate the signed record** — add accounting fields directly to the record JSON and re-seal.
2. **Derive separately** — keep the sealed record immutable; generate accounting data as derivative files.

---

## Decision

**Approach 2: derive accounting data as separate files; never mutate signed records.**

The sealed record fields (`id`, `amount`, `currency`, `ts`, `intent`, `seal`) are frozen at the
moment the agent signs. Accounting files are generated at export time from the sealed records plus
company context (industry template, GL mapping). They are reproducible and do not carry the
authority of the seal.

---

## Alternatives considered

### Mutate and re-seal

Would require the signing key at export time. This conflates signing authority (the paying agent)
with accounting authority (the company's GL team), which are different parties in most deployments.
It also prevents independently auditing the accounting treatment after the fact without the key.

### Embed accounting fields in `intent`

The `intent` field is signed as part of the record. Pre-computing accounting treatment before
sealing is not always possible (company GL chart changes; the same record may be reclassified
under a different policy). Embedding it would freeze the accounting treatment at payment time.

---

## Consequences

**Positive:**
- SPR signatures remain verifiable by any party without accounting context.
- Accounting classification can be revised without invalidating seals.
- The two manifests (`manifest.json` and `accounting-export-manifest.json`) have independent schemas.
- Journal entries are always DRAFT until externally posted to an ERP; the SPR cannot represent POSTED.

**Negative/risks:**
- Two export steps required; users must not conflate SPR verification with accounting sign-off.
- Accounting files may drift from the sealed record if a regeneration uses different company parameters.

---

## Security and compatibility impact

- No change to `packages/spr/index.mjs` canonicalization or seal logic.
- No change to existing SPR record schema.
- `accounting-export-manifest.json` uses a separate schema URI (`luca.accounting-export/0.1`) and
  must never be confused with the SPR `manifest.json` (`luca.spr/0.1`).

---

## References

- `SPEC.md` §3 (Seals), §4 (Packages)
- `packages/spr-sdk/export.mjs` – `buildAccountingExport()`, `writeAccountingExport()`
- `packages/spr-sdk/book.mjs` – `exportAccountingPackage()`
- `test/accounting.test.mjs` – "SPR still verifies after accounting export"
- ADR 0004 (accounting export manifest schema)
