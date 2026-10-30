# Tutorial 05: Industry Templates and Account Codes

**Audience:** Developers, Accountants  
**Time:** 20 minutes  
**Prev:** [Understanding Accounting Classification](04-understanding-accounting-classification.md)  
**Next:** [Generating a Draft Journal](06-generating-a-draft-journal.md)

---

## What are industry templates?

Industry templates are versioned data objects that map accounting treatments to account codes
and names. They encode the typical chart-of-accounts structure for a given industry.

## Available templates

| Template key | Industry |
|-------------|----------|
| `software_saas` | Software / SaaS companies |
| `media_content` | Media, publishing, content |
| `research` | Research organisations, academia |
| `professional_services` | Consulting, legal, accounting firms |
| `ecommerce_retail` | E-commerce, retail |
| `financial_services` | Finance, payments, fintech |
| `general` | Fallback for unregistered industries |

## Template structure

Each template has:

```js
{
  industry: "software_saas",
  version: "0.1.0",
  accounts: {
    OPERATING_EXPENSE: { code: "6000", name: "Software & Subscriptions" },
    COST_OF_REVENUE:   { code: "5000", name: "Cost of Revenue — API" },
    FIXED_ASSET:       { code: "1500", name: "Equipment & Hardware" },
    PREPAID_ASSET:     { code: "1300", name: "Prepaid Expenses" },
    INVENTORY:         { code: "1200", name: "Inventory" },
    INTERCOMPANY:      { code: "2100", name: "Intercompany Payable" },
  },
  capitalization_threshold_minor: 250000,  // $2,500.00
  default_treatment: "OPERATING_EXPENSE",
}
```

## Capitalization threshold

Purchases above the threshold may be capitalised as fixed assets rather than expensed immediately.
The default threshold is $2,500 (250000 minor units). Override it per company:

```js
classify(record, context, {
  industry: "software_saas",
  capitalization_threshold_minor: 500000,  // $5,000.00 custom threshold
  ...
})
```

## Using a custom GL mapping

If your company's chart of accounts differs from the template defaults, pass a `companyMapping`:

```js
import { generateDraftJournal } from "@luca/spr-sdk/journal";

const journal = generateDraftJournal(
  sealedRecord,
  classificationResult,
  {
    accounts: {
      OPERATING_EXPENSE: { code: "7150", name: "AI Tools & APIs" },
      COST_OF_REVENUE:   { code: "4500", name: "Direct API Costs" },
    }
  },
  { currency: "USD" }
);
```

Missing account codes in the company mapping fall back to the template default. If the template
also has no code for a treatment, an exception record is produced with account code `"0000"`.

## Disclaimer

All account codes and GAAP/IFRS references in the templates are **illustrative**. They are
starting points for a GL mapping exercise. Your accountant should verify and adjust them for
your specific chart of accounts and jurisdictional requirements.

---

**Next:** [Generating a Draft Journal](06-generating-a-draft-journal.md)
