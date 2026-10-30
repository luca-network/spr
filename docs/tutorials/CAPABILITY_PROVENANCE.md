# Capability Provenance — What Local SPR Can and Cannot Claim

This document defines the trust boundary for the local SPR SDK. It is critical reading before
presenting SPR-backed accounting data to auditors, finance teams, or regulators.

---

## What a sealed SPR record proves

| Claim | Proven? | How |
|-------|---------|-----|
| The record was created with specific fields (amount, currency, recipient, timestamp) | **Yes** | Ed25519 seal over RFC 8785 canonical JSON |
| The record has not been modified since it was created | **Yes** | Signature verification (`verifySeal`) |
| The record belongs to a specific package (Merkle root) | **Yes** | `verifyPackage` checks Merkle inclusion |
| The payment was sent to a payment rail | **No** | Local SPR has no network access |
| The payment was received by the payee | **No** | — |
| The payment settled and was not reversed | **No** | — |

**Settlement confidence is always `unconfirmed` in local SPR.**

Only hosted Luca can set `rail_matched` by cross-referencing SPR records with payment rail responses.

---

## What an accounting export proves

| Claim | Proven? | How |
|-------|---------|-----|
| The classification was derived from a sealed record | **Yes** | `verification-report.json` cross-references each record's seal validity |
| The journal entries balance (debits = credits per record) | **Yes** | Enforced by `generateDraftJournal`; test coverage in `accounting.test.mjs` |
| The CSV files are complete and unmodified | **Yes** (integrity only) | SHA-256 hashes in `accounting-export-manifest.json` |
| The accounting treatment is correct for your jurisdiction | **No** | GAAP/IFRS references are illustrative; consult a qualified accountant |
| The journal has been posted to your ERP | **No** | POSTED status is intentionally absent; ERP writes are out-of-scope |

---

## What `VERIFIED_EVIDENCE` journal status means

A journal entry with `status: "VERIFIED_EVIDENCE"` means:

> The Ed25519 seal on the underlying SPR record verified successfully. The journal is a
> draft based on verified source data.

It does **not** mean:
- The payment settled on the payment rail
- The accounting treatment has been approved by a qualified accountant
- The journal has been reviewed or posted

---

## GAAP and IFRS references

Account codes and taxonomy references in classification results are marked as:

```
taxonomy_note: "illustrative/unverified — consult qualified accountant for jurisdiction-specific treatment"
```

They are provided as starting points for a GL mapping exercise, not as authoritative accounting opinions.

---

## Data security reminders

- Private signing keys (`key.pem`) are never included in any export file.
- Export files contain payment amounts, recipients, and timestamps — treat them as sensitive financial data.
- Apply appropriate filesystem permissions and access controls to export directories.
- Retention policies for accounting export files must comply with your jurisdiction's financial record-keeping requirements.

---

## References

- `README.md` — local SPR vs hosted Luca capability matrix
- `docs/adr/0003-settlement-evidence-trust-model.md`
- `docs/adr/0001-immutable-spr-core-vs-accounting-derivatives.md`
- `packages/spr-sdk/contracts.mjs` — `JournalStatus`, `SettlementConfidence`
