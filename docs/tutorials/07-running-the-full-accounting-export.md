# Tutorial 07: Running the Full Accounting Export

**Audience:** Developers  
**Time:** 20 minutes  
**Prev:** [Generating a Draft Journal](06-generating-a-draft-journal.md)  
**Next:** [Reading the Export Files](08-reading-the-export-files.md)

---

## Two methods

### Method 1: `SprBook.exportAccountingPackage()`

The recommended way — exports SPR records and accounting files in one call.

```js
import { SprBook } from "@luca/spr-sdk";

const book = await SprBook.open("/path/to/book");
const result = await book.exportAccountingPackage(
  "/path/to/output",
  {
    companyProfile: {
      industry: "software_saas",
      reporting_framework: "GAAP",
      capitalization_threshold_minor: 250000,
      jurisdiction: "US",
    },
    classificationContext: {
      delivery_context: "internal_use",
      for_resale: false,
    },
    overwrite: false,  // set true to overwrite an existing export
  }
);

console.log(result.folder);          // "/path/to/output"
console.log(result.accounting_files); // list of accounting CSV/JSON files
```

### Method 2: `buildAccountingExport()` standalone

For use without a SprBook (e.g. processing records loaded from elsewhere):

```js
import { buildAccountingExport, writeAccountingExport } from "@luca/spr-sdk/export";

const { files, stats } = buildAccountingExport(records, keyring, {
  companyProfile: { industry: "software_saas", ... },
  classificationContext: { delivery_context: "internal_use", ... },
});

const { folder } = await writeAccountingExport("/path/to/output", files, {
  overwrite: false,
});
```

### CLI

```bash
node packages/spr-sdk/bin/spr-export.mjs \
  --book /path/to/book \
  --out /path/to/output \
  --industry software_saas \
  --framework GAAP \
  --delivery-context internal_use
```

## What gets written

```
/path/to/output/
├── spr-records.jsonl              ← all sealed records as newline-delimited JSON
├── verification-report.json       ← seal validity for each record
├── accounting-transactions.csv    ← one row per record: treatment, account, amount
├── journal-entries.csv            ← double-entry lines
├── exceptions.csv                 ← records with missing or conflicting classification
├── README.md                      ← auto-generated summary of the export
└── accounting-export-manifest.json ← SHA-256 hashes of all files above
```

## Overwrite protection

By default, `writeAccountingExport` refuses to overwrite an existing export directory.
Pass `overwrite: true` to allow. The export is atomic: if it fails partway, no partial
files are left in the output directory.

## Idempotency

Re-exporting the same book with the same options produces the same files (same hashes,
same `export_id` if you pass one explicitly; otherwise a new UUIDv4 is generated).

---

**Next:** [Reading the Export Files](08-reading-the-export-files.md)
