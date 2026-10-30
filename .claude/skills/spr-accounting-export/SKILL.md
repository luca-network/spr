# Skill: spr-accounting-export

## Purpose

Generate an accounting export package from an SPR book: classify payments, generate draft
journal entries, and write the accounting CSV files alongside the signed SPR package.

## When to use

- User asks to export accounting data, generate journal entries, or produce CSV for ERP import.
- User asks to classify payments by industry profile.

## Key files

| File | Purpose |
|------|---------|
| `packages/spr-sdk/classify.mjs` | Five-layer classification engine |
| `packages/spr-sdk/journal.mjs` | Draft journal generation |
| `packages/spr-sdk/export.mjs` | Standalone export logic |
| `packages/spr-sdk/contracts.mjs` | Data contracts (Treatment, JournalStatus, etc.) |
| `packages/spr-sdk/industry-templates.mjs` | Seven versioned industry templates |
| `packages/spr-sdk/erp/qbo.mjs` | QuickBooks Online profile (UNVERIFIED) |
| `packages/spr-sdk/erp/sap.mjs` | SAP FI profile (UNVERIFIED) |

## Usage

```js
import { SprBook } from "@luca-network/spr-sdk";

const book = new SprBook({ dir: "./books", agentId: "agt_research", entity: "Example Co" });
const result = book.exportAccountingPackage("./exports/oct-2026", {
  companyProfile: {
    industry: "software_saas",           // or: research, media_content, general, ...
    reporting_framework: "US_GAAP",
    capitalization_threshold_minor: 250000,  // cents; $2,500 USD
  },
  classificationContext: {
    // Per-record override (optional):
    "LR-STRIPE-AABBCC-v1": { delivery_context: "internal_use" },
  },
});
console.log(result.verified);            // SPR package still independently verifies
console.log(result.accounting_files);   // list of written accounting files
```

## CLI

```bash
node packages/spr-sdk/bin/spr-export.mjs export ./books ./exports/oct-2026 \
  --industry=software_saas --framework=US_GAAP
```

## Guardrails

- Never set journal status to POSTED.
- Never include key.pem in the export directory.
- Always check `result.verified === true` after export.
- ERP profiles (qbo, sap) are UNVERIFIED samples; do not import without accountant review.
- GAAP/IFRS account references in templates are illustrative; validate against your chart of accounts.
