// SPR Accounting Export – data contracts (Phase 1).
//
// These are plain JS objects used as typed records throughout the accounting export pipeline.
// They are not JSON Schema definitions; field names and shapes are documented here as the
// single source of truth for the export format version 1.
//
// IMPORTANT: these contracts define the ACCOUNTING export layer only. The SPR signed core
// (records.jsonl, manifest.json, etc.) is governed exclusively by SPEC.md and is never
// modified by accounting code.

export const ACCOUNTING_EXPORT_SCHEMA = "luca.accounting-export/0.1";
export const ACCOUNTING_EXPORT_VERSION = "1";

// ── Accounting treatments ──────────────────────────────────────────────────────────────────
export const Treatment = Object.freeze({
  OPERATING_EXPENSE: "OPERATING_EXPENSE",
  PREPAID_ASSET:     "PREPAID_ASSET",
  FIXED_ASSET:       "FIXED_ASSET",
  INVENTORY:         "INVENTORY",
  COST_OF_REVENUE:   "COST_OF_REVENUE",
  INTERCOMPANY:      "INTERCOMPANY",
});

// ── Journal status ─────────────────────────────────────────────────────────────────────────
export const JournalStatus = Object.freeze({
  DRAFT:              "DRAFT",
  NEEDS_REVIEW:       "NEEDS_REVIEW",
  VERIFIED_EVIDENCE:  "VERIFIED_EVIDENCE",
  // POSTED is intentionally absent: posting requires an actual ERP write confirmed externally
});

// ── Settlement confidence ──────────────────────────────────────────────────────────────────
export const SettlementConfidence = Object.freeze({
  UNCONFIRMED:  "unconfirmed",  // agent-reported only; local SPR
  RAIL_MATCHED: "rail_matched", // hosted Luca: rail independently confirmed
  DISPUTED:     "disputed",
});

// ── Factories ─────────────────────────────────────────────────────────────────────────────
// Each factory returns a plain object. Callers may add additional fields; the seal covers them.

/**
 * AccountingTransaction: one payment's enriched accounting view.
 * Derived from a sealed SPR record payload; never overwrites signed content.
 */
export function makeAccountingTransaction({
  record_id,
  spr_payload_sha256,
  spr_version,
  entity,
  rail,
  direction,
  amount_minor,
  currency,
  occurred_at,
  settled_on,
  counterparty = null,
  state,
  intent_id = null,
  reported_by,
  settlement_confidence = SettlementConfidence.UNCONFIRMED,
  classification = null,   // output of classify()
  journal_status = JournalStatus.DRAFT,
  export_id,
}) {
  return {
    schema: ACCOUNTING_EXPORT_SCHEMA,
    record_id,
    spr_payload_sha256,
    spr_version,
    entity,
    rail,
    direction,
    amount_minor,
    currency,
    occurred_at,
    settled_on,
    counterparty,
    state,
    intent_id,
    reported_by,
    settlement_confidence,
    classification,
    journal_status,
    export_id,
  };
}

/**
 * DraftJournalLine: one debit or credit line in a journal entry.
 * The set of lines for one record must have sum(debit_minor) === sum(credit_minor).
 */
export function makeDraftJournalLine({
  record_id,
  spr_payload_sha256,
  line_seq,              // integer: 1, 2, … for ordering
  account_code,
  account_name,
  debit_minor = 0,
  credit_minor = 0,
  currency,
  posting_date,          // YYYY-MM-DD
  description = "",
  classification_rule_id = null,
  classification_rule_version = null,
  export_id,
}) {
  if (!Number.isInteger(debit_minor) || debit_minor < 0) throw new Error("debit_minor must be a non-negative integer");
  if (!Number.isInteger(credit_minor) || credit_minor < 0) throw new Error("credit_minor must be a non-negative integer");
  if (debit_minor !== 0 && credit_minor !== 0) throw new Error("a journal line is either a debit or a credit, not both");
  return {
    record_id,
    spr_payload_sha256,
    line_seq,
    account_code,
    account_name,
    debit_minor,
    credit_minor,
    currency,
    posting_date,
    description,
    classification_rule_id,
    classification_rule_version,
    export_id,
  };
}

/**
 * ExceptionRecord: a payment that could not be fully classified or journalised.
 * Placed in exceptions.csv for human review; the SPR record remains intact and verifiable.
 */
export function makeExceptionRecord({
  record_id,
  spr_payload_sha256,
  exception_type,        // "missing_context" | "missing_gl_mapping" | "unbalanced_journal" | "unverified_settlement" | "classification_conflict"
  message,
  details = null,
  requires_action = true,
  export_id,
}) {
  return {
    record_id,
    spr_payload_sha256,
    exception_type,
    message,
    details,
    requires_action,
    export_id,
  };
}

/**
 * VerificationOutcome: result of checking one sealed SPR record.
 * Does NOT claim settlement occurred; only reports cryptographic seal validity.
 */
export function makeVerificationOutcome({
  record_id,
  spr_payload_sha256,
  seal_valid,
  hash_matches,
  signature_valid,
  key_id,
  core_fields_ok,
  problems = [],
  settlement_confidence = SettlementConfidence.UNCONFIRMED,
  note = "Seal validity confirms cryptographic integrity of the agent-reported record. It does not prove the payment settled on the rail or that authority was granted by an external party.",
}) {
  return {
    record_id,
    spr_payload_sha256,
    seal_valid,
    hash_matches,
    signature_valid,
    key_id,
    core_fields_ok,
    problems,
    settlement_confidence,
    note,
  };
}

/**
 * ExportManifest: the accounting export's own manifest (NOT the SPR package manifest).
 * Schema: luca.accounting-export/0.1
 */
export function makeExportManifest({
  export_id,
  generated_at,
  entity,
  spr_manifest_sha256,
  record_count,
  journal_line_count,
  exception_count,
  files,               // [{ name, sha256, description }]
  format_version = ACCOUNTING_EXPORT_VERSION,
  producer,
}) {
  return {
    schema: ACCOUNTING_EXPORT_SCHEMA,
    export_id,
    generated_at,
    entity,
    format_version,
    spr_manifest_sha256,
    record_count,
    journal_line_count,
    exception_count,
    files,
    producer,
    note: "This manifest covers the accounting-export files only. The SPR package manifest (manifest.json) governs the signed SPR records and is verified independently with spr-verify.",
  };
}
