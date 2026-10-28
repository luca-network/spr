// The SPR book: an agent's sealed records, kept by the company on its own machine, with its own key.
//
// Two moments matter, and the book seals both:
//   declare(intent)    before paying: what the agent is about to buy, why, and the most it may pay. Sealed,
//                      so the record can later show the intent existed before the payment, and the intent's
//                      nonce returned, so the rail itself records which intent the payer signed under.
//   seal(settlement)   after paying: the payment, matched to its intent by ID or by the nonce alone, checked
//                      against the intent's window and cap.
// label(record) seals the company's side of the label the counterparty can confirm (SPR section 7).
//
// No call to Luca. Everything follows SPR (../../lib/spr/SPEC.md), so anyone can check the folder or an
// export of it with spr-verify and no Luca code. The folder:
//   key.pem              the company's Ed25519 key (created on first use, readable by its owner only), unless
//                        a key is passed in, for example from the operating system's keychain
//   keys.jsonl           its public key, and any earlier ones
//   intents.jsonl, cancellations.jsonl, checks.jsonl, records.jsonl, labels.jsonl   each sealed: { payload, seal }
//   mandate.json         optional: the limits the agent acts under (currency, per payment, validity)
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createPrivateKey, generateKeyPairSync, randomBytes } from "node:crypto";
import * as L from "@luca-network/spr";

export const SDK_PRODUCER = { name: "spr-sdk", version: "0.1.0" };
const RECORD_SCHEMA = "luca.record/0.7";   // SPR section 6; the hosted service seals the same schema
const INTENT_SCHEMA = "luca.intent/0.1";
const CLOCK_SKEW_MS = 2 * 60_000;

const iso = (d) => d.toISOString().replace(/\.000Z$/, "Z");
const hex = (n) => randomBytes(n).toString("hex");
function durationMs(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(s ?? "");
  if (!m || (!m[1] && !m[2] && !m[3])) throw new Error(`expires_in must be an ISO 8601 duration such as PT1H or P3D, got ${s}`);
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000;
}

export class SprBook {
  constructor(cfg) {
    if (!cfg?.agentId?.trim() || !cfg?.entity?.trim()) throw new Error("The book needs the agent's ID (agentId) and the company it pays for (entity)");
    if (!cfg.dir) throw new Error("The book needs a folder (dir) to keep its records in");
    this.cfg = { timeZone: "UTC", binding: false, now: () => new Date(), owner: null, producer: SDK_PRODUCER, ...cfg };
    this.dir = cfg.dir;
    mkdirSync(this.dir, { recursive: true });
    if (cfg.key) this.key = typeof cfg.key === "string" ? createPrivateKey(cfg.key) : cfg.key;
    else {
      const keyFile = join(this.dir, "key.pem");
      if (existsSync(keyFile)) this.key = createPrivateKey(readFileSync(keyFile, "utf8"));
      else {
        this.key = generateKeyPairSync("ed25519").privateKey;
        writeFileSync(keyFile, this.key.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
      }
    }
    if (this.key.asymmetricKeyType !== "ed25519") throw new Error("The book's key must be Ed25519");
    this.keyId = L.keyIdFor(this.key);
    if (!this.jsonl("keys.jsonl").some((k) => k.key_id === this.keyId))
      this.append("keys.jsonl", { key_id: this.keyId, algorithm: "ed25519", public_pem: L.publicKeyPemOf(this.key), created_at: iso(this.now()), owner: this.cfg.entity });
    this.intents = new Map(this.jsonl("intents.jsonl").map((i) => [i.payload.intent_id, i]));
    this.cancellations = new Map(this.jsonl("cancellations.jsonl").map((c) => [c.payload.intent_id, c]));
    this.records = this.jsonl("records.jsonl");
    this.labels = this.jsonl("labels.jsonl");
  }

  now() { return this.cfg.now(); }
  jsonl(name) {
    const f = join(this.dir, name);
    return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  }
  append(name, row) { appendFileSync(join(this.dir, name), JSON.stringify(row) + "\n"); }
  sealRow(payload) { return { payload, seal: L.sealWith(payload, this.key) }; }
  mandate() {
    const f = join(this.dir, "mandate.json");
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  }
  localDate(at) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: this.cfg.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  }

  // The mandate's limits, checked against the most the agent could pay.
  mandateChecks(amount, currency, at) {
    const m = this.mandate();
    if (!m) return { decision: "no_mandate", checks: [], mandate_id: null };
    const checks = [];
    if (m.currency) checks.push({ check: "currency", ok: !currency || currency === m.currency, detail: `Mandate in ${m.currency}; intent in ${currency ?? "no currency"}` });
    if (m.max_per_payment_minor !== undefined) checks.push({ check: "per_payment", ok: amount === null || amount <= m.max_per_payment_minor, detail: `Limit ${m.max_per_payment_minor}; up to ${amount ?? "no amount given"}` });
    if (m.valid_from || m.valid_until) checks.push({ check: "in_date", ok: (!m.valid_from || at >= new Date(m.valid_from)) && (!m.valid_until || at <= new Date(m.valid_until)),
      detail: `Valid ${m.valid_from ?? "any time"} to ${m.valid_until ?? "no end"}` });
    return { decision: checks.every((c) => c.ok) ? "within_mandate" : "outside_mandate", checks, mandate_id: m.mandate_id ?? null };
  }

  // ---- before paying ----
  declare(input) { return this.recordIntent(input); }
  recordIntent(input) {
    if (!input?.purpose?.trim()) throw new Error("purpose is required: why you are paying, in one sentence");
    const cap = input.max_amount_minor ?? null;
    if (cap !== null && (!Number.isSafeInteger(cap) || cap <= 0)) throw new Error("max_amount_minor must be a positive integer in minor units");
    if (cap !== null && input.expected_amount_minor != null && input.expected_amount_minor > cap) throw new Error("expected_amount_minor is above max_amount_minor");
    const now = this.now();
    const ttl = input.expires_in ? durationMs(input.expires_in) : (input.expires_in_hours ?? 72) * 3600_000;
    const currency = input.currency ? input.currency.toUpperCase() : null;
    const pre = this.mandateChecks(cap ?? input.expected_amount_minor ?? null, currency, now);
    const payload = {
      schema: INTENT_SCHEMA, intent_id: `int_${hex(10)}`,
      agent: { id: this.cfg.agentId, owner: this.cfg.owner }, entity: this.cfg.entity, mandate_id: pre.mandate_id ?? null,
      purpose: input.purpose.trim(), counterparty: input.counterparty ?? null,
      expected_amount_minor: input.expected_amount_minor ?? null, max_amount_minor: cap, currency,
      rail: input.rail ?? null, rail_ref: input.rail_ref ?? null, terms: input.terms ?? null,
      declared_at: iso(now), expires_at: iso(new Date(now.getTime() + ttl)),
      precheck: { decision: pre.decision, checks: pre.checks }, producer: this.cfg.producer,
    };
    const row = this.sealRow(payload);
    this.append("intents.jsonl", row);
    this.intents.set(payload.intent_id, row);
    return {
      intent_id: payload.intent_id, decision: pre.decision, checks: pre.checks, declared_at: payload.declared_at, expires_at: payload.expires_at,
      max_amount_minor: cap, seal: row.seal,
      binding: this.cfg.binding ? { scheme: L.INTENT_NONCE_SCHEME, nonce: L.intentNonce(row.seal.payload_sha256) } : null,
    };
  }
  // The intent's nonce, whether or not the book returns it on declare.
  nonceFor(intentId, seq = 0) {
    const i = this.intents.get(intentId);
    if (!i) throw new Error(`No intent ${intentId} in this book`);
    return L.intentNonce(i.seal.payload_sha256, seq);
  }

  cancelIntent(intentId, reason) {
    const i = this.intents.get(intentId);
    if (!i) throw new Error(`No intent ${intentId} in this book`);
    if (!reason?.trim()) throw new Error("Say why the intent is withdrawn");
    if (this.cancellations.has(intentId)) return this.cancellations.get(intentId).payload;
    const row = this.sealRow({ schema: "luca.intent-cancellation/0.1", intent_id: intentId, intent_payload_sha256: i.seal.payload_sha256,
      by: this.cfg.agentId, reason: reason.trim(), cancelled_at: iso(this.now()), producer: this.cfg.producer });
    this.append("cancellations.jsonl", row);
    this.cancellations.set(intentId, row);
    return row.payload;
  }

  getIntent(intentId) {
    const i = this.intents.get(intentId);
    if (!i) throw new Error(`No intent ${intentId} in this book`);
    const paid = this.current().filter((r) => r.payload.intent?.intent_id === intentId).map((r) => r.payload.record_id);
    const status = this.cancellations.has(intentId) ? "withdrawn" : paid.length ? "matched" : new Date(i.payload.expires_at) < this.now() ? "expired" : "open";
    return { ...i.payload, status, records: paid, seal: i.seal };
  }

  intentFor(intentId, nonce) {
    if (intentId) return this.intents.get(intentId) ?? null;
    if (nonce) for (const i of this.intents.values()) if (L.intentNonce(i.seal.payload_sha256) === nonce.toLowerCase()) return i;
    return null;
  }

  // Before paying: is this payment inside an open intent and the mandate? The answer is sealed and kept.
  checkPayment(input) {
    const now = this.now();
    const currency = String(input.currency ?? "").toUpperCase();
    const i = this.intentFor(input.intent_id, input.nonce);
    const consent = i ? this.consent(i, { at: now, amount: input.amount_minor, currency, nonce: input.nonce ?? null }) : null;
    const m = this.mandateChecks(Math.abs(input.amount_minor), currency, now);
    const checks = [
      { check: "open_intent", ok: Boolean(i), detail: i ? `Intent ${i.payload.intent_id}` : "No intent named or matched by the nonce" },
      ...(consent?.checks ?? []).filter((c) => c.severity === "hard"),
      ...m.checks,
    ];
    const row = this.sealRow({ schema: "luca.payment-check/0.1", id: `pck_${hex(8)}`, checked_at: iso(now), agent: this.cfg.agentId,
      request: { ...input },
     
      decision: checks.every((c) => c.ok) ? "approve" : "decline", checks, producer: this.cfg.producer });
    this.append("checks.jsonl", row);
    return { id: row.payload.id, decision: row.payload.decision, checks, reasons: checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`), seal: row.seal };
  }


  consent(i, p) {
    const ip = i.payload;
    const checks = [];
    const hard = (check, ok, detail) => checks.push({ check, ok, detail, severity: "hard" });
    hard("declared_before_payment", p.at.getTime() + CLOCK_SKEW_MS >= Date.parse(ip.declared_at), `Intent declared ${ip.declared_at}; paid ${iso(p.at)}`);
    hard("before_intent_expiry", p.at.getTime() <= Date.parse(ip.expires_at), `Intent expires ${ip.expires_at}; paid ${iso(p.at)}`);
    const c = this.cancellations.get(ip.intent_id);
    if (c) hard("not_withdrawn", p.at.getTime() < Date.parse(c.payload.cancelled_at), `Intent withdrawn ${c.payload.cancelled_at}; paid ${iso(p.at)}`);
    if (ip.max_amount_minor !== null) {
      const authorized = Math.abs(p.amount);
      const comparable = !ip.currency || ip.currency === p.currency;
      hard("within_intent_cap", comparable && authorized <= ip.max_amount_minor, comparable
        ? `Cap ${ip.max_amount_minor}; paid ${authorized} (${p.currency} minor units)`
        : `Paid in ${p.currency}, which cannot be compared with the ${ip.currency} cap here`);
    }
    const expected = L.intentNonce(i.seal.payload_sha256);
    const binding = p.nonce
      ? { scheme: L.INTENT_NONCE_SCHEME, status: p.nonce.toLowerCase() === expected ? "bound" : "unbound", nonce: p.nonce.toLowerCase(), expected, seq: 0 }
      : { scheme: L.INTENT_NONCE_SCHEME, status: "not_applicable", nonce: null, expected, seq: 0 };
    return { intent_id: ip.intent_id, within_consent: checks.every((x) => x.ok), checks, binding };
  }

  current() {
    const replaced = new Set(this.records.map((r) => r.payload.supersedes).filter(Boolean));
    return this.records.filter((r) => !replaced.has(r.payload.record_id));
  }

  // ---- after paying ----
  seal(input) { return this.recordSettlement(input); }
  // A payment the agent made (or received), sealed as reported_by "agent". Reporting the same payment again
  // with different facts makes a new version that names the one it replaces; the same facts return the record.
  recordSettlement(input) {
    if (!input?.rail || !input.source_id) throw new Error("rail and source_id are required");
    if (!Number.isSafeInteger(input.amount_minor)) throw new Error("amount_minor must be an integer in minor units");
    const at = new Date(input.occurred_at ?? this.now());
    if (!input.currency || Number.isNaN(at.getTime())) throw new Error("currency and occurred_at (ISO 8601) are required");
    const currency = input.currency.toUpperCase();
    const sourceId = /^0x[0-9a-f]+$/i.test(input.source_id) ? input.source_id.toLowerCase() : input.source_id;
    const nonce = (input.nonce ?? input.x402?.authorization?.nonce ?? null)?.toLowerCase() ?? null;
    const i = this.intentFor(input.intent_id, nonce);
    if (input.intent_id && !i) throw new Error(`No intent ${input.intent_id} in this book`);
    const direction = input.direction ?? "outflow";
    const consent = i && direction === "outflow" ? this.consent(i, { at, amount: input.amount_minor, currency, nonce }) : null;

    const key = `${this.cfg.entity}:${input.rail}:${sourceId}`;
    const earlier = this.current().find((r) => `${r.payload.entity}:${r.payload.rail}:${r.payload.source.id}` === key) ?? null;
    const facts = {
      direction, state: input.amount_minor < 0 ? "refunded" : input.state === "pending" ? "pending" : "cleared",
      amount_minor: input.amount_minor, currency, occurred_at: iso(at), counterparty: input.counterparty ?? null,
      memo: input.memo ?? null, intent: i ? { intent_id: i.payload.intent_id, payload_sha256: i.seal.payload_sha256 } : null,
    };
    if (earlier) {
      const same = Object.entries(facts).every(([k, v]) => L.canonicalize(v ?? null) === L.canonicalize(earlier.payload[k] ?? null));
      if (same) return { status: "unchanged", record_id: earlier.payload.record_id, seal: earlier.seal };
    }
    const version = earlier ? earlier.payload.version + 1 : 1;
    const payload = {
      schema: RECORD_SCHEMA,
      record_id: `LR-${input.rail.toUpperCase()}-${L.sha256Hex(key).slice(0, 10).toUpperCase()}-v${version}`,
      version, supersedes: earlier?.payload.record_id ?? null,
      changed: earlier ? Object.keys(facts).filter((k) => L.canonicalize(facts[k] ?? null) !== L.canonicalize(earlier.payload[k] ?? null)) : [],
      entity: this.cfg.entity, entity_id: this.cfg.entity, rail: input.rail, reported_by: "agent",
      source: { id: sourceId, payload_sha256: L.hashSourcePayload(input) },
      ...facts,
      time_zone: this.cfg.timeZone, settled_on: this.localDate(at),
      agent: { id: this.cfg.agentId, owner: this.cfg.owner },
      rail_authorization: nonce ? [{ scheme: `${input.rail}_payment`, reference: nonce }] : [],
      consent, evidence: input.evidence ?? null, producer: this.cfg.producer,
    };
    const problems = L.checkRecord(payload).problems;
    if (problems.length) throw new Error(`The record would not meet SPR: ${problems.join("; ")}`);
    const row = this.sealRow(payload);
    this.append("records.jsonl", row);
    this.records.push(row);
    return { status: earlier ? "new_version" : "recorded", record_id: payload.record_id, within_consent: consent?.within_consent ?? null,
      binding: consent?.binding.status ?? null, checks: consent?.checks ?? [],
      seal: row.seal };
  }

  // ---- the label (SPR section 7) ----
  // The company's side: the shared fields of a record, signed with the company's key. The counterparty signs
  // the same signing input with its own key to agree; counterpartySignature checks that.
  label(recordId, opts) {
    const r = this.current().find((x) => x.payload.record_id === recordId || x.payload.record_id.replace(/-v\d+$/, "") === recordId.replace(/-v\d+$/, ""));
    if (!r) throw new Error(`No record ${recordId} in this book`);
    if (!opts?.counterparty) throw new Error("Name the counterparty the label is for");
    const p = r.payload;
    const labelId = `lbl_${L.sha256Hex(`${p.entity}|${p.rail}|${p.source.id}|${opts.counterparty}`).slice(0, 20)}`;
    const inflow = p.direction === "inflow";
    const shared = {
      schema: L.LABEL_SCHEMA, label_id: labelId,
      payment: { rail: p.rail, id: p.source.id, network: opts.network ?? p.evidence?.network ?? null },
      amount_minor: p.amount_minor, currency: p.currency, accounting_date: p.settled_on,
      payer: inflow ? opts.counterparty : p.entity, payee: inflow ? p.entity : opts.counterparty,
      product: opts.product ?? null, tax: { jurisdiction: opts.tax?.jurisdiction ?? null, treatment: opts.tax?.treatment ?? null },
      ...(opts.service_period ? { service_period: opts.service_period } : {}),
    };
    const sharedSha = L.labelSharedSha256(shared);
    const ours = { party: "company", key_id: this.keyId, alg: "EdDSA", signature: L.signLabel(this.key, labelId, sharedSha) };
    const row = { label_id: labelId, record_id: p.record_id, shared, shared_sha256: sharedSha, sign_this: L.labelSigningInput(labelId, sharedSha), signatures: [ours] };
    this.append("labels.jsonl", row);
    this.labels.push(row);
    return row;
  }
  // Records the counterparty's signature once it checks against its public key; the label is then agreed.
  counterpartySignature(labelId, jwk, signature) {
    const l = [...this.labels].reverse().find((x) => x.label_id === labelId);
    if (!l) throw new Error(`No label ${labelId} in this book`);
    const pub = L.checkPublicJwk(jwk);
    if (!L.verifyLabelSignature(pub, labelId, l.shared_sha256, signature)) throw new Error("The signature does not verify with that key over sign_this");
    const row = { ...l, signatures: [...l.signatures, { party: "counterparty", key_thumbprint: L.jwkThumbprint(pub), jwk: pub, alg: pub.kty === "OKP" ? "EdDSA" : "ES256", signature }], state: "agreed" };
    this.append("labels.jsonl", row);
    this.labels.push(row);
    return row;
  }

  verifyRecord(recordId) {
    const r = this.records.find((x) => x.payload.record_id === recordId);
    if (!r) throw new Error(`No record ${recordId} in this book`);
    const v = L.verifySeal(r.payload, r.seal, this.key);
    const core = L.checkRecord(r.payload);
    return { record_id: recordId, ...v, ok: v.ok && core.ok, core_fields: core, key_id: this.keyId,
      how_to_check: "SHA-256 of the canonical JSON (RFC 8785) of payload is seal.payload_sha256; the Ed25519 signature over that canonical JSON verifies with the public key in keys.jsonl. Run: spr-verify <folder>" };
  }

  listRecords(opts = {}) {
    return (opts.all ? this.records : this.current()).map((r) => ({ record_id: r.payload.record_id, rail: r.payload.rail, amount_minor: r.payload.amount_minor,
      currency: r.payload.currency, settled_on: r.payload.settled_on, counterparty: r.payload.counterparty, intent_id: r.payload.intent?.intent_id ?? null,
      within_consent: r.payload.consent?.within_consent ?? null, payload_sha256: r.seal.payload_sha256 }));
  }

  // A copy of the book for an auditor, a counterparty or Luca: the files and a sealed manifest of their hashes.
  exportPackage(outDir) {
    mkdirSync(outDir, { recursive: true });
    const names = ["keys.jsonl", "intents.jsonl", "cancellations.jsonl", "checks.jsonl", "records.jsonl", "labels.jsonl"].filter((n) => existsSync(join(this.dir, n)));
    for (const n of names) copyFileSync(join(this.dir, n), join(outDir, n));
    const pkg = { schema: "luca.local-package/0.1", entity: this.cfg.entity, generated_at: iso(this.now()), producer: this.cfg.producer, format: L.SPEC_VERSION,
      files: names.map((name) => ({ name, sha256: L.sha256Hex(readFileSync(join(outDir, name))) })) };
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ package: pkg, seal: L.sealWith(pkg, this.key) }, null, 2) + "\n");
    const check = L.verifyPackage((n) => existsSync(join(outDir, n)) ? readFileSync(join(outDir, n)) : null);
    return { folder: outDir, files: [...names, "manifest.json"], verified: check.ok, passed: check.passed, failed: check.failed };
  }
}
