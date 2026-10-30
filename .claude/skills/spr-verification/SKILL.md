# Skill: spr-verification

## Purpose

Verify sealed SPR records and packages using the reference library.

## Key commands

```bash
# Verify a package (checks all seals, file hashes, manifest):
npx spr-verify ./books-export --key company.pem
python -m spr ./books-export --key company.pem

# Without --key: shows only consistency (not who made it):
npx spr-verify ./books-export

# Run the canonical test vectors:
node packages/spr/bin/spr-verify.mjs --vectors
python -m spr --vectors
```

## In code

```js
import * as spr from "@luca-network/spr";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const result = spr.verifyPackage(
  (name) => existsSync(join(exportDir, name)) ? readFileSync(join(exportDir, name)) : null,
  { expectedKeys: [company.publicKey().public_pem] }
);
console.log(result.ok, result.trust); // "expected-key" or "consistency-only"
```

## What verification proves and does NOT prove

✅ Proves: the record's content matches the sealed hash; the Ed25519 signature is valid with
   the named key; the package is internally consistent.

❌ Does NOT prove: the payment actually settled on the rail; the agent had genuine authority;
   the counterparty received the payment; any statement by the agent in the record is true.

Settlement confirmation requires Luca's hosted service, which reads the payment from the
rail independently.
