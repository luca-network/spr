# Tutorial 06: Generating a Draft Journal

**Audience:** Developers, Accountants  
**Time:** 20 minutes  
**Prev:** [Industry Templates and Account Codes](05-industry-templates-and-account-codes.md)  
**Next:** [Running the Full Accounting Export](07-running-the-full-accounting-export.md)

---

## What is a draft journal entry?

A draft journal entry represents a payment as a double-entry bookkeeping transaction. For each
sealed record, `generateDraftJournal` produces:

- Debit line (expense or asset account)
- Credit line (accounts payable or cash)

The journal is always DRAFT until a human accountant reviews and posts it to the ERP.

## Generate a journal entry

```js
import { classify } from "@luca/spr-sdk/classify";
import { generateDraftJournal } from "@luca/spr-sdk/journal";

const { result: classification } = classify(record, context, companyProfile);

const journal = generateDraftJournal(
  record,
  classification,
  companyMapping,  // optional custom GL mapping
  { currency: "USD" }
);
```

## Journal structure

```js
{
  export_id: "uuid-v4",
  status: "VERIFIED_EVIDENCE",  // or "DRAFT" if seal not verified
  balance_ok: true,
  lines: [
    {
      record_id: "spr_0191abc...",
      line_type: "debit",
      account_code: "6000",
      account_name: "Software & Subscriptions",
      debit_minor: 1500,
      credit_minor: 0,
      currency: "USD",
      description: "Claude API call — text generation",
      date: "2026-10-30",
      treatment: "OPERATING_EXPENSE"
    },
    {
      record_id: "spr_0191abc...",
      line_type: "credit",
      account_code: "2000",
      account_name: "Accounts Payable",
      debit_minor: 0,
      credit_minor: 1500,
      currency: "USD",
      description: "Claude API call — text generation",
      date: "2026-10-30",
      treatment: "OPERATING_EXPENSE"
    }
  ],
  exceptions: []
}
```

## Journal status

| Status | Meaning |
|--------|---------|
| `DRAFT` | Source record seal was NOT verified at journal generation time |
| `NEEDS_REVIEW` | Classification produced exceptions; human review required |
| `VERIFIED_EVIDENCE` | Source record seal verified; journal is backed by tamper-evident data |

`POSTED` is intentionally absent. Posting to an ERP happens outside the SDK.
See [ADR 0003](../adr/0003-settlement-evidence-trust-model.md).

## Balance enforcement

`balance_ok` is `true` only when `sum(debit_minor) === sum(credit_minor)` for every record.
An imbalanced journal is a bug in the classification or mapping; check the exceptions output.

## Exception handling

If a record cannot be fully classified, `generateDraftJournal` still produces journal lines
using a placeholder account (`"0000"`) and adds an exception to the `exceptions` array.
The journal is never silently dropped; exceptions accumulate in the exceptions CSV.

---

**Next:** [Running the Full Accounting Export](07-running-the-full-accounting-export.md)
