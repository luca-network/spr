# Tutorial 12: Settlement Confidence and What It Means

**Audience:** Anyone  
**Time:** 10 minutes  
**Prev:** [ERP Import — SAP FI Sample](11-erp-import-sap-fi.md)  
**Next:** [Python SDK — Classify and Export](13-python-sdk-classify-and-export.md)

---

## The question auditors always ask

"This journal entry is backed by a sealed payment record. Does that mean the payment settled?"

The short answer is: **not necessarily**.

## What a valid seal proves

A valid Ed25519 seal proves:

1. An AI agent created a record with these exact fields at this timestamp
2. The record has not been modified since it was sealed

It does NOT prove that money moved on a payment rail.

## Settlement confidence levels

| Level | Meaning | Who sets it |
|-------|---------|------------|
| `unconfirmed` | Seal valid; no rail evidence | All local SPR exports |
| `rail_matched` | SPR matched to a payment rail response | Hosted Luca only |
| `disputed` | A reversal or dispute has been flagged | Hosted Luca only |

Local SPR exports always show `unconfirmed`. This is correct and expected.

## What `VERIFIED_EVIDENCE` journal status means

```
journal_status: "VERIFIED_EVIDENCE"
```

This means: **the Ed25519 seal on the source record verified successfully**.

It does NOT mean: the payment settled, the accounting treatment is approved, or the entry has been reviewed.

Think of it as: "the source document is authentic" — analogous to a receipted invoice vs an
unconfirmed bank transfer.

## How to get `rail_matched`

Rail confirmation requires [hosted Luca](https://luca.records). Hosted Luca:

1. Receives the sealed SPR record from the AI agent
2. Submits the payment to the payment rail
3. Matches the rail response back to the SPR record
4. Returns `settlement_confidence: "rail_matched"` when the rail confirms the payment

See `README.md` for the full local vs hosted capability matrix.

## Accounting implications

For most internal control purposes, `VERIFIED_EVIDENCE` + `unconfirmed` means:

- ✓ The expense claim is backed by a tamper-evident source document
- ✓ The amount, date, and intent are cryptographically bound to the record
- ✗ Bank reconciliation requires rail confirmation (use hosted Luca or manual bank statement matching)
- ✗ Settlement risk is not eliminated by the seal

Work with your accountant to determine whether `VERIFIED_EVIDENCE` meets your internal control
requirements or whether rail confirmation (`rail_matched`) is needed.

---

**Next:** [Python SDK — Classify and Export](13-python-sdk-classify-and-export.md)
