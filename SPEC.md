# SPR: the Sealed Payment Record

Draft 1 · 28 October 2026 · `spr/draft-1`

SPR is a format for the accounting record of a payment made or received by a software agent. This document defines how a record is written, sealed and checked, so that any party can make one or check one without Luca. Luca's hosted service, Luca's MCP server in local mode and the reference library in this repository all follow it. The test vectors in `packages/spr/vectors/vectors.json` are part of the format: an implementation conforms when it gives the same answers on them.

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

**Names inside the format.** The identifiers a record carries keep the names they were first sealed with: `luca.record`, `luca.intent`, `luca.label/1`, `luca.seal/1` and `luca.intent-nonce/1`. They sit inside every seal and every nonce already made, so renaming them would change every hash. They identify the format's schemas and say nothing about who made a record.

**License.** The reference library, the checker and the test vectors are released under the Apache License 2.0, which includes a patent license for that code. The methods in sections 5 and 7 and the audit package in section 8 are patent pending. Luca will not assert those patents against any implementation of this format, including one written without the reference code, on the terms in `PATENTS.md`. The commitment ends for anyone who brings a patent claim against an implementation of this format.

**SPR-compatible.** An implementation may describe itself as SPR-compatible when it passes every vector of the draft it names.

## 1. Canonical JSON

Every sealed object is serialized as canonical JSON before it is hashed or signed. The rules are those of RFC 8785 (JSON Canonicalization Scheme) for the value types the format allows:

- strings, written as ECMAScript's `JSON.stringify` writes them;
- integers, which MUST be safe integers (between −(2^53 − 1) and 2^53 − 1). A number with a fraction MUST be rejected, never rounded. Money is always an integer count of the currency's minor unit;
- `true`, `false` and `null`;
- arrays, in their order;
- objects, with members sorted by the UTF-16 code units of their names, and no whitespace anywhere. For a name holding a character outside the basic plane (an emoji, written as a surrogate pair), this order differs from sorting by code point, which is the default in some languages, including Python; the vectors include such a case.

A member whose value is undefined (absent in the producer's language) is left out. A member whose value is `null` is kept.

A rail's own payload is not sealed in this form, since rails send fractions. Where a record refers to it, it carries `source.payload_sha256`: the SHA-256 of the payload written as JSON with object members sorted by name and numbers as JSON writes them.

## 2. Hashes

SHA-256, written as 64 lower-case hexadecimal characters. Text is hashed as UTF-8. The payload hash of an object is the SHA-256 of its canonical JSON.

## 3. Keys and seals

**Keys.** A seal key is Ed25519. Its key ID is `ed25519:` followed by the first 16 hexadecimal characters of the SHA-256 of the base64 text of the public key's SubjectPublicKeyInfo (DER).

**Algorithms.** A seal names one of two algorithms:

- `ed25519`: the Ed25519 signature over the canonical JSON itself;
- `ed25519-digest`: the Ed25519 signature over the UTF-8 text `luca.seal/1:` followed by the payload hash. This is for keys held in a hardware security module or a cloud key service that signs only a few kilobytes. It binds the same content.

A reader that registered a key with its algorithm SHOULD use that algorithm, whatever the seal says.

**The seal object:**

| Member | Meaning |
|---|---|
| `payload_sha256` | the payload hash |
| `signature` | the signature, in standard base64 |
| `key_id` | the key ID of the key that signed |
| `algorithm` | `ed25519` or `ed25519-digest`; `ed25519` when absent |

A sealed object travels as `{ "payload": …, "seal": … }`. Luca's own exports and audit packages keep the same three values as columns beside the payload (`payload_hash`, `signature`, `key_id`); they mean the same.

**Checking a seal.** Recompute the canonical JSON of the payload and its hash; the hash MUST equal `payload_sha256`. Find the public key whose key ID is `key_id`; the signature MUST verify with it under the algorithm. A seal is good only when all three hold.

The public keys of a company are published as a list of `{ key_id, algorithm, public_pem }`, including retired keys, so old records stay checkable.

**Handing over to a new key.** A company that replaces its key adds the new key to the list with a `rotation` member: `{ payload, seal }`, where the payload is

| Member | Meaning |
|---|---|
| `schema` | `luca.key-rotation/0.1` |
| `from` | the key ID of the key handed over from |
| `to` | the key ID of the new key |
| `to_public_pem` | the new public key |
| `at` | when, an ISO 8601 instant |
| `entity` | the company |
| `reason` | optional: why |

and the seal is made with the key named in `from`. A reader that trusts the earlier key MAY trust the new one on the strength of the handover. A handover is good only when its seal checks with the earlier key, `to` is the key ID of `to_public_pem`, and both match the key it is attached to. Records sealed with the earlier key stay checkable with its public key.

## 4. Merkle trees

The format uses one Merkle tree construction for evidence, for a journal entry's commitment to its records and for packages.

- Leaves are payload hashes, in hexadecimal.
- A parent is the SHA-256 of the bytes of the left child followed by the bytes of the right child.
- An odd node at the end of a level is carried up to the next level unchanged.
- The root of no leaves is the SHA-256 of the empty string.

**A path** from a leaf to the root is a list of steps `{ sibling, side }`, where `side` is `right` when the sibling sits to the right. Hashing the leaf up the path in order MUST give the root.

**A journal entry's records root** is the Merkle root over the payload hashes of the records the entry carries, taken in order of record ID.

## 5. Intents and the intent nonce

An intent is what an agent declares before paying. It is sealed with the company's key.

**Core fields of an intent (schema `luca.intent/<major>.<minor>`):**

| Field | Rule |
|---|---|
| `schema` | `luca.intent/` and a version |
| `intent_id` | a non-empty string, unique to the company, with enough randomness that the intent cannot be guessed |
| `purpose` | why the payment is made, in a sentence |
| `declared_at` | an ISO 8601 instant with its offset |
| `expires_at` | an ISO 8601 instant with its offset |
| `max_amount_minor` | the most the agent may pay under it, a positive integer, or null |
| `currency` | the cap's currency, or null |

An intent MAY also carry the agent, the mandate, the counterparty, the expected amount, the rail, the rail reference, the exact terms of the purchase and the pre-check against the mandate.

**What a check against a book's own limits shows.** A company's book MAY hold limits for its agent (`mandate.json` in the SDKs). Whoever keeps the book writes them, so a check against them shows that the agent stayed inside limits the book declares. Producers report it as `authority: "self-declared"`, and `"none"` where the book holds no limits. It does not show that anyone else granted that authority. Authority granted by another party needs that party's own record or signature: a mandate approved in a hosted service, or one signed with a principal's key.

**The intent nonce.** Where a rail lets the payer choose a value that the rail records at settlement (the nonce of an EIP-3009 transfer authorization, a Permit2 nonce or witness, a memo, a payment reference), the payer MAY use the intent nonce:

```
nonce = "0x" + SHA-256( "luca.intent-nonce/1:" + intent payload hash + ":" + seq )
```

`seq` is written in decimal: 0 for a single payment, and 1, 2 and so on where one intent covers several. The intent payload hash is written in lower-case hexadecimal. The nonce is 32 bytes and reveals nothing about the intent.

Anyone holding the sealed intent recomputes the nonce and compares it with the value the rail recorded, with no need to trust the company or the agent. A payment whose recorded value equals the nonce is **bound** to the intent. A payment that names an intent but carries another value is **unbound**.

## 6. Records

A record is the company's own accounting record of one payment. It is sealed with the company's key and never edited: a correction is a new version.

**Core fields (schema `luca.record/<major>.<minor>`):**

| Field | Rule |
|---|---|
| `schema` | `luca.record/` and a version |
| `record_id` | a non-empty string. Luca's form is `LR-<RAIL>-<10 hex characters>-v<version>`, the hex taken from a SHA-256 over the rail and the source reference (with the entity and tenant where there are several), so every version of one payment shares it |
| `version` | an integer from 1 |
| `supersedes` | null for version 1; for a later version, the `record_id` of the version it replaces |
| `entity` | the company whose record this is |
| `rail` | the payment rail: `x402`, `tempo`, `stripe`, `ramp`, `mpp`, `ap2`, `mastercard` and so on |
| `direction` | `outflow` (money out of the entity) or `inflow` |
| `source.id` | the rail's own reference for the payment: transaction hash, charge ID, network transaction ID |
| `state` | the payment's state: `cleared`, `pending`, `refunded` and so on |
| `amount_minor` | what moved on the rail to or from the entity, an integer in the currency's minor unit (cents; 6 decimals for USDC) |
| `currency` | the currency or token |
| `occurred_at` | an ISO 8601 instant with its offset, or null where the rail gives no time. A producer MUST refuse a time given without an offset rather than read it in its own time zone. Where no time is given it MAY use the time of sealing, and then SHOULD say so in `occurred_at_source` |
| `settled_on` | the accounting date, `YYYY-MM-DD`, in the entity's time zone, or null |
| `intent.intent_id` | where the payment was made under an intent: the intent's ID, with `intent.payload_sha256` its sealed hash |

A record MAY carry any other member. Luca's records carry, among others:

- the agent and how its registration was approved;
- the mandate check, the match to the intent and the consent check (declared before payment, before expiry, not withdrawn, within the cap, and the binding status);
- the rail's own authorization;
- the classification to nature, function and account, with US GAAP and IFRS elements and the tax view;
- FX, intercompany, disputes, revenue recognition, and the delivered terms compared with those declared.

A reader MUST keep members it does not understand, because the seal covers them.

**Corrections.** When the facts of a payment change (the rail confirms a different amount, a classification is corrected), the producer seals a new version with `version` one higher and `supersedes` naming the version replaced. In a set of records, every version a record names in `supersedes` SHOULD be present, and the current version of a payment is the one no other version supersedes.

Where the payments come from an agent and not from a rail's own feed, a changed retry and a deliberate correction look alike. Such a producer SHOULD return the sealed record unchanged when it is given the same facts again. It SHOULD refuse different facts for a payment already sealed unless the caller gives a reason, and seal that reason in the new version as `correction.reason`. A pending payment that clears needs no reason.

## 7. Two-sided labels

A label carries the fields of one payment that both sides book the same way. The schema is `luca.label/1`. These are its **shared fields**:

- `schema` and `label_id`;
- `payment`: the rail, its reference and the network;
- `amount_minor`, `currency` and `accounting_date`;
- `payer` and `payee`;
- `product`, and `tax` with its jurisdiction and treatment;
- once agreed, `service_period`.

Each side keeps its own account and taxonomy elements off the label.

**Signing.** `shared_sha256` is the payload hash of the shared fields. What each side signs is the UTF-8 canonical JSON of:

```
{ "schema": "luca.label/1", "label_id": <label_id>, "shared_sha256": <shared_sha256> }
```

The counterparty signs with a key it registered with the company, which MUST be a public JWK: Ed25519 (`kty` OKP, signature EdDSA) or P-256 (`kty` EC, signature ES256 written as r‖s). Signatures are in base64url. A key is identified by its RFC 7638 thumbprint. A JWK carrying a private member (`d`) MUST be refused.

**Agreement.** A label is agreed when both sides have signed the same `shared_sha256`. A side that books the payment differently signs the shared fields as it would have them, as a proposal, and the other side accepts or rejects it.

## 8. Local packages

A package is a folder of files that can be checked with nothing but this format. The SDKs and the MCP server keep a company's book in a folder and export packages from it.

| File | Contents |
|---|---|
| `keys.jsonl` | one public key per line: `{ key_id, algorithm, public_pem }`, and `rotation` for a key handed over from an earlier one (section 3) |
| `intents.jsonl` | one sealed intent per line: `{ payload, seal }` |
| `cancellations.jsonl` | one sealed withdrawal of an intent per line |
| `checks.jsonl` | one sealed pre-payment check per line |
| `records.jsonl` | one sealed record per line, every version |
| `manifest.json` | `{ package, seal }`, where `package` lists each file with its SHA-256 and is sealed with the company's key |

A checker of a package MUST check:

- that the manifest names only files from the table above, by their plain names. A checker MUST NOT read anything outside the package's folder, follow a link, or accept a name with a path in it;
- the manifest's seal, and that each file listed has the hash the manifest gives;
- every key handover in `keys.jsonl` (section 3);
- every intent and record seal, with the key it names;
- the core fields of every intent and record;
- that every superseded version is in the package;
- that each record's intent is in the package with the hash the record names;
- for a record whose consent check carries a nonce, that it is marked bound exactly when the nonce equals the intent nonce (section 5);
- that no record ID holds two different records, and that no payment has two records with the same version number.

**Whose package it is.** The checks above use the keys the package carries, so they show the package is consistent: anyone can make a consistent package with a key of their own. A checker given the company's public keys, from the company itself, MUST also check that every seal is by one of them or by a key one of them handed over to (section 3). A checker SHOULD show which keys sealed the package, and MUST NOT present a result without the company's keys as proof of who made it.

A large book MAY be sent as several packages. Each one stands on its own: it holds the keys, every version of each payment it carries, and the intents and withdrawals those records name. Its manifest says which part it is, as `part: { index, of }`.

A book's own folder also holds its private key (`key.pem` in the SDKs) and no manifest. A checker MAY check it as a book (every seal and core field, with no manifest) and SHOULD say to share an export instead. A package MUST NOT contain a private key, and a checker MUST fail one that does.

Luca's monthly audit package (`luca.audit-package/1`) is a larger package of the same kind, with its own checker.

## 9. Conformance

A **producer** conforms when every object it seals follows sections 1 to 3. Every record it seals MUST also have the core fields of section 6, and every intent those of section 5. 
A **checker** conforms when it gives the answer each vector in `packages/spr/vectors/vectors.json` gives:

- canonical forms and their hashes, including the values it MUST reject;
- seals in both algorithms, made with RFC 8032's published test key 1, so every signature can be reproduced;
- Merkle roots and paths, and a records root;
- intent nonces;
- JWK thumbprints and label signatures, Ed25519 and P-256;
- which records and intents have their core fields;
- key handovers, good and bad.

Run them against this library with:

```
node lib/spr/bin/spr-verify.mjs --vectors
```

## 10. Versions

The format's version is in its name (`draft-1`). A record's or intent's schema carries its own version:

- a **minor** version adds optional members, and a checker of an earlier minor version still checks it;
- a **major** version changes a core field.

A seal never depends on the schema version: it covers whatever the payload holds.
