// SPR Accounting Export – journal generation (Phase 3).
//
// Generates DRAFT journal entries from classified SPR records.
// Rules:
//   - Every entry must balance: sum(debit_minor) === sum(credit_minor) per record per currency
//   - Status is always DRAFT, NEEDS_REVIEW, or VERIFIED_EVIDENCE; never POSTED
//   - Missing GL mapping → ExceptionRecord, no unbalanced entry emitted
//   - Traceable: each line carries SPR record_id, payload_sha256, rule_id, and rule_version
//
// Supported treatments:
//   OPERATING_EXPENSE: Dr Expense / Cr Accounts Payable (or Bank)
//   COST_OF_REVENUE:   Dr COGS / Cr Accounts Payable
//   PREPAID_ASSET:     Dr Prepaid Asset / Cr Accounts Payable  (amortisation is staged separately)
//   FIXED_ASSET:       Dr Fixed Asset / Cr Accounts Payable    (depreciation is staged separately)
//   INVENTORY:         Dr Inventory / Cr Accounts Payable
//   INTERCOMPANY:      Dr Intercompany / Cr Intercompany Payable

import { Treatment, JournalStatus, makeDraftJournalLine, makeExceptionRecord } from "./contracts.mjs";

export const JOURNAL_VERSION = "1.0.0";

// Default AP/Cash account when no company mapping provides one.
const DEFAULT_AP = { code: "2000", name: "Accounts Payable" };
const DEFAULT_BANK = { code: "1000", name: "Cash / Bank" };

/**
 * generateDraftJournal(record, classification, companyMapping, opts) →
 *   { lines, status, exceptions, balance_ok, export_id }
 *
 * record: SPR record payload
 * classification: output of classify() result (or null → produces exception)
 * companyMapping: {
 *   gl_accounts: { [code]: { code, name } },   // optional overrides
 *   ap_account: { code, name } | null,
 *   bank_account: { code, name } | null,
 * }
 * opts: { export_id, settlement_confidence }
 */
export function generateDraftJournal(record, classification, companyMapping = {}, opts = {}) {
  const recordId = record?.record_id ?? "unknown";
  const digest = record?._spr_payload_sha256 ?? null;
  const exportId = opts.export_id ?? null;
  const exceptions = [];

  if (!classification) {
    exceptions.push(makeExceptionRecord({
      record_id: recordId, spr_payload_sha256: digest,
      exception_type: "missing_context",
      message: "No classification result; cannot generate journal entry. Review exceptions for the classification reason.",
      export_id: exportId,
    }));
    return { lines: [], status: JournalStatus.NEEDS_REVIEW, exceptions, balance_ok: false, export_id: exportId };
  }

  const amt = Math.abs(record?.amount_minor ?? 0);
  const currency = record?.currency ?? "USD";
  const postingDate = record?.settled_on ?? (record?.occurred_at ?? "").slice(0, 10);
  const isInflow = record?.direction === "inflow";

  const ap = companyMapping.ap_account ?? DEFAULT_AP;
  const bank = companyMapping.bank_account ?? DEFAULT_BANK;

  // Resolve the debit account from classification
  const debitAccount = resolveGlAccount(classification.account_code, classification.account_name, companyMapping);
  if (!debitAccount) {
    exceptions.push(makeExceptionRecord({
      record_id: recordId, spr_payload_sha256: digest,
      exception_type: "missing_gl_mapping",
      message: `GL account ${classification.account_code} (${classification.account_name}) is not in the company's chart of accounts. Add it to companyMapping.gl_accounts.`,
      details: { account_code: classification.account_code, treatment: classification.treatment },
      export_id: exportId,
    }));
    return { lines: [], status: JournalStatus.NEEDS_REVIEW, exceptions, balance_ok: false, export_id: exportId };
  }

  const baseFields = {
    record_id: recordId,
    spr_payload_sha256: digest,
    currency,
    posting_date: postingDate,
    description: buildDescription(record, classification),
    classification_rule_id: classification.rule_id,
    classification_rule_version: classification.classify_version,
    export_id: exportId,
  };

  let lines = [];

  if (isInflow) {
    // Inflow: Dr Bank / Cr Revenue account (use credit account from classification)
    lines = [
      makeDraftJournalLine({ ...baseFields, line_seq: 1, account_code: bank.code, account_name: bank.name, debit_minor: amt, credit_minor: 0 }),
      makeDraftJournalLine({ ...baseFields, line_seq: 2, account_code: debitAccount.code, account_name: debitAccount.name, debit_minor: 0, credit_minor: amt }),
    ];
  } else {
    // Outflow: treatment determines the debit account
    switch (classification.treatment) {
      case Treatment.OPERATING_EXPENSE:
      case Treatment.COST_OF_REVENUE:
        lines = [
          makeDraftJournalLine({ ...baseFields, line_seq: 1, account_code: debitAccount.code, account_name: debitAccount.name, debit_minor: amt, credit_minor: 0 }),
          makeDraftJournalLine({ ...baseFields, line_seq: 2, account_code: ap.code, account_name: ap.name, debit_minor: 0, credit_minor: amt }),
        ];
        break;

      case Treatment.PREPAID_ASSET:
        lines = [
          makeDraftJournalLine({ ...baseFields, line_seq: 1, account_code: debitAccount.code, account_name: debitAccount.name, debit_minor: amt, credit_minor: 0,
            description: baseFields.description + " [PREPAID – amortisation schedule required]" }),
          makeDraftJournalLine({ ...baseFields, line_seq: 2, account_code: ap.code, account_name: ap.name, debit_minor: 0, credit_minor: amt }),
        ];
        break;

      case Treatment.FIXED_ASSET:
        lines = [
          makeDraftJournalLine({ ...baseFields, line_seq: 1, account_code: debitAccount.code, account_name: debitAccount.name, debit_minor: amt, credit_minor: 0,
            description: baseFields.description + " [FIXED ASSET – depreciation schedule required]" }),
          makeDraftJournalLine({ ...baseFields, line_seq: 2, account_code: ap.code, account_name: ap.name, debit_minor: 0, credit_minor: amt }),
        ];
        break;

      case Treatment.INVENTORY:
      case Treatment.INTERCOMPANY:
        // INVENTORY: Dr Inventory / Cr AP; INTERCOMPANY: Dr IC Receivable / Cr IC Payable.
        // Journal line structure is identical; account codes differ per template.
        lines = [
          makeDraftJournalLine({ ...baseFields, line_seq: 1, account_code: debitAccount.code, account_name: debitAccount.name, debit_minor: amt, credit_minor: 0 }),
          makeDraftJournalLine({ ...baseFields, line_seq: 2, account_code: ap.code, account_name: ap.name, debit_minor: 0, credit_minor: amt }),
        ];
        break;

      default:
        exceptions.push(makeExceptionRecord({
          record_id: recordId, spr_payload_sha256: digest,
          exception_type: "classification_conflict",
          message: `Unknown treatment: ${classification.treatment}`,
          export_id: exportId,
        }));
        return { lines: [], status: JournalStatus.NEEDS_REVIEW, exceptions, balance_ok: false, export_id: exportId };
    }
  }

  // Verify balance
  const totalDebit = lines.reduce((s, l) => s + l.debit_minor, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit_minor, 0);
  if (totalDebit !== totalCredit) {
    exceptions.push(makeExceptionRecord({
      record_id: recordId, spr_payload_sha256: digest,
      exception_type: "unbalanced_journal",
      message: `Journal does not balance: debits=${totalDebit}, credits=${totalCredit}`,
      export_id: exportId,
    }));
    return { lines: [], status: JournalStatus.NEEDS_REVIEW, exceptions, balance_ok: false, export_id: exportId };
  }

  // Determine status
  const sealValid = opts.seal_valid ?? false;
  const status = sealValid
    ? JournalStatus.VERIFIED_EVIDENCE
    : JournalStatus.DRAFT;

  return { lines, status, exceptions, balance_ok: true, export_id: exportId };
}

function resolveGlAccount(code, name, companyMapping) {
  // Company mapping can override account name; fall back to classification name
  const overrides = companyMapping.gl_accounts ?? {};
  if (overrides[code]) return overrides[code];
  // Accept the classification's account if the code is present; an empty name is allowed.
  if (code) return { code, name: name ?? "" };
  return null;
}

function buildDescription(record, classification) {
  const parts = [];
  if (record?.counterparty) parts.push(record.counterparty);
  const purpose = record?.purpose ?? record?.memo;
  if (purpose) parts.push(purpose.slice(0, 80));
  parts.push(`[${classification.treatment}]`);
  if (record?.intent?.intent_id) parts.push(`intent:${record.intent.intent_id}`);
  return parts.join(" – ").slice(0, 200);
}
