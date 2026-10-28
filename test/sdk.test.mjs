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
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
