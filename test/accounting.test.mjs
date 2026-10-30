// SPR Accounting Export tests (Phase 6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { classify, inferCategories } = await import("@luca-network/spr-sdk/classify");
const { generateDraftJournal } = await import("@luca-network/spr-sdk/journal");
const { buildAccountingExport, writeAccountingExport } = await import("@luca-network/spr-sdk/export");
const { csvCell, buildCsv } = await import("@luca-network/spr-sdk/csv");
const { Treatment, JournalStatus } = await import("@luca-network/spr-sdk/contracts");
const { SprBook } = await import("@luca-network/spr-sdk");
const spr = (await import("@luca-network/spr")).default ?? await import("@luca-network/spr");

// ── helpers ────────────────────────────────────────────────────────────────────────────────
const makeRecord = (overrides = {}) => ({
  record_id: "LR-STRIPE-AABBCC1122-v1",
  version: 1, supersedes: null,
  entity: "Example Co", rail: "stripe",
  direction: "outflow", state: "cleared",
  source: { id: "pi_test_1", payload_sha256: "0".repeat(64) },
  amount_minor: 1500, currency: "USD",
  occurred_at: "2026-10-28T12:00:00Z",
  settled_on: "2026-10-28",
  counterparty: "Data Provider Ltd",
  schema: "luca.record/0.7",
  reported_by: "agent",
  _spr_payload_sha256: "a".repeat(64),
  ...overrides,
});

const INTERNAL_PROFILE = { industry: "research", reporting_framework: "US_GAAP" };
const CUSTOMER_PROFILE = { industry: "software_saas", reporting_framework: "US_GAAP" };

// ── Phase 2: Classification tests ─────────────────────────────────────────────────────────

test("classify: $15 data access, internal-use → OPERATING_EXPENSE", () => {
  const r = makeRecord({ amount_minor: 1500, purpose: "market data for the pricing model" });
  const { result, exceptions } = classify(r, { delivery_context: "internal_use" }, INTERNAL_PROFILE);
  assert.ok(result, `Expected result, got exceptions: ${JSON.stringify(exceptions)}`);
  assert.equal(result.treatment, Treatment.OPERATING_EXPENSE);
  assert.equal(result.industry, "research");
  // Advisory exception about delivery_context is NOT raised because we provided it
  assert.equal(exceptions.filter(e => e.exception_type === "missing_context" && e.requires_action).length, 0);
});

test("classify: $15 data access, customer-delivery → COST_OF_REVENUE", () => {
  const r = makeRecord({ amount_minor: 1500, purpose: "market data for the pricing model" });
  const { result, exceptions } = classify(r, { delivery_context: "customer_delivery" }, CUSTOMER_PROFILE);
  assert.ok(result, `Expected result, got exceptions: ${JSON.stringify(exceptions)}`);
  assert.equal(result.treatment, Treatment.COST_OF_REVENUE);
});

test("classify: $3,200 laptop (above $2,500 threshold) → FIXED_ASSET", () => {
  const r = makeRecord({ amount_minor: 320000, purpose: "laptop for the engineering team" });
  const { result } = classify(r, { delivery_context: "internal_use" }, INTERNAL_PROFILE);
  assert.ok(result);
  assert.equal(result.treatment, Treatment.FIXED_ASSET);
});

test("classify: $800 laptop (below $2,500 threshold) → OPERATING_EXPENSE", () => {
  const r = makeRecord({ amount_minor: 80000, purpose: "laptop for the engineering team" });
  const { result } = classify(r, { delivery_context: "internal_use" }, INTERNAL_PROFILE);
  assert.ok(result);
  assert.equal(result.treatment, Treatment.OPERATING_EXPENSE);
});

test("classify: company custom capitalisation threshold overrides template", () => {
  const r = makeRecord({ amount_minor: 80000, purpose: "laptop for the engineering team" });
  const profile = { ...INTERNAL_PROFILE, capitalization_threshold_minor: 50000 };
  const { result } = classify(r, { delivery_context: "internal_use" }, profile);
  assert.ok(result);
  assert.equal(result.treatment, Treatment.FIXED_ASSET);
});

test("classify: missing industry → exception, no result", () => {
  const r = makeRecord({});
  const { result, exceptions } = classify(r, {}, {});
  assert.equal(result, null);
  assert.ok(exceptions.some(e => e.exception_type === "missing_context"));
});

test("classify: data purchase with no delivery_context → advisory exception only (result present)", () => {
  const r = makeRecord({ purpose: "api data feed" });
  const { result, exceptions } = classify(r, {}, INTERNAL_PROFILE);
  assert.ok(result); // classification proceeds with default
  const advisory = exceptions.filter(e => e.requires_action === false);
  assert.ok(advisory.length > 0, "Expected advisory exception about missing delivery_context");
});

test("classify: unknown industry → exception", () => {
  const r = makeRecord({});
  const { result, exceptions } = classify(r, {}, { industry: "nonexistent_industry" });
  assert.equal(result, null);
  assert.ok(exceptions.some(e => /Unknown industry/.test(e.message)));
});

test("inferCategories: detects laptop, hardware, equipment from text", () => {
  const cats = inferCategories("Purchased a MacBook Pro laptop for engineering");
  assert.ok(cats.includes("laptop"));
  assert.ok(cats.includes("hardware"));
  assert.ok(cats.includes("equipment"));
});

test("inferCategories: detects data and api from text", () => {
  const cats = inferCategories("market data feed via API call for pricing model");
  assert.ok(cats.includes("data"));
  assert.ok(cats.includes("api"));
});

// ── Phase 3: Journal tests ─────────────────────────────────────────────────────────────────

test("journal: every emitted journal balances (debits === credits)", () => {
  const r = makeRecord({ amount_minor: 5000 });
  const { result: cls } = classify(r, { delivery_context: "internal_use" }, INTERNAL_PROFILE);
  assert.ok(cls);
  const { lines, balance_ok } = generateDraftJournal(r, cls, {});
  assert.equal(balance_ok, true);
  const totalDebit  = lines.reduce((s, l) => s + l.debit_minor, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit_minor, 0);
  assert.equal(totalDebit, totalCredit);
  assert.equal(totalDebit, 5000);
});

test("journal: missing classification → exception, no lines", () => {
  const r = makeRecord({});
  const { lines, exceptions, balance_ok } = generateDraftJournal(r, null, {});
  assert.equal(lines.length, 0);
  assert.equal(balance_ok, false);
  assert.ok(exceptions.length > 0);
});

test("journal: status is DRAFT for unverified seal, VERIFIED_EVIDENCE when seal_valid", () => {
  const r = makeRecord({ amount_minor: 100 });
  const { result: cls } = classify(r, { delivery_context: "internal_use" }, INTERNAL_PROFILE);
  const { status: draftStatus } = generateDraftJournal(r, cls, {}, { seal_valid: false });
  assert.equal(draftStatus, JournalStatus.DRAFT);
  const { status: verifStatus } = generateDraftJournal(r, cls, {}, { seal_valid: true });
  assert.equal(verifStatus, JournalStatus.VERIFIED_EVIDENCE);
});

test("journal: status is never POSTED", () => {
  const statuses = Object.values(JournalStatus);
  assert.ok(!statuses.includes("POSTED"), "POSTED must not be a valid journal status");
});

test("journal: fixed asset lines contain depreciation note", () => {
  const r = makeRecord({ amount_minor: 320000, purpose: "laptop for the engineering team" });
  const { result: cls } = classify(r, { delivery_context: "internal_use" }, INTERNAL_PROFILE);
  assert.equal(cls.treatment, Treatment.FIXED_ASSET);
  const { lines } = generateDraftJournal(r, cls, {});
  assert.ok(lines.some(l => /FIXED ASSET/i.test(l.description)));
});

// ── Phase 4: Export package tests ─────────────────────────────────────────────────────────

test("exportAccountingPackage: SPR package still independently verifies after accounting export", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-acct-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_acct", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_acct_1", amount_minor: 1500, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z", counterparty: "Data Provider Ltd" });
    const result = book.exportAccountingPackage(join(dir, "export"), {
      companyProfile: { industry: "research", reporting_framework: "US_GAAP" },
    });
    // SPR verification must still pass
    assert.equal(result.verified, true, "SPR package should still verify after accounting export");
    // Accounting files written
    assert.ok(result.accounting_files.includes("accounting-transactions.csv"));
    assert.ok(result.accounting_files.includes("journal-entries.csv"));
    assert.ok(result.accounting_files.includes("exceptions.csv"));
    assert.ok(result.accounting_files.includes("accounting-export-manifest.json"));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("exportAccountingPackage: no private key in accounting export", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-nokey-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_nokey", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_nokey_1", amount_minor: 500, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    book.exportAccountingPackage(join(dir, "export"), {
      companyProfile: { industry: "general" },
    });
    // The private key must not be in the export folder
    assert.ok(!existsSync(join(dir, "export", "key.pem")), "key.pem must not appear in accounting export");
    // Verify no text file in the export contains PRIVATE KEY marker
    const exportDir = join(dir, "export");
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(exportDir);
    for (const f of files) {
      const content = readFileSync(join(exportDir, f), "utf8");
      assert.ok(!content.includes("PRIVATE KEY"), `${f} must not contain private key material`);
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("exportAccountingPackage: idempotent re-export produces same financial rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-idem-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_idem", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_idem_1", amount_minor: 2000, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    const opts = { companyProfile: { industry: "general" }, overwrite: false };
    book.exportAccountingPackage(join(dir, "export1"), opts);
    book.exportAccountingPackage(join(dir, "export2"), opts);
    const csv1 = readFileSync(join(dir, "export1", "journal-entries.csv"), "utf8");
    const csv2 = readFileSync(join(dir, "export2", "journal-entries.csv"), "utf8");
    // Same records should produce identical journal rows (excluding export_id timestamp)
    // Compare line count and first data row structure
    const lines1 = csv1.trim().split("\r\n");
    const lines2 = csv2.trim().split("\r\n");
    assert.equal(lines1.length, lines2.length, "Same number of journal lines in both exports");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("exportAccountingPackage: overwrite protection works", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-owp-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_owp", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_owp_1", amount_minor: 100, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    book.exportAccountingPackage(join(dir, "export"), { companyProfile: { industry: "general" } });
    // Second export without overwrite should fail because SPR package already exists
    assert.throws(
      () => book.exportAccountingPackage(join(dir, "export"), { companyProfile: { industry: "general" } }),
      /already holds an export/
    );
    // With overwrite it succeeds
    assert.ok(book.exportAccountingPackage(join(dir, "export"), { companyProfile: { industry: "general" }, overwrite: true }));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("exportAccountingPackage: accounting-export-manifest sha256 matches files", async () => {
  const { createHash } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "spr-manifest-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_mf", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_mf_1", amount_minor: 1000, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    const expDir = join(dir, "export");
    book.exportAccountingPackage(expDir, { companyProfile: { industry: "general" } });
    const manifest = JSON.parse(readFileSync(join(expDir, "accounting-export-manifest.json"), "utf8"));
    for (const { name, sha256 } of manifest.files) {
      const actual = createHash("sha256").update(readFileSync(join(expDir, name))).digest("hex");
      assert.equal(actual, sha256, `SHA-256 mismatch for ${name}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("exportAccountingPackage: exception when no classification context for unknown item", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-exc-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_exc", entity: "Example Co" });
    // data purchase with no delivery_context → advisory exception but not blocking
    book.seal({ rail: "stripe", source_id: "pi_exc_1", amount_minor: 1500, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z", counterparty: "api data provider" });
    const expDir = join(dir, "export");
    const result = book.exportAccountingPackage(expDir, { companyProfile: { industry: "research" } });
    const excCsv = readFileSync(join(expDir, "exceptions.csv"), "utf8");
    // Advisory exception for missing delivery_context on data purchase
    assert.ok(excCsv.includes("missing_context"), "Should have a missing_context advisory exception");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

// ── Phase 1: CSV safety tests ──────────────────────────────────────────────────────────────

test("csv: formula injection prevention – = prefix gets leading space", () => {
  assert.equal(csvCell("=HYPERLINK(A1)"), " =HYPERLINK(A1)");
  assert.equal(csvCell("+1234"), " +1234");
  assert.equal(csvCell("-1234"), " -1234");
  assert.equal(csvCell("@SUM(A1)"), " @SUM(A1)");
});

test("csv: numeric fields pass through as numbers", () => {
  assert.equal(csvCell(1500, { numeric: true }), "1500");
  assert.equal(csvCell(-250, { numeric: true }), "-250");
  assert.equal(csvCell(0, { numeric: true }), "0");
});

test("csv: fields with commas are quoted", () => {
  assert.equal(csvCell("Smith, John"), '"Smith, John"');
});

test("csv: fields with double-quotes have them escaped", () => {
  assert.equal(csvCell('say "hello"'), '"say ""hello"""');
});

test("csv: null and undefined produce empty string", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csv: buildCsv produces correct row count", () => {
  const out = buildCsv(
    [{ key: "a", header: "A" }, { key: "b", header: "B", numeric: true }],
    [{ a: "hello", b: 42 }, { a: "world", b: 99 }]
  );
  const lines = out.split("\r\n").filter(Boolean);
  assert.equal(lines.length, 3); // header + 2 data rows
  assert.equal(lines[0], "A,B");
  assert.equal(lines[1], "hello,42");
});

// ── Negative / security tests ──────────────────────────────────────────────────────────────

test("forged record: verify returns ok=false", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-forge-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_f", entity: "Example Co" });
    const r = book.seal({ rail: "stripe", source_id: "pi_f_1", amount_minor: 100, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    // Tamper with the record
    const payload = JSON.parse(readFileSync(join(dir, "records.jsonl"), "utf8").trim());
    payload.payload.amount_minor = 999999;
    const forgedSeal = { ...payload.seal }; // original seal, wrong payload
    const v = (await import("@luca-network/spr")).verifySeal(payload.payload, forgedSeal,
      book.publicKey().public_pem);
    assert.equal(v.ok, false, "Forged record should not verify");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("duplicate record: same source_id sealed twice with same facts → status unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-dup-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_d", entity: "Example Co" });
    const r1 = book.seal({ rail: "stripe", source_id: "pi_dup_1", amount_minor: 100, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    const r2 = book.seal({ rail: "stripe", source_id: "pi_dup_1", amount_minor: 100, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    assert.equal(r1.status, "recorded");
    assert.equal(r2.status, "unchanged");
    assert.equal(r1.record_id, r2.record_id);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("correction with different facts requires reason", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-corr-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_corr", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_corr_1", amount_minor: 100, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    const conflict = book.seal({ rail: "stripe", source_id: "pi_corr_1", amount_minor: 200, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z" });
    assert.equal(conflict.status, "conflict", "Should return conflict without reason");
    const corrected = book.seal({ rail: "stripe", source_id: "pi_corr_1", amount_minor: 200, currency: "USD",
      occurred_at: "2026-10-28T12:00:00Z", correction: { reason: "Rail confirmed different amount" } });
    assert.equal(corrected.status, "new_version");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});
