// The SPR SDK: withLuca around the real x402 client, against a stand-in seller; the tools in the OpenAI Agents
// SDK and LangChain; a label agreed by the counterparty; and Python and JavaScript reading each other's books.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";

const { SprBook, sprTools, toOpenAIAgentsTools, toLangChainTools, spr } = await import("@luca-network/spr-sdk");
const { withLuca, PaymentDeclinedByLuca } = await import("@luca-network/spr-sdk/x402");
const { encodePaymentRequiredHeader, encodePaymentResponseHeader, decodePaymentSignatureHeader } = await import("@x402/core/http");
const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
const { recoverTypedDataAddress } = await import("viem");
const { authorizationTypes } = await import("@x402/evm");

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SELLER = "0x59dd0305c70fdd714d9a022a1b0daf93e7dcec6d";
const requirements = (amount) => ({ scheme: "exact", network: "eip155:84532", asset: USDC, amount, payTo: SELLER, maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } });

// A seller that asks for payment over x402, checks the signed authorization and answers with a settlement.
function standInSeller(price, seen) {
  return async (input, init) => {
    seen.calls++;
    const req = new Request(input, init);
    if (req.url.endsWith("/free")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const sig = req.headers.get("PAYMENT-SIGNATURE");
    if (!sig) return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader({ x402Version: 2,
      resource: { url: req.url, description: "Market data", mimeType: "application/json" }, accepts: [requirements(price)] }) } });
    const payload = decodePaymentSignatureHeader(sig);
    seen.signatures.push(payload);
    const a = payload.payload.authorization;
    const signer = await recoverTypedDataAddress({ domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC }, types: authorizationTypes,
      primaryType: "TransferWithAuthorization", message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
      signature: payload.payload.signature });
    if (signer.toLowerCase() !== a.from.toLowerCase()) return new Response("bad signature", { status: 402 });
    const tx = "0x" + a.nonce.slice(2, 66).split("").reverse().join("");
    return new Response(JSON.stringify({ prices: [1, 2, 3] }), { status: 200,
      headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader({ success: true, transaction: tx, network: "eip155:84532", payer: a.from }) } });
  };
}

test("withLuca: one wrapped fetch declares the intent, pays bound to it, and seals the record, with the real x402 client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-sdk-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_research", entity: "Example Co" });
    const account = privateKeyToAccount(generatePrivateKey());
    const seen = { signatures: [], calls: 0 };
    const pay = withLuca(book, { signer: account, fetch: standInSeller("10000", seen) });

    const res = await pay("https://data.example/prices", { luca: { purpose: "Market data for the pricing model", max_amount_minor: 20000, currency: "USDC",
      counterparty: "Data Example Ltd" } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { prices: [1, 2, 3] });
    const luca = res.luca;
    assert.equal(luca.status, "paid");
    // The payer signed the intent's fingerprint as the nonce; the seller and the client needed no change.
    assert.equal(seen.signatures[0].payload.authorization.nonce, book.nonceFor(luca.intent.intent_id));
    assert.ok(Number(seen.signatures[0].payload.authorization.validBefore) <= Math.floor(Date.parse(luca.intent.expires_at) / 1000));
    assert.equal(luca.record.status, "recorded");
    assert.equal(luca.record.binding, "bound");
    assert.equal(luca.record.within_consent, true);
    assert.equal(book.getIntent(luca.intent.intent_id).status, "matched");
    // The check before signing is in the book too.
    assert.ok(existsSync(join(dir, "checks.jsonl")));
    // The whole book checks with nothing but the SPR library.
    const out = book.exportPackage(join(dir, "export"));
    assert.equal(out.verified, true, JSON.stringify(out));

    // Over the cap: the check declines before anything is signed, and the intent is withdrawn.
    const before = seen.signatures.length;
    await assert.rejects(pay("https://data.example/prices", { luca: { purpose: "More market data", max_amount_minor: 5000, currency: "USDC" } }),
      (e) => e instanceof PaymentDeclinedByLuca && /within_intent_cap/.test(e.message));
    assert.equal(seen.signatures.length, before);
    const declined = [...book.intents.values()].pop();
    assert.equal(book.getIntent(declined.payload.intent_id).status, "withdrawn");

    // Nothing asked for: the intent is withdrawn and no record is made.
    const free = await pay("https://data.example/free", { luca: { purpose: "Open data", max_amount_minor: 1000 } });
    assert.equal(free.luca.status, "free");
    assert.equal(book.listRecords().length, 1);
    // Without luca options the fetch passes through untouched.
    assert.equal((await pay("https://data.example/free")).status, 200);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("the book's calls as tools in the OpenAI Agents SDK and LangChain", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-tools-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_tools", entity: "Example Co" });
    assert.deepEqual(sprTools(book).map((t) => t.name), ["record_intent", "check_payment", "record_settlement", "cancel_intent", "get_intent", "verify_record"]);
    const { tool: oaTool } = await import("@openai/agents");
    const oa = toOpenAIAgentsTools(book, oaTool);
    const declare = oa.find((t) => t.name === "record_intent");
    const receipt = JSON.parse(await declare.invoke({}, JSON.stringify({ purpose: "Model calls for the support bot", max_amount_minor: 500, currency: "USD" })));
    assert.match(receipt.intent_id, /^int_/);
    const { tool: lcTool } = await import("@langchain/core/tools");
    const lc = toLangChainTools(book, lcTool);
    const sealed = JSON.parse(await lc.find((t) => t.name === "record_settlement").invoke({ rail: "stripe", source_id: "ch_tools_1", amount_minor: 450, currency: "USD",
      occurred_at: new Date().toISOString(), intent_id: receipt.intent_id }));
    assert.equal(sealed.within_consent, true);
    const bad = JSON.parse(await lc.find((t) => t.name === "get_intent").invoke({ intent_id: "int_none" }));
    assert.match(bad.error, /No intent int_none/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("a label: the company signs its side, the counterparty's P-256 signature agrees it, and both check with the SPR library alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-label-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_lbl", entity: "Example Co" });
    const r = book.seal({ rail: "x402", source_id: "0x" + "aa".repeat(32), amount_minor: 250000, currency: "USDC", occurred_at: "2026-10-28T16:00:00Z", counterparty: "Data Example Ltd" });
    const label = book.label(r.record_id, { counterparty: "Data Example Ltd", product: { code: "data_access", label: "Data access" }, tax: { jurisdiction: "US-CA", treatment: "exempt" } });
    assert.equal(label.shared.payer, "Example Co");
    assert.equal(label.shared_sha256, spr.labelSharedSha256(label.shared));
    const ours = label.signatures[0];
    const pubJwk = { kty: "OKP", crv: "Ed25519", x: (await import("node:crypto")).createPublicKey(readFileSync(join(dir, "key.pem"), "utf8")).export({ format: "jwk" }).x };
    assert.equal(spr.verifyLabelSignature(pubJwk, label.label_id, label.shared_sha256, ours.signature), true);
    const cp = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const sig = spr.signLabel(cp.privateKey, label.label_id, label.shared_sha256);
    const jwk = cp.publicKey.export({ format: "jwk" });
    const agreed = book.counterpartySignature(label.label_id, jwk, sig);
    assert.equal(agreed.state, "agreed");
    assert.throws(() => book.counterpartySignature(label.label_id, jwk, spr.signLabel(cp.privateKey, label.label_id, "0".repeat(64))), /does not verify/);
    assert.throws(() => book.counterpartySignature(label.label_id, { ...jwk, d: "x" }, sig), /private key/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("Python and JavaScript read each other's books: either seals, the other checks and carries on", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const pyDir = fileURLToPath(new URL("../python", import.meta.url));
  const probe = spawnSync("python3", ["-c", "import cryptography"], { encoding: "utf8" });
  if (probe.status !== 0) { t.skip("python3 with the cryptography package is not installed"); return; }
  const py = (code) => {
    const r = spawnSync("python3", ["-c", code], { cwd: pyDir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    return r.stdout.trim();
  };
  const dir = mkdtempSync(join(tmpdir(), "spr-cross-"));
  try {
    // Python starts the book: an intent and a bound payment.
    const fromPy = JSON.parse(py(`
import json, spr
b = spr.SprBook(dir=${JSON.stringify(dir)}, agent_id="agt_cross", entity="Example Co")
i = b.declare(purpose="Market data", max_amount_minor=20000, currency="USDC")
r = b.seal(rail="x402", source_id="0x" + "cd" * 32, amount_minor=10000, currency="USDC", nonce=b.nonce_for(i["intent_id"]))
print(json.dumps({"intent": i["intent_id"], "record": r["record_id"], "binding": r["binding"]}))`));
    assert.equal(fromPy.binding, "bound");
    // JavaScript opens the same folder with the same key, checks Python's record and seals the next payment.
    const book = new SprBook({ dir, agentId: "agt_cross", entity: "Example Co" });
    assert.equal(book.verifyRecord(fromPy.record).ok, true);
    assert.equal(book.getIntent(fromPy.intent).status, "matched");
    const i2 = book.declare({ purpose: "More data", max_amount_minor: 5000, currency: "USDC" });
    book.seal({ rail: "x402", source_id: "0x" + "ce".repeat(32), amount_minor: 4000, currency: "USDC", occurred_at: new Date().toISOString(), nonce: book.nonceFor(i2.intent_id) });
    const out = book.exportPackage(join(dir, "export"));
    assert.equal(out.verified, true);
    // Python checks the package JavaScript exported, records from both languages in it.
    const checked = JSON.parse(spawnSync("python3", ["-m", "spr", join(dir, "export"), "--json"], { cwd: pyDir, encoding: "utf8" }).stdout);
    assert.equal(checked.failed, 0, JSON.stringify(checked.results.filter((r) => !r.ok)));
    assert.ok(checked.passed >= 12);
    // And Python's own export checks with the JavaScript library.
    py(`
import spr
b = spr.SprBook(dir=${JSON.stringify(dir)}, agent_id="agt_cross", entity="Example Co")
assert b.export_package(${JSON.stringify(join(dir, "export-py"))})["verified"]`);
    const js = spr.verifyPackage((n) => existsSync(join(dir, "export-py", n)) ? readFileSync(join(dir, "export-py", n)) : null);
    assert.equal(js.failed, 0, JSON.stringify(js.results.filter((r) => !r.ok)));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("sendToLuca: the book goes as a package whose sealed manifest checks with the SPR library alone; Luca's refusal comes back as an error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-send-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_research", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 4900, currency: "USD" });
    const sent = [];
    const fetch = async (url, init) => {
      sent.push({ url, init });
      return new Response(JSON.stringify(url.endsWith("/v1/spr/import") ? { import_id: "spi_1", created: 1 } : { change: { id: "chg_1", status: "pending" } }), { status: 201 });
    };
    assert.equal((await book.sendToLuca({ url: "https://luca.example", apiKey: "k_1", fetch })).created, 1);
    assert.equal(sent[0].url, "https://luca.example/v1/spr/import");
    assert.equal(sent[0].init.headers.authorization, "Bearer k_1");
    const files = JSON.parse(sent[0].init.body).files;
    assert.deepEqual(Object.keys(files).sort(), ["keys.jsonl", "manifest.json", "records.jsonl"]);
    assert.ok(spr.verifyPackage((n) => files[n] === undefined ? null : Buffer.from(files[n])).ok);
    assert.ok(!Object.values(files).some((t) => /PRIVATE KEY/.test(t)), "the private key never leaves the machine");

    await book.registerWithLuca({ url: "https://luca.example", apiKey: "k_fin", fetch, entityId: "ent_1" });
    const reg = JSON.parse(sent[1].init.body);
    assert.equal(reg.public_pem, book.publicKey().public_pem);
    assert.equal(reg.entity_id, "ent_1");

    const refuse = async () => new Response(JSON.stringify({ error: "Key ed25519:x is not registered with Luca" }), { status: 403 });
    await assert.rejects(book.sendToLuca({ url: "https://luca.example", apiKey: "k_1", fetch: refuse }), (e) => e.status === 403 && /not registered/.test(e.message));
    await assert.rejects(book.sendToLuca({ fetch }), /LUCA_URL/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("times: one without its offset is refused; the accounting date follows the book's time zone (UTC by default), whatever the computer's", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-time-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_t", entity: "Example Co" });
    assert.throws(() => book.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00" }), /offset/);
    assert.equal(book.listRecords().length, 0);
    book.seal({ rail: "stripe", source_id: "pi_2", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T23:30:00-07:00" });
    const p = JSON.parse(readFileSync(join(dir, "records.jsonl"), "utf8").trim().split("\n").pop()).payload;
    assert.deepEqual([p.occurred_at, p.time_zone, p.settled_on], ["2026-10-29T06:30:00Z", "UTC", "2026-10-29"]);
    const la = new SprBook({ dir: join(dir, "la"), agentId: "agt_t", entity: "Example Co", timeZone: "America/Los_Angeles" });
    la.seal({ rail: "stripe", source_id: "pi_2", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T23:30:00-07:00" });
    assert.equal(la.listRecords()[0].settled_on, "2026-10-28");
    // No time: the record says so, and a retry keeps the first time. The agent tools insist on one.
    la.seal({ rail: "stripe", source_id: "pi_3", amount_minor: 100, currency: "USD" });
    const p3 = JSON.parse(readFileSync(join(dir, "la", "records.jsonl"), "utf8").trim().split("\n").pop()).payload;
    assert.equal(p3.occurred_at_source, "not given: the time the book sealed it");
    assert.equal(la.seal({ rail: "stripe", source_id: "pi_3", amount_minor: 100, currency: "USD" }).status, "unchanged");
    const settle = sprTools(la).find((t) => t.name === "record_settlement");
    assert.throws(() => settle.run({ rail: "stripe", source_id: "pi_4", amount_minor: 100, currency: "USD" }), /occurred_at is required/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("authority: the book's own limits are reported as self-declared; a book's folder checks as a book; a package holding the private key fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-auth-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_a", entity: "Example Co" });
    const i = book.declare({ purpose: "Data", max_amount_minor: 500, currency: "USD" });
    assert.deepEqual([i.decision, i.authority], ["none", "none"]);
    const { writeFileSync, copyFileSync } = await import("node:fs");
    writeFileSync(join(dir, "mandate.json"), JSON.stringify({ currency: "USD", max_per_payment_minor: 1000 }));
    const c = book.checkPayment({ amount_minor: 400, currency: "USD", intent_id: i.intent_id });
    assert.deepEqual([c.decision, c.authority], ["approve", "self-declared"]);
    book.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 400, currency: "USD", occurred_at: "2026-10-28T12:00:00Z", intent_id: i.intent_id });
    const read = (d) => (n) => existsSync(join(d, n)) ? readFileSync(join(d, n)) : null;
    const asBook = spr.verifyPackage(read(dir));
    assert.equal(asBook.kind, "book");
    assert.equal(asBook.ok, true, JSON.stringify(asBook.results.filter((r) => !r.ok)));
    const exp = join(dir, "export");
    book.exportPackage(exp);
    assert.equal(spr.verifyPackage(read(exp)).kind, "package");
    copyFileSync(join(dir, "key.pem"), join(exp, "key.pem"));
    const leaked = spr.verifyPackage(read(exp));
    assert.equal(leaked.ok, false);
    assert.ok(leaked.results.some((r) => r.what === "the package holds no private key" && !r.ok));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("one writer at a time: four processes sealing into one book lose nothing and seal each payment once", async () => {
  const { spawn } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "spr-many-"));
  try {
    new SprBook({ dir, agentId: "agt_many", entity: "Example Co" });
    const sdk = import.meta.resolve("@luca-network/spr-sdk");
    const script = `const { SprBook } = await import(${JSON.stringify("SDK_URL")});
      const [dir, who] = process.argv.slice(1); const b = new SprBook({ dir, agentId: "agt_many", entity: "Example Co" }); const out = {};
      for (let k = 0; k < 60; k++) {
        for (const [id, amt] of [[who + "-" + k, 100 + k], ["shared-" + (k % 10), who === "w0" ? 1 : 2]]) {
          const s = b.seal({ rail: "stripe", source_id: id, amount_minor: amt, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" }).status;
          out[s] = (out[s] ?? 0) + 1;
        }
      }
      console.log(JSON.stringify(out));`.replace("SDK_URL", sdk);
    const runs = await Promise.all(["w0", "w1", "w2", "w3"].map((w) => new Promise((done, fail) => {
      let out = ""; const p = spawn(process.execPath, ["--input-type=module", "-e", script, dir, w]);
      p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
      p.on("exit", (c) => c === 0 ? done(JSON.parse(out)) : fail(new Error(out)));
    })));
    const lines = readFileSync(join(dir, "records.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 4 * 60 + 10, JSON.stringify(runs));
    assert.equal(new Set(lines.map((r) => r.payload.record_id)).size, lines.length);
    const read = (n) => existsSync(join(dir, n)) ? readFileSync(join(dir, n)) : null;
    assert.equal(spr.verifyPackage(read).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("key rotation: the new key is handed over by the old one; old records still check; another open copy of the book follows the new key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-rot-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_rot", entity: "Example Co" });
    const other = new SprBook({ dir, agentId: "agt_rot", entity: "Example Co" });
    const r1 = book.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" });
    const r = book.rotateKey({ reason: "Yearly rotation" });
    assert.notEqual(r.from, r.to);
    assert.equal(book.verifyRecord(r1.record_id).ok, true);
    const r2 = other.seal({ rail: "stripe", source_id: "pi_2", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" });
    assert.equal(r2.seal?.key_id, r.to, "a copy opened before the rotation seals with the new key");
    const read = (n) => existsSync(join(dir, n)) ? readFileSync(join(dir, n)) : null;
    const v = spr.verifyPackage(read);
    assert.equal(v.ok, true);
    assert.ok(v.results.some((x) => x.what === `key ${r.to} was handed over by key ${r.from}, which sealed the handover` && x.ok));
    const forged = readFileSync(join(dir, "keys.jsonl"), "utf8").replace("Yearly rotation", "Forged");
    assert.equal(spr.verifyPackage((n) => n === "keys.jsonl" ? Buffer.from(forged) : read(n)).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("a large book: sealing stays quick, and it goes to Luca in parts that each check on their own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-big-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_big", entity: "Example Co" });
    const i = book.declare({ purpose: "Bulk data", max_amount_minor: 10_000_000, currency: "USD", expires_in: "P3D" });
    // The same machine seals 200 into a nearly empty book, then 200 into the 3,000-record book: a slow or busy
    // computer slows both, so only a cost that grows with the book fails.
    const timed = (tag) => { const t = Date.now(); for (let k = 0; k < 200; k++) book.seal({ rail: "stripe", source_id: `pi_${tag}_${k}`, amount_minor: 1, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" }); return Date.now() - t; };
    const early = timed("early");
    for (let k = 0; k < 2800; k++) book.seal({ rail: "stripe", source_id: `pi_${k}`, amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00Z", intent_id: k % 2 ? i.intent_id : undefined });
    const late = timed("late");
    assert.ok(late < early * 3 + 250, `200 seals took ${early} ms into a nearly empty book and ${late} ms into a 3,000-record book`);
    const parts = book.packageParts({ maxRecords: 1000 });
    assert.equal(parts.length, 4);
    for (const p of parts) assert.equal(spr.verifyPackage((n) => p[n] === undefined ? null : Buffer.from(p[n])).ok, true);
    let sent = 0;
    const fetch = async (_url, init) => { sent++; const f = JSON.parse(init.body).files; return new Response(JSON.stringify({ created: f["records.jsonl"].trim().split("\n").length }), { status: 201 }); };
    const out = await book.sendToLuca({ url: "https://luca.example", apiKey: "k", fetch, maxRecords: 1000 });
    assert.deepEqual([sent, out.parts, out.created], [4, 4, 3200]);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("whose package it is: a package sealed by another key passes only as consistency; with the company's key it fails, and the company's own passes", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "spr-trust-"));
  try {
    const company = new SprBook({ dir: join(dir, "company"), agentId: "agt", entity: "Example Co" });
    company.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" });
    const forger = new SprBook({ dir: join(dir, "forger"), agentId: "agt", entity: "Example Co" });
    forger.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 999999, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" });
    const read = (d) => (n) => existsSync(join(d, n)) ? readFileSync(join(d, n)) : null;
    forger.exportPackage(join(dir, "forged"));
    company.exportPackage(join(dir, "real"));
    const loose = spr.verifyPackage(read(join(dir, "forged")));
    assert.deepEqual([loose.ok, loose.trust], [true, "consistency-only"]);
    const pem = company.publicKey().public_pem;
    const strict = spr.verifyPackage(read(join(dir, "forged")), { expectedKeys: [pem] });
    assert.deepEqual([strict.ok, strict.trust], [false, "untrusted"]);
    assert.deepEqual([spr.verifyPackage(read(join(dir, "real")), { expectedKeys: [company.keyId] }).trust], ["expected-key"]);
    // After a rotation the company's old key still vouches for the new one.
    company.rotateKey();
    company.seal({ rail: "stripe", source_id: "pi_2", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" });
    company.exportPackage(join(dir, "rotated"));
    assert.equal(spr.verifyPackage(read(join(dir, "rotated")), { expectedKeys: [pem] }).trust, "expected-key");
    // Two writers that bypassed the lock: one record ID, two amounts. The checker fails it.
    const rec = readFileSync(join(dir, "company", "records.jsonl"), "utf8").trim().split("\n")[0];
    const files = { ...company.packageFiles() };
    // (sealed by the current key, so the seal itself checks; only the duplicate is wrong)
    const tw = JSON.parse(rec); tw.payload.amount_minor = 2000; tw.seal = spr.sealWith(tw.payload, readFileSync(join(dir, "company", "key.pem"), "utf8"));
    files["records.jsonl"] += JSON.stringify(tw) + "\n";
    const resealed = company.sealPackage(Object.fromEntries(Object.entries(files).filter(([n]) => n !== "manifest.json")));
    const dup = spr.verifyPackage((n) => resealed[n] === undefined ? null : Buffer.from(resealed[n]));
    assert.equal(dup.ok, false);
    assert.ok(dup.results.some((r) => !r.ok && /appears twice with different content/.test(r.detail)));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("the checker stays inside the package: names outside the package, absolute paths and links are refused", async () => {
  const { writeFileSync, symlinkSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "spr-paths-"));
  const cli = (args) => { try { return { code: 0, out: execFileSync(process.execPath, [fileURLToPath(import.meta.resolve("@luca-network/spr")).replace(/index\.mjs$/, "bin/spr-verify.mjs"), ...args], { encoding: "utf8" }) }; } catch (e) { return { code: e.status, out: String(e.stdout) }; } };
  try {
    const book = new SprBook({ dir: join(dir, "book"), agentId: "agt", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" });
    writeFileSync(join(dir, "secret.txt"), "not part of any package");
    const files = book.packageFiles();
    const m = JSON.parse(files["manifest.json"]);
    for (const name of ["../secret.txt", join(dir, "secret.txt"), "C:\\Windows\\win.ini", "sub/records.jsonl"]) m.package.files.push({ name, sha256: "0" });
    const exp = join(dir, "export"); book.exportPackage(exp);
    writeFileSync(join(exp, "manifest.json"), JSON.stringify(m));
    const r = cli([exp]);
    assert.equal(r.code, 1);
    assert.equal((r.out.match(/the manifest names only the package's own files/g) ?? []).length, 4);
    assert.ok(!/secret\.txt is the file the manifest names/.test(r.out));
    const exp2 = join(dir, "export2"); book.exportPackage(exp2);
    const recs = join(exp2, "records.jsonl"); writeFileSync(join(dir, "elsewhere.jsonl"), readFileSync(recs)); rmSync(recs);
    // Windows lets only administrators and Developer Mode make links; without that there is no link to refuse.
    try { symlinkSync(join(dir, "elsewhere.jsonl"), recs); } catch (e) { if (e.code === "EPERM") return; throw e; }
    const r2 = cli([exp2]);
    assert.equal(r2.code, 1);
    assert.match(r2.out, /records\.jsonl is a link/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("sending to Luca: only https, plain http only to this computer when asked, redirects refused; synced folders and published test keys refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-safe-"));
  try {
    const book = new SprBook({ dir: join(dir, "book"), agentId: "agt", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 100, currency: "USD", occurred_at: "2026-10-28T12:00:00Z" });
    const calls = [];
    const ok = async (url) => { calls.push(url); return new Response(JSON.stringify({ created: 1 }), { status: 201 }); };
    await assert.rejects(book.sendToLuca({ url: "http://luca.example", apiKey: "k", fetch: ok }), /https:\/\//);
    await assert.rejects(book.sendToLuca({ url: "http://127.0.0.1:8080", apiKey: "k", fetch: ok }), /LUCA_ALLOW_INSECURE_LOCAL/);
    assert.deepEqual(calls, []);
    assert.equal((await book.sendToLuca({ url: "http://127.0.0.1:8080", apiKey: "k", fetch: ok, allowInsecureLocal: true })).created, 1);
    await assert.rejects(book.sendToLuca({ url: "http://luca.example", apiKey: "k", fetch: ok, allowInsecureLocal: true }), /https:\/\//);
    const moved = async () => new Response(null, { status: 302, headers: { location: "http://elsewhere.example" } });
    await assert.rejects(book.sendToLuca({ url: "https://luca.example", apiKey: "k", fetch: moved }), /redirect/);
    // A book inside a synced folder is refused unless allowed.
    const synced = join(dir, "OneDrive", "books");
    assert.throws(() => new SprBook({ dir: synced, agentId: "agt", entity: "Example Co" }), /syncs to the cloud/);
    assert.ok(new SprBook({ dir: synced, agentId: "agt", entity: "Example Co", allowSyncedFolder: true }));
    // The vectors' published test keys are refused.
    const { createPrivateKey } = await import("node:crypto");
    const seed = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
    const test1 = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
    assert.throws(() => new SprBook({ dir: join(dir, "t"), agentId: "agt", entity: "Example Co", key: test1 }), /published test key/);
    // An export never replaces an earlier one unless asked, and never goes into the book's own folder.
    book.exportPackage(join(dir, "e"));
    assert.throws(() => book.exportPackage(join(dir, "e")), /already holds an export/);
    assert.equal(book.exportPackage(join(dir, "e"), { overwrite: true }).verified, true);
    assert.throws(() => book.exportPackage(join(dir, "book")), /outside the book's folder/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("a crash part way through a write: the unfinished line is set aside, the next record seals, and the book opens", async () => {
  const { appendFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "spr-torn-"));
  try {
    const at = "2026-10-31T12:00:00Z";
    new SprBook({ dir, agentId: "agt_torn", entity: "Example Co" }).seal({ rail: "stripe", source_id: "pi_one", amount_minor: 100, currency: "USD", occurred_at: at });
    appendFileSync(join(dir, "records.jsonl"), '{"payload":{"record_id":"LR-HALF');   // the process stopped here
    const b = new SprBook({ dir, agentId: "agt_torn", entity: "Example Co" });
    assert.equal(b.seal({ rail: "stripe", source_id: "pi_two", amount_minor: 200, currency: "USD", occurred_at: at }).status, "recorded");
    const lines = readFileSync(join(dir, "records.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(readFileSync(join(dir, "records.jsonl.torn"), "utf8"), '{"payload":{"record_id":"LR-HALF\n');
    assert.equal(new SprBook({ dir, agentId: "agt_torn", entity: "Example Co" }).listRecords().length, 2);
    const read = (n) => existsSync(join(dir, n)) ? readFileSync(join(dir, n)) : null;
    assert.equal(spr.verifyPackage(read).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a lock left by a process that has ended is taken back at once", async () => {
  const { writeFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { hostname } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "spr-lock-"));
  try {
    const b = new SprBook({ dir, agentId: "agt_lock", entity: "Example Co" });
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    writeFileSync(join(dir, "book.lock"), JSON.stringify({ pid: gone, host: hostname(), at: new Date().toISOString() }));
    const t0 = Date.now();
    assert.equal(b.seal({ rail: "stripe", source_id: "pi_lock", amount_minor: 100, currency: "USD", occurred_at: "2026-10-31T12:00:00Z" }).status, "recorded");
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
    assert.equal(existsSync(join(dir, "book.lock")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("export_package refuses an export folder that is a link", async () => {
  const { mkdirSync, symlinkSync } = await import("node:fs");
  const { mcpTools } = await import("@luca-network/spr-mcp");
  const dir = mkdtempSync(join(tmpdir(), "spr-link-"));
  try {
    const book = new SprBook({ dir: join(dir, "book"), agentId: "agt_link", entity: "Example Co" });
    const root = join(dir, "exports"), elsewhere = join(dir, "elsewhere");
    mkdirSync(root); mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(root, "audit"), process.platform === "win32" ? "junction" : "dir");
    const exp = mcpTools(book, { exportDir: root }).find((t) => t.name === "export_package");
    assert.throws(() => exp.run({ name: "audit" }), /is a link/);
    assert.equal(exp.run({ name: "audit-2" }).verified, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Machine Payment Profile: the optional facts are sealed only when given, and the book exports as xBRL-CSV", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "spr-mpp-"));
  try {
    // A book that gives none of them seals what it sealed before.
    const plain = new SprBook({ dir: join(dir, "plain"), agentId: "agt_p", entity: "Example Co" });
    const pi = plain.getIntent(plain.declare({ purpose: "Plain", max_amount_minor: 100, currency: "USD" }).intent_id);
    assert.deepEqual(pi.agent, { id: "agt_p", owner: null });
    assert.equal("principal" in pi || "mandate" in pi || "product" in pi, false);

    const bookDir = join(dir, "book");
    const b = new SprBook({ dir: bookDir, agentId: "agt_research", entity: "Northwind Analytics", agentType: "autonomous-agent", agentProvider: "Example Corporation",
      agentVersion: "2.3.0", entityType: "organization", entityIdentifier: "lei:5493001KJTIIGC8Y1R12" });
    writeFileSync(join(bookDir, "mandate.json"), JSON.stringify({ mandate_id: "mandate-2026-00418", issuer: "Northwind Analytics", scope: "data-acquisition", currency: "USDC", max_per_payment_minor: 50000000 }));
    const i = b.declare({ purpose: "Market data for the weekly pricing report", product: "pro-monthly", counterparty: "Veridian Data", max_amount_minor: 30000000, currency: "USDC" });
    const ip = b.getIntent(i.intent_id);
    assert.deepEqual(ip.agent, { id: "agt_research", owner: null, type: "autonomous-agent", provider: "Example Corporation", version: "2.3.0" });
    assert.deepEqual(ip.principal, { type: "organization", identifier: { scheme: "lei", value: "5493001KJTIIGC8Y1R12" } });
    assert.equal(ip.mandate.id, "mandate-2026-00418"); assert.equal(ip.mandate.issuer, "Northwind Analytics"); assert.match(ip.mandate.sha256, /^[0-9a-f]{64}$/);
    assert.equal(ip.product, "pro-monthly");

    const tx = "0x" + "ab".repeat(32), sha = "c".repeat(64), at = new Date().toISOString();
    const r = b.seal({ rail: "x402", source_id: tx, amount_minor: 24000000, currency: "USDC", occurred_at: at, intent_id: i.intent_id, counterparty: "Veridian Data", memo: "Market data API calls",
      network: "base", evidence_type: "onchain", settlement_provider: "facilitator.example", counterparty_type: "service", counterparty_id: "domain:veridian.example", receipt: { ref: "receipts/123.pdf", sha256: sha } });
    assert.equal(r.status, "recorded");
    const rec = b.records.at(-1).payload;
    assert.deepEqual(rec.evidence, { kind: "onchain", network: "base", provider: "facilitator.example", chain: "base", tx_hash: tx });
    assert.deepEqual(rec.counterparty_ref, { type: "service", identifier: { scheme: "domain", value: "veridian.example" } });
    assert.deepEqual(rec.receipt, { ref: "receipts/123.pdf", sha256: sha, kind: null });
    assert.equal(rec.principal.identifier.value, "5493001KJTIIGC8Y1R12");
    assert.equal(b.verifyRecord(r.record_id).ok, true);
    assert.throws(() => b.seal({ rail: "x402", source_id: "0x" + "cd".repeat(32), amount_minor: 1, currency: "USDC", occurred_at: at, receipt: { ref: "r", sha256: "nothex" } }), /SHA-256/);

    const out = b.exportXbrlCsv(join(dir, "xbrl"));
    assert.equal(out.rows, 1);
    const meta = JSON.parse(readFileSync(join(dir, "xbrl", "mpp-report.json"), "utf8"));
    assert.equal(meta.documentInfo.documentType, "https://xbrl.org/2021/xbrl-csv");
    const [head, row] = readFileSync(join(dir, "xbrl", "mpp-payments.csv"), "utf8").trim().split("\r\n");
    const cols = head.split(","), cells = row.split(",");
    const v = Object.fromEntries(cols.map((c, k) => [c, cells[k]]));
    assert.equal(v.paymentAmount, "24.000000"); assert.equal(v.paymentAmountMinor, "24000000"); assert.equal(v.paymentUnit, "mpp:USDC");
    assert.equal(v.principalEntity, "lei:5493001KJTIIGC8Y1R12"); assert.equal(v.mandateReference, "mandate-2026-00418"); assert.equal(v.mandateAuthority, "self-declared");
    assert.equal(v.transactionPurpose, "Market data for the weekly pricing report"); assert.equal(v.productOrServiceReference, "pro-monthly");
    assert.equal(v.intentMaximumAmount, "30.000000"); assert.equal(v.withinIntent, "true"); assert.equal(v.settlementEvidenceValue, tx); assert.equal(v.paymentNetwork, "base");
    assert.equal(v.assuranceSource, "agent"); assert.equal(v.recordHash, b.records.at(-1).seal.payload_sha256);
    for (const c of cols) assert.ok(c in meta.tableTemplates.payments.columns, c);
    assert.throws(() => b.exportXbrlCsv(join(dir, "xbrl")), /already holds/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("export_xbrl_csv: the MCP tool writes under the export folder and takes a name, never a path", async () => {
  const { mcpTools } = await import("@luca-network/spr-mcp");
  const dir = mkdtempSync(join(tmpdir(), "spr-mpp-mcp-"));
  try {
    const book = new SprBook({ dir: join(dir, "book"), agentId: "agt_x", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "pi_1", amount_minor: 1999, currency: "USD", occurred_at: "2026-10-31T12:00:00Z", counterparty: "Example, Inc." });
    const exp = mcpTools(book, { exportDir: join(dir, "exports") }).find((t) => t.name === "export_xbrl_csv");
    assert.throws(() => exp.run({ name: "../out" }), /plain folder name/);
    assert.equal(exp.run({ name: "xbrl-2026-10" }).rows, 1);
    const csv = readFileSync(join(dir, "exports", "xbrl-2026-10", "mpp-payments.csv"), "utf8");
    assert.match(csv, /"Example, Inc\."/);
    assert.match(csv, /,19\.99,1999,/);
    assert.match(csv, /iso4217:USD/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("xBRL-CSV: text that looks like a formula is written as text, and amounts are written unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-csv-"));
  try {
    const book = new SprBook({ dir: join(dir, "book"), agentId: "agt_x", entity: "Example Co" });
    book.seal({ rail: "stripe", source_id: "re_1", amount_minor: -500, currency: "USD", occurred_at: "2026-10-31T12:00:00Z",
      counterparty: '=HYPERLINK("http://example.invalid","click")', memo: "@SUM(A1:A9)" });
    book.exportXbrlCsv(join(dir, "x"));
    const csv = readFileSync(join(dir, "x", "mpp-payments.csv"), "utf8");
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/example\.invalid"",""click""\)"/);
    assert.match(csv, /,'@SUM\(A1:A9\),/);
    assert.match(csv, /,-5\.00,-500,/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("order and processor IDs: sealed when given, added later without a reason, kept on a retry, and exported to xBRL-CSV", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spr-refs-"));
  try {
    const book = new SprBook({ dir: join(dir, "book"), agentId: "agt_x", entity: "Example Co" });
    const at = "2026-11-03T12:00:00Z", base = { rail: "stripe", source_id: "pi_1", amount_minor: 1999, currency: "USD", occurred_at: at };
    book.seal(base);
    assert.equal(book.records.at(-1).payload.payment_refs, undefined);
    assert.equal(book.seal({ ...base, order_id: " ORD-1042 " }).status, "new_version");
    assert.deepEqual(book.records.at(-1).payload.payment_refs, { order_id: "ORD-1042" });
    const r3 = book.seal({ ...base, processor_transaction_id: "ch_3Pz" });
    assert.deepEqual(book.records.at(-1).payload.payment_refs, { order_id: "ORD-1042", processor_transaction_id: "ch_3Pz" });
    assert.equal(book.seal(base).status, "unchanged");
    assert.equal(book.seal({ ...base, order_id: "ORD-9999" }).status, "conflict");
    assert.equal(book.seal({ ...base, order_id: "ORD-9999", correction: { reason: "Wrong order" } }).status, "new_version");
    assert.throws(() => book.seal({ ...base, source_id: "pi_2", order_id: "x".repeat(201) }), /200 characters/);
    assert.equal(book.verifyRecord(r3.record_id).ok, true);
    book.exportXbrlCsv(join(dir, "x"));
    const [head, row] = readFileSync(join(dir, "x", "mpp-payments.csv"), "utf8").trim().split("\r\n");
    const v = Object.fromEntries(head.split(",").map((c, k) => [c, row.split(",")[k]]));
    assert.equal(v.orderReference, "ORD-9999");
    assert.equal(v.processorTransactionReference, "ch_3Pz");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the payee check: a 402 that asks to pay someone else is declined before anything is signed, whether the intent or the mandate names the payee", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "spr-payee-"));
  try {
    const ATTACKER = "0x00000000000000000000000000000000000bad00";
    // A seller whose payment request has been tampered with: it asks for the money to go to another address.
    const tampered = (seen) => {
      const real = standInSeller("10000", seen);
      return async (input, init) => {
        const res = await real(input, init);
        const h = res.headers.get("PAYMENT-REQUIRED");
        if (!h) return res;
        const { decodePaymentRequiredHeader } = await import("@x402/core/http");
        const r = decodePaymentRequiredHeader(h);
        r.accepts = r.accepts.map((a) => ({ ...a, payTo: ATTACKER }));
        return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(r) } });
      };
    };
    const book = new SprBook({ dir: join(dir, "a"), agentId: "agt_research", entity: "Example Co" });
    const account = privateKeyToAccount(generatePrivateKey());
    const seen = { signatures: [], calls: 0 };
    const pay = withLuca(book, { signer: account, fetch: tampered(seen) });
    await assert.rejects(pay("https://data.example/prices", { luca: { purpose: "Market data", max_amount_minor: 20000, currency: "USDC", payee_id: `wallet:${SELLER}` } }),
      (e) => e instanceof PaymentDeclinedByLuca && /payee_matches_intent/.test(e.message) && e.message.includes(ATTACKER));
    assert.equal(seen.signatures.length, 0, "nothing was signed");
    assert.equal(book.listRecords().length, 0);
    // The honest seller, same payee: paid, and the record names the payee's address.
    const ok = await withLuca(book, { signer: account, fetch: standInSeller("10000", seen) })("https://data.example/prices",
      { luca: { purpose: "Market data", max_amount_minor: 20000, currency: "USDC", payee_id: `wallet:${SELLER.toUpperCase().replace("0X", "0x")}` } });
    assert.equal(ok.luca.status, "paid");
    assert.deepEqual(book.records.at(-1).payload.counterparty_ref, { type: null, identifier: { scheme: "wallet", value: SELLER } });

    // With no payee in the intent, a mandate that lists its payees refuses anyone else.
    const b2 = new SprBook({ dir: join(dir, "b"), agentId: "agt_research", entity: "Example Co" });
    writeFileSync(join(dir, "b", "mandate.json"), JSON.stringify({ mandate_id: "m-1", payees: [`wallet:${SELLER}`, { id: "domain:veridian.example", name: "Veridian Data" }] }));
    await assert.rejects(withLuca(b2, { signer: account, fetch: tampered(seen) })("https://data.example/prices", { luca: { purpose: "Market data", max_amount_minor: 20000, currency: "USDC" } }),
      (e) => e instanceof PaymentDeclinedByLuca && /approved_payee/.test(e.message));
    assert.equal(seen.signatures.length, 1, "only the honest payment was ever signed");
    // check_payment on its own: no payee given against a mandate with a list is declined; one on the list is approved.
    const i = b2.declare({ purpose: "Data", max_amount_minor: 500, currency: "USD" });
    assert.equal(b2.checkPayment({ amount_minor: 100, currency: "USD", intent_id: i.intent_id }).decision, "decline");
    assert.equal(b2.checkPayment({ amount_minor: 100, currency: "USD", intent_id: i.intent_id, payee_id: "domain:Veridian.Example" }).decision, "approve");
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});

test("the duplicate check: an invoice is paid once; with duplicate_window, the same amount to the same payee is held; a retry under the same intent is not a duplicate", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "spr-dup-"));
  try {
    const book = new SprBook({ dir, agentId: "agt_ap", entity: "Example Co" });
    const at = new Date().toISOString();
    const i1 = book.declare({ purpose: "Pay invoice INV-7 from Acme", max_amount_minor: 50000, currency: "USD", payee_id: "domain:acme.example" });
    const c1 = book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: i1.intent_id, payee_id: "domain:acme.example", invoice_ref: "INV-7" });
    assert.equal(c1.decision, "approve", JSON.stringify(c1.reasons));
    // The same intent asking again (a retry after a timeout) is not a duplicate.
    assert.equal(book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: i1.intent_id, payee_id: "domain:acme.example", invoice_ref: "INV-7" }).decision, "approve");
    book.seal({ rail: "stripe", source_id: "pi_inv7", amount_minor: 42000, currency: "USD", occurred_at: at, intent_id: i1.intent_id,
      counterparty: "Acme", counterparty_id: "domain:acme.example", invoice_ref: "INV-7" });
    assert.equal(book.records.at(-1).payload.payment_refs.invoice_ref, "INV-7");
    // Another intent for the same invoice: declined, naming the record that paid it.
    const i2 = book.declare({ purpose: "Pay Acme invoice INV-7", max_amount_minor: 50000, currency: "USD" });
    const c2 = book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: i2.intent_id, payee_id: "domain:acme.example", invoice_ref: " INV-7 " });
    assert.equal(c2.decision, "decline");
    assert.match(c2.reasons.join(";"), /not_already_paid: Invoice INV-7 was already paid: LR-STRIPE-/);
    // A different invoice from the same payee is fine while the book has no duplicate_window.
    assert.equal(book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: i2.intent_id, payee_id: "domain:acme.example", invoice_ref: "INV-8" }).decision, "approve");

    writeFileSync(join(dir, "mandate.json"), JSON.stringify({ mandate_id: "m-ap", duplicate_window: "P1D" }));
    const i3 = book.declare({ purpose: "Pay Acme again", max_amount_minor: 50000, currency: "USD" });
    const c3 = book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: i3.intent_id, payee_id: "domain:acme.example" });
    assert.equal(c3.decision, "decline");
    assert.match(c3.reasons.join(";"), /not_a_repeat: The same amount to domain:acme\.example within P1D/);
    assert.equal(book.checkPayment({ amount_minor: 41999, currency: "USD", intent_id: i3.intent_id, payee_id: "domain:acme.example" }).decision, "approve");
    writeFileSync(join(dir, "mandate.json"), JSON.stringify({ duplicate_window: "one day" }));
    assert.throws(() => book.checkPayment({ amount_minor: 1, currency: "USD", intent_id: i3.intent_id, payee_id: "domain:acme.example" }), /duplicate_window/);
    // Every check is sealed and the book still checks.
    writeFileSync(join(dir, "mandate.json"), JSON.stringify({}));
    assert.equal(book.exportPackage(join(dir, "..", `${dir.split(/[\\/]/).pop()}-export`)).verified, true);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); rmSync(`${dir}-export`, { recursive: true, force: true }); }
});

test("a merchant's dispute pack: the buyer's sealed intent checks with the buyer's key, and the pack checks with the SPR library alone", async () => {
  const { writeFileSync } = await import("node:fs");
  const { verifyPackage } = await import("@luca-network/spr");
  const dir = mkdtempSync(join(tmpdir(), "spr-dispute-"));
  try {
    // The buyer's agent declares the purchase in the buyer's own book.
    const buyer = new SprBook({ dir: join(dir, "buyer"), agentId: "agt_buyer", entity: "Northwind Analytics" });
    const i = buyer.declare({ purpose: "Annual data licence from Example Store", max_amount_minor: 25000, currency: "USD", payee_id: "domain:store.example" });
    const sealedIntent = { payload: buyer.intents.get(i.intent_id).payload, seal: buyer.intents.get(i.intent_id).seal };
    const buyerKey = { public_pem: buyer.publicKey().public_pem, entity: "Northwind Analytics" };

    // The merchant records the payment it received, with the buyer's intent presented at checkout.
    const shop = new SprBook({ dir: join(dir, "shop"), agentId: "agt_checkout", entity: "Example Store" });
    const at = new Date().toISOString();
    const sale = { rail: "stripe", source_id: "pi_shop_1", amount_minor: 19999, currency: "USD", occurred_at: at, direction: "inflow", counterparty: "Northwind Analytics",
      order_id: "ORD-1042", processor_transaction_id: "ch_3PzSHOP" };
    // A changed intent, or one checked with another key, is refused and nothing is sealed.
    assert.throws(() => shop.seal({ ...sale, buyer_intent: { ...sealedIntent, payload: { ...sealedIntent.payload, max_amount_minor: 99999 } }, buyer_key: buyerKey }), /does not check/);
    assert.throws(() => shop.seal({ ...sale, buyer_intent: sealedIntent, buyer_key: { public_pem: shop.publicKey().public_pem } }), /not by the buyer key given/);
    assert.equal(shop.listRecords().length, 0);
    const r = shop.seal({ ...sale, buyer_intent: sealedIntent, buyer_key: buyerKey,
      buyer_authentication: { method: "3ds", result: "authenticated", reference: "3ds-tx-77f1", eci: "05", provider: "Stripe", at } });
    assert.equal(r.status, "recorded");
    const rec = shop.records.at(-1).payload;
    assert.equal(rec.buyer_intent.intent_id, i.intent_id);
    assert.equal(rec.buyer_intent.key_id, buyer.keyId);
    assert.equal(rec.buyer_intent.within_intent, true);
    assert.equal(rec.buyer_authentication.method, "3ds"); assert.equal(rec.buyer_authentication.eci, "05");
    assert.equal(Date.parse(rec.buyer_authentication.at), Date.parse(at));
    assert.throws(() => shop.seal({ ...sale, source_id: "pi_x", buyer_authentication: { method: "fax", result: "ok" } }), /method is one of/);

    // The dispute pack, with delivery, checks with the merchant's key and the buyer's.
    const out = shop.exportDisputePack(r.record_id, join(dir, "dispute"), { delivery: { method: "digital", delivered_at: at, reference: "download-5521" } });
    assert.equal(out.verified, true, JSON.stringify(out));
    assert.match(out.summary, /order ORD-1042, processor transaction ch_3PzSHOP/);
    assert.match(out.summary, /Northwind Analytics, through its agent agt_buyer/);
    assert.match(out.summary, /passed declared before payment/);
    assert.match(out.summary, /Buyer authentication: 3ds, authenticated, reference 3ds-tx-77f1, ECI 05, by Stripe/);
    const read = (n) => existsSync(join(dir, "dispute", n)) ? readFileSync(join(dir, "dispute", n)) : null;
    const v = verifyPackage(read, { expectedKeys: [shop.keyId], buyerKeys: [buyer.keyId] });
    assert.equal(v.ok, true, JSON.stringify(v.results.filter((x) => !x.ok)));
    assert.deepEqual(v.buyer_signers, [buyer.keyId]);
    assert.equal(v.trust, "expected-key");
    // Another buyer key expected: fails. An edited summary: fails.
    assert.equal(verifyPackage(read, { expectedKeys: [shop.keyId], buyerKeys: [shop.keyId] }).ok, false);
    writeFileSync(join(dir, "dispute", "summary.txt"), out.summary.replace("authenticated", "verified"));
    assert.equal(verifyPackage(read, { expectedKeys: [shop.keyId] }).ok, false);
    // The merchant's whole book, buyer intents included, still exports and checks.
    assert.equal(shop.exportPackage(join(dir, "shop-export")).verified, true);

    // Over the buyer's cap: recorded, marked outside the intent, and the summary says which check failed.
    const r2 = shop.seal({ ...sale, source_id: "pi_shop_2", amount_minor: 30000, buyer_intent: sealedIntent, buyer_key: buyerKey });
    assert.equal(shop.records.at(-1).payload.buyer_intent.within_intent, false);
    assert.match(shop.exportDisputePack(r2.record_id, join(dir, "dispute2")).summary, /FAILED within intent cap/);
    // A buyer's intent added after the payment was first recorded: a new version, no reason needed.
    shop.seal({ ...sale, source_id: "pi_shop_3" });
    assert.equal(shop.seal({ ...sale, source_id: "pi_shop_3", buyer_intent: sealedIntent, buyer_key: buyerKey }).status, "new_version");
    assert.throws(() => shop.exportDisputePack("LR-NOPE-v1", join(dir, "d3")), /No record/);
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 10 }); }
});
