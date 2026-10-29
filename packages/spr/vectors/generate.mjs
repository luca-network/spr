// Writes vectors.json. Run when the format changes: node lib/spr/vectors/generate.mjs
// The Ed25519 key is RFC 8032's published test key 1 (section 7.1), so anyone can reproduce every
// signature. The P-256 key is RFC 6979's published test key (appendix A.2.5). ES256 signatures are not
// deterministic, so an earlier vectors.json's P-256 signature is kept while it still checks; the file then
// changes only when the format does.
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey, createPrivateKey } from "node:crypto";
import * as L from "../index.mjs";
import { ed25519FromSeed } from "./run.mjs";

const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUB = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const priv = ed25519FromSeed(SEED);
const pubJwk = createPublicKey(priv).export({ format: "jwk" });
const h = (s) => L.sha256Hex(s);

const canonical = [
  ["empty object", {}],
  ["keys sorted, undefined dropped", { b: 1, a: [true, null, "x"], c: undefined }],
  ["nested objects and arrays keep array order", { z: [{ y: 2, x: 1 }, [3, 2, 1]], a: { d: { c: null } } }],
  ["negative and large safe integers", { minus: -4050, big: 9007199254740991, zero: 0 }],
  ["keys sorted by UTF-16 code unit (digits, upper case, lower case, then é)", { "é": 1, z: 2, Z: 3, "10": 4, "9": 5 }],
  // Sorting by code point (Python's default) puts U+E000 and U+FFFF before the emoji; UTF-16 order puts the emoji first.
  ["keys outside the basic plane sort by UTF-16 code unit (emoji, a surrogate pair, before U+E000 and U+FFFF)", { "\uffff": 1, "😀": 2, a: 3, "\ue000": 4 }],
  ["string escapes", { s: "quote \" backslash \\ tab \t newline \n control \u0001 line sep   emoji 😀" }],
  ["a record-shaped payload", { schema: "luca.record/0.7", record_id: "LR-X402-0123456789-v1", version: 1, supersedes: null, amount_minor: 1500000, currency: "USDC" }],
].map(([name, input]) => ({ name, input, canonical: L.canonicalize(input), sha256: h(L.canonicalize(input)) }));

const canonical_rejects = [
  { name: "a float", input_json: "{\"amount\":12.5}" },
  { name: "an integer beyond 2^53 - 1", input_json: "{\"amount\":9007199254740993}" },
];

const recordPayload = {
  schema: "luca.record/0.7", record_id: "LR-X402-AB12CD34EF-v1", version: 1, supersedes: null,
  entity: "Example Co", entity_id: "example-co", rail: "x402", direction: "outflow", reported_by: "agent",
  source: { id: "0x5f2c0000000000000000000000000000000000000000000000000000000000aa" },
  state: "cleared", amount_minor: 250000, currency: "USDC",
  occurred_at: "2026-10-21T17:04:05Z", time_zone: "UTC", settled_on: "2026-10-21", counterparty: "data.example",
};
const seals = ["ed25519", "ed25519-digest"].map((algorithm) => ({
  name: `${algorithm} over a record`, key: "rfc8032_test1", algorithm, payload: recordPayload,
  seal: L.sealWith(recordPayload, priv, { algorithm }), tampered: { ...recordPayload, amount_minor: 250001 },
}));

const leaves = ["a", "b", "c", "d", "e"].map((x) => h(x));
const merkle = [
  { name: "no leaves", leaves: [] },
  { name: "one leaf", leaves: leaves.slice(0, 1) },
  { name: "two leaves", leaves: leaves.slice(0, 2) },
  { name: "five leaves (an odd node carried up)", leaves },
].map((m) => ({ ...m, root: L.merkleRoot(m.leaves), paths: m.leaves.map((_, i) => ({ index: i, path: L.merklePath(m.leaves, i) })) }));

const recs = [{ id: "LR-B-v1", payload_sha256: h("b") }, { id: "LR-A-v1", payload_sha256: h("a") }, { id: "LR-C-v2", payload_sha256: h("c") }];
const records_root = [{ name: "three records, given out of order", records: recs, root: L.recordsRoot(recs) }];

const intentHash = L.payloadSha256({ schema: "luca.intent/0.1", intent_id: "int_00000000000000000001", purpose: "Market data for the pricing model" });
const intent_nonce = [0, 1, 7].map((seq) => ({ name: `sequence ${seq}`, intent_payload_sha256: intentHash, seq, nonce: L.intentNonce(intentHash, seq) }));

const b64u = (hex) => Buffer.from(hex, "hex").toString("base64url");
const p256Jwk = { kty: "EC", crv: "P-256",
  x: b64u("60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6"),
  y: b64u("7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299") };
const p256 = { privateKey: createPrivateKey({ key: { ...p256Jwk, d: b64u("C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721") }, format: "jwk" }) };
const outPath = join(dirname(fileURLToPath(import.meta.url)), "vectors.json");
const earlierEs256 = (labelId, sha) => {
  try {
    const sig = JSON.parse(readFileSync(outPath, "utf8")).labels?.[0]?.signatures?.find((s) => s.alg === "ES256" && s.jwk?.x === p256Jwk.x)?.signature;
    return sig && L.verifyLabelSignature(p256Jwk, labelId, sha, sig) ? sig : null;
  } catch { return null; }
};
const shared = {
  schema: "luca.label/1", label_id: "lbl_0123456789abcdef0123",
  payment: { rail: "x402", id: recordPayload.source.id, network: "eip155:8453" },
  amount_minor: 250000, currency: "USDC", accounting_date: "2026-10-21", payer: "Example Co", payee: "Data Example Ltd",
  product: { code: "data_access", label: "Data access" }, tax: { jurisdiction: "US-CA", treatment: "exempt" },
};
const sharedSha = L.labelSharedSha256(shared);
const labels = [{
  name: "an x402 purchase of data", label_id: shared.label_id, shared, shared_sha256: sharedSha,
  signing_input: L.labelSigningInput(shared.label_id, sharedSha),
  signatures: [
    { alg: "EdDSA", key: "rfc8032_test1", jwk: { kty: "OKP", crv: "Ed25519", x: pubJwk.x }, signature: L.signLabel(priv, shared.label_id, sharedSha) },
    { alg: "ES256", jwk: { kty: "EC", crv: "P-256", x: p256Jwk.x, y: p256Jwk.y }, signature: earlierEs256(shared.label_id, sharedSha) ?? L.signLabel(p256.privateKey, shared.label_id, sharedSha) },
  ],
}];
const jwk_thumbprints = [
  { name: "Ed25519", jwk: { kty: "OKP", crv: "Ed25519", x: pubJwk.x } },
  { name: "P-256", jwk: { kty: "EC", crv: "P-256", x: p256Jwk.x, y: p256Jwk.y } },
].map((t) => ({ ...t, thumbprint: L.jwkThumbprint(t.jwk) }));

const records = [
  { name: "a complete record", payload: recordPayload, ok: true },
  { name: "a correction names the version it replaces", payload: { ...recordPayload, record_id: "LR-X402-AB12CD34EF-v2", version: 2, supersedes: "LR-X402-AB12CD34EF-v1" }, ok: true },
  { name: "version 2 with nothing replaced", payload: { ...recordPayload, version: 2 }, ok: false },
  { name: "an amount in decimal units", payload: { ...recordPayload, amount_minor: "2.50" }, ok: false },
  { name: "a local time with no offset", payload: { ...recordPayload, occurred_at: "2026-10-21T17:04:05" }, ok: false },
  { name: "no direction", payload: { ...recordPayload, direction: undefined }, ok: false },
];
const intentPayload = { schema: "luca.intent/0.1", intent_id: "int_00000000000000000001", purpose: "Market data for the pricing model",
  max_amount_minor: 300000, currency: "USDC", declared_at: "2026-10-21T17:00:00Z", expires_at: "2026-10-24T17:00:00Z" };
const intents = [
  { name: "a complete intent", payload: intentPayload, ok: true },
  { name: "no purpose", payload: { ...intentPayload, purpose: "" }, ok: false },
  { name: "a cap of zero", payload: { ...intentPayload, max_amount_minor: 0 }, ok: false },
];

// Key handovers (section 3): RFC 8032's test key 1 hands over to its test key 2.
const SEED2 = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const priv2 = ed25519FromSeed(SEED2);
const key1 = { key_id: L.keyIdFor(priv), algorithm: "ed25519", public_pem: L.publicKeyPemOf(priv) };
const handover = { schema: L.KEY_ROTATION_SCHEMA, from: key1.key_id, to: L.keyIdFor(priv2), to_public_pem: L.publicKeyPemOf(priv2), at: "2026-10-28T12:00:00Z", entity: "Example Co", reason: "Yearly rotation" };
const key2 = { key_id: handover.to, algorithm: "ed25519", public_pem: handover.to_public_pem, rotation: { payload: handover, seal: L.sealWith(handover, priv) } };
const key_handovers = [
  { name: "sealed by the earlier key", key: key2, keys: [key1, key2], ok: true },
  { name: "changed after sealing", key: { ...key2, rotation: { ...key2.rotation, payload: { ...handover, reason: "Something else" } } }, keys: [key1], ok: false },
  { name: "sealed by the new key itself", key: { ...key2, rotation: { payload: handover, seal: { ...L.sealWith(handover, priv2) } } }, keys: [key1, key2], ok: false },
  { name: "the earlier key is not in the list", key: key2, keys: [], ok: false },
];

const out = {
  spec: L.SPEC_VERSION,
  note: "Generated by vectors/generate.mjs. Keys rfc8032_test1 and rfc8032_test2 are the published test keys 1 and 2 of RFC 8032, section 7.1, and the P-256 key is the test key of RFC 6979, appendix A.2.5: test keys, never used for real records.",
  keys: { rfc8032_test1: { seed_hex: SEED, public_hex: PUB, key_id: L.keyIdFor(priv), public_pem: L.publicKeyPemOf(priv) },
    rfc8032_test2: { seed_hex: SEED2, public_hex: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", key_id: L.keyIdFor(priv2), public_pem: L.publicKeyPemOf(priv2) } },
  canonical, canonical_rejects, seals, merkle, records_root, intent_nonce, jwk_thumbprints, labels,
  records, intents, key_handovers,
};
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log("vectors.json written");
