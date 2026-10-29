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

    def test_packed_vectors_are_the_repository_vectors(self):
        packed = os.path.join(os.path.dirname(spr.__file__), "vectors.json")
        with open(VECTORS, encoding="utf-8") as a, open(packed, encoding="utf-8") as b:
            self.assertEqual(json.load(a), json.load(b))

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
            args = dict(rail="x402", source_id="0x" + "ab" * 32, amount_minor=240000, currency="USDC", occurred_at="2026-10-28T15:04:05Z", nonce=nonce)
            # A different amount for a payment already sealed is refused unless it says why.
            clash = book.seal(**args)
            self.assertEqual((clash["status"], clash["sealed"]), ("conflict", False))
            self.assertEqual(clash["differs"][0]["field"], "amount_minor")
            self.assertEqual(len(book.records), 1)
            v2 = book.seal(**args, correction={"reason": "The seller refunded 0.01 USDC before settlement"})
            self.assertTrue(v2["record_id"].endswith("-v2"))
            self.assertEqual(book.records[-1]["payload"]["correction"]["reason"], "The seller refunded 0.01 USDC before settlement")
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


class SendToLuca(unittest.TestCase):
    def test_the_book_goes_as_a_package_that_checks_and_a_refusal_is_an_error(self):
        import http.server
        import threading
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["content-length"])))
                seen.append((self.path, self.headers["authorization"], body))
                if self.headers["authorization"] == "Bearer moved":
                    self.send_response(302)
                    self.send_header("location", "http://elsewhere.example/v1/spr/import")
                    self.end_headers()
                    return
                refused = self.headers["authorization"] == "Bearer bad"
                out = json.dumps({"error": "Key is not registered with Luca"} if refused else {"import_id": "spi_1", "created": 1}).encode()
                self.send_response(403 if refused else 201)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *a):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            with tempfile.TemporaryDirectory() as d:
                book = SprBook(dir=d, agent_id="agt_research", entity="Example Co")
                book.seal(rail="stripe", source_id="pi_1", amount_minor=4900, currency="USD")
                # Plain HTTP is refused, even to this computer, unless local development is asked for.
                with self.assertRaises(ValueError):
                    book.send_to_luca(url=url, api_key="k_1")
                with self.assertRaises(ValueError):
                    book.send_to_luca(url="http://luca.example", api_key="k_1")
                self.assertEqual(seen, [])
                os.environ["LUCA_ALLOW_INSECURE_LOCAL"] = "1"
                self.addCleanup(os.environ.pop, "LUCA_ALLOW_INSECURE_LOCAL", None)
                self.assertEqual(book.send_to_luca(url=url, api_key="k_1")["created"], 1)
                path, auth, body = seen[0]
                self.assertEqual((path, auth), ("/v1/spr/import", "Bearer k_1"))
                files = body["files"]
                self.assertEqual(sorted(files), ["keys.jsonl", "manifest.json", "records.jsonl"])
                self.assertTrue(spr.verify_package(lambda n: files[n].encode() if n in files else None)["ok"])
                self.assertFalse(any("PRIVATE KEY" in t for t in files.values()))
                book.register_with_luca("ent_1", url=url, api_key="k_fin")
                self.assertEqual(seen[1][2]["public_pem"], book.public_key()["public_pem"])
                with self.assertRaises(spr.LucaError) as e:
                    book.send_to_luca(url=url, api_key="bad")
                self.assertEqual(e.exception.status, 403)
                with self.assertRaises(spr.LucaError) as e:
                    book.send_to_luca(url=url, api_key="moved")
                self.assertIn("redirect", str(e.exception))
        finally:
            server.shutdown()


if __name__ == "__main__":
    unittest.main()


class Times(unittest.TestCase):
    def test_a_time_without_its_offset_is_refused_and_the_accounting_date_follows_the_book(self):
        with tempfile.TemporaryDirectory() as d:
            book = SprBook(dir=d, agent_id="agt_py", entity="Example Co")
            with self.assertRaises(ValueError) as e:
                book.seal(rail="stripe", source_id="pi_1", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00")
            self.assertIn("offset", str(e.exception))
            self.assertEqual(book.records, [])
            # 23:30 in Los Angeles is the next day in UTC, the default.
            r = book.seal(rail="stripe", source_id="pi_2", amount_minor=100, currency="USD", occurred_at="2026-10-28T23:30:00-07:00")
            p = book.records[-1]["payload"]
            self.assertEqual((p["occurred_at"], p["time_zone"], p["settled_on"]), ("2026-10-29T06:30:00Z", "UTC", "2026-10-29"))
        with tempfile.TemporaryDirectory() as d:
            la = SprBook(dir=d, agent_id="agt_py", entity="Example Co", time_zone="America/Los_Angeles")
            la.seal(rail="stripe", source_id="pi_2", amount_minor=100, currency="USD", occurred_at="2026-10-28T23:30:00-07:00")
            self.assertEqual(la.records[-1]["payload"]["settled_on"], "2026-10-28")
            # No time given: the record says so, and a retry keeps the first time.
            first = la.seal(rail="stripe", source_id="pi_3", amount_minor=100, currency="USD")
            self.assertEqual(la.records[-1]["payload"]["occurred_at_source"], "not given: the time the book sealed it")
            self.assertEqual(la.seal(rail="stripe", source_id="pi_3", amount_minor=100, currency="USD")["status"], "unchanged")


class Authority(unittest.TestCase):
    def test_the_books_own_limits_are_reported_as_self_declared(self):
        with tempfile.TemporaryDirectory() as d:
            book = SprBook(dir=d, agent_id="agt_py", entity="Example Co")
            i = book.declare(purpose="Data", max_amount_minor=500, currency="USD")
            self.assertEqual((i["decision"], i["authority"]), ("none", "none"))
            with open(os.path.join(d, "mandate.json"), "w") as f:
                json.dump({"currency": "USD", "max_per_payment_minor": 1000}, f)
            c = book.check_payment(400, "USD", intent_id=i["intent_id"])
            self.assertEqual((c["decision"], c["authority"]), ("approve", "self-declared"))


class BookFolder(unittest.TestCase):
    def test_a_books_own_folder_checks_as_a_book_and_a_package_with_the_key_fails(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            book = SprBook(dir=d, agent_id="agt_py", entity="Example Co")
            book.seal(rail="stripe", source_id="pi_1", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            out = spr.verify_folder(d)
            self.assertEqual((out["kind"], out["ok"]), ("book", True), out)
            self.assertIn("share an export", out["results"][0]["what"])
            exp = os.path.join(d, "export")
            book.export_package(exp)
            self.assertEqual(spr.verify_folder(exp)["kind"], "package")
            shutil.copyfile(os.path.join(d, "key.pem"), os.path.join(exp, "key.pem"))
            leaked = spr.verify_folder(exp)
            self.assertFalse(leaked["ok"])
            self.assertTrue(any(r["what"] == "the package holds no private key" and not r["ok"] for r in leaked["results"]))


class OneWriter(unittest.TestCase):
    def test_four_processes_sealing_into_one_book_lose_nothing(self):
        import subprocess
        import sys
        here = os.path.dirname(os.path.dirname(os.path.abspath(spr.__file__)))
        code = (
            "import sys; from spr import SprBook\n"
            "d, who = sys.argv[1], sys.argv[2]\n"
            "b = SprBook(dir=d, agent_id='agt_many', entity='Example Co')\n"
            "for k in range(40):\n"
            "    b.seal(rail='stripe', source_id=f'{who}-{k}', amount_minor=100 + k, currency='USD', occurred_at='2026-10-28T12:00:00Z')\n"
            "    b.seal(rail='stripe', source_id=f'shared-{k % 10}', amount_minor=1 if who == 'w0' else 2, currency='USD', occurred_at='2026-10-28T12:00:00Z')\n"
        )
        with tempfile.TemporaryDirectory() as d:
            SprBook(dir=d, agent_id="agt_many", entity="Example Co")
            ps = [subprocess.Popen([sys.executable, "-c", code, d, w], cwd=here) for w in ["w0", "w1", "w2", "w3"]]
            self.assertEqual([p.wait() for p in ps], [0, 0, 0, 0])
            with open(os.path.join(d, "records.jsonl"), encoding="utf-8") as f:
                rows = [json.loads(l) for l in f if l.strip()]
            self.assertEqual(len(rows), 4 * 40 + 10)
            self.assertEqual(len({r["payload"]["record_id"] for r in rows}), len(rows))
            self.assertTrue(spr.verify_folder(d)["ok"])


class Rotation(unittest.TestCase):
    def test_the_new_key_is_handed_over_and_old_records_still_check(self):
        with tempfile.TemporaryDirectory() as d:
            book = SprBook(dir=d, agent_id="agt_rot", entity="Example Co")
            other = SprBook(dir=d, agent_id="agt_rot", entity="Example Co")
            r1 = book.seal(rail="stripe", source_id="pi_1", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            r = book.rotate_key(reason="Yearly rotation")
            self.assertTrue(book.verify_record(r1["record_id"])["ok"])
            r2 = other.seal(rail="stripe", source_id="pi_2", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            self.assertEqual(r2["seal"]["key_id"], r["to"])
            v = spr.verify_folder(d)
            self.assertTrue(v["ok"], v)
            self.assertTrue(any(x["what"] == f"key {r['to']} was handed over by key {r['from']}, which sealed the handover" for x in v["results"]))
            p = os.path.join(d, "keys.jsonl")
            with open(p, encoding="utf-8") as f:
                text = f.read()
            with open(p, "w", encoding="utf-8") as f:
                f.write(text.replace("Yearly rotation", "Forged"))
            self.assertFalse(spr.verify_folder(d)["ok"])


class LargeBook(unittest.TestCase):
    def test_parts_each_check_on_their_own(self):
        import time as _t
        with tempfile.TemporaryDirectory() as d:
            book = SprBook(dir=d, agent_id="agt_big", entity="Example Co")
            for k in range(1500):
                book.seal(rail="stripe", source_id=f"pi_{k}", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            t = _t.monotonic()
            for k in range(100):
                book.seal(rail="stripe", source_id=f"pi_late_{k}", amount_minor=1, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            self.assertLess(_t.monotonic() - t, 5)
            parts = book.package_parts(max_records=500)
            self.assertEqual(len(parts), 4)
            for p in parts:
                self.assertTrue(spr.verify_package(lambda n, p=p: p[n].encode() if n in p else None)["ok"])


class GroupOne(unittest.TestCase):
    def test_whose_package_it_is(self):
        with tempfile.TemporaryDirectory() as d:
            company = SprBook(dir=os.path.join(d, "company"), agent_id="agt", entity="Example Co")
            company.seal(rail="stripe", source_id="pi_1", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            forger = SprBook(dir=os.path.join(d, "forger"), agent_id="agt", entity="Example Co")
            forger.seal(rail="stripe", source_id="pi_1", amount_minor=999999, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            forger.export_package(os.path.join(d, "forged"))
            loose = spr.verify_folder(os.path.join(d, "forged"))
            self.assertEqual((loose["ok"], loose["trust"]), (True, "consistency-only"))
            pem = company.public_key()["public_pem"]
            strict = spr.verify_folder(os.path.join(d, "forged"), [pem])
            self.assertEqual((strict["ok"], strict["trust"]), (False, "untrusted"))
            company.export_package(os.path.join(d, "real"))
            self.assertEqual(spr.verify_folder(os.path.join(d, "real"), [company.key_id])["trust"], "expected-key")

    def test_the_checker_stays_inside_the_package(self):
        with tempfile.TemporaryDirectory() as d:
            book = SprBook(dir=os.path.join(d, "book"), agent_id="agt", entity="Example Co")
            book.seal(rail="stripe", source_id="pi_1", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            with open(os.path.join(d, "secret.txt"), "w") as f:
                f.write("not part of any package")
            exp = os.path.join(d, "export")
            book.export_package(exp)
            with open(os.path.join(exp, "manifest.json"), encoding="utf-8") as f:
                m = json.load(f)
            for name in ["../secret.txt", os.path.join(d, "secret.txt"), "C:\\\\Windows\\\\win.ini", "sub/records.jsonl"]:
                m["package"]["files"].append({"name": name, "sha256": "0"})
            with open(os.path.join(exp, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump(m, f)
            out = spr.verify_folder(exp)
            self.assertFalse(out["ok"])
            self.assertEqual(sum(1 for r in out["results"] if r["what"] == "the manifest names only the package's own files"), 4)
            self.assertFalse(any("secret.txt is the file" in r["what"] for r in out["results"]))
            exp2 = os.path.join(d, "export2")
            book.export_package(exp2)
            recs = os.path.join(exp2, "records.jsonl")
            os.replace(recs, os.path.join(d, "elsewhere.jsonl"))
            try:
                os.symlink(os.path.join(d, "elsewhere.jsonl"), recs)
            except OSError:
                return  # Windows lets only administrators and Developer Mode make links
            out2 = spr.verify_folder(exp2)
            self.assertFalse(out2["ok"])
            self.assertTrue(any("is a link" in r["detail"] for r in out2["results"]))

    def test_unknown_time_zone_is_refused_when_the_book_opens(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                SprBook(dir=d, agent_id="agt", entity="Example Co", time_zone="Mars/Olympus")
            self.assertEqual(SprBook(dir=d, agent_id="agt", entity="Example Co", time_zone="Europe/London").time_zone, "Europe/London")

    def test_synced_folders_test_keys_and_exports(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                SprBook(dir=os.path.join(d, "Dropbox", "books"), agent_id="agt", entity="Example Co")
            SprBook(dir=os.path.join(d, "Dropbox", "books"), agent_id="agt", entity="Example Co", allow_synced_folder=True)
            from cryptography.hazmat.primitives.asymmetric import ed25519
            test1 = ed25519.Ed25519PrivateKey.from_private_bytes(bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"))
            with self.assertRaises(ValueError):
                SprBook(dir=os.path.join(d, "t"), agent_id="agt", entity="Example Co", key=test1)
            book = SprBook(dir=os.path.join(d, "book"), agent_id="agt", entity="Example Co")
            book.seal(rail="stripe", source_id="pi_1", amount_minor=100, currency="USD", occurred_at="2026-10-28T12:00:00Z")
            book.export_package(os.path.join(d, "e"))
            with self.assertRaises(ValueError):
                book.export_package(os.path.join(d, "e"))
            self.assertTrue(book.export_package(os.path.join(d, "e"), overwrite=True)["verified"])
            with self.assertRaises(ValueError):
                book.export_package(os.path.join(d, "book"))
