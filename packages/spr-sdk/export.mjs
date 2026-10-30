// SPR Accounting Export – standalone export logic (Phase 4).
//
// Generates the full accounting export package from a set of verified SPR records.
// Designed to be called by SprBook.exportAccountingPackage() or directly by a CLI.
//
// Output files (written atomically; all-or-nothing):
//   spr-records.jsonl              (copy of the signed SPR records – unchanged)
//   verification-report.json       (seal check for each record)
//   accounting-transactions.csv    (one row per current-version record)
//   journal-entries.csv            (draft debit/credit lines)
//   exceptions.csv                 (records needing human review)
//   accounting-export-manifest.json (separate from SPR manifest)
//   README.md                      (audit guide)
//
// The SPR signed package files (manifest.json, keys.jsonl, etc.) are written by
// the existing exportPackage() method; this module does not touch them.

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { classify } from "./classify.mjs";
import { generateDraftJournal } from "./journal.mjs";
import { buildCsv } from "./csv.mjs";
import { makeAccountingTransaction, makeVerificationOutcome, makeExportManifest,
         SettlementConfidence, JournalStatus, ACCOUNTING_EXPORT_SCHEMA } from "./contracts.mjs";

export const EXPORT_VERSION = "1";
const PRODUCER = { name: "spr-accounting-export", version: "0.1.0" };

/**
 * buildAccountingExport(records, keys, opts) → { files: { [name]: string }, stats }
 *
 * records: array of { payload, seal } from records.jsonl (current versions only)
 * keys:    Map<keyId, { key_id, public_pem, algorithm }> from keys.jsonl
 * opts: {
 *   export_id: string,
 *   generated_at: string (ISO),
 *   entity: string,
 *   spr_manifest_sha256: string | null,
 *   companyProfile: { industry, reporting_framework, capitalization_threshold_minor?, jurisdiction? },
 *   companyMapping: { gl_accounts?, ap_account?, bank_account? },
 *   classificationContext: { [record_id]: { delivery_context?, for_resale?, override_categories? } },
 *   verifySeal: (payload, seal, keyring) => VerificationOutcome,
 * }
 */
export function buildAccountingExport(records, keyring, opts = {}) {
  const exportId = opts.export_id ?? `ae_${Date.now().toString(36)}`;
  const generatedAt = opts.generated_at ?? new Date().toISOString();
  const entity = opts.entity ?? "unknown";
  const spr_manifest_sha256 = opts.spr_manifest_sha256 ?? null;
  const companyProfile = opts.companyProfile ?? { industry: "general" };
  const companyMapping = opts.companyMapping ?? {};
  const contextMap = opts.classificationContext ?? {};
  const verifySealFn = opts.verifySeal;

  const transactions = [];
  const allJournalLines = [];
  const allExceptions = [];
  const verificationResults = [];

  for (const row of records) {
    const p = row.payload;
    const recordId = p.record_id;
    const digest = row.seal?.payload_sha256 ?? null;

    // Verification
    let sealValid = false;
    if (verifySealFn && digest) {
      const v = verifySealFn(p, row.seal, keyring);
      sealValid = Boolean(v?.ok);
      verificationResults.push(makeVerificationOutcome({
        record_id: recordId,
        spr_payload_sha256: digest,
        seal_valid: sealValid,
        hash_matches: Boolean(v?.hash_matches),
        signature_valid: Boolean(v?.signature_valid),
        key_id: row.seal?.key_id ?? null,
        core_fields_ok: Boolean(v?.core_fields_ok ?? true),
        problems: v?.problems ?? [],
        settlement_confidence: SettlementConfidence.UNCONFIRMED,
      }));
    }

    // Classification
    const recordContext = { ...contextMap[recordId], export_id: exportId };
    // Attach digest to record so classify/journal can reference it
    const recordWithDigest = { ...p, _spr_payload_sha256: digest };
    const { result: classification, exceptions: classExceptions } = classify(recordWithDigest, recordContext, companyProfile);
    allExceptions.push(...classExceptions);

    // Journal
    const { lines, status, exceptions: journalExceptions } = generateDraftJournal(
      recordWithDigest, classification, companyMapping, { export_id: exportId, seal_valid: sealValid }
    );
    allExceptions.push(...journalExceptions);
    allJournalLines.push(...lines);

    // Accounting transaction
    transactions.push(makeAccountingTransaction({
      record_id: recordId,
      spr_payload_sha256: digest,
      spr_version: p.version,
      entity: p.entity,
      rail: p.rail,
      direction: p.direction,
      amount_minor: p.amount_minor,
      currency: p.currency,
      occurred_at: p.occurred_at,
      settled_on: p.settled_on,
      counterparty: p.counterparty,
      state: p.state,
      intent_id: p.intent?.intent_id ?? null,
      reported_by: p.reported_by,
      settlement_confidence: SettlementConfidence.UNCONFIRMED,
      classification,
      journal_status: status,
      export_id: exportId,
    }));
  }

  // Sort deterministically
  transactions.sort((a, b) => a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0);
  allJournalLines.sort((a, b) => {
    const c = a.record_id.localeCompare(b.record_id);
    return c !== 0 ? c : a.line_seq - b.line_seq;
  });
  allExceptions.sort((a, b) => a.record_id.localeCompare(b.record_id));

  // Build files
  const sprRecordsJsonl = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");

  const verificationReport = JSON.stringify({
    schema: "luca.verification-report/0.1",
    export_id: exportId,
    generated_at: generatedAt,
    entity,
    total_records: records.length,
    verified_ok: verificationResults.filter((v) => v.seal_valid).length,
    settlement_confidence_note: "All records show settlement_confidence: unconfirmed. Local SPR does not confirm rail settlement; only hosted Luca can confirm that.",
    results: verificationResults,
  }, null, 2) + "\n";

  const txCsv = buildCsv([
    { key: "record_id",           header: "record_id" },
    { key: "spr_version",         header: "version", numeric: true },
    { key: "entity",              header: "entity" },
    { key: "rail",                header: "rail" },
    { key: "direction",           header: "direction" },
    { key: "amount_minor",        header: "amount_minor", numeric: true },
    { key: "currency",            header: "currency" },
    { key: "occurred_at",         header: "occurred_at" },
    { key: "settled_on",          header: "settled_on" },
    { key: "counterparty",        header: "counterparty" },
    { key: "state",               header: "state" },
    { key: "intent_id",           header: "intent_id" },
    { key: "settlement_confidence", header: "settlement_confidence" },
    { key: "treatment",           header: "treatment" },
    { key: "account_code",        header: "account_code" },
    { key: "account_name",        header: "account_name" },
    { key: "journal_status",      header: "journal_status" },
    { key: "spr_payload_sha256",  header: "spr_payload_sha256" },
    { key: "export_id",           header: "export_id" },
  ], transactions.map((t) => ({
    ...t,
    treatment:    t.classification?.treatment ?? "",
    account_code: t.classification?.account_code ?? "",
    account_name: t.classification?.account_name ?? "",
  })));

  const journalCsv = buildCsv([
    { key: "record_id",                   header: "record_id" },
    { key: "line_seq",                    header: "line_seq", numeric: true },
    { key: "account_code",                header: "account_code" },
    { key: "account_name",                header: "account_name" },
    { key: "debit_minor",                 header: "debit_minor", numeric: true },
    { key: "credit_minor",                header: "credit_minor", numeric: true },
    { key: "currency",                    header: "currency" },
    { key: "posting_date",                header: "posting_date" },
    { key: "description",                 header: "description" },
    { key: "classification_rule_id",      header: "classification_rule_id" },
    { key: "classification_rule_version", header: "classification_rule_version" },
    { key: "spr_payload_sha256",          header: "spr_payload_sha256" },
    { key: "export_id",                   header: "export_id" },
  ], allJournalLines);

  const exceptionCsv = buildCsv([
    { key: "record_id",         header: "record_id" },
    { key: "exception_type",    header: "exception_type" },
    { key: "message",           header: "message" },
    { key: "requires_action",   header: "requires_action" },
    { key: "spr_payload_sha256", header: "spr_payload_sha256" },
    { key: "export_id",         header: "export_id" },
  ], allExceptions);

  const readme = buildReadme({ exportId, generatedAt, entity, records, allJournalLines, allExceptions });

  // Compute sha256 for each accounting file
  const accountingFiles = {
    "spr-records.jsonl":              sprRecordsJsonl,
    "verification-report.json":       verificationReport,
    "accounting-transactions.csv":    txCsv,
    "journal-entries.csv":            journalCsv,
    "exceptions.csv":                 exceptionCsv,
    "README.md":                      readme,
  };

  const fileShas = Object.fromEntries(
    Object.entries(accountingFiles).map(([name, text]) => [
      name, createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")
    ])
  );

  const manifest = makeExportManifest({
    export_id: exportId,
    generated_at: generatedAt,
    entity,
    spr_manifest_sha256,
    record_count: records.length,
    journal_line_count: allJournalLines.length,
    exception_count: allExceptions.length,
    files: Object.entries(fileShas).map(([name, sha256]) => ({ name, sha256 })),
    producer: PRODUCER,
  });

  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";

  return {
    files: {
      ...accountingFiles,
      "accounting-export-manifest.json": manifestJson,
    },
    stats: {
      export_id: exportId,
      record_count: records.length,
      journal_line_count: allJournalLines.length,
      exception_count: allExceptions.length,
      verified_ok: verificationResults.filter((v) => v.seal_valid).length,
    },
  };
}

/**
 * writeAccountingExport(outDir, files, opts) → { folder, files, ... }
 * Writes files atomically: all succeed or the directory is cleaned up.
 * Never overwrites an existing export unless opts.overwrite is true.
 */
export function writeAccountingExport(outDir, files, opts = {}) {
  const out = resolve(outDir);
  const accountingMarker = join(out, "accounting-export-manifest.json");
  if (existsSync(accountingMarker) && !opts.overwrite)
    throw new Error(`${outDir} already holds an accounting export; choose another folder, or pass overwrite: true`);

  mkdirSync(out, { recursive: true });
  const written = [];
  try {
    for (const [name, text] of Object.entries(files)) {
      const dest = join(out, name);
      writeFileSync(dest, text, "utf8");
      written.push(name);
    }
  } catch (e) {
    // Atomic: remove partial output on failure
    for (const name of written) {
      try { rmSync(join(out, name)); } catch {}
    }
    throw e;
  }
  return { folder: outDir, files: written };
}

function buildReadme({ exportId, generatedAt, entity, records, allJournalLines, allExceptions }) {
  return `# SPR Accounting Export

**Export ID:** ${exportId}
**Entity:** ${entity}
**Generated:** ${generatedAt}
**SPR format:** spr/draft-1

## Files in this package

| File | Description |
|------|-------------|
| \`spr-records.jsonl\` | Copy of the sealed SPR records. Verify with: \`npx spr-verify .\` or \`python -m spr .\` |
| \`manifest.json\` | SPR package manifest (sealed). Governs the SPR records above. |
| \`keys.jsonl\` | Public signing keys for the sealed records. |
| \`verification-report.json\` | Cryptographic seal check for each record. |
| \`accounting-transactions.csv\` | One row per payment with classification and journal status. |
| \`journal-entries.csv\` | Draft debit/credit lines. Status: DRAFT or NEEDS_REVIEW. |
| \`exceptions.csv\` | Payments needing human review before they can be journalised. |
| \`accounting-export-manifest.json\` | SHA-256 of each accounting file in this package. |

## Records: ${records.length} | Journal lines: ${allJournalLines.length} | Exceptions: ${allExceptions.length}

## How to verify

\`\`\`
# Verify the SPR package (cryptographic integrity):
npx spr-verify .   --key company.pem
python -m spr . --key company.pem

# Check the accounting export manifest:
# Compute SHA-256 of each file listed in accounting-export-manifest.json and compare.
\`\`\`

## Important notes

- **Journal status:** All entries are DRAFT or NEEDS_REVIEW. No entry has been posted to an ERP.
- **Settlement confidence:** All records show \`settlement_confidence: unconfirmed\`. Local SPR records
  what the agent reported; only Luca's hosted service can confirm payment from the rail itself.
- **Exceptions:** Review exceptions.csv before importing journal entries. Missing GL mappings and
  incomplete context must be resolved before posting.
- **ERP import:** Do not import these files directly into an ERP without first mapping account codes
  to your chart of accounts and verifying with your accounting team.
- **Private key:** This export contains no private signing key.

## Audit trail

Each journal line and transaction row carries the SPR \`record_id\` and \`spr_payload_sha256\`.
Auditors can independently verify the sealed record by:
1. Running \`spr-verify\` against this package with the company's public key.
2. Comparing the \`spr_payload_sha256\` in each row against the verified digest.
`;
}
