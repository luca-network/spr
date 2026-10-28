// Runs the test vectors against this library. Another implementation conforms when it gives the same
// answers; this file is also a worked example of what each vector asks.
import { createPrivateKey, createPublicKey } from "node:crypto";
import * as L from "../index.mjs";

// An Ed25519 private key from its 32-byte seed (RFC 8032), wrapped as PKCS#8.
export const ed25519FromSeed = (seedHex) =>
  createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seedHex, "hex")]), format: "der", type: "pkcs8" });

export function runVectors(v) {
  const results = [];
  const check = (what, ok, detail = "") => results.push({ what, ok: Boolean(ok), detail });
  const same = (what, got, want) => check(what, got === want, `got ${got}, want ${want}`);

  const keys = {};
  for (const [name, k] of Object.entries(v.keys)) {
    const priv = ed25519FromSeed(k.seed_hex);
    keys[name] = { priv, pub: createPublicKey(priv) };
    same(`key ${name}: public key from the seed`, createPublicKey(priv).export({ format: "jwk" }).x, Buffer.from(k.public_hex, "hex").toString("base64url"));
    same(`key ${name}: key ID`, L.keyIdFor(createPublicKey(priv)), k.key_id);
  }
  for (const c of v.canonical) {
    same(`canonical: ${c.name}`, L.canonicalize(c.input), c.canonical);
    same(`canonical: ${c.name}, SHA-256`, L.sha256Hex(c.canonical), c.sha256);
  }
  for (const c of v.canonical_rejects) {
    let threw = false;
    try { L.canonicalize(JSON.parse(c.input_json)); } catch { threw = true; }
    check(`canonical rejects: ${c.name}`, threw, "it was accepted");
  }
  for (const s of v.seals) {
    const k = keys[s.key];
    const made = L.sealWith(s.payload, k.priv, { algorithm: s.algorithm });
    same(`seal ${s.name}: payload hash`, made.payload_sha256, s.seal.payload_sha256);
    same(`seal ${s.name}: signature (Ed25519 is deterministic)`, made.signature, s.seal.signature);
    check(`seal ${s.name}: verifies`, L.verifySeal(s.payload, s.seal, k.pub).ok);
    check(`seal ${s.name}: a changed payload fails`, !L.verifySeal(s.tampered, s.seal, k.pub).ok);
  }
  for (const m of v.merkle) {
    same(`merkle ${m.name}: root`, L.merkleRoot(m.leaves), m.root);
    for (const p of m.paths) {
      check(`merkle ${m.name}: path of leaf ${p.index}`, JSON.stringify(L.merklePath(m.leaves, p.index)) === JSON.stringify(p.path), JSON.stringify(L.merklePath(m.leaves, p.index)));
      same(`merkle ${m.name}: leaf ${p.index} reaches the root`, L.rootFromPath(m.leaves[p.index], p.path), m.root);
    }
  }
  for (const r of v.records_root) same(`records root: ${r.name}`, L.recordsRoot(r.records), r.root);
  for (const n of v.intent_nonce) same(`intent nonce: ${n.name}`, L.intentNonce(n.intent_payload_sha256, n.seq), n.nonce);
  for (const t of v.jwk_thumbprints) same(`JWK thumbprint: ${t.name}`, L.jwkThumbprint(t.jwk), t.thumbprint);
  for (const l of v.labels) {
    same(`label ${l.name}: shared SHA-256`, L.labelSharedSha256(l.shared), l.shared_sha256);
    same(`label ${l.name}: what is signed`, L.labelSigningInput(l.label_id, l.shared_sha256), l.signing_input);
    for (const s of l.signatures) {
      check(`label ${l.name}: ${s.alg} signature verifies`, L.verifyLabelSignature(s.jwk, l.label_id, l.shared_sha256, s.signature));
      check(`label ${l.name}: ${s.alg} signature fails on another digest`, !L.verifyLabelSignature(s.jwk, l.label_id, "0".repeat(64), s.signature));
      if (s.key && keys[s.key]) same(`label ${l.name}: ${s.alg} signature (deterministic)`, L.signLabel(keys[s.key].priv, l.label_id, l.shared_sha256), s.signature);
    }
  }
  for (const r of v.records) {
    const c = L.checkRecord(r.payload);
    check(`record core fields: ${r.name}`, c.ok === r.ok, c.problems.join("; ") || "it passed");
  }
  for (const r of v.intents) {
    const c = L.checkIntent(r.payload);
    check(`intent core fields: ${r.name}`, c.ok === r.ok, c.problems.join("; ") || "it passed");
  }
  return { spec: v.spec, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
