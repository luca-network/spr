# Tutorial 09: Exception Handling and Missing Context

**Audience:** Developers  
**Time:** 15 minutes  
**Prev:** [Reading the Export Files](08-reading-the-export-files.md)  
**Next:** [ERP Import — QuickBooks Online Sample](10-erp-import-quickbooks-online.md)

---

## Why exceptions exist

Classification requires context that may not always be available:

- `delivery_context` — was this for internal use or customer delivery?
- `industry` — what industry template applies?
- Large amounts that cross the capitalisation threshold

Rather than crashing or silently producing wrong results, the classifier produces exception records.
The export always completes; exceptions appear in `exceptions.csv`.

## Exception severities

| Severity | Meaning | Effect on journal |
|----------|---------|------------------|
| `advisory` | Context missing; default applied | Journal generated; status `NEEDS_REVIEW` |
| `blocking` | Classification cannot proceed | Journal generated with placeholder account `"0000"` |

## Common exceptions

### Missing delivery_context (advisory)

```js
const { result, exceptions } = classify(
  record,
  { delivery_context: null },  // not set
  companyProfile
);
// exceptions[0].code === "MISSING_DELIVERY_CONTEXT"
// exceptions[0].severity === "advisory"
// result still has a treatment (default applied)
```

**Fix:** Set `delivery_context` to `"internal_use"` or `"customer_delivery"`.

### Unregistered industry (blocking)

```js
classify(record, context, {
  industry: "fintech_startup",  // not a registered template key
  ...
})
// Falls back to "general" template
// exceptions[0].code === "UNKNOWN_INDUSTRY"
// exceptions[0].message === "Unknown industry 'fintech_startup'; using general template"
```

**Fix:** Use one of the seven registered industry keys, or map your industry to the closest one.

### Amount at capitalisation boundary

An amount that changes treatment based on the threshold produces an advisory exception so an
accountant can confirm the threshold is correct.

## Handling exceptions in code

```js
const { files, stats } = buildAccountingExport(records, keyring, opts);

if (stats.exception_count > 0) {
  console.warn(`${stats.exception_count} exceptions — review exceptions.csv`);
}
// The export still completes; exceptions are NOT a reason to abort
```

## Overriding classification per-record

If an AI agent knows the correct treatment at payment time:

```js
const record = await book.declare({
  amount: 32000,
  currency: "USD",
  intent: "Annual enterprise software licence",
  // ...
});

const { result } = classify(record, {
  delivery_context: "internal_use",
  override_categories: { treatment: "PREPAID_ASSET" },  // explicit override
}, companyProfile);
// result.rule_id === "override"
```

Overrides bypass all template and threshold logic. Use with care.

---

**Next:** [ERP Import — QuickBooks Online Sample](10-erp-import-quickbooks-online.md)
