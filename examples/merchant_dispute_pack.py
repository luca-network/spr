"""A merchant's side of an agent payment (SPR 0.2.0): the buyer's sealed intent checked with the buyer's key, how the
buyer authenticated, the order and processor references, and one payment's evidence for a chargeback response.

    pip install spr-sdk
    python merchant_dispute_pack.py
"""
import os
import tempfile
from datetime import datetime, timezone

from spr import SprBook, verify_folder

d = tempfile.mkdtemp(prefix="spr-dispute-")

# The buyer's agent declares the purchase in the buyer's own book, and presents the sealed intent at checkout.
buyer = SprBook(dir=os.path.join(d, "buyer"), agent_id="agt_buyer", entity="Northwind Analytics")
i = buyer.declare(purpose="Annual data licence from Example Store", max_amount_minor=25000, currency="USD", payee_id="domain:store.example")
sealed_intent = buyer.intents[i["intent_id"]]
buyer_key = {"public_pem": buyer.public_key()["public_pem"], "entity": "Northwind Analytics"}

# The merchant records the payment it received. The buyer's intent must check with the buyer's key, or nothing is sealed.
shop = SprBook(dir=os.path.join(d, "shop"), agent_id="agt_checkout", entity="Example Store")
now = datetime.now(timezone.utc).isoformat()
r = shop.seal(rail="stripe", source_id="pi_shop_1", amount_minor=19999, currency="USD", occurred_at=now, direction="inflow",
              counterparty="Northwind Analytics", order_id="ORD-1042", processor_transaction_id="ch_3PzSHOP",
              buyer_intent=sealed_intent, buyer_key=buyer_key,
              buyer_authentication={"method": "3ds", "result": "authenticated", "reference": "3ds-tx-77f1", "eci": "05", "provider": "Stripe", "at": now})
print(f"Recorded {r['record_id']}; inside the buyer's intent: {shop.records[-1]['payload']['buyer_intent']['within_intent']}\n")

# A chargeback arrives. One call writes the evidence; anyone checks it with the two public keys.
pack = shop.export_dispute_pack(r["record_id"], os.path.join(d, "dispute-ORD-1042"),
                                delivery={"method": "digital", "delivered_at": now, "reference": "download-5521"})
print(pack["summary"])
check = verify_folder(pack["folder"], [shop.key_id], [buyer.key_id])
print(f"Package check: {check['passed']} passed, {check['failed']} failed, against the merchant's key {shop.key_id} and the buyer's key {buyer.key_id}")
print("The evidence supports a dispute response. Whether to submit it is the merchant's decision, and the card network decides the outcome.")
