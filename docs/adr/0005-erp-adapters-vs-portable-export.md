# ADR 0005: ERP Adapters vs Portable Export

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

Companies using SPR need to import payment data into their ERP systems (QuickBooks Online, SAP,
Xero, NetSuite, etc.). Each ERP has a different CSV import format with specific column names,
date formats, and debit/credit conventions.

Two architectures were considered:

1. **ERP-specific adapters** — per-ERP modules that produce ERP-ready import files directly.
2. **Portable canonical export** — a standard CSV format that users or adapters can transform
   for any ERP.

---

## Decision

**Primary deliverable is portable canonical CSV (`accounting-transactions.csv`, `journal-entries.csv`).**

ERP-specific adapters (`erp/qbo.mjs`, `erp/sap.mjs`) are provided as **unverified samples only**,
clearly labelled with:
- `PROFILE_STATUS: "UNVERIFIED_SAMPLE"`
- `NOTE: "Column layout and field mappings are illustrative. Verify against current ERP import spec."`

The canonical CSV is produced by `buildAccountingExport()` and is the only output covered by tests.
ERP adapter output is not tested against live ERP imports.

---

## Rationale

ERP import specifications change without notice. Maintaining verified, tested adapters for multiple
ERPs in a general-purpose SDK would require:
- Access to live ERP sandbox environments for each supported ERP
- Ongoing maintenance as ERP import formats change
- Legal review of any claimed ERP compatibility

These are not appropriate for an open-source SDK. The portable CSV approach:
- Works with any spreadsheet tool and most ERP import wizards
- Can be transformed by users or by an ERP-specific connector
- Is fully tested and documented

---

## Alternatives considered

### No ERP adapters at all

Cleaner but less useful for users who want a starting point for ERP integration. The sample
adapters provide a template without making verified claims.

### Test ERP adapters against live ERP sandboxes

Would require ERP developer accounts and ongoing maintenance. Out of scope for this release.
Marked as a future enhancement.

### Use a third-party accounting integration library

Adds an external dependency and may not support all ERPs. The canonical CSV approach gives
users more control.

---

## Consequences

**Positive:**
- Portable canonical CSV works immediately without ERP-specific configuration.
- Sample adapters give users a starting point without implying verified compatibility.
- No ERP credentials or network access required.

**Negative/risks:**
- Users expecting plug-and-play ERP integration will need to do some transformation work.
- The `UNVERIFIED_SAMPLE` label must be prominent; any ERP-specific claims require independent verification.

---

## Security and compatibility impact

- ERP adapters must not include private keys or credentials.
- Adapters must apply the same formula-injection protection as the canonical CSV (`csv.mjs`).
- Users importing to live ERP systems must verify column mappings against their ERP documentation.
- Future verified adapters should be published as separate packages, not in this SDK.

---

## References

- `packages/spr-sdk/erp/qbo.mjs` – QuickBooks Online sample (UNVERIFIED)
- `packages/spr-sdk/erp/sap.mjs` – SAP FI sample (UNVERIFIED)
- `packages/spr-sdk/csv.mjs` – canonical CSV with formula-injection protection
- `packages/spr-sdk/export.mjs` – `buildAccountingExport()`
- ADR 0002 (classification policy precedence)
