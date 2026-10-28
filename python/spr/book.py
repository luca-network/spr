"""The SPR book in Python: an agent's sealed records, kept by the company on its own machine, with its own key.

    book = SprBook(dir="books", agent_id="agt_research", entity="Example Co")
    intent = book.declare(purpose="Market data for the pricing model", max_amount_minor=20000, currency="USDC")
    nonce = book.nonce_for(intent["intent_id"])        # sign this as the payment's nonce where the rail lets you
    record = book.seal(rail="x402", source_id=tx_hash, amount_minor=10000, currency="USDC", nonce=nonce)

The same folder, files and records as the JavaScript SDK, so either language reads the other's book, and
spr-verify checks either with no Luca code.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from . import format as L

SDK_PRODUCER = {"name": "spr-sdk-python", "version": "0.1.0"}
RECORD_SCHEMA = "luca.record/0.7"
INTENT_SCHEMA = "luca.intent/0.1"
CLOCK_SKEW = timedelta(minutes=2)




def _iso(d: datetime) -> str:
    d = d.astimezone(timezone.utc)
    s = d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
    return s.replace(".000Z", "Z")


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _duration(s: str) -> timedelta:
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?", s or "")
    if not m or not any(m.groups()):
        raise ValueError(f"expires_in must be an ISO 8601 duration such as PT1H or P3D, got {s}")
    return timedelta(days=int(m[1] or 0), hours=int(m[2] or 0), minutes=int(m[3] or 0))


class SprBook:
    def __init__(self, dir: str, agent_id: str, entity: str, owner: Optional[str] = None, time_zone: str = "UTC",
                 binding: bool = False, key: Optional[ed25519.Ed25519PrivateKey] = None, now=None, producer: Optional[dict] = None):
        if not (agent_id or "").strip() or not (entity or "").strip():
            raise ValueError("The book needs the agent's ID (agent_id) and the company it pays for (entity)")
        self.dir, self.agent_id, self.entity, self.owner = dir, agent_id, entity, owner
        self.time_zone, self.binding, self._now = time_zone, binding, now or (lambda: datetime.now(timezone.utc))
        self.producer = producer or SDK_PRODUCER
        os.makedirs(dir, exist_ok=True)
        if key is None:
            path = os.path.join(dir, "key.pem")
            if os.path.exists(path):
                with open(path, "rb") as f:
                    key = serialization.load_pem_private_key(f.read(), None)
            else:
                key = ed25519.Ed25519PrivateKey.generate()
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        if not isinstance(key, ed25519.Ed25519PrivateKey):
            raise ValueError("The book's key must be Ed25519")
        self.key, self.key_id = key, L.key_id_for(key)
        if not any(k["key_id"] == self.key_id for k in self._jsonl("keys.jsonl")):
            self._append("keys.jsonl", {"key_id": self.key_id, "algorithm": "ed25519", "public_pem": L.public_key_pem_of(key),
                                        "created_at": _iso(self._now()), "owner": entity})
        self.intents = {i["payload"]["intent_id"]: i for i in self._jsonl("intents.jsonl")}
        self.cancellations = {c["payload"]["intent_id"]: c for c in self._jsonl("cancellations.jsonl")}
        self.records = self._jsonl("records.jsonl")
        self.labels = self._jsonl("labels.jsonl")

    # ---- files ----
    def _jsonl(self, name):
        p = os.path.join(self.dir, name)
        if not os.path.exists(p):
            return []
        with open(p, encoding="utf-8") as f:
            return [json.loads(l) for l in f if l.strip()]

    def _append(self, name, row):
        with open(os.path.join(self.dir, name), "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")

    def _seal_row(self, payload):
        return {"payload": payload, "seal": L.seal_with(payload, self.key)}

    def _mandate(self):
        p = os.path.join(self.dir, "mandate.json")
        if not os.path.exists(p):
            return None
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def _local_date(self, at: datetime) -> str:
        return at.astimezone(ZoneInfo(self.time_zone)).strftime("%Y-%m-%d")

    def _mandate_checks(self, amount, currency, at):
        m = self._mandate()
        if not m:
            return {"decision": "no_mandate", "checks": [], "mandate_id": None}
        checks = []
        if m.get("currency"):
            checks.append({"check": "currency", "ok": not currency or currency == m["currency"], "detail": f"Mandate in {m['currency']}; intent in {currency or 'no currency'}"})
        if "max_per_payment_minor" in m:
            checks.append({"check": "per_payment", "ok": amount is None or amount <= m["max_per_payment_minor"], "detail": f"Limit {m['max_per_payment_minor']}; up to {amount if amount is not None else 'no amount given'}"})
        if m.get("valid_from") or m.get("valid_until"):
            ok = (not m.get("valid_from") or at >= _parse(m["valid_from"])) and (not m.get("valid_until") or at <= _parse(m["valid_until"]))
            checks.append({"check": "in_date", "ok": ok, "detail": f"Valid {m.get('valid_from') or 'any time'} to {m.get('valid_until') or 'no end'}"})
        return {"decision": "within_mandate" if all(c["ok"] for c in checks) else "outside_mandate", "checks": checks, "mandate_id": m.get("mandate_id")}

    # ---- before paying ----
    def declare(self, purpose: str, max_amount_minor: Optional[int] = None, currency: Optional[str] = None, counterparty: Optional[str] = None,
                expected_amount_minor: Optional[int] = None, rail: Optional[str] = None, rail_ref: Optional[dict] = None,
                terms: Optional[dict] = None, expires_in: Optional[str] = None, expires_in_hours: Optional[int] = None) -> dict:
        if not (purpose or "").strip():
            raise ValueError("purpose is required: why you are paying, in one sentence")
        cap = max_amount_minor
        if cap is not None and (not L._safe_int(cap) or cap <= 0):
            raise ValueError("max_amount_minor must be a positive integer in minor units")
        if cap is not None and expected_amount_minor is not None and expected_amount_minor > cap:
            raise ValueError("expected_amount_minor is above max_amount_minor")
        now = self._now()
        ttl = _duration(expires_in) if expires_in else timedelta(hours=expires_in_hours or 72)
        cur = currency.upper() if currency else None
        pre = self._mandate_checks(cap if cap is not None else expected_amount_minor, cur, now)
        payload = {
            "schema": INTENT_SCHEMA, "intent_id": "int_" + secrets.token_hex(10),
            "agent": {"id": self.agent_id, "owner": self.owner}, "entity": self.entity, "mandate_id": pre.get("mandate_id"),
            "purpose": purpose.strip(), "counterparty": counterparty, "expected_amount_minor": expected_amount_minor,
            "max_amount_minor": cap, "currency": cur, "rail": rail, "rail_ref": rail_ref, "terms": terms,
            "declared_at": _iso(now), "expires_at": _iso(now + ttl), "precheck": {"decision": pre["decision"], "checks": pre["checks"]},
            "producer": self.producer,
        }
        row = self._seal_row(payload)
        self._append("intents.jsonl", row)
        self.intents[payload["intent_id"]] = row
        return {"intent_id": payload["intent_id"], "decision": pre["decision"], "checks": pre["checks"], "declared_at": payload["declared_at"],
                "expires_at": payload["expires_at"], "max_amount_minor": cap, "seal": row["seal"],
                "binding": {"scheme": L.INTENT_NONCE_SCHEME, "nonce": L.intent_nonce(row["seal"]["payload_sha256"])} if self.binding else None}

    record_intent = declare

    def nonce_for(self, intent_id: str, seq: int = 0) -> str:
        i = self.intents.get(intent_id)
        if not i:
            raise KeyError(f"No intent {intent_id} in this book")
        return L.intent_nonce(i["seal"]["payload_sha256"], seq)

    def cancel_intent(self, intent_id: str, reason: str) -> dict:
        i = self.intents.get(intent_id)
        if not i:
            raise KeyError(f"No intent {intent_id} in this book")
        if not (reason or "").strip():
            raise ValueError("Say why the intent is withdrawn")
        if intent_id in self.cancellations:
            return self.cancellations[intent_id]["payload"]
        row = self._seal_row({"schema": "luca.intent-cancellation/0.1", "intent_id": intent_id, "intent_payload_sha256": i["seal"]["payload_sha256"],
                              "by": self.agent_id, "reason": reason.strip(), "cancelled_at": _iso(self._now()), "producer": self.producer})
        self._append("cancellations.jsonl", row)
        self.cancellations[intent_id] = row
        return row["payload"]

    def get_intent(self, intent_id: str) -> dict:
        i = self.intents.get(intent_id)
        if not i:
            raise KeyError(f"No intent {intent_id} in this book")
        paid = [r["payload"]["record_id"] for r in self._current() if (r["payload"].get("intent") or {}).get("intent_id") == intent_id]
        status = "withdrawn" if intent_id in self.cancellations else "matched" if paid else "expired" if _parse(i["payload"]["expires_at"]) < self._now() else "open"
        return {**i["payload"], "status": status, "records": paid, "seal": i["seal"]}

    def _intent_for(self, intent_id, nonce):
        if intent_id:
            return self.intents.get(intent_id)
        if nonce:
            for i in self.intents.values():
                if L.intent_nonce(i["seal"]["payload_sha256"]) == nonce.lower():
                    return i
        return None


    def _consent(self, i, at, amount, currency, nonce):
        ip = i["payload"]
        checks = []
        hard = lambda c, ok, d: checks.append({"check": c, "ok": bool(ok), "detail": d, "severity": "hard"})
        hard("declared_before_payment", at + CLOCK_SKEW >= _parse(ip["declared_at"]), f"Intent declared {ip['declared_at']}; paid {_iso(at)}")
        hard("before_intent_expiry", at <= _parse(ip["expires_at"]), f"Intent expires {ip['expires_at']}; paid {_iso(at)}")
        c = self.cancellations.get(ip["intent_id"])
        if c:
            hard("not_withdrawn", at < _parse(c["payload"]["cancelled_at"]), f"Intent withdrawn {c['payload']['cancelled_at']}; paid {_iso(at)}")
        if ip.get("max_amount_minor") is not None:
            authorized = abs(amount)
            comparable = not ip.get("currency") or ip["currency"] == currency
            note = ""
            hard("within_intent_cap", comparable and authorized <= ip["max_amount_minor"],
                 (f"Cap {ip['max_amount_minor']}; paid {authorized} ({currency} minor units)" + note)
                 if comparable else f"Paid in {currency}, which cannot be compared with the {ip['currency']} cap here")
        expected = L.intent_nonce(i["seal"]["payload_sha256"])
        binding = ({"scheme": L.INTENT_NONCE_SCHEME, "status": "bound" if nonce.lower() == expected else "unbound", "nonce": nonce.lower(), "expected": expected, "seq": 0}
                   if nonce else {"scheme": L.INTENT_NONCE_SCHEME, "status": "not_applicable", "nonce": None, "expected": expected, "seq": 0})
        return {"intent_id": ip["intent_id"], "within_consent": all(x["ok"] for x in checks), "checks": checks, "binding": binding}

    def check_payment(self, amount_minor: int, currency: str, counterparty: Optional[str] = None, intent_id: Optional[str] = None,
                      nonce: Optional[str] = None,
                      ) -> dict:
        now = self._now()
        cur = currency.upper()
        i = self._intent_for(intent_id, nonce)
        consent = self._consent(i, now, amount_minor, cur, nonce) if i else None
        m = self._mandate_checks(abs(amount_minor), cur, now)
        checks = [{"check": "open_intent", "ok": bool(i), "detail": f"Intent {i['payload']['intent_id']}" if i else "No intent named or matched by the nonce"}]
        checks += [c for c in (consent or {}).get("checks", []) if c["severity"] == "hard"] + m["checks"]
        request = {"amount_minor": amount_minor, "currency": currency, "counterparty": counterparty, "intent_id": intent_id, "nonce": nonce}
        row = self._seal_row({"schema": "luca.payment-check/0.1", "id": "pck_" + secrets.token_hex(8), "checked_at": _iso(now), "agent": self.agent_id,
                              "request": {k: v for k, v in request.items() if v is not None}, "decision": "approve" if all(c["ok"] for c in checks) else "decline",
                              "checks": checks, "producer": self.producer})
        self._append("checks.jsonl", row)
        return {"id": row["payload"]["id"], "decision": row["payload"]["decision"], "checks": checks,
                "reasons": [f"{c['check']}: {c['detail']}" for c in checks if not c["ok"]], "seal": row["seal"]}

    def _current(self):
        replaced = {r["payload"].get("supersedes") for r in self.records if r["payload"].get("supersedes")}
        return [r for r in self.records if r["payload"]["record_id"] not in replaced]

    # ---- after paying ----
    def seal(self, rail: str, source_id: str, amount_minor: int, currency: str, occurred_at: Optional[str] = None, counterparty: Optional[str] = None,
             intent_id: Optional[str] = None, memo: Optional[str] = None, state: Optional[str] = None, direction: str = "outflow",
             nonce: Optional[str] = None, evidence: Optional[dict] = None,
             ) -> dict:
        if not rail or not source_id:
            raise ValueError("rail and source_id are required")
        if not L._safe_int(amount_minor):
            raise ValueError("amount_minor must be an integer in minor units")
        at = _parse(occurred_at) if occurred_at else self._now()
        cur = currency.upper()
        src = source_id.lower() if re.fullmatch(r"0x[0-9a-fA-F]+", source_id) else source_id
        nonce = nonce.lower() if nonce else None
        i = self._intent_for(intent_id, nonce)
        if intent_id and not i:
            raise KeyError(f"No intent {intent_id} in this book")
        consent = self._consent(i, at, amount_minor, cur, nonce) if i and direction == "outflow" else None
        key = f"{self.entity}:{rail}:{src}"
        earlier = next((r for r in self._current() if f"{r['payload']['entity']}:{r['payload']['rail']}:{r['payload']['source']['id']}" == key), None)
        facts = {"direction": direction, "state": "refunded" if amount_minor < 0 else "pending" if state == "pending" else "cleared",
                 "amount_minor": amount_minor, "currency": cur, "occurred_at": _iso(at), "counterparty": counterparty, "memo": memo,
                 "intent": {"intent_id": i["payload"]["intent_id"], "payload_sha256": i["seal"]["payload_sha256"]} if i else None}
        if earlier and all(L.canonicalize(v) == L.canonicalize(earlier["payload"].get(k)) for k, v in facts.items()):
            return {"status": "unchanged", "record_id": earlier["payload"]["record_id"], "seal": earlier["seal"]}
        version = earlier["payload"]["version"] + 1 if earlier else 1
        source_input = {k: v for k, v in {"rail": rail, "source_id": source_id, "amount_minor": amount_minor, "currency": currency, "occurred_at": occurred_at,
                        "counterparty": counterparty, "intent_id": intent_id, "memo": memo, "state": state, "nonce": nonce, "evidence": evidence,
                        }.items() if v is not None}
        payload = {
            "schema": RECORD_SCHEMA, "record_id": f"LR-{rail.upper()}-{L.sha256_hex(key)[:10].upper()}-v{version}",
            "version": version, "supersedes": earlier["payload"]["record_id"] if earlier else None,
            "changed": [k for k in facts if earlier and L.canonicalize(facts[k]) != L.canonicalize(earlier["payload"].get(k))],
            "entity": self.entity, "entity_id": self.entity, "rail": rail, "reported_by": "agent",
            "source": {"id": src, "payload_sha256": L.hash_source_payload(source_input)},
            **facts,
            "time_zone": self.time_zone, "settled_on": self._local_date(at),
            "agent": {"id": self.agent_id, "owner": self.owner},
            "rail_authorization": [{"scheme": f"{rail}_payment", "reference": nonce}] if nonce else [],
            "consent": consent, "evidence": evidence, "producer": self.producer,
        }
        problems = L.check_record(payload)["problems"]
        if problems:
            raise ValueError(f"The record would not meet SPR: {'; '.join(problems)}")
        row = self._seal_row(payload)
        self._append("records.jsonl", row)
        self.records.append(row)
        return {"status": "new_version" if earlier else "recorded", "record_id": payload["record_id"],
                "within_consent": consent["within_consent"] if consent else None, "binding": consent["binding"]["status"] if consent else None,
                "checks": consent["checks"] if consent else [],
                "seal": row["seal"]}

    record_settlement = seal

    # ---- the label (SPR section 7) ----
    def label(self, record_id: str, counterparty: str, product: Optional[dict] = None, tax: Optional[dict] = None,
              network: Optional[str] = None, service_period: Any = None) -> dict:
        base = re.sub(r"-v\d+$", "", record_id)
        r = next((x for x in self._current() if re.sub(r"-v\d+$", "", x["payload"]["record_id"]) == base), None)
        if not r:
            raise KeyError(f"No record {record_id} in this book")
        p = r["payload"]
        label_id = "lbl_" + L.sha256_hex(f"{p['entity']}|{p['rail']}|{p['source']['id']}|{counterparty}")[:20]
        inflow = p["direction"] == "inflow"
        shared = {"schema": L.LABEL_SCHEMA, "label_id": label_id,
                  "payment": {"rail": p["rail"], "id": p["source"]["id"], "network": network or (p.get("evidence") or {}).get("network")},
                  "amount_minor": p["amount_minor"], "currency": p["currency"], "accounting_date": p["settled_on"],
                  "payer": counterparty if inflow else p["entity"], "payee": p["entity"] if inflow else counterparty,
                  "product": product, "tax": {"jurisdiction": (tax or {}).get("jurisdiction"), "treatment": (tax or {}).get("treatment")}}
        if service_period:
            shared["service_period"] = service_period
        sha = L.label_shared_sha256(shared)
        row = {"label_id": label_id, "record_id": p["record_id"], "shared": shared, "shared_sha256": sha,
               "sign_this": L.label_signing_input(label_id, sha),
               "signatures": [{"party": "company", "key_id": self.key_id, "alg": "EdDSA", "signature": L.sign_label(self.key, label_id, sha)}]}
        self._append("labels.jsonl", row)
        self.labels.append(row)
        return row

    def counterparty_signature(self, label_id: str, jwk: dict, signature: str) -> dict:
        l = next((x for x in reversed(self.labels) if x["label_id"] == label_id), None)
        if not l:
            raise KeyError(f"No label {label_id} in this book")
        pub = L.check_public_jwk(jwk)
        if not L.verify_label_signature(pub, label_id, l["shared_sha256"], signature):
            raise ValueError("The signature does not verify with that key over sign_this")
        row = {**l, "signatures": l["signatures"] + [{"party": "counterparty", "key_thumbprint": L.jwk_thumbprint(pub), "jwk": pub,
                                                      "alg": "EdDSA" if pub["kty"] == "OKP" else "ES256", "signature": signature}], "state": "agreed"}
        self._append("labels.jsonl", row)
        self.labels.append(row)
        return row

    def verify_record(self, record_id: str) -> dict:
        r = next((x for x in self.records if x["payload"]["record_id"] == record_id), None)
        if not r:
            raise KeyError(f"No record {record_id} in this book")
        v = L.verify_seal(r["payload"], r["seal"], self.key)
        core = L.check_record(r["payload"])
        return {"record_id": record_id, **v, "ok": v["ok"] and core["ok"], "core_fields": core, "key_id": self.key_id}

    def list_records(self, all: bool = False) -> list:
        return [{"record_id": r["payload"]["record_id"], "rail": r["payload"]["rail"], "amount_minor": r["payload"]["amount_minor"],
                 "currency": r["payload"]["currency"], "settled_on": r["payload"]["settled_on"], "counterparty": r["payload"].get("counterparty"),
                 "intent_id": (r["payload"].get("intent") or {}).get("intent_id"), "within_consent": (r["payload"].get("consent") or {}).get("within_consent"),
                 "payload_sha256": r["seal"]["payload_sha256"]} for r in (self.records if all else self._current())]

    def export_package(self, out_dir: str) -> dict:
        os.makedirs(out_dir, exist_ok=True)
        names = [n for n in ["keys.jsonl", "intents.jsonl", "cancellations.jsonl", "checks.jsonl", "records.jsonl", "labels.jsonl"] if os.path.exists(os.path.join(self.dir, n))]
        for n in names:
            shutil.copyfile(os.path.join(self.dir, n), os.path.join(out_dir, n))
        def sha(n):
            with open(os.path.join(out_dir, n), "rb") as f:
                return L.sha256_hex(f.read())
        pkg = {"schema": "luca.local-package/0.1", "entity": self.entity, "generated_at": _iso(self._now()), "producer": self.producer,
               "format": L.SPEC_VERSION, "files": [{"name": n, "sha256": sha(n)} for n in names]}
        with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"package": pkg, "seal": L.seal_with(pkg, self.key)}, indent=2, ensure_ascii=False) + "\n")
        check = verify_folder(out_dir)
        return {"folder": out_dir, "files": names + ["manifest.json"], "verified": check["ok"], "passed": check["passed"], "failed": check["failed"]}


def verify_folder(folder: str) -> dict:
    def read(name):
        p = os.path.join(folder, name)
        if not os.path.exists(p):
            return None
        with open(p, "rb") as f:
            return f.read()
    return L.verify_package(read)
