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

Check a package, or run the test vectors:

```
python -m spr <package folder>
python -m spr --vectors ../packages/spr/vectors/vectors.json
```

Tests: `python -m unittest discover -s tests`, from this folder.
