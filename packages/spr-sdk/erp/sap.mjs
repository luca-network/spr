// SPR Accounting Export – SAP FI posting profile (Phase 5).
//
// IMPORTANT – UNVERIFIED SAMPLE:
// This profile generates a CSV in a format intended to resemble SAP FI document posting
// (transaction FB50 / direct input). It has NOT been tested against a SAP system or sandbox.
// SAP posting layouts, company codes, cost centres, profit centres and document types vary
// significantly by implementation. Do NOT import without a qualified SAP consultant's review.
//
// Status: UNVERIFIED – no SAP sandbox available at implementation time.

import { buildCsv } from "../csv.mjs";

export const SAP_PROFILE_VERSION = "0.1.0-unverified";
export const SAP_DISCLAIMER = "SAMPLE/UNVERIFIED: Not tested against a SAP system. Verify with your SAP consultant before use.";

/**
 * toSapCsv(journalLines, opts) → CSV string for SAP FI direct input.
 * opts: { company_code, document_type, posting_period }
 */
export function toSapCsv(journalLines, opts = {}) {
  const companyCode = opts.company_code ?? "0001";
  const documentType = opts.document_type ?? "SA";
  const currency = journalLines[0]?.currency ?? "USD";

  const rows = journalLines.map((l) => ({
    "BLDAT":   l.posting_date ?? "",           // Document date
    "BUDAT":   l.posting_date ?? "",           // Posting date
    "BLART":   documentType,
    "BUKRS":   companyCode,
    "WAERS":   currency,
    "BKTXT":   `[SPR:${l.record_id}]`.slice(0, 25),
    "HKONT":   l.account_code ?? "",           // GL account
    "SGTXT":   l.description?.slice(0, 50) ?? "",
    "WRBTR":   (Math.max(l.debit_minor, l.credit_minor) / 100).toFixed(2),
    "SHKZG":   l.debit_minor > 0 ? "S" : "H", // S=Debit, H=Credit
    "SPR_ID":  l.record_id,
    "SPR_HASH": l.spr_payload_sha256 ?? "",
    "STATUS":  "DRAFT",
    "NOTE":    SAP_DISCLAIMER,
  }));

  return buildCsv([
    { key: "BLDAT",    header: "BLDAT" },
    { key: "BUDAT",    header: "BUDAT" },
    { key: "BLART",    header: "BLART" },
    { key: "BUKRS",    header: "BUKRS" },
    { key: "WAERS",    header: "WAERS" },
    { key: "BKTXT",    header: "BKTXT" },
    { key: "HKONT",    header: "HKONT" },
    { key: "SGTXT",    header: "SGTXT" },
    { key: "WRBTR",    header: "WRBTR" },
    { key: "SHKZG",    header: "SHKZG" },
    { key: "SPR_ID",   header: "SPR_Record_ID" },
    { key: "SPR_HASH", header: "SPR_Payload_SHA256" },
    { key: "STATUS",   header: "Status" },
    { key: "NOTE",     header: "Note" },
  ], rows);
}
