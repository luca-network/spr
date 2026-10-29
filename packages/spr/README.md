# SPR: the Sealed Payment Record

SPR is an open format for the accounting record of a payment made or received by a software agent: sealed by the company that made it, checkable by anyone with its public key. This folder holds the format and a reference library with no dependencies (Node 20 or later), under the Apache License 2.0.

- `SPEC.md`: the format (draft 1).
- `index.mjs`: canonical JSON, hashes, seals and key IDs, Merkle roots and paths, the intent nonce, two-sided labels, the core fields of records and intents, and the check of a package.
- `vectors/vectors.json`: the test vectors. An implementation in any language conforms when it gives the same answers.
- `bin/spr-verify.mjs`: checks a package folder, or runs the vectors.

```js
import { sealWith, verifySeal, checkRecord } from "@luca-network/spr";

const seal = sealWith(record, privateKey);                      // { payload_sha256, signature, key_id, algorithm }
verifySeal(record, seal, publicKeyPem).ok;                      // true
checkRecord(record);                                            // { ok, problems }
```

```
node bin/spr-verify.mjs --vectors          # the library against the vectors
node bin/spr-verify.mjs <package folder>   # a package, with no Luca code
```

The library runs wherever you run it and makes no call to Luca. Luca's hosted service seals with the same library.

## Licence

Apache License 2.0 (`LICENSE`), which includes a patent licence from each contributor for this code. Methods in the format are the subject of a US provisional patent application assigned to Luca Africa Inc.; a royalty-free commitment for implementations written without this code is published with the format (`SPEC.md`, the front page).
