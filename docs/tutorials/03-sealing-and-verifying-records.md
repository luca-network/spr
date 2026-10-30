# Tutorial 03: Sealing and Verifying Records

**Audience:** Developers  
**Time:** 15 minutes  
**Prev:** [Creating Your First SPR Book](02-creating-your-first-spr-book.md)  
**Next:** [Understanding Accounting Classification](04-understanding-accounting-classification.md)

---

## Declare and seal a record

```js
const record = await book.declare({
  amount: 1500,           // in minor units ($0.01 = 1 cent → $15.00 = 1500)
  currency: "USD",
  intent: "Claude API call — text generation",
  recipient: "anthropic.com",
  // Optional: x402 payment metadata
  // x402: { scheme: "exact", network: "base", resource: "..." }
});

const sealed = await book.seal(record.id);
```

`declare()` creates a draft record. `seal()` computes the Ed25519 signature and writes the sealed
file to `records/`. The manifest is updated atomically.

## Verify a record

```js
import { verifySeal } from "@luca/spr";

const isValid = await verifySeal(sealed, book.publicKey);
// true if the signature is valid; false if the record was modified
```

Or verify the whole package:

```js
import { verifyPackage } from "@luca/spr";

const result = await verifyPackage(bookDir);
// { valid: true, records: [...], errors: [] }
```

## What verification proves

When `verifySeal` returns `true`:
- The record fields have not changed since it was sealed ✓
- The seal was created by the holder of the key identified by `seal.kid` ✓

It does **not** prove payment settlement. See [Capability Provenance](CAPABILITY_PROVENANCE.md).

## Forged record detection

```js
// Modify a field after sealing
const tampered = { ...sealed, amount: 9999 };
const isTampered = await verifySeal(tampered, book.publicKey);
// false — the signature no longer matches
```

Any change to any field — including the amount, timestamp, or intent — produces a verification failure.

## Cross-language verification

An SPR sealed in JavaScript can be verified in Python:

```python
from spr import verify_seal, load_book

book = load_book(book_dir)
sealed_record = book.get_record(record_id)
is_valid = verify_seal(sealed_record, book.public_key)
```

The canonical JSON serialisation and Ed25519 algorithm are identical in both SDKs, so records
produced by one can be verified by the other.

---

**Next:** [Understanding Accounting Classification](04-understanding-accounting-classification.md)
