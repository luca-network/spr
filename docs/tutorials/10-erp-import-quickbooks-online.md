# Tutorial 10: ERP Import — QuickBooks Online Sample

**Audience:** Accountants, Integrators  
**Time:** 20 minutes  
**Prev:** [Exception Handling and Missing Context](09-exception-handling-and-missing-context.md)  
**Next:** [ERP Import — SAP FI Sample](11-erp-import-sap-fi.md)

---

> **IMPORTANT: UNVERIFIED SAMPLE**
>
> The QuickBooks Online import profile in `packages/spr-sdk/erp/qbo.mjs` is an **illustrative
> sample only**. Column names, date formats, and required fields change with QBO updates.
> Verify the current import specification at [intuit.com/developer](https://developer.intuit.com)
> before using in production.

---

## Overview

QuickBooks Online supports CSV import for journal entries and bank transactions.
The `erp/qbo.mjs` module provides a starting-point column mapping.

## Using the QBO profile

```js
import { transformForQBO } from "@luca/spr-sdk/erp/qbo";

const { files, stats } = buildAccountingExport(records, keyring, opts);
const qboRows = transformForQBO(files["journal-entries.csv"]);
// Write qboRows to a CSV for QBO import
```

## Typical QBO journal entry CSV columns

> These column names are illustrative. Verify against your QBO account's current import format.

| QBO Column | SPR Source | Notes |
|------------|-----------|-------|
| `Date` | `date` | QBO format: MM/DD/YYYY |
| `JournalNo` | `export_id` | Use as reference number |
| `Memo` | `description` | Max 4000 chars in QBO |
| `Account` | `account_name` | Must match a QBO chart of accounts account name exactly |
| `Debit` | `debit_minor / 100` | Decimal dollars |
| `Credit` | `credit_minor / 100` | Decimal dollars |
| `Name` | `recipient` (if available) | Optional vendor/customer name |
| `Class` | — | QBO class tracking (optional) |

## Manual import steps (illustrative)

1. Open QuickBooks Online → **Accounting** → **Chart of Accounts**
2. Verify that each `account_name` in the journal CSV exists in your QBO accounts
3. Navigate to **Banking** → **Import** (or use the QBO CSV import wizard)
4. Map the CSV columns to QBO fields in the import dialog
5. Review the preview and confirm the import
6. **Human review required before posting**

## What to check before importing

- [ ] All `account_code` values in `journal-entries.csv` map to accounts in your QBO chart
- [ ] Date format matches QBO expectation (MM/DD/YYYY, not ISO 8601)
- [ ] No rows with `journal_status: "NEEDS_REVIEW"` — resolve exceptions first
- [ ] `balance_ok` flag in manifest is `true` for all records
- [ ] `settlement_confidence` shows `unconfirmed` (expected for local SPR)

## Disclaimer

This tutorial does not provide accounting advice. Work with your accountant or bookkeeper to
verify that the journal entries are correct for your chart of accounts before importing.

---

**Next:** [ERP Import — SAP FI Sample](11-erp-import-sap-fi.md)
