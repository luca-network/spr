# Tutorial 04: Understanding Accounting Classification

**Audience:** Developers, Accountants  
**Time:** 20 minutes  
**Prev:** [Sealing and Verifying Records](03-sealing-and-verifying-records.md)  
**Next:** [Industry Templates and Account Codes](05-industry-templates-and-account-codes.md)

---

## Why classification is needed

A sealed SPR record tells you *what was paid* — amount, recipient, timestamp, intent.
It does not tell you *how to record it in your books*.

Accounting classification answers: given this payment, what is the correct accounting treatment?

- Is it an operating expense? A capital asset? Cost of revenue?
- Which GL account does it belong in?
- Is the amount above the capitalisation threshold?

## The five-layer model

Classification runs five decision layers in order:

```
1. Company profile     → industry, framework, capitalisation threshold
2. Item taxonomy       → what category of item was purchased
3. Transaction rel.    → internal use vs customer delivery vs resale
4. Accounting treatment → OPERATING_EXPENSE, FIXED_ASSET, COST_OF_REVENUE, etc.
5. Industry mapping    → specific account code and GAAP/IFRS reference
```

Each layer uses the output of the previous layer. If a layer is missing required information,
it produces an exception record rather than a hard error.

## Calling classify()

```js
import { classify } from "@luca/spr-sdk/classify";

const { result, exceptions } = classify(
  sealedRecord,
  {
    delivery_context: "internal_use",  // "internal_use" | "customer_delivery" | null
    for_resale: false,
  },
  {
    industry: "software_saas",
    reporting_framework: "GAAP",
    capitalization_threshold_minor: 250000,  // $2,500.00
    jurisdiction: "US",
  }
);

console.log(result.treatment);      // "OPERATING_EXPENSE"
console.log(result.account_code);   // "6000"
console.log(result.rule_id);        // "saas.internal_use.below_threshold"
```

## Classification results

| Field | Description |
|-------|-------------|
| `treatment` | One of 6 accounting treatments |
| `account_code` | GL account code from the industry template |
| `account_name` | Human-readable account name |
| `gaap_ref` | Illustrative GAAP reference (unverified) |
| `ifrs_ref` | Illustrative IFRS reference (unverified) |
| `rule_id` | Which rule produced this result (for audit trail) |
| `classify_version` | SDK version used |
| `taxonomy_note` | Warning if the classification is illustrative |

## Accounting treatments

| Treatment | Typical use |
|-----------|------------|
| `OPERATING_EXPENSE` | Routine purchases: API calls, SaaS tools, compute |
| `PREPAID_ASSET` | Subscriptions covering future periods |
| `FIXED_ASSET` | Capital expenditure above threshold |
| `INVENTORY` | Goods held for resale |
| `COST_OF_REVENUE` | Purchases that directly enable revenue delivery |
| `INTERCOMPANY` | Payments between related entities |

## Important caveats

GAAP and IFRS references are **illustrative only**. The classify() function does not provide
accounting advice. Results must be reviewed by a qualified accountant before posting.

---

**Next:** [Industry Templates and Account Codes](05-industry-templates-and-account-codes.md)
