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
// No call to Luca, unless you send the book there yourself (sendToLuca). Everything follows SPR (../../lib/spr/SPEC.md), so anyone can check the folder or an
// export of it with spr-verify and no Luca code. The folder:
//   key.pem              the company's Ed25519 key (created on first use, readable by its owner only), unless
//                        a key is passed in, for example from the operating system's keychain
//   keys.jsonl           its public key, and any earlier ones
//   intents.jsonl, cancellations.jsonl, checks.jsonl, records.jsonl, labels.jsonl   each sealed: { payload, seal }
//   mandate.json         optional: the limits the agent acts under (currency, per payment, validity)
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync, openSync, readSync, closeSync, rmSync, renameSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync, randomBytes } from "node:crypto";
import * as L from "@luca-network/spr";
import { buildAccountingExport, writeAccountingExport } from "./export.mjs";

export const SDK_PRODUCER = { name: "spr-sdk", version: "0.1.3" };
const RECORD_SCHEMA = "luca.record/0.7";   // SPR section 6; the hosted service seals the same schema
const INTENT_SCHEMA = "luca.intent/0.1";
const CLOCK_SKEW_MS = 2 * 60_000;

const iso = (d) => d.toISOString().replace(/\.000Z$/, "Z");
// A time the agent gives must carry its offset. Without one, JavaScript reads it in this computer's time zone,
// so the same input would seal a different instant on a machine set to another zone.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function instant(value, what) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !INSTANT.test(value))
    throw new Error(`${what} must be an ISO 8601 time with its offset, such as 2026-10-28T12:00:00Z or 2026-10-28T12:00:00-07:00. ` +
      `${JSON.stringify(value)} has none, so it could be any time zone`);
  return new Date(value);
}
// What a local book's limits are: mandate.json is written by whoever keeps the book, so a check against it shows
// the agent stayed inside limits the company's own folder declares. It is not authority granted by someone else.
export const SELF_DECLARED = "self-declared";
const hex = (n) => randomBytes(n).toString("hex");
function durationMs(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(s ?? "");
  if (!m || (!m[1] && !m[2] && !m[3])) throw new Error(`expires_in must be an ISO 8601 duration such as PT1H or P3D, got ${s}`);
  return ((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60_000;
}

const FILES = ["keys.jsonl", "intents.jsonl", "cancellations.jsonl", "checks.jsonl", "records.jsonl", "labels.jsonl"];
// One writer at a time: a book's folder may be opened by several processes (an MCP server and a script, an agent
// run twice). Each write takes book.lock, reads what the others appended since, writes, and lets go.
const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const BUSY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const SLEEP = new Int32Array(new SharedArrayBuffer(4));
const paymentKey = (p) => `${p.entity}:${p.rail}:${p.source.id}`;
// What one import to Luca takes at most; a bigger book is sent in parts.
export const PART_MAX_RECORDS = 4000;
export const PART_MAX_BYTES = 8 * 1024 * 1024;

// The published test keys of the vectors (RFC 8032 test keys 1 and 2). Anyone has their private parts.
const TEST_KEY_IDS = new Set(["ed25519:a00579fb9f411e66", "ed25519:df45109f9d243cdb"]);
// Folders that sync to the cloud: a book there uploads its private key, and its lock does not hold across machines.
const SYNCED = /^(onedrive( - .+)?|dropbox|google drive|my drive|icloud drive|iclouddrive|mobile documents|cloudstorage|box|box sync|pclouddrive|mega)$/i;
export function syncedFolderOf(dir) {
  let p; try { p = realpathSync(dir); } catch { p = resolve(dir); }
  for (const v of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
    const root = process.env[v];
    if (root && (p === root || p.toLowerCase().startsWith(resolve(root).toLowerCase() + sep))) return root;
  }
  return p.split(/[\\/]/).find((seg) => SYNCED.test(seg)) ?? null;
}
// The private key file is the owner's alone: 0600 where the system honours it, and on Windows an access list that
// names only the current user. An existing key file others can read is reported.
function protectKeyFile(file) {
  if (process.platform !== "win32") return;
  try { execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:F`], { stdio: "ignore", windowsHide: true }); }
  catch { console.warn(`SPR: could not limit ${file} to your user alone; check who can read it`); }
}
function warnIfOpen(file) {
  if (process.platform === "win32") return;
  try { if (statSync(file).mode & 0o077) console.warn(`SPR: ${file} can be read by other users of this computer. Run: chmod 600 "${file}"`); } catch {}
}

export class SprBook {
  constructor(cfg) {
    if (!cfg?.agentId?.trim() || !cfg?.entity?.trim()) throw new Error("The book needs the agent's ID (agentId) and the company it pays for (entity)");
    if (!cfg.dir) throw new Error("The book needs a folder (dir) to keep its records in");
    this.cfg = { timeZone: "UTC", binding: false, now: () => new Date(), owner: null, producer: SDK_PRODUCER, ...cfg };
    this.dir = cfg.dir;
    mkdirSync(this.dir, { recursive: true });
    const synced = syncedFolderOf(this.dir);
    if (synced && !cfg.allowSyncedFolder && process.env.SPR_ALLOW_SYNCED_FOLDER !== "1")
      throw new Error(`The book's folder ${this.dir} is inside ${synced}, which syncs to the cloud: the private key would be uploaded, and two machines syncing one book would not see each other's lock. Choose a folder outside it, or pass allowSyncedFolder: true (SPR_ALLOW_SYNCED_FOLDER=1) if you accept that.`);
    this.keyFile = cfg.key ? null : join(this.dir, "key.pem");
    this.lockDepth = 0;
    this.reset();
    this.locked(() => {
      if (cfg.key) this.key = typeof cfg.key === "string" ? createPrivateKey(cfg.key) : cfg.key;
      else if (existsSync(this.keyFile)) { warnIfOpen(this.keyFile); this.key = createPrivateKey(readFileSync(this.keyFile, "utf8")); }
      else {
        this.key = generateKeyPairSync("ed25519").privateKey;
        writeFileSync(this.keyFile, this.key.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
        protectKeyFile(this.keyFile);
      }
      if (this.key.asymmetricKeyType !== "ed25519") throw new Error("The book's key must be Ed25519");
      this.keyId = L.keyIdFor(this.key);
      if (TEST_KEY_IDS.has(this.keyId)) throw new Error(`Key ${this.keyId} is a published test key from the SPR vectors; anyone can sign with it. Use a key of your own`);
      this.checkNotRetired();
      if (!this.keyring.has(this.keyId))
        this.append("keys.jsonl", { key_id: this.keyId, algorithm: "ed25519", public_pem: L.publicKeyPemOf(this.key), created_at: iso(this.now()), owner: this.cfg.entity });
    });
  }

  now() { return this.cfg.now(); }

  // ---- the folder ----
  // What is in memory, rebuilt from the files. Each file is read from where the last read stopped, so a write by
  // another process is picked up and a large book is not read again on every call.
  reset() {
    this.offsets = {};
    this.keyring = new Map();       // key_id -> keys.jsonl row
    this.intents = new Map();       // intent_id -> sealed intent
    this.byNonce = new Map();       // intent nonce (seq 0) -> sealed intent
    this.cancellations = new Map(); // intent_id -> sealed withdrawal
    this.records = [];              // every version, in the order sealed
    this.byPayment = new Map();     // entity:rail:source -> current version
    this.labels = [];
  }
  refresh() {
    for (const n of FILES) {
      const f = join(this.dir, n);
      if (!existsSync(f)) { if (this.offsets[n]) { this.reset(); return this.refresh(); } continue; }
      const size = statSync(f).size, from = this.offsets[n] ?? 0;
      if (size < from) { this.reset(); return this.refresh(); }
      if (size === from) continue;
      const buf = Buffer.alloc(size - from), fd = openSync(f, "r");
      try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
      const end = buf.lastIndexOf(10);   // only whole lines; a line being written is read next time
      if (end < 0) continue;
      this.offsets[n] = from + end + 1;
      for (const l of buf.subarray(0, end + 1).toString("utf8").split("\n")) if (l.trim()) this.ingest(n, JSON.parse(l));
    }
  }
  ingest(name, row) {
    if (name === "keys.jsonl") this.keyring.set(row.key_id, row);
    else if (name === "intents.jsonl") { this.intents.set(row.payload.intent_id, row); this.byNonce.set(L.intentNonce(row.seal.payload_sha256), row); }
    else if (name === "cancellations.jsonl") this.cancellations.set(row.payload.intent_id, row);
    else if (name === "records.jsonl") { this.records.push(row); this.byPayment.set(paymentKey(row.payload), row); }
    else if (name === "labels.jsonl") this.labels.push(row);
  }
  locked(fn) {
    if (this.lockDepth > 0) { this.lockDepth++; try { return fn(); } finally { this.lockDepth--; } }
    const lock = join(this.dir, "book.lock"), deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try { writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" }); break; }
      catch (e) {
        // On Windows a lock another process is letting go of can refuse the open with EPERM or EACCES for a moment.
        if (e.code !== "EEXIST" && !(BUSY_CODES.has(e.code) && Date.now() <= deadline)) throw e;
        try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) { rmSync(lock, { force: true }); continue; } } catch { Atomics.wait(SLEEP, 0, 0, 5); continue; }
        if (Date.now() > deadline) throw new Error(`The book at ${this.dir} is busy: another process has held book.lock for over ${LOCK_WAIT_MS / 1000} seconds. If no other process is using the book, delete book.lock.`);
        Atomics.wait(SLEEP, 0, 0, 20);
      }
    }
    this.lockDepth = 1;
    try {
      this.refresh();
      if (this.key) this.checkNotRetired();
      return fn();
    } finally { this.lockDepth = 0; rmSync(lock, { force: true, maxRetries: 50, retryDelay: 20 }); }
  }
  // Another process may have rotated the key: pick up the new key from key.pem, or stop if the key was passed in.
  checkNotRetired() {
    for (;;) {
      const next = [...this.keyring.values()].find((k) => k.rotation?.payload?.from === this.keyId);
      if (!next) return;
      if (!this.keyFile) throw new Error(`The book's key ${this.keyId} was rotated to ${next.key_id}; open the book with the new key`);
      const k = createPrivateKey(readFileSync(this.keyFile, "utf8"));
      if (L.keyIdFor(k) === this.keyId) throw new Error(`The book's key ${this.keyId} was rotated to ${next.key_id}, but key.pem still holds the old key`);
      this.key = k; this.keyId = L.keyIdFor(k);
    }
  }
  append(name, row) { appendFileSync(join(this.dir, name), JSON.stringify(row) + "\n"); this.refresh(); }
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
    if (!m) return { decision: "none", authority: "none", checks: [], mandate_id: null };
    const checks = [];
    if (m.currency) checks.push({ check: "currency", ok: !currency || currency === m.currency, detail: `Mandate in ${m.currency}; intent in ${currency ?? "no currency"}` });
    if (m.max_per_payment_minor !== undefined) checks.push({ check: "per_payment", ok: amount === null || amount <= m.max_per_payment_minor, detail: `Limit ${m.max_per_payment_minor}; up to ${amount ?? "no amount given"}` });
    if (m.valid_from || m.valid_until) checks.push({ check: "in_date", ok: (!m.valid_from || at >= new Date(m.valid_from)) && (!m.valid_until || at <= new Date(m.valid_until)),
      detail: `Valid ${m.valid_from ?? "any time"} to ${m.valid_until ?? "no end"}` });
    return { decision: checks.every((c) => c.ok) ? "within_mandate" : "outside_mandate", authority: SELF_DECLARED, checks, mandate_id: m.mandate_id ?? null };
  }

  // ---- before paying ----
  declare(input) { return this.recordIntent(input); }
  recordIntent(input) { return this.locked(() => this._recordIntent(input)); }
  _recordIntent(input) {
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
      precheck: { decision: pre.decision, authority: pre.authority, checks: pre.checks }, producer: this.cfg.producer,
    };
    const row = this.sealRow(payload);
    this.append("intents.jsonl", row);
    return {
      intent_id: payload.intent_id, decision: pre.decision, authority: pre.authority, checks: pre.checks, declared_at: payload.declared_at, expires_at: payload.expires_at,
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

  cancelIntent(intentId, reason) { return this.locked(() => this._cancelIntent(intentId, reason)); }
  _cancelIntent(intentId, reason) {
    const i = this.intents.get(intentId);
    if (!i) throw new Error(`No intent ${intentId} in this book`);
    if (!reason?.trim()) throw new Error("Say why the intent is withdrawn");
    if (this.cancellations.has(intentId)) return this.cancellations.get(intentId).payload;
    const row = this.sealRow({ schema: "luca.intent-cancellation/0.1", intent_id: intentId, intent_payload_sha256: i.seal.payload_sha256,
      by: this.cfg.agentId, reason: reason.trim(), cancelled_at: iso(this.now()), producer: this.cfg.producer });
    this.append("cancellations.jsonl", row);
    return row.payload;
  }

  getIntent(intentId) {
    this.refresh();
    const i = this.intents.get(intentId);
    if (!i) throw new Error(`No intent ${intentId} in this book`);
    const paid = this.current().filter((r) => r.payload.intent?.intent_id === intentId).map((r) => r.payload.record_id);
    const status = this.cancellations.has(intentId) ? "withdrawn" : paid.length ? "matched" : new Date(i.payload.expires_at) < this.now() ? "expired" : "open";
    return { ...i.payload, status, records: paid, seal: i.seal };
  }

  intentFor(intentId, nonce) {
    if (intentId) return this.intents.get(intentId) ?? null;
    if (nonce) return this.byNonce.get(nonce.toLowerCase()) ?? null;
    return null;
  }

  // Before paying: is this payment inside an open intent and the mandate? The answer is sealed and kept.
  checkPayment(input) { return this.locked(() => this._checkPayment(input)); }
  _checkPayment(input) {
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
     
      decision: checks.every((c) => c.ok) ? "approve" : "decline", authority: m.authority, checks, producer: this.cfg.producer });
    this.append("checks.jsonl", row);
    return { id: row.payload.id, decision: row.payload.decision, authority: m.authority, checks, reasons: checks.filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`), seal: row.seal };
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
    return [...this.byPayment.values()];
  }

  // ---- after paying ----
  seal(input) { return this.recordSettlement(input); }
  // A payment the agent made (or received), sealed as reported_by "agent". Reporting the same payment again
  // with different facts makes a new version that names the one it replaces; the same facts return the record.
  recordSettlement(input) { return this.locked(() => this._recordSettlement(input)); }
  _recordSettlement(input) {
    if (!input?.rail || !input.source_id) throw new Error("rail and source_id are required");
    if (!Number.isSafeInteger(input.amount_minor)) throw new Error("amount_minor must be an integer in minor units");
    if (!input.currency) throw new Error("currency is required");
    const currency = input.currency.toUpperCase();
    const sourceId = /^0x[0-9a-f]+$/i.test(input.source_id) ? input.source_id.toLowerCase() : input.source_id;
    const key = `${this.cfg.entity}:${input.rail}:${sourceId}`;
    const earlier = this.byPayment.get(key) ?? null;
    // Without occurred_at the record says so and takes the time of sealing; a retry keeps the time first sealed.
    const timeGiven = input.occurred_at !== undefined && input.occurred_at !== null;
    const at = timeGiven ? instant(input.occurred_at, "occurred_at") : earlier ? new Date(earlier.payload.occurred_at) : this.now();
    const timeNote = timeGiven ? null : earlier ? (earlier.payload.occurred_at_source ?? null) : "not given: the time the book sealed it";
    const nonce = (input.nonce ?? input.x402?.authorization?.nonce ?? null)?.toLowerCase() ?? null;
    const i = this.intentFor(input.intent_id, nonce);
    if (input.intent_id && !i) throw new Error(`No intent ${input.intent_id} in this book`);
    const direction = input.direction ?? "outflow";
    const consent = i && direction === "outflow" ? this.consent(i, { at, amount: input.amount_minor, currency, nonce }) : null;

    const facts = {
      direction, state: input.amount_minor < 0 ? "refunded" : input.state === "pending" ? "pending" : "cleared",
      amount_minor: input.amount_minor, currency, occurred_at: iso(at), counterparty: input.counterparty ?? null,
      memo: input.memo ?? null, intent: i ? { intent_id: i.payload.intent_id, payload_sha256: i.seal.payload_sha256 } : null,
    };
    // The same facts again are a retry. Different facts under the same payment are a correction, and need a reason;
    // only a pending payment clearing is taken as it comes.
    let correction = null;
    if (earlier) {
      const changed = Object.keys(facts).filter((k) => L.canonicalize(facts[k] ?? null) !== L.canonicalize(earlier.payload[k] ?? null));
      if (!changed.length) return { status: "unchanged", record_id: earlier.payload.record_id, seal: earlier.seal };
      const clearing = changed.length === 1 && changed[0] === "state" && earlier.payload.state === "pending";
      const reason = typeof input.correction?.reason === "string" ? input.correction.reason.trim() : "";
      if (!clearing && !reason)
        return { status: "conflict", record_id: earlier.payload.record_id, sealed: false,
          differs: changed.map((k) => ({ field: k, sealed: earlier.payload[k] ?? null, given: facts[k] ?? null })),
          how: "Nothing was sealed. If the sealed record is wrong, call again with correction: { reason }. If this is another payment, give it its own source_id." };
      if (reason) correction = { reason };
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
      ...(timeNote ? { occurred_at_source: timeNote } : {}),
      ...(correction ? { correction } : {}),
      time_zone: this.cfg.timeZone, settled_on: this.localDate(at),
      agent: { id: this.cfg.agentId, owner: this.cfg.owner },
      rail_authorization: nonce ? [{ scheme: `${input.rail}_payment`, reference: nonce }] : [],
      consent, evidence: input.evidence ?? null, producer: this.cfg.producer,
    };
    const problems = L.checkRecord(payload).problems;
    if (problems.length) throw new Error(`The record would not meet SPR: ${problems.join("; ")}`);
    const row = this.sealRow(payload);
    this.append("records.jsonl", row);
    return { status: earlier ? "new_version" : "recorded", record_id: payload.record_id, within_consent: consent?.within_consent ?? null,
      binding: consent?.binding.status ?? null, checks: consent?.checks ?? [],
      seal: row.seal };
  }

  // ---- the label (SPR section 7) ----
  // The company's side: the shared fields of a record, signed with the company's key. The counterparty signs
  // the same signing input with its own key to agree; counterpartySignature checks that.
  label(recordId, opts) { return this.locked(() => this._label(recordId, opts)); }
  _label(recordId, opts) {
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
    return row;
  }
  // Records the counterparty's signature once it checks against its public key; the label is then agreed.
  counterpartySignature(labelId, jwk, signature) { return this.locked(() => this._counterpartySignature(labelId, jwk, signature)); }
  _counterpartySignature(labelId, jwk, signature) {
    const l = [...this.labels].reverse().find((x) => x.label_id === labelId);
    if (!l) throw new Error(`No label ${labelId} in this book`);
    const pub = L.checkPublicJwk(jwk);
    if (!L.verifyLabelSignature(pub, labelId, l.shared_sha256, signature)) throw new Error("The signature does not verify with that key over sign_this");
    const row = { ...l, signatures: [...l.signatures, { party: "counterparty", key_thumbprint: L.jwkThumbprint(pub), jwk: pub, alg: pub.kty === "OKP" ? "EdDSA" : "ES256", signature }], state: "agreed" };
    this.append("labels.jsonl", row);
    return row;
  }

  verifyRecord(recordId) {
    this.refresh();
    const r = this.records.find((x) => x.payload.record_id === recordId);
    if (!r) throw new Error(`No record ${recordId} in this book`);
    // Checked with the key that sealed it, which may be an earlier key of the book.
    const keyId = L.normalizeSeal(r.seal).key_id, k = this.keyring.get(keyId);
    const v = k ? L.verifySeal(r.payload, r.seal, k.public_pem) : { ok: false, hash_matches: false, signature_valid: false };
    const core = L.checkRecord(r.payload);
    return { record_id: recordId, ...v, ok: v.ok && core.ok, core_fields: core, key_id: keyId,
      how_to_check: "SHA-256 of the canonical JSON (RFC 8785) of payload is seal.payload_sha256; the Ed25519 signature over that canonical JSON verifies with the public key in keys.jsonl. Run: spr-verify <folder>" };
  }

  listRecords(opts = {}) {
    this.refresh();
    return (opts.all ? this.records : this.current()).map((r) => ({ record_id: r.payload.record_id, rail: r.payload.rail, amount_minor: r.payload.amount_minor,
      currency: r.payload.currency, settled_on: r.payload.settled_on, counterparty: r.payload.counterparty, intent_id: r.payload.intent?.intent_id ?? null,
      within_consent: r.payload.consent?.within_consent ?? null, payload_sha256: r.seal.payload_sha256 }));
  }

  // The book's public key: what finance registers with Luca once, so the book can be sent (sendToLuca).
  publicKey() { return { key_id: this.keyId, public_pem: L.publicKeyPemOf(this.key), entity: this.cfg.entity, agent_id: this.cfg.agentId }; }

  // The book as a package (SPR section 8): each file by name, as text, with a sealed manifest of their hashes.
  packageFiles() {
    return this.locked(() => {
      const names = FILES.filter((n) => existsSync(join(this.dir, n)));
      return this.sealPackage(Object.fromEntries(names.map((n) => [n, readFileSync(join(this.dir, n), "utf8")])));
    });
  }
  sealPackage(files, part = null) {
    const names = Object.keys(files);
    const pkg = { schema: "luca.local-package/0.1", entity: this.cfg.entity, generated_at: iso(this.now()), producer: this.cfg.producer, format: L.SPEC_VERSION,
      ...(part ? { part } : {}), files: names.map((name) => ({ name, sha256: L.sha256Hex(Buffer.from(files[name], "utf8")) })) };
    return { ...files, "manifest.json": JSON.stringify({ package: pkg, seal: L.sealWith(pkg, this.key) }, null, 2) + "\n" };
  }
  // The book in parts that each stand on their own: every version of a payment stays in one part, with the intents
  // and withdrawals its records name, and the book's keys. A book under the limits is one part, the whole book.
  packageParts(opts = {}) {
    const maxRecords = opts.maxRecords ?? PART_MAX_RECORDS, maxBytes = opts.maxBytes ?? PART_MAX_BYTES;
    return this.locked(() => {
      const whole = FILES.filter((n) => existsSync(join(this.dir, n))).reduce((t, n) => t + statSync(join(this.dir, n)).size, 0);
      if (this.records.length <= maxRecords && whole <= maxBytes) return [this.packageFiles()];
      const line = (row) => JSON.stringify(row) + "\n";
      const chains = new Map();
      for (const r of this.records) { const k = paymentKey(r.payload); if (!chains.has(k)) chains.set(k, []); chains.get(k).push(r); }
      const keysText = [...this.keyring.values()].map(line).join("");
      const groups = [];
      let cur = { records: [], bytes: 0 };
      for (const chain of chains.values()) {
        const bytes = chain.reduce((t, r) => t + Buffer.byteLength(line(r)), 0);
        if (cur.records.length && (cur.records.length + chain.length > maxRecords || cur.bytes + bytes > maxBytes)) { groups.push(cur); cur = { records: [], bytes: 0 }; }
        cur.records.push(...chain); cur.bytes += bytes;
      }
      if (cur.records.length) groups.push(cur);
      return groups.map((g, i) => {
        const ids = new Set(g.records.map((r) => r.payload.intent?.intent_id).filter(Boolean));
        const files = { "keys.jsonl": keysText };
        const intents = [...ids].map((id) => this.intents.get(id)).filter(Boolean);
        if (intents.length) files["intents.jsonl"] = intents.map(line).join("");
        const cancels = [...ids].map((id) => this.cancellations.get(id)).filter(Boolean);
        if (cancels.length) files["cancellations.jsonl"] = cancels.map(line).join("");
        files["records.jsonl"] = g.records.map(line).join("");
        return this.sealPackage(files, { index: i + 1, of: groups.length });
      });
    });
  }

  // A copy of the book for an auditor, a counterparty or Luca: the files and a sealed manifest of their hashes.
  // An export never goes into the book's own folder, and never replaces an earlier export unless asked (overwrite).
  exportPackage(outDir, opts = {}) {
    const out = resolve(outDir);
    if (out === resolve(this.dir)) throw new Error("Export to a folder of its own, outside the book's folder, which holds the private key");
    if (existsSync(out) && !opts.overwrite && L.PACKAGE_FILES.some((n) => existsSync(join(out, n))))
      throw new Error(`${outDir} already holds an export; choose another folder, or pass overwrite: true to replace it`);
    mkdirSync(outDir, { recursive: true });
    const files = this.packageFiles();
    for (const [n, text] of Object.entries(files)) writeFileSync(join(outDir, n), text);
    const check = L.verifyPackage((n) => existsSync(join(outDir, n)) ? readFileSync(join(outDir, n)) : null);
    return { folder: outDir, files: Object.keys(files), verified: check.ok, passed: check.passed, failed: check.failed };
  }

  // Accounting export: the signed SPR package plus accounting CSV files in a single output folder.
  // The SPR package is written unchanged by exportPackage(); accounting files are added alongside.
  // opts: { overwrite, companyProfile, companyMapping, classificationContext }
  exportAccountingPackage(outDir, opts = {}) {
    const out = resolve(outDir);
    if (out === resolve(this.dir)) throw new Error("Export to a folder of its own, outside the book's folder, which holds the private key");
    // Write the signed SPR package first (unchanged)
    const sprResult = this.exportPackage(outDir, { overwrite: opts.overwrite });
    // Read the manifest sha256 from what was just written
    const manifestPath = join(outDir, "manifest.json");
    let sprManifestSha256 = null;
    try {
      const raw = readFileSync(manifestPath, "utf8");
      sprManifestSha256 = L.sha256Hex(Buffer.from(raw, "utf8"));
    } catch (e) {
      // manifest unreadable after write; accounting manifest cross-reference will be null
      console.warn(`SPR accounting export: could not read manifest.json for cross-reference hash: ${e.message}`);
    }
    // Get current records (current version only for accounting; all versions are in the SPR package)
    const currentRecords = this.current();
    // Build accounting export
    const { files, stats } = buildAccountingExport(
      currentRecords,
      this.keyring,
      {
        export_id: `ae_${iso(this.now()).replace(/[^0-9]/g, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`,
        generated_at: iso(this.now()),
        entity: this.cfg.entity,
        spr_manifest_sha256: sprManifestSha256,
        companyProfile: opts.companyProfile ?? { industry: "general" },
        companyMapping: opts.companyMapping ?? {},
        classificationContext: opts.classificationContext ?? {},
        verifySeal: (payload, seal, keyring) => {
          const s = L.normalizeSeal(seal ?? {});
          const k = keyring instanceof Map ? keyring.get(s.key_id) : keyring?.[s.key_id];
          if (!k) return { ok: false, hash_matches: false, signature_valid: false, core_fields_ok: false };
          const v = L.verifySeal(payload, seal, k.public_pem, k.algorithm ?? s.algorithm);
          const core = L.checkRecord(payload);
          return { ...v, ok: v.ok && core.ok, core_fields_ok: core.ok, problems: core.problems };
        },
      }
    );
    // Write accounting files alongside the SPR package
    writeAccountingExport(outDir, files, { overwrite: true });
    return { ...sprResult, ...stats, accounting_files: Object.keys(files) };
  }

  // ---- the key ----
  // A new key for the book, handed over by the old one: keys.jsonl gains the new public key with a handover sealed by
  // the old key, so anyone can check that the same company holds both. Records sealed before stay checkable with the
  // old public key. The book's own key.pem is replaced; a key passed in (opts.key) is the caller's to keep.
  rotateKey(opts = {}) {
    return this.locked(() => {
      const next = opts.key ? (typeof opts.key === "string" ? createPrivateKey(opts.key) : opts.key) : generateKeyPairSync("ed25519").privateKey;
      if (next.asymmetricKeyType !== "ed25519") throw new Error("The book's key must be Ed25519");
      if (!this.keyFile && !opts.key) throw new Error("This book's key was passed in; pass the new one as rotateKey({ key })");
      const handover = { schema: "luca.key-rotation/0.1", from: this.keyId, to: L.keyIdFor(next), to_public_pem: L.publicKeyPemOf(next),
        at: iso(this.now()), entity: this.cfg.entity, ...(opts.reason ? { reason: String(opts.reason) } : {}) };
      if (handover.to === handover.from) throw new Error("The new key is the key the book already has");
      if (TEST_KEY_IDS.has(handover.to)) throw new Error(`Key ${handover.to} is a published test key from the SPR vectors; use a key of your own`);
      if (this.keyFile) {
        writeFileSync(this.keyFile + ".new", next.export({ type: "pkcs8", format: "pem" }).toString(), { mode: 0o600 });
        protectKeyFile(this.keyFile + ".new");
        renameSync(this.keyFile + ".new", this.keyFile);
      }
      this.append("keys.jsonl", { key_id: handover.to, algorithm: "ed25519", public_pem: handover.to_public_pem, created_at: handover.at,
        owner: this.cfg.entity, rotation: { payload: handover, seal: L.sealWith(handover, this.key) } });
      this.key = next; this.keyId = handover.to;
      return { from: handover.from, to: handover.to, at: handover.at, key_file: this.keyFile,
        next: "If Luca keeps this book, send it again: the handover registers the new key" };
    });
  }

  // ---- Luca, the hosted service (optional) ----
  // Sends the book to Luca's hosted service, which checks every seal before it stores anything. The book's key is
  // registered with Luca first (registerWithLuca). Sending the same book again changes nothing. A book over one
  // import's limits goes in parts, one after the other.
  async sendToLuca(opts = {}) {
    const parts = this.packageParts(opts);
    if (parts.length === 1) return lucaCall(opts, "/v1/spr/import", { files: parts[0] });
    const results = [];
    for (const files of parts) results.push(await lucaCall(opts, "/v1/spr/import", { files }));
    const sum = (k) => results.reduce((t, r) => t + (r[k] ?? 0), 0);
    return { parts: results.length, created: sum("created"), versioned: sum("versioned"), unchanged: sum("unchanged"),
      read_from_rail: sum("read_from_rail"), differs_from_rail: sum("differs_from_rail"), held_for_key_approval: sum("held_for_key_approval"), results };
  }
  // Asks Luca to accept this book's key for one of the company's entities, with a finance user's key.
  // agentOnly limits the key to this book's agent.
  async registerWithLuca(opts = {}) {
    const k = this.publicKey();
    return lucaCall(opts, "/v1/spr/keys", { public_pem: k.public_pem, entity_id: opts.entityId, book_entity: this.cfg.entity,
      ...(opts.agentOnly ? { agent_id: this.cfg.agentId } : {}) });
  }
}

// The book and the API key go to Luca only over HTTPS. Plain HTTP is allowed to this computer alone, and only when
// asked for (allowInsecureLocal, or LUCA_ALLOW_INSECURE_LOCAL=1), for local development. Redirects are refused, so
// the key is never sent on to another address.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function lucaUrl(url, path, opts = {}) {
  let u;
  try { u = new URL(path, url); } catch { throw new Error(`Luca's address is not a URL: ${url}`); }
  if (u.protocol === "https:") return u;
  const local = u.protocol === "http:" && LOOPBACK.has(u.hostname);
  if (local && (opts.allowInsecureLocal || process.env.LUCA_ALLOW_INSECURE_LOCAL === "1")) return u;
  throw new Error(local
    ? `Refusing to send the book and the API key over plain HTTP to ${u.host}. For local development only, set LUCA_ALLOW_INSECURE_LOCAL=1 or pass allowInsecureLocal: true`
    : `Luca's address must start with https:// (got ${u.protocol}//${u.host}): the book and the API key are never sent unencrypted`);
}
async function lucaCall(opts, path, body) {
  const url = opts.url ?? process.env.LUCA_URL;
  const apiKey = opts.apiKey ?? process.env.LUCA_API_KEY;
  if (!url || !apiKey) throw new Error("Give Luca's address and an API key: { url, apiKey }, or LUCA_URL and LUCA_API_KEY");
  const target = lucaUrl(url, path, opts);
  const res = await (opts.fetch ?? globalThis.fetch)(target.toString(), { redirect: "manual",
    method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400))
    throw Object.assign(new Error("Luca's address answered with a redirect; refused, so the book and the API key are not sent on"), { status: res.status });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out?.error ?? `Luca answered ${res.status}`), { status: res.status, detail: out });
  return out;
}
