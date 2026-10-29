# SPR SDK for Python

SPR, the Sealed Payment Record, in Python: seal your AI agents' payments on your own machine with your company's own key, and check any SPR record or package without Luca. Apache-2.0. Needs `cryptography`.

```python
from spr import SprBook

book = SprBook(dir="books", agent_id="agt_research", entity="Example Co")

# Before paying: declare, and sign the nonce as the payment's nonce where the rail lets you (x402, EIP-3009).
intent = book.declare(purpose="Market data for the pricing model", max_amount_minor=20000, currency="USDC")
nonce = book.nonce_for(intent["intent_id"])
if book.check_payment(10000, "USDC", nonce=nonce)["decision"] != "approve":
    raise SystemExit("declined")

# After paying: seal it.
record = book.seal(rail="x402", source_id=tx_hash, amount_minor=10000, currency="USDC", nonce=nonce)
```

The folder, files and records are the same as the JavaScript SDK's, so either language opens the other's book.

The book runs on your machine and makes no call to Luca. It checks each payment against the agent's declared intent: the cap, the expiry, and whether the intent was withdrawn. An optional `mandate.json` in the folder adds one limit across all the agent's intents; whoever keeps the folder writes it, so results report it as `authority: "self-declared"`. Spending authority granted by someone else needs that party's own record, such as a mandate approved in Luca's hosted service.

Times need their offset; a time without one is refused. Different facts for a payment already sealed return `conflict` and seal nothing, unless you pass `correction={"reason": ...}`.

Export the book for an auditor or a counterparty (never share the folder itself, which holds the private key), and check it, or run the test vectors that come with the package:

```python
out = book.export_package("books-export")   # out["verified"] is True: the export checked itself
```

```
python -m spr books-export --key company-public-key.pem   # every seal, file hash and intent link, and whose package it is
python -m spr --vectors           # this package against the format's test vectors
```

`book.rotate_key(reason=...)` replaces the key: the old key seals a handover to the new one in `keys.jsonl`, and records sealed before stay checkable. Several processes can use one book: each write takes `book.lock` for a moment, so nothing is lost.

Send the book to Luca's hosted service (optional), which checks every seal, then classifies each payment and posts it to your ERP:

```python
book.register_with_luca("acme-us", url="https://sandbox.luca.network", api_key=FINANCE_KEY)   # once, by finance
book.send_to_luca(url="https://sandbox.luca.network", api_key=LUCA_API_KEY)                    # sending it again changes nothing
```

`url` and `api_key` default to `LUCA_URL` and `LUCA_API_KEY`. The address must be https, and a redirect is refused; `LUCA_ALLOW_INSECURE_LOCAL=1` allows plain HTTP to your own computer, for development. A book folder inside OneDrive, Dropbox, iCloud or Google Drive is refused unless you pass `allow_synced_folder=True`. Only the package's files are sent, never the private key. A book over one import's limits (4,000 records or 8 MB) goes in parts, each of which checks on its own.

Tests: `python -m unittest discover -s tests`, from this folder.
