# Tutorial 01: What Is a Sealed Payment Record?

**Audience:** Anyone  
**Time:** 10 minutes  
**Next:** [Creating Your First SPR Book](02-creating-your-first-spr-book.md)

---

## The problem

AI agents make payments — for API calls, compute, data, subscriptions. These payments need to be:

1. **Tamper-evident** — no one can change the amount after the fact
2. **Auditable** — an accountant can verify what was paid and when
3. **Portable** — the record works across payment rails and accounting systems

A database row can be edited. An email can be forged. A PDF receipt can be altered. None of these
provide cryptographic tamper-evidence.

## The solution: sealed payment records

An SPR (Sealed Payment Record) is a JSON document that is signed with an Ed25519 key using
RFC 8785 canonical JSON serialisation. Once sealed, any change to any field — even whitespace —
invalidates the signature.

```json
{
  "id": "spr_0191abc...",
  "amount": 1500,
  "currency": "USD",
  "ts": "2026-10-30T12:00:00.000Z",
  "intent": "Claude API call — image generation",
  "seal": {
    "alg": "ed25519",
    "kid": "k1",
    "sig": "base64url..."
  }
}
```

## What "sealed" means

The `seal.sig` is an Ed25519 signature over the canonical JSON of the record **without** the `seal`
field. To verify a record:

1. Remove the `seal` field
2. Serialize the remaining fields in RFC 8785 canonical order
3. Verify the signature against the public key identified by `seal.kid`

If the signature is valid, the record is exactly as the signer created it. The `verifySeal`
function in `packages/spr/index.mjs` does this in a few lines.

## What "sealed" does NOT mean

A valid seal proves data integrity — not payment settlement.

- The paying agent created a record with those fields ✓
- The record has not been modified ✓
- The payment was sent to a payment rail ✗
- The payment settled ✗

See [Capability Provenance](CAPABILITY_PROVENANCE.md) for the full trust boundary.

## The SPR book

Records are organised into a **book** — a local directory managed by `SprBook`. A book has:

- A private key (`key.pem`) for signing new records
- An append-only log of sealed records (`records/`)
- A manifest that tracks all records in the book

Multiple books can exist side by side; each has its own independent key.

## Summary

- SPR = JSON record + Ed25519 signature
- Sealed = tamper-evident via cryptographic signature
- Book = local directory of sealed records
- Seal proves data integrity; settlement requires hosted Luca

---

**Next:** [Creating Your First SPR Book](02-creating-your-first-spr-book.md)
