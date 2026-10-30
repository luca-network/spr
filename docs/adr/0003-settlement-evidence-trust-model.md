# ADR 0003: Settlement Evidence Trust Model

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

A sealed SPR record proves:
- The paying AI agent created a record with specific fields at a specific time.
- The record has not been modified since it was sealed (Ed25519 signature over canonical JSON).

A sealed SPR record does **not** prove:
- The payment was sent to a payment rail.
- The payment was received by the payee.
- The payment settled or was not reversed.

This distinction matters for accounting. An auditor reading a journal entry backed by an SPR seal
needs to understand what assurance the seal actually provides.

Several settlement confidence levels were proposed:

1. `unconfirmed` – seal is valid; no evidence of rail delivery
2. `rail_matched` – hosted Luca confirms the record was submitted to a payment rail
3. `disputed` – a reversal or dispute has been flagged against the record

---

## Decision

**Local SPR always produces `settlement_confidence: "unconfirmed"`.**

Only hosted Luca can set `rail_matched` by matching SPR records against payment rail responses.
The local SPR SDK has no network access to rails and cannot make settlement claims.

The journal status `POSTED` is intentionally absent from the `JournalStatus` enum. A POSTED journal
entry implies the ERP has accepted the entry; that write must happen in the ERP directly, not
through this SDK.

Verification outcome (`makeVerificationOutcome`) records:
- `seal_valid: boolean` – whether the Ed25519 seal verifies
- `settlement_confidence: "unconfirmed"|"rail_matched"|"disputed"`
- A warning string when seal is valid but settlement is unconfirmed

---

## Alternatives considered

### Allow local SDK to set `rail_matched` based on on-chain data or webhook

Would require the SDK to trust external data sources it cannot verify. Local SPR is designed
to work offline; adding network dependencies for settlement confirmation would change its trust model.

### Omit `settlement_confidence` entirely

Cleaner model, but auditors and ERP adapters need to reason about what level of evidence backs
a journal entry. Explicit `unconfirmed` is safer than silence.

### Add `POSTED` to `JournalStatus`

Tempting for completeness, but POSTED implies the journal has been accepted by an ERP system.
The SDK has no way to know whether an ERP write succeeded. Adding POSTED would allow callers
to incorrectly assert that a draft journal has been posted.

---

## Consequences

**Positive:**
- Explicit `unconfirmed` prevents accidental over-reliance on SPR seals for settlement assurance.
- Journal status stops at `VERIFIED_EVIDENCE`; ERP writes are out-of-scope for the local SDK.
- The trust boundary is clear: Ed25519 seal = data integrity; rail confirmation = out-of-band.

**Negative/risks:**
- Users expecting settlement confirmation from the SDK will be surprised. The README and
  `CAPABILITY_PROVENANCE.md` must make this explicit.
- `VERIFIED_EVIDENCE` sounds authoritative; documentation must clarify it refers to seal verification,
  not settlement verification.

---

## Security and compatibility impact

- `settlement_confidence` is a read-only assertion; it cannot be written by `buildAccountingExport`.
- If `SettlementConfidence.RAIL_MATCHED` is ever set locally (only via hosted Luca integration),
  the source of that claim must be auditable.
- Changing the `JournalStatus` enum to add POSTED would be a breaking change; any consumer that
  filters on status values would need updating.

---

## References

- `packages/spr-sdk/contracts.mjs` – `JournalStatus`, `SettlementConfidence`, `makeVerificationOutcome()`
- `packages/spr-sdk/journal.mjs` – journal status assignment (DRAFT vs VERIFIED_EVIDENCE)
- `packages/spr-sdk/export.mjs` – `verification-report.json` output
- `README.md` – "Local SPR vs hosted Luca" capability matrix
- `test/accounting.test.mjs` – "journal status never POSTED"
- ADR 0001 (immutable SPR core)
