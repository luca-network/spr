// SPR, the Sealed Payment Record (SPEC.md), as a library with no dependencies. Apache-2.0 (LICENSE).
//
// Everything a party needs to make or check a Luca record without Luca: canonical JSON, hashes, seals,
// key IDs, Merkle roots and paths, the intent nonce, two-sided labels, the record and intent core
// fields, and a check of a whole local package. Node's own crypto only; Node 20 or later.
//
// Luca's own service seals with this library, so do the SPR SDKs, and the test vectors in
// vectors/vectors.json are produced and checked with it. Another implementation conforms when it gives
// the same answers on those vectors.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const SPEC_VERSION = "spr/draft-1";

// ---- 1. canonical JSON ---------------------------------------------------------------------------------
// RFC 8785 (JCS) for the value types Luca signs: strings, integers, booleans, null, arrays and objects.
// Object members are sorted by UTF-16 code unit; members whose value is undefined are left out. Numbers
// must be safe integers: money is always integer minor units, so a float is an error, never rounded.
export function canonicalize(value) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) throw new Error(`canonicalize: only safe integers can be signed, got ${value}`);
      return String(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

// ---- 2. hashes -------------------------------------------------------------------------------------------
// SHA-256, lower-case hex. Text is hashed as UTF-8.
export function sha256Hex(data) {
  return createHash("sha256").update(typeof data === "string" ? Buffer.from(data, "utf8") : data).digest("hex");
}
export const payloadSha256 = (payload) => sha256Hex(canonicalize(payload));

// A rail's own payload may hold floats, so it is hashed from sorted-key JSON that keeps numbers as JSON
// writes them. The hash ties a record to what the rail sent; it is not a seal.
export function hashSourcePayload(value) {
  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
  return sha256Hex(JSON.stringify(sortKeys(value)));
}

// ---- 3. keys and seals -----------------------------------------------------------------------------------
const asPublic = (key) => typeof key === "string" ? createPublicKey(key) : key.type === "private" ? createPublicKey(key) : key;
const asPrivate = (key) => typeof key === "string" ? createPrivateKey(key) : key;

// A key's ID: "ed25519:" and the first 16 hex characters of the SHA-256 of the base64 text of its
// SubjectPublicKeyInfo (DER).
export function keyIdFor(key) {
  const der = asPublic(key).export({ type: "spki", format: "der" });
  return "ed25519:" + sha256Hex(der.toString("base64")).slice(0, 16);
}
export const publicKeyPemOf = (key) => asPublic(key).export({ type: "spki", format: "pem" }).toString();

// Two seal algorithms. "ed25519" signs the canonical JSON itself. "ed25519-digest" signs the fixed text
// "luca.seal/1:" followed by the payload's SHA-256, for keys held in a hardware module that signs at most
// a few kilobytes; it binds the same content.
export const SEAL_DIGEST_PREFIX = "luca.seal/1:";
export const digestMessage = (hash) => Buffer.from(`${SEAL_DIGEST_PREFIX}${hash}`, "utf8");
export const SEAL_ALGORITHMS = ["ed25519", "ed25519-digest"];

export function sealWith(payload, privateKey, options = {}) {
  const algorithm = options.algorithm ?? "ed25519";
  if (!SEAL_ALGORITHMS.includes(algorithm)) throw new Error(`unknown seal algorithm ${algorithm}`);
  const priv = asPrivate(privateKey);
  if (priv.asymmetricKeyType !== "ed25519") throw new Error(`a seal key must be Ed25519, got ${priv.asymmetricKeyType}`);
  const canonical = canonicalize(payload);
  const hash = sha256Hex(canonical);
  const message = algorithm === "ed25519-digest" ? digestMessage(hash) : Buffer.from(canonical, "utf8");
  return { payload_sha256: hash, signature: sign(null, message, priv).toString("base64"), key_id: options.keyId ?? keyIdFor(priv), algorithm };
}

// A seal may be written with snake_case names (the format) or camelCase (as some services keep it).
export function normalizeSeal(seal) {
  return {
    payload_sha256: seal.payload_sha256 ?? seal.payloadHash ?? seal.payload_hash,
    signature: seal.signature,
    key_id: seal.key_id ?? seal.keyId,
    algorithm: seal.algorithm ?? "ed25519",
  };
}

// Checks a seal with a public key. key_matches is false when that key is not the one the seal names.
// `algorithm` overrides the seal's own, for a reader that registered the key with its algorithm.
export function verifySeal(payload, seal, publicKey, algorithm) {
  const s = normalizeSeal(seal);
  let canonical;
  try { canonical = canonicalize(payload); } catch { return { ok: false, hash_matches: false, signature_valid: false, key_matches: false }; }
  const hash_matches = sha256Hex(canonical) === s.payload_sha256;
  let pub = null;
  try { pub = publicKey ? asPublic(publicKey) : null; } catch { pub = null; }
  let key_matches = false;
  try { key_matches = Boolean(pub) && (!s.key_id || keyIdFor(pub) === s.key_id); } catch { key_matches = false; }
  const alg = algorithm ?? s.algorithm;
  let signature_valid = false;
  try {
    if (pub) signature_valid = verify(null, alg === "ed25519-digest" ? digestMessage(s.payload_sha256) : Buffer.from(canonical, "utf8"), pub, Buffer.from(s.signature, "base64"));
  } catch { signature_valid = false; }
  return { ok: hash_matches && signature_valid && key_matches, hash_matches, signature_valid, key_matches };
}

// ---- 4. Merkle trees -------------------------------------------------------------------------------------
// Leaves are SHA-256 hashes in hex. A parent is the SHA-256 of the two children's bytes (left then right).
// An odd node at the end of a level is carried up unchanged. The root of no leaves is the SHA-256 of "".
const pair = (l, r) => sha256Hex(Buffer.from(l + r, "hex"));
export function merkleRoot(leaves) {
  if (!leaves.length) return sha256Hex("");
  let level = leaves.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? pair(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}
// The path from leaf `index` to the root: each step names the sibling and the side it sits on.
export function merklePath(leaves, index) {
  const path = [];
  let level = leaves.slice(), i = index;
  while (level.length > 1) {
    const j = i % 2 === 0 ? i + 1 : i - 1;
    if (j < level.length) path.push({ sibling: level[j], side: i % 2 === 0 ? "right" : "left" });
    const next = [];
    for (let k = 0; k < level.length; k += 2) next.push(k + 1 < level.length ? pair(level[k], level[k + 1]) : level[k]);
    level = next; i = Math.floor(i / 2);
  }
  return path;
}
export const rootFromPath = (leaf, path) => path.reduce((h, p) => p.side === "right" ? pair(h, p.sibling) : pair(p.sibling, h), leaf);

// A journal entry's commitment to its records: the Merkle root over their payload hashes, records in
// order of ID.
export function recordsRoot(records) {
  return merkleRoot([...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => r.payload_sha256));
}

// ---- 5. the intent nonce ---------------------------------------------------------------------------------
// The value a payer signs as the payer-chosen nonce of a rail's transfer authorization (EIP-3009 and the
// like), which binds the payment to the sealed intent: SHA-256 of "luca.intent-nonce/1:", the intent's
// payload hash in hex, ":" and a sequence number (0 for one payment; 1, 2… where an intent covers several).
export const INTENT_NONCE_SCHEME = "luca.intent-nonce/1";
export function intentNonce(intentPayloadSha256, seq = 0) {
  if (!/^[0-9a-f]{64}$/i.test(intentPayloadSha256)) throw new Error("intent payload hash must be 64 hex characters");
  if (!Number.isInteger(seq) || seq < 0) throw new Error("seq must be a whole number");
  return `0x${sha256Hex(`${INTENT_NONCE_SCHEME}:${intentPayloadSha256.toLowerCase()}:${seq}`)}`;
}

// ---- 6. two-sided labels ---------------------------------------------------------------------------------
export const LABEL_SCHEMA = "luca.label/1";
export const labelSharedSha256 = (shared) => payloadSha256(shared);
// What each side signs: the canonical JSON of {schema, label_id, shared_sha256}, as UTF-8.
export const labelSigningInput = (labelId, sharedSha256) => canonicalize({ schema: LABEL_SCHEMA, label_id: labelId, shared_sha256: sharedSha256 });

// RFC 7638 thumbprint of an Ed25519 (OKP) or P-256 (EC) public JWK, base64url.
export function jwkThumbprint(jwk) {
  const members = jwk.kty === "OKP" ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x } : { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return createHash("sha256").update(JSON.stringify(members)).digest("base64url");
}
// A counterparty's public key: Ed25519 or P-256, never a private key. Returns the key reduced to its
// public members.
export function checkPublicJwk(jwk) {
  if (!jwk || typeof jwk !== "object") throw new Error("a public JWK is required");
  if ("d" in jwk || "p" in jwk) throw new Error("the JWK holds a private key; only the public key is accepted");
  const ok = (jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.x) || (jwk.kty === "EC" && jwk.crv === "P-256" && jwk.x && jwk.y);
  if (!ok) throw new Error("the JWK must be an Ed25519 (kty OKP) or P-256 (kty EC) public key");
  createPublicKey({ key: jwk, format: "jwk" });
  return jwk.kty === "OKP" ? { kty: "OKP", crv: "Ed25519", x: jwk.x } : { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}
// Signs a label: Ed25519 (EdDSA), or P-256 (ES256, signature as r||s). base64url.
export function signLabel(privateKey, labelId, sharedSha256) {
  const priv = asPrivate(privateKey);
  const msg = Buffer.from(labelSigningInput(labelId, sharedSha256), "utf8");
  const sig = priv.asymmetricKeyType === "ed25519" ? sign(null, msg, priv) : sign("sha256", msg, { key: priv, dsaEncoding: "ieee-p1363" });
  return sig.toString("base64url");
}
export function verifyLabelSignature(jwk, labelId, sharedSha256, signature) {
  if (typeof signature !== "string" || !signature) return false;
  const msg = Buffer.from(labelSigningInput(labelId, sharedSha256), "utf8");
  const sig = Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return jwk.kty === "OKP" ? verify(null, msg, key, sig) : verify("sha256", msg, { key, dsaEncoding: "ieee-p1363" }, sig);
  } catch { return false; }
}

// ---- 8. core fields of records and intents ---------------------------------------------------------------
// The fields every record carries, whoever made it. A producer may add any other member; a reader keeps
// what it does not understand, since the seal covers it.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isStr = (v) => typeof v === "string" && v.length > 0;
const isInt = (v) => Number.isSafeInteger(v);

export const RECORD_SCHEMA_PATTERN = /^luca\.record\/\d+\.\d+$/;
export function checkRecord(p) {
  const problems = [];
  const need = (ok, what) => { if (!ok) problems.push(what); };
  if (!p || typeof p !== "object") return { ok: false, problems: ["a record payload is an object"] };
  need(typeof p.schema === "string" && RECORD_SCHEMA_PATTERN.test(p.schema), "schema is luca.record/<major>.<minor>");
  need(isStr(p.record_id), "record_id is a non-empty string");
  need(isInt(p.version) && p.version >= 1, "version is an integer from 1");
  need(p.supersedes === null || isStr(p.supersedes), "supersedes is the record_id of the version replaced, or null");
  need((p.version === 1) === (p.supersedes === null), "version 1 supersedes nothing; a later version names the one it replaces");
  need(isStr(p.entity), "entity names the company whose record this is");
  need(isStr(p.rail), "rail names the payment rail");
  need(["inflow", "outflow"].includes(p.direction), "direction is inflow or outflow");
  need(p.source && isStr(p.source.id), "source.id is the rail's own reference for the payment");
  need(isStr(p.state), "state is given");
  need(isInt(p.amount_minor), "amount_minor is an integer in the currency's minor unit");
  need(isStr(p.currency), "currency is given");
  need(p.occurred_at === null || (typeof p.occurred_at === "string" && INSTANT.test(p.occurred_at)), "occurred_at is an ISO 8601 instant with its offset, or null");
  need(p.settled_on === null || p.settled_on === undefined || (typeof p.settled_on === "string" && DATE.test(p.settled_on)), "settled_on is a date (YYYY-MM-DD), or null");
  if (p.intent) need(isStr(p.intent.intent_id), "intent.intent_id names the intent the payment was made under");
  return { ok: problems.length === 0, problems };
}

export const INTENT_SCHEMA_PATTERN = /^luca\.intent\/\d+\.\d+$/;
export function checkIntent(p) {
  const problems = [];
  const need = (ok, what) => { if (!ok) problems.push(what); };
  if (!p || typeof p !== "object") return { ok: false, problems: ["an intent payload is an object"] };
  need(typeof p.schema === "string" && INTENT_SCHEMA_PATTERN.test(p.schema), "schema is luca.intent/<major>.<minor>");
  need(isStr(p.intent_id), "intent_id is a non-empty string");
  need(isStr(p.purpose), "purpose says, in a sentence, why the payment is made");
  need(typeof p.declared_at === "string" && INSTANT.test(p.declared_at), "declared_at is an ISO 8601 instant");
  need(typeof p.expires_at === "string" && INSTANT.test(p.expires_at), "expires_at is an ISO 8601 instant");
  need(p.max_amount_minor === null || p.max_amount_minor === undefined || (isInt(p.max_amount_minor) && p.max_amount_minor > 0), "max_amount_minor is a positive integer, or null");
  need(p.currency === null || p.currency === undefined || isStr(p.currency), "currency is given, or null");
  return { ok: problems.length === 0, problems };
}

export const KEY_ROTATION_SCHEMA = "luca.key-rotation/0.1";
// A key row that carries a handover: { key_id, public_pem, rotation: { payload, seal } }. The handover names the
// earlier key (from) and this one (to, to_public_pem), and is sealed by the earlier key, found in keys (key_id -> row).
export function checkKeyHandover(row, keys) {
  const h = row?.rotation?.payload, seal = row?.rotation?.seal;
  if (!h || !seal) return { ok: false, detail: "no handover" };
  if (h.schema !== KEY_ROTATION_SCHEMA) return { ok: false, detail: `the handover's schema is not ${KEY_ROTATION_SCHEMA}` };
  if (h.to !== row.key_id || h.to_public_pem !== row.public_pem || keyIdFor(row.public_pem) !== row.key_id) return { ok: false, detail: "the handover does not name this key" };
  const s = normalizeSeal(seal);
  if (s.key_id !== h.from || h.from === h.to) return { ok: false, detail: "the handover is not sealed by the earlier key it names" };
  const prev = keys instanceof Map ? keys.get(h.from) : keys?.[h.from];
  if (!prev) return { ok: false, detail: `key ${h.from} is not in the list of keys` };
  const v = verifySeal(h, s, prev.public_pem, prev.algorithm ?? s.algorithm);
  return { ok: v.ok, detail: v.ok ? "" : !v.hash_matches ? "the handover is not the one sealed" : "the earlier key's signature does not verify" };
}

// ---- 9. a local package ----------------------------------------------------------------------------------
// The only files a package holds (section 8). A manifest that names anything else is refused, so a package can
// never send a checker outside its own folder.
export const PACKAGE_FILES = ["manifest.json", "keys.jsonl", "intents.jsonl", "cancellations.jsonl", "checks.jsonl", "records.jsonl", "labels.jsonl"];
const isKeyId = (k) => typeof k === "string" && /^ed25519:[0-9a-f]{16}$/.test(k);

// Problems in a set of records as a whole: one record ID with two different contents, or two records of one
// payment with the same version number. Either means two writers sealed different facts (section 6).
export function checkRecordSet(payloads) {
  const problems = [], byId = new Map(), byVersion = new Map();
  for (const p of payloads) {
    const h = payloadSha256(p);
    const seen = byId.get(p?.record_id);
    if (seen !== undefined && seen !== h) problems.push(`record ${p.record_id} appears twice with different content`);
    byId.set(p?.record_id, h);
    const k = `${p?.entity}|${p?.rail}|${p?.source?.id}|${p?.version}`;
    const other = byVersion.get(k);
    if (other && other.id !== p?.record_id) problems.push(`payment ${p?.source?.id} on ${p?.rail} has two version ${p?.version} records: ${other.id} and ${p?.record_id}`);
    else if (!other) byVersion.set(k, { id: p?.record_id });
  }
  return { ok: problems.length === 0, problems };
}

// A folder (or a map of file name to bytes) holding keys.jsonl, intents.jsonl, records.jsonl and a sealed
// manifest.json, as the SDKs export it. Returns every check made, and ok when all pass.
// A book's own folder holds its private key (key.pem) and no manifest: it is checked as a book, every seal and
// core field, and the answer says to export it before sharing. A package that holds a private key fails.
//
// Whose package it is: without opts.expectedKeys the check shows the package is consistent with the keys it carries,
// and says so (trust: "consistency-only"). With the company's public keys or key IDs, every seal must come from one
// of them, or from a key one of them handed over to (trust: "expected-key"); any other signer fails.
export function verifyPackage(read, opts = {}) {
  const results = [];
  const check = (what, ok, detail = "") => { results.push({ what, ok: Boolean(ok), detail }); return ok; };
  const cache = new Map();
  const get = (name) => {
    if (!cache.has(name)) {
      try { cache.set(name, read(name)); } catch (e) { check(`${name} can be read`, false, String(e?.message ?? e)); cache.set(name, null); }
    }
    return cache.get(name);
  };
  const jsonl = (name) => { const b = get(name); return b ? b.toString("utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []; };
  const holdsKey = Boolean(get("key.pem"));
  const kind = holdsKey && !get("manifest.json") ? "book" : "package";
  if (kind === "book") check("this is a book's own folder: its seals and fields are checked below; it holds the private key, so share an export of it instead", true);
  else if (holdsKey) check("the package holds no private key", false, "key.pem is a private key and must never be shared");
  const keys = new Map(jsonl("keys.jsonl").map((k) => [k.key_id, k]));
  const signers = new Set();
  const sealOk = (payload, seal) => {
    const s = normalizeSeal(seal ?? {});
    signers.add(s.key_id);
    const k = keys.get(s.key_id);
    if (!k) return { ok: false, detail: `key ${s.key_id} is not in keys.jsonl` };
    const v = verifySeal(payload, s, k.public_pem, k.algorithm ?? s.algorithm);
    return { ok: v.ok, detail: v.ok ? "" : !v.hash_matches ? "the payload's hash is not the sealed hash" : "the signature does not verify with that key" };
  };
  // A key handed over from an earlier one carries the handover, sealed by the earlier key (section 3).
  const goodHandover = new Set();
  for (const k of keys.values()) {
    if (!k.rotation) continue;
    const c = checkKeyHandover(k, keys);
    if (c.ok) goodHandover.add(k.key_id);
    check(`key ${k.key_id} was handed over by key ${k.rotation.payload?.from}, which sealed the handover`, c.ok, c.detail);
  }
  const manifestBytes = get("manifest.json");
  if (kind === "package" && check("manifest.json is present", Boolean(manifestBytes))) {
    const m = JSON.parse(manifestBytes.toString("utf8"));
    const s = sealOk(m.package, m.seal);
    check("the manifest is sealed", s.ok, s.detail);
    for (const f of m.package?.files ?? []) {
      if (typeof f?.name !== "string" || !PACKAGE_FILES.includes(f.name) || f.name === "manifest.json") {
        check("the manifest names only the package's own files", false, `${JSON.stringify(f?.name)} is not one of ${PACKAGE_FILES.slice(1).join(", ")}`);
        continue;
      }
      const b = get(f.name);
      check(`${f.name} is the file the manifest names`, Boolean(b) && sha256Hex(b) === f.sha256, b ? "its SHA-256 differs" : "missing");
    }
  }
  const intents = jsonl("intents.jsonl"), records = jsonl("records.jsonl");
  const intentById = new Map();
  for (const i of intents) {
    const s = sealOk(i.payload, i.seal);
    check(`intent ${i.payload?.intent_id} is sealed`, s.ok, s.detail);
    const c = checkIntent(i.payload);
    check(`intent ${i.payload?.intent_id} has the core fields`, c.ok, c.problems.join("; "));
    intentById.set(i.payload?.intent_id, i);
  }
  for (const name of ["cancellations.jsonl", "checks.jsonl"])
    for (const row of jsonl(name)) {
      const s = sealOk(row.payload, row.seal);
      check(`${name === "checks.jsonl" ? "pre-payment check" : "withdrawal of intent"} ${row.payload?.id ?? row.payload?.intent_id} is sealed`, s.ok, s.detail);
    }
  const recById = new Map(records.map((r) => [r.payload?.record_id, r]));
  for (const r of records) {
    const p = r.payload ?? {};
    const s = sealOk(p, r.seal);
    check(`record ${p.record_id} is sealed`, s.ok, s.detail);
    const c = checkRecord(p);
    check(`record ${p.record_id} has the core fields`, c.ok, c.problems.join("; "));
    if (p.supersedes) check(`record ${p.record_id} replaces a version in the package`, recById.has(p.supersedes), p.supersedes);
    if (p.intent?.intent_id) {
      const i = intentById.get(p.intent.intent_id);
      check(`record ${p.record_id}: its intent is in the package`, Boolean(i), p.intent.intent_id);
      if (i) check(`record ${p.record_id}: it names the intent's sealed hash`, normalizeSeal(i.seal).payload_sha256 === p.intent.payload_sha256);
      const b = p.consent?.binding;
      if (i && b?.nonce) {
        const expected = intentNonce(normalizeSeal(i.seal).payload_sha256, Number.isInteger(b.seq) ? b.seq : 0);
        check(`record ${p.record_id}: bound only when the nonce is the intent's fingerprint`, (b.status === "bound") === (b.nonce.toLowerCase() === expected), `expected ${expected}`);
      }
    }
  }
  const set = checkRecordSet(records.map((r) => r.payload ?? {}));
  check("no record ID holds two different records, and no payment has two records of one version", set.ok, set.problems.join("; "));

  // Whose package it is.
  const expected = (opts.expectedKeys ?? []).map((k) => isKeyId(k) ? k : keyIdFor(k));
  let trust = "consistency-only";
  if (expected.length) {
    const trusted = new Set(expected);
    for (let grew = true; grew;) {
      grew = false;
      for (const id of goodHandover) if (!trusted.has(id) && trusted.has(keys.get(id).rotation.payload.from)) { trusted.add(id); grew = true; }
    }
    const strangers = [...signers].filter((id) => !trusted.has(id));
    trust = check(`every seal is by the company's expected key ${expected.join(" or ")}, or a key it handed over to`, strangers.length === 0,
      strangers.length ? `sealed by ${strangers.join(", ")}, which the expected key did not hand over to` : "") ? "expected-key" : "untrusted";
  }
  const ok = results.every((r) => r.ok);
  return { kind, ok, trust, signers: [...signers], expected_keys: expected,
    passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
