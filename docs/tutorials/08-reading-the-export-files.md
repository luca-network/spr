# Tutorial 08: Reading the Export Files

**Audience:** Developers, Accountants  
**Time:** 15 minutes  
**Prev:** [Running the Full Accounting Export](07-running-the-full-accounting-export.md)  
**Next:** [Exception Handling and Missing Context](09-exception-handling-and-missing-context.md)

---

## spr-records.jsonl

Newline-delimited JSON. Each line is one sealed record:

```json
{"id":"spr_0191abc...","amount":1500,"currency":"USD","ts":"2026-10-30T12:00:00.000Z","intent":"Claude API call","seal":{"alg":"ed25519","kid":"k1","sig":"..."}}
```

Use this file to verify records independently of the SDK:

```bash
node -e "
const { verifySeal } = await import('@luca/spr');
const lines = fs.readFileSync('spr-records.jsonl','utf8').trim().split('\n');
for (const line of lines) {
  const r = JSON.parse(line);
  console.log(r.id, await verifySeal(r, publicKey));
}
"
```

## verification-report.json

Object with one entry per record:

```json
{
  "spr_0191abc...": {
    "seal_valid": true,
    "settlement_confidence": "unconfirmed",
    "warning": "Seal valid; settlement not confirmed by this SDK"
  }
}
```

All records show `settlement_confidence: "unconfirmed"` in local SPR exports.

## accounting-transactions.csv

One row per sealed record. Columns:

| Column | Description |
|--------|-------------|
| `record_id` | SPR record ID |
| `date` | Record timestamp (YYYY-MM-DD) |
| `amount_minor` | Amount in minor currency units |
| `currency` | ISO 4217 currency code |
| `treatment` | Accounting treatment |
| `account_code` | GL account code |
| `account_name` | GL account name |
| `description` | Record intent (formula-injection safe) |
| `seal_valid` | Whether Ed25519 seal verified |
| `settlement_confidence` | Always `unconfirmed` in local exports |

## journal-entries.csv

Double-entry bookkeeping lines. One debit + one credit row per record.

| Column | Description |
|--------|-------------|
| `record_id` | SPR record ID |
| `journal_status` | DRAFT, NEEDS_REVIEW, or VERIFIED_EVIDENCE |
| `line_type` | `debit` or `credit` |
| `account_code` | GL account code |
| `account_name` | GL account name |
| `debit_minor` | Debit amount (0 for credit lines) |
| `credit_minor` | Credit amount (0 for debit lines) |
| `currency` | ISO 4217 |
| `date` | Record date |
| `description` | Record intent |

## exceptions.csv

Records that could not be fully classified. Columns:

| Column | Description |
|--------|-------------|
| `record_id` | SPR record ID (or `"system"` for non-record exceptions) |
| `severity` | `advisory` or `blocking` |
| `code` | Machine-readable exception code |
| `message` | Human-readable description |

## accounting-export-manifest.json

SHA-256 hashes of every file in the export. Verify integrity:

```js
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("accounting-export-manifest.json"));
for (const entry of manifest.files) {
  const actual = createHash("sha256")
    .update(readFileSync(entry.name))
    .digest("hex");
  console.log(entry.name, actual === entry.sha256 ? "OK" : "MISMATCH");
}
```

---

**Next:** [Exception Handling and Missing Context](09-exception-handling-and-missing-context.md)
