// x402 with SPR: one wrapped fetch that declares the intent, checks the payment, binds it to the intent on
// chain and seals the record, around the standard x402 client.
//
//   const pay = withLuca(book, { signer: account });
//   const res = await pay(url, { luca: { purpose: "Market data for the pricing model", max_amount_minor: 20000, currency: "USDC" } });
//   res.luca.record   // the sealed record
//
// The payer signs an EIP-3009 authorization whose nonce is the intent's fingerprint (SPR section 5), so the
// chain's AuthorizationUsed event records which intent it was paid under, and whose signature expires no later
// than the intent. Sellers and facilitators change nothing. A seller asking for Permit2 is paid with the
// standard client and the record says the payment is unbound.
//
// Needs @x402/fetch, @x402/evm, @x402/core and viem (peer dependencies).
import { getAddress } from "viem";
import { ExactEvmScheme, authorizationTypes, findDefaultAsset } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader } from "@x402/core/http";

export class PaymentDeclinedByLuca extends Error {
  constructor(checkId, reasons) { super(`The payment was declined (${checkId}): ${reasons.join("; ")}`); this.checkId = checkId; this.reasons = reasons; }
}

const chainIdOf = (network) => {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) throw new Error(`Not an EVM network in CAIP-2 form: ${network}`);
  return Number(m[1]);
};

// An x402 "exact" client for EVM that binds the payment to an intent: the nonce is the intent's fingerprint,
// and the signature ends no later than the intent. binding.check, when given, is asked before anything is signed.
export class IntentBoundExactEvmScheme {
  scheme = "exact";
  // The x402 client's spend controls accept only assets the scheme recognises as defaults (USDC per network).
  findDefaultAsset = findDefaultAsset;
  lastBound = false;

  constructor(signer, binding) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(binding?.nonce ?? "")) throw new Error("binding nonce must be 32 bytes in hex");
    this.signer = signer;
    this.binding = binding;
    this.fallback = new ExactEvmScheme(signer);
  }

  async createPaymentPayload(x402Version, requirements, context) {
    const method = requirements.extra?.assetTransferMethod ?? "eip3009";
    if (this.binding.check) {
      const r = await this.binding.check({ amount: String(requirements.amount), payTo: requirements.payTo, asset: requirements.asset,
        network: requirements.network, nonce: method === "eip3009" ? this.binding.nonce : null });
      if (r.decision !== "approve") throw new PaymentDeclinedByLuca(r.id, r.reasons ?? []);
    }
    if (method !== "eip3009") {
      this.lastBound = false;
      return this.fallback.createPaymentPayload(x402Version, requirements, context);
    }
    if (!requirements.extra?.name || !requirements.extra?.version)
      throw new Error(`EIP-712 domain (name, version) missing from the requirements for ${requirements.asset}`);
    const now = Math.floor(Date.now() / 1000);
    let validBefore = now + Number(requirements.maxTimeoutSeconds);
    if (this.binding.expiresAt) validBefore = Math.min(validBefore, Math.floor(Date.parse(this.binding.expiresAt) / 1000));
    if (validBefore <= now) throw new Error("The intent has expired; declare a new one before paying");
    const authorization = {
      from: this.signer.address, to: getAddress(requirements.payTo), value: String(requirements.amount),
      validAfter: "0", validBefore: String(validBefore), nonce: this.binding.nonce,
    };
    const signature = await this.signer.signTypedData({
      domain: { name: requirements.extra.name, version: requirements.extra.version, chainId: chainIdOf(requirements.network),
        verifyingContract: getAddress(requirements.asset) },
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: getAddress(authorization.from), to: authorization.to, value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore), nonce: authorization.nonce,
      },
    });
    this.lastBound = true;
    return { x402Version, payload: { authorization, signature } };
  }
}

// fetch, wrapped: every call that names `luca` in its options is declared, checked, paid bound to its intent
// and sealed in the book. A call without `luca` is passed through unchanged.
//   options.signer   the payer's account (viem LocalAccount or anything with address and signTypedData)
//   options.fetch    the fetch to call underneath (default: the global fetch)
//   options.bind     sign with the intent's nonce (default true); false uses the standard client
export function withLuca(book, options) {
  if (!options?.signer) throw new Error("withLuca needs the payer's signer");
  const baseFetch = options.fetch ?? globalThis.fetch;
  const bind = options.bind ?? true;
  return async function pay(input, init = {}) {
    const { luca, ...rest } = init;
    if (!luca) return baseFetch(input, rest);
    const currency = (luca.currency ?? "USDC").toUpperCase();
    const intent = book.declare({ purpose: luca.purpose, counterparty: luca.counterparty, max_amount_minor: luca.max_amount_minor,
      expected_amount_minor: luca.expected_amount_minor, currency, rail: "x402", terms: luca.terms, expires_in: luca.expires_in ?? "PT1H" });
    const nonce = book.nonceFor(intent.intent_id);
    // The fetch underneath is tapped so the book sees the seller's requirements and the payer's authorization.
    let required = null, signed = null;
    const tap = async (i, ini) => {
      const req = new Request(i, ini);
      const sig = req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT");
      if (sig) signed = decodePaymentSignatureHeader(sig);
      const res = await baseFetch(req);
      const h = res.status === 402 ? res.headers.get("PAYMENT-REQUIRED") : null;
      if (h) required = decodePaymentRequiredHeader(h);
      return res;
    };
    // The x402 client wraps errors in its own, so a decline is kept here and rethrown as itself.
    let declined = null;
    const check = async (r) => {
      const c = book.checkPayment({ amount_minor: Number(r.amount), currency, counterparty: luca.counterparty ?? r.payTo,
        intent_id: intent.intent_id, nonce: r.nonce,
      });
      if (c.decision !== "approve") declined = c;
      return c;
    };
    const client = bind ? new IntentBoundExactEvmScheme(options.signer, { nonce, expiresAt: intent.expires_at, check }) : new ExactEvmScheme(options.signer);
    if (!bind) {
      const r = await check({ amount: String(luca.expected_amount_minor ?? luca.max_amount_minor ?? 0), payTo: luca.counterparty ?? "", nonce: null });
      if (r.decision !== "approve") { book.cancelIntent(intent.intent_id, `Declined by the pre-payment check ${r.id}`); throw new PaymentDeclinedByLuca(r.id, r.reasons); }
    }
    const paid = wrapFetchWithPaymentFromConfig(tap, { schemes: [{ network: "eip155:*", client }] });
    let res;
    try {
      res = await paid(input, rest);
    } catch (e) {
      if (declined) {
        book.cancelIntent(intent.intent_id, `Declined by the pre-payment check ${declined.id}`);
        throw new PaymentDeclinedByLuca(declined.id, declined.reasons);
      }
      book.cancelIntent(intent.intent_id, `Payment failed: ${String(e?.message ?? e).slice(0, 200)}`);
      throw e;
    }
    const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    const settled = header ? decodePaymentResponseHeader(header) : null;
    const accepted = signed?.accepted ?? required?.accepts?.[0] ?? null;
    if (!settled?.transaction || !accepted) {
      book.cancelIntent(intent.intent_id, required ? `Payment did not complete (HTTP ${res.status})` : "No payment was asked for");
      Object.defineProperty(res, "luca", { value: { intent, record: null, status: required ? "not_paid" : "free" } });
      return res;
    }
    const auth = signed?.payload?.authorization ?? null;
    const record = book.seal({
      rail: "x402", source_id: settled.transaction, amount_minor: Number(settled.amount ?? accepted.amount), currency,
      occurred_at: new Date().toISOString(), counterparty: luca.counterparty ?? accepted.payTo, intent_id: intent.intent_id,
      nonce: auth?.nonce ?? null, state: settled.success ? "cleared" : "pending",
      evidence: { network: settled.network ?? accepted.network, payer: settled.payer ?? options.signer.address, payee: accepted.payTo,
        asset: accepted.asset, resource: required?.resource?.url ?? String(input), transaction: settled.transaction },
    });
    Object.defineProperty(res, "luca", { value: { intent, record, status: "paid" } });
    return res;
  };
}
