"""python -m unittest discover -s tests   (from python/)"""
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives.asymmetric import ec

import spr
from spr import SprBook

VECTORS = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "spr", "vectors", "vectors.json")


class Vectors(unittest.TestCase):
    def test_every_vector(self):
        with open(VECTORS, encoding="utf-8") as f:
            out = spr.run_vectors(json.load(f))
        self.assertEqual(out["failed"], 0, [r for r in out["results"] if not r["ok"]])

    def test_python_default_key_order_is_not_spr(self):
        d = {"￿": 1, "\U0001F600": 2, "a": 3, "": 4}
        self.assertNotEqual(json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False), spr.canonicalize(d))


class Book(unittest.TestCase):
    def test_declare_check_seal_label_export(self):
        with tempfile.TemporaryDirectory() as d:
            t = [datetime(2026, 10, 28, 15, 0, tzinfo=timezone.utc)]
            book = SprBook(dir=d, agent_id="agt_py", entity="Example Co", time_zone="America/Los_Angeles", now=lambda: t[0])
            intent = book.declare(purpose="Market data for the pricing model", max_amount_minor=300000, currency="usdc")
            nonce = book.nonce_for(intent["intent_id"])
            self.assertEqual(book.check_payment(250000, "USDC", nonce=nonce)["decision"], "approve")
            self.assertEqual(book.check_payment(300001, "USDC", nonce=nonce)["decision"], "decline")
            t[0] = t[0] + timedelta(minutes=5)
            r = book.seal(rail="x402", source_id="0x" + "AB" * 32, amount_minor=250000, currency="USDC", occurred_at="2026-10-28T08:04:05-07:00", nonce=nonce)
            self.assertEqual((r["status"], r["binding"], r["within_consent"]), ("recorded", "bound", True))
            self.assertEqual(book.get_intent(intent["intent_id"])["status"], "matched")
            self.assertTrue(book.verify_record(r["record_id"])["ok"])
            again = book.seal(rail="x402", source_id="0x" + "ab" * 32, amount_minor=250000, currency="USDC", occurred_at="2026-10-28T15:04:05Z", nonce=nonce)
            self.assertEqual(again["status"], "unchanged")
            v2 = book.seal(rail="x402", source_id="0x" + "ab" * 32, amount_minor=240000, currency="USDC", occurred_at="2026-10-28T15:04:05Z", nonce=nonce)
            self.assertTrue(v2["record_id"].endswith("-v2"))
            label = book.label(v2["record_id"], counterparty="Data Example Ltd", product={"code": "data_access", "label": "Data access"})
            cp = ec.generate_private_key(ec.SECP256R1())
            n = cp.public_key().public_numbers()
            b64 = lambda i: spr.format._b64u(i.to_bytes(32, "big"))
            jwk = {"kty": "EC", "crv": "P-256", "x": b64(n.x), "y": b64(n.y)}
            self.assertEqual(book.counterparty_signature(label["label_id"], jwk, spr.sign_label(cp, label["label_id"], label["shared_sha256"]))["state"], "agreed")
            out = book.export_package(os.path.join(d, "export"))
            self.assertTrue(out["verified"], out)
            p = os.path.join(d, "export", "records.jsonl")
            with open(p, encoding="utf-8") as f:
                text = f.read().replace('"amount_minor":240000', '"amount_minor":24')
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            self.assertFalse(spr.verify_folder(os.path.join(d, "export"))["ok"])


if __name__ == "__main__":
    unittest.main()
