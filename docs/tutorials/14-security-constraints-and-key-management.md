# Tutorial 14: Security Constraints and Key Management

**Audience:** All  
**Time:** 20 minutes  
**Prev:** [Python SDK — Classify and Export](13-python-sdk-classify-and-export.md)

---

## The most important rule

**Never expose, export, or log the `key.pem` private key.**

The private key is what makes SPR seals trustworthy. If it is compromised:

- Anyone can create forged records that appear to be legitimately sealed
- Historical records cannot be distinguished from forgeries without an out-of-band audit trail
- The book must be considered compromised and rotated

## Where the key is stored

```
{bookDir}/key.pem   ← Ed25519 private key in PEM format
```

This file is created once when `SprBook.open()` is first called. It is never transmitted over
the network by the local SDK.

## What NEVER belongs in export files

The following must never appear in any export file:

| Item | Risk if exposed |
|------|----------------|
| `key.pem` contents | Allows forging records |
| Any private key bytes | — |
| Access tokens or credentials | Authorised access to external services |
| Production payment details beyond what's in the sealed record | PII / compliance risk |

The test `"no private key in export"` in `test/accounting.test.mjs` verifies this invariant.

## Claude Code hook protection

The `check-key-read.sh` hook warns or blocks Claude Code operations targeting `key.pem`:

- **Read** `key.pem` → advisory warning (reading is permitted; logs are not)
- **Write/Edit** `key.pem` → blocked (the hook exits 2)

This is a defence-in-depth measure. The real protection is not including key material in any
function that produces export output.

## Key rotation

Rotate the key when:

- The book directory or host machine may have been compromised
- A team member with key access has left the organisation
- Your security policy requires periodic rotation

```js
await book.rotateKey();
// New key is active for new records
// Old key(s) retained in keyring for verifying historical records
```

Old keys are kept in a keyring inside the book directory. Historical records sealed with an old
key remain verifiable after rotation.

## Filesystem permissions

- `key.pem` should be readable only by the process that runs the SPR SDK
- Set permissions: `chmod 600 {bookDir}/key.pem`
- Export directories may contain payment amounts and timestamps — treat as sensitive financial data
- Apply retention policies as required by your jurisdiction

## Multi-tenant deployments

Each tenant must have a separate book directory with its own `key.pem`. Never share a book
directory between tenants. See [ADR 0006](../adr/0006-tenant-isolation-and-retention.md).

## What NOT to do

| Do NOT | Why |
|--------|-----|
| Commit `key.pem` to version control | Exposes key to all repo viewers; persists in git history |
| Include `key.pem` path in `.env` files committed to git | Same risk |
| Log the key value for debugging | Logs are often shipped to observability tools |
| Store the key in an environment variable in CI | CI logs may be retained or shared |
| Use the same key across multiple tenants | Key compromise affects all tenants |

## Production key management

For production deployments, consider:

- **Hardware Security Module (HSM)** — key never leaves hardware
- **Cloud KMS** (AWS KMS, GCP Cloud KMS, Azure Key Vault) — managed key storage with audit logs
- **Secrets manager** (HashiCorp Vault, AWS Secrets Manager) — application-layer key retrieval

The SPR SDK supports custom key providers; contact Luca for enterprise key management options.

---

**You've completed the SPR Accounting Export tutorial series.**

See [Capability Provenance](CAPABILITY_PROVENANCE.md) for a summary of what local SPR can
and cannot claim before sharing export files with auditors or finance teams.
