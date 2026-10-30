# Tutorial 02: Creating Your First SPR Book

**Audience:** Developers  
**Time:** 15 minutes  
**Prev:** [What Is a Sealed Payment Record?](01-what-is-a-sealed-payment-record.md)  
**Next:** [Sealing and Verifying Records](03-sealing-and-verifying-records.md)

---

## Prerequisites

- Node.js 20+
- `npm install` from the repo root

## Create a book

```js
import { SprBook } from "@luca/spr-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bookDir = mkdtempSync(join(tmpdir(), "my-book-"));
const book = await SprBook.open(bookDir);
```

`SprBook.open(dir)` creates the directory if it does not exist, generates a fresh Ed25519 key pair,
and writes `key.pem` and the initial `manifest.json`. On subsequent opens, it loads the existing key.

## What gets created

```
my-book-XXXXXX/
├── key.pem          ← Ed25519 private key (NEVER share this)
├── manifest.json    ← Book manifest (schema: luca.spr/0.1)
└── records/         ← Sealed record files (created on first seal)
```

## Key management

The `key.pem` file contains your signing private key. Protect it:

- Do not commit it to version control
- Do not include it in any export file
- Do not log its contents

Key rotation is supported:

```js
await book.rotateKey();
// New key is active for new records; old key(s) stay in keyring for verification
```

## Python equivalent

```python
from spr import SprBook
import tempfile, os

book_dir = tempfile.mkdtemp(prefix="my-book-")
book = SprBook(book_dir)
```

## Closing thoughts

- One book = one signing identity
- Multiple books are independent; they never share keys
- The book directory is the source of truth; the manifest tracks all records

---

**Next:** [Sealing and Verifying Records](03-sealing-and-verifying-records.md)
