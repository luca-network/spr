// SPR Accounting Export – CSV serialiser (Phase 1/4).
//
// Produces UTF-8 CSV that is:
//   - RFC 4180 compliant (CRLF line endings, fields quoted when necessary)
//   - Safe against formula injection in spreadsheet applications
//   - Deterministically ordered

// Characters that, if at the start of a cell, would be interpreted as formulas
// by Excel/Sheets. We prefix the cell with a space to defuse them.
// Note: \r is NOT included — it is not a formula trigger and is handled separately
// by the quoting path below, so including it here would corrupt leading-\r values.
const FORMULA_CHARS = new Set(["=", "+", "-", "@", "\t"]);

/**
 * Escape a single CSV cell value.
 * - null/undefined → empty string
 * - numbers → bare decimal (integers only)
 * - strings → quoted if they contain comma, double-quote, newline or CRLF
 * - formula injection: text-type fields starting with FORMULA_CHARS get a leading space
 */
export function csvCell(value, { numeric = false } = {}) {
  if (value === null || value === undefined) return "";
  if (numeric) {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  let s = String(value);
  // Defuse formula injection for text fields
  if (s.length > 0 && FORMULA_CHARS.has(s[0])) s = " " + s;
  // Quote if needed
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Serialise an array of row arrays to a CSV string with CRLF line endings.
 * First element of rows is treated as the header.
 */
export function toCsv(rows) {
  return rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
}

/**
 * Build a CSV from an array of objects and a column spec.
 * columns: [{ key, header, numeric }]
 * rows: objects
 * Ordered deterministically by the provided sort key if given.
 */
export function buildCsv(columns, rows) {
  const header = columns.map((c) => csvCell(c.header));
  const body = rows.map((row) =>
    columns.map((c) => csvCell(row[c.key], { numeric: Boolean(c.numeric) }))
  );
  return toCsv([header, ...body]);
}
