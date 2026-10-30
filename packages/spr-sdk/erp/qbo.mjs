// SPR Accounting Export – QuickBooks Online import profile (Phase 5).
//
// IMPORTANT – UNVERIFIED SAMPLE:
// This profile generates a CSV in a format intended to resemble QuickBooks Online's
// journal entry import layout. It has NOT been tested against a QBO sandbox or live account.
// QuickBooks Online import formats vary by product version, region and account settings.
// Do NOT import this output without first verifying it matches your QBO version's template,
// mapping account codes to your actual chart of accounts, and having your accountant review it.
//
// Status: UNVERIFIED – no QBO sandbox available at implementation time.

import { buildCsv } from "../csv.mjs";

export const QBO_PROFILE_VERSION = "0.1.0-unverified";
export const QBO_DISCLAIMER = "SAMPLE/UNVERIFIED: Not tested against a QBO sandbox. Verify against your QBO version before import.";

/**
 * toQboCsv(journalLines) → CSV string suitable as a starting point for QBO journal import.
 *
 * QBO journal import typically requires: Date, Memo, Account, Debit, Credit, Name.
 * Amounts in decimal dollars (minor units / 100 for USD/2dp currencies).
 */
export function toQboCsv(journalLines) {
  const rows = journalLines.map((l) => ({
    "Date":        l.posting_date ?? "",
    "Memo":        `[SPR:${l.record_id}] ${l.description ?? ""}`.slice(0, 200),
    "Account":     l.account_name ?? l.account_code ?? "",
    "Debit":       l.debit_minor > 0 ? (l.debit_minor / 100).toFixed(2) : "",
    "Credit":      l.credit_minor > 0 ? (l.credit_minor / 100).toFixed(2) : "",
    "Name":        "",
    "SPR_Record":  l.record_id,
    "SPR_Digest":  l.spr_payload_sha256 ?? "",
    "Status":      "DRAFT",
    "Note":        QBO_DISCLAIMER,
  }));

  return buildCsv([
    { key: "Date",       header: "Date" },
    { key: "Memo",       header: "Memo" },
    { key: "Account",    header: "Account" },
    { key: "Debit",      header: "Debit" },
    { key: "Credit",     header: "Credit" },
    { key: "Name",       header: "Name" },
    { key: "SPR_Record", header: "SPR_Record_ID" },
    { key: "SPR_Digest", header: "SPR_Payload_SHA256" },
    { key: "Status",     header: "Status" },
    { key: "Note",       header: "Note" },
  ], rows);
}
