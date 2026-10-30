# Tutorial 11: ERP Import — SAP FI Sample

**Audience:** Integrators  
**Time:** 20 minutes  
**Prev:** [ERP Import — QuickBooks Online Sample](10-erp-import-quickbooks-online.md)  
**Next:** [Settlement Confidence and What It Means](12-settlement-confidence.md)

---

> **IMPORTANT: UNVERIFIED SAMPLE**
>
> The SAP FI posting profile in `packages/spr-sdk/erp/sap.mjs` is an **illustrative sample only**.
> SAP FI posting formats vary by system configuration, client, and SAP version.
> Consult your SAP BASIS/FI configuration team before using in production.

---

## Overview

SAP FI (Financial Accounting) accepts journal entries via several mechanisms:
- BAPI calls (programmatic)
- IDOC (EDI-style batch posting)
- FB50/FV50 (manual G/L document entry)
- File-based import via programs like RFBIBL00

The `erp/sap.mjs` module provides a starting-point field mapping for a flat-file interface.

## Using the SAP profile

```js
import { transformForSAP } from "@luca/spr-sdk/erp/sap";

const { files, stats } = buildAccountingExport(records, keyring, opts);
const sapRows = transformForSAP(files["journal-entries.csv"]);
// Write sapRows to a flat file for SAP import
```

## Typical SAP FI flat-file fields

> These field names are illustrative. Your SAP system may use different field layouts.

| SAP Field | SPR Source | Notes |
|-----------|-----------|-------|
| `BLDAT` | `date` | Document date (YYYYMMDD) |
| `BUDAT` | `date` | Posting date (YYYYMMDD) |
| `BUKRS` | config | Company code (4 chars) |
| `WAERS` | `currency` | Currency key (USD → USD) |
| `HKONT` | `account_code` | G/L account number |
| `SHKZW` | derived | `S` = debit, `H` = credit |
| `WRBTR` | `debit_minor / 100` or `credit_minor / 100` | Amount in document currency |
| `SGTXT` | `description` | Posting text (max 50 chars) |
| `XBLNR` | `export_id` | External document reference |

## Pre-import checklist

- [ ] G/L account numbers (`account_code`) match accounts in your SAP client's chart of accounts
- [ ] Company code (`BUKRS`) is configured in your SAP system
- [ ] Posting period is open in `OB52` (SAP FI period control)
- [ ] All rows with `journal_status: "NEEDS_REVIEW"` have been resolved
- [ ] Your SAP BASIS team has reviewed the flat-file layout for your system version

## Note on SAP integration

SAP FI posting is highly configuration-dependent. A full integration typically requires:

1. Coordination with SAP BASIS and FI configuration teams
2. Testing in a non-production client (Q or D system)
3. ABAP development or consultant support for custom interfaces
4. Authorisation objects setup for the posting user

A general-purpose SDK cannot substitute for this integration work.

---

**Next:** [Settlement Confidence and What It Means](12-settlement-confidence.md)
