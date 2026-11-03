"""The SPR book in Python: an agent's sealed records, kept by the company on its own machine, with its own key.

    book = SprBook(dir="books", agent_id="agt_research", entity="Example Co")
    intent = book.declare(purpose="Market data for the pricing model", max_amount_minor=20000, currency="USDC")
    nonce = book.nonce_for(intent["intent_id"])        # sign this as the payment's nonce where the rail lets you
    record = book.seal(rail="x402", source_id=tx_hash, amount_minor=10000, currency="USDC", nonce=nonce)

The same folder, files and records as the JavaScript SDK, so either language reads the other's book, and
spr-verify checks either with no Luca code.
"""
from __future__ import annotations

import functools
import json
import os
import re
import secrets
import socket
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from . import format as L

SDK_PRODUCER = {"name": "spr-sdk-python", "version": "0.2.0"}
RECORD_SCHEMA = "luca.record/0.7"
INTENT_SCHEMA = "luca.intent/0.1"
CLOCK_SKEW = timedelta(minutes=2)
FILES = ["keys.jsonl", "intents.jsonl", "cancellations.jsonl", "checks.jsonl", "records.jsonl", "labels.jsonl", "buyer-intents.jsonl"]
# One writer at a time: each write takes book.lock, reads what other processes appended since, writes, and lets go.
LOCK_WAIT = 10.0
LOCK_STALE = 30.0
# What one import to Luca takes at most; a bigger book is sent in parts.
PART_MAX_RECORDS = 4000
PART_MAX_BYTES = 8 * 1024 * 1024
KEY_ROTATION_SCHEMA = "luca.key-rotation/0.1"


# The published test keys of the vectors (RFC 8032 test keys 1 and 2). Anyone has their private parts.
TEST_KEY_IDS = {"ed25519:a00579fb9f411e66", "ed25519:df45109f9d243cdb"}
_SYNCED = re.compile(r"(onedrive( - .+)?|dropbox|google drive|my drive|icloud drive|iclouddrive|mobile documents|cloudstorage|box|box sync|pclouddrive|mega)", re.I)


def synced_folder_of(path: str) -> Optional[str]:
    """The cloud-synced folder a path is inside (OneDrive, Dropbox, iCloud, Google Drive...), or None."""
    p = os.path.realpath(path)
    for v in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]:
        root = os.environ.get(v)
        if root and (p == root or p.lower().startswith(os.path.realpath(root).lower() + os.sep)):
            return root
    return next((seg for seg in re.split(r"[\\/]", p) if _SYNCED.fullmatch(seg)), None)


def _protect_key_file(path: str):
    """On Windows, an access list naming only the current user; elsewhere the file is created 0600."""
    if os.name != "nt":
        return
    import subprocess
    try:
        subprocess.run(["icacls", path, "/inheritance:r", "/grant:r", f"{os.environ.get('USERNAME', '')}:F"], check=True, capture_output=True)
    except Exception:
        print(f"SPR: could not limit {path} to your user alone; check who can read it", file=sys.stderr)


def _warn_if_open(path: str):
    if os.name == "nt":
        return
    try:
        if os.stat(path).st_mode & 0o077:
            print(f'SPR: {path} can be read by other users of this computer. Run: chmod 600 "{path}"', file=sys.stderr)
    except OSError:
        pass


def _zone_for(name: str):
    """The book's time zone. Windows has no time-zone database of its own; Python then reads the tzdata package."""
    if name in ("UTC", "Etc/UTC", "Z"):
        return timezone.utc
    try:
        return ZoneInfo(name)
    except Exception as e:
        hint = " Windows has no time-zone database of its own: run pip install tzdata." if os.name == "nt" else ""
        raise ValueError(f"Unknown time zone {name!r}; use an IANA name such as 'America/Los_Angeles'.{hint}") from e


def _payment_key(p):
    return f"{p['entity']}:{p['rail']}:{p['source']['id']}"


def _set_aside_torn_tail(path):
    """A line left unfinished by a crash is moved to <file>.torn, kept as evidence, so the next record starts on a line
    of its own and the book still opens. Called under the lock, so no other writer is part way through a line."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return
    if size == 0:
        return
    with open(path, "rb+") as f:
        f.seek(size - 1)
        if f.read(1) == b"\n":
            return
        f.seek(0)
        buf = f.read()
        end = buf.rfind(b"\n") + 1
        with open(path + ".torn", "ab") as t:
            t.write(buf[end:] + b"\n")
        f.truncate(end)


def _lock_owner_gone(lock) -> bool:
    """book.lock taken on this computer by a process that is no longer running. Not checked on Windows, where
    os.kill would end the process instead of testing it; there the 30-second rule applies."""
    if os.name == "nt":
        return False
    try:
        with open(lock, encoding="utf-8") as f:
            info = json.load(f)
        pid = int(info["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return False
    if info.get("host") != socket.gethostname() or pid == os.getpid():
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    return False


# ---- the Machine Payment Profile (draft 0.2, SPR RFC 0001) ----
# Optional facts about the agent, the principal, the mandate, the counterparty and the settlement, named after the
# Machine Payment Profile for XBRL GL. Each appears in a sealed payload only when it is given, so books that use
# none of them seal exactly what they sealed before.
def _identifier_of(v):
    if v is None or v == "":
        return None
    if isinstance(v, dict):
        return {"scheme": str(v["scheme"]) if v.get("scheme") else None, "value": str(v["value"])} if v.get("value") else None
    s = str(v)
    i = s.find(":")
    return {"scheme": s[:i], "value": s[i + 1:]} if i > 0 else {"scheme": None, "value": s}


def _mandate_ref_of(m):
    try:
        sha = L.sha256_hex(L.canonicalize(m))
    except Exception:
        sha = None
    return {"id": m.get("mandate_id"), "issuer": m.get("issuer"), "scope": m.get("scope"), "valid_from": m.get("valid_from"),
            "valid_until": m.get("valid_until"), "sha256": sha}


def _evidence_of(source_id, evidence, evidence_type, network, provider):
    """The settlement evidence: the evidence given whole, or built from the settlement's network, kind and provider."""
    if not evidence_type and not network and not provider:
        return evidence
    built = {"kind": evidence_type or "provider_reference", "network": network, "provider": provider}
    if evidence_type == "onchain":
        built.update({"chain": network, "tx_hash": source_id.lower() if re.fullmatch(r"0x[0-9a-fA-F]+", source_id) else source_id})
    else:
        built["reference"] = source_id
    return {**built, **(evidence or {})}


# The merchant's order ID and the processor's transaction ID: what a merchant's or a buyer's finance team, a
# processor and a card network use to find the same payment.
_REF_FIELDS = ("order_id", "processor_transaction_id", "invoice_ref")


def _ref_text(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def _payee_key(v):
    """One payee, however it is written: wallet addresses, domains and email addresses don't depend on case."""
    ident = _identifier_of(v)
    if not ident:
        return None
    scheme = (ident["scheme"] or "").lower()
    value = ident["value"].strip()
    if scheme in ("wallet", "domain", "email") or re.fullmatch(r"0x[0-9a-fA-F]+", value):
        value = value.lower()
    return f"{scheme}:{value}" if scheme else value


def _payment_refs_of(given_refs: dict, earlier) -> Optional[dict]:
    given = {}
    for k in _REF_FIELDS:
        v = given_refs.get(k)
        if v is None:
            continue
        if not isinstance(v, str) or not v.strip() or len(v) > 200:
            raise ValueError(f"{k} is the reference as text, up to 200 characters")
        given[k] = v.strip()
    # A retry that leaves them out keeps the ones first sealed; one that adds them keeps the others.
    refs = {**((earlier or {}).get("payment_refs") or {}), **given}
    return {k: refs[k] for k in _REF_FIELDS if k in refs} or None


# How the buyer proved it was them at checkout: a 3-D Secure result, a passkey, a network token's cryptogram, a
# one-time code, or the buyer's own signed mandate. The evidence itself stays with the merchant or its processor.
AUTH_METHODS = ("3ds", "passkey", "network_token", "otp", "agent_mandate", "other")


def _buyer_auth_of(a) -> Optional[dict]:
    if a is None:
        return None
    if not isinstance(a, dict):
        raise ValueError("buyer_authentication is a dict: {method, result, reference, sha256, at}")
    if a.get("method") not in AUTH_METHODS:
        raise ValueError(f"buyer_authentication.method is one of {', '.join(AUTH_METHODS)}")
    if not isinstance(a.get("result"), str) or not a["result"].strip():
        raise ValueError("buyer_authentication.result says how it ended, such as authenticated, attempted or failed")
    sha = a.get("sha256")
    if sha is not None and not re.fullmatch(r"[0-9a-fA-F]{64}", sha):
        raise ValueError("buyer_authentication.sha256 is the evidence's SHA-256 in hexadecimal (64 characters)")
    out = {"method": a["method"], "result": a["result"].strip()}
    for k in ("reference", "eci", "provider"):
        if a.get(k) is not None:
            out[k] = str(a[k])
    if sha is not None:
        out["sha256"] = sha.lower()
    if a.get("at") is not None:
        out["at"] = _iso(_instant(a["at"], "buyer_authentication.at"))
    return out


_ZERO_DECIMALS = {"JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "PYG", "RWF", "KMF", "GNF", "DJF", "BIF", "VUV", "XPF"}
_THREE_DECIMALS = {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}
_TOKEN_DECIMALS = {"USDC": 6, "USDT": 6, "EURC": 6, "PYUSD": 6, "USDG": 6}


def _money(minor: int, currency: str) -> str:
    d = _TOKEN_DECIMALS.get(currency, 0 if currency in _ZERO_DECIMALS else 3 if currency in _THREE_DECIMALS else 2)
    s = str(abs(minor)).rjust(d + 1, "0")
    return f"{s[:-d]}.{s[-d:]} {currency}" if d else f"{s} {currency}"


def _dispute_summary(p: dict, delivery: Optional[dict], key_id: str) -> str:
    """The dispute package's statement in plain words. Every line says what a sealed file in the package shows."""
    out = [f"Payment evidence for {p['record_id']}", ""]
    out.append(f"Payment: {_money(p['amount_minor'], p['currency'])} {'received by' if p.get('direction') == 'inflow' else 'paid by'} {p['entity']} on {p.get('occurred_at') or p.get('settled_on')}, {p['rail']} reference {p['source']['id']}.")
    refs = p.get("payment_refs") or {}
    parts = [x for x in (refs.get("order_id") and f"order {refs['order_id']}", refs.get("processor_transaction_id") and f"processor transaction {refs['processor_transaction_id']}",
                         refs.get("invoice_ref") and f"invoice {refs['invoice_ref']}") if x]
    if parts:
        out.append(f"References: {', '.join(parts)}.")
    b = p.get("buyer_intent")
    if b:
        out.append(f"Authorized by: {b.get('entity') or 'the buyer'}{', through its agent ' + b['agent'] if b.get('agent') else ''}. Before paying, it declared this purchase: \"{b['purpose']}\" (intent {b['intent_id']}). The declaration is sealed with the buyer's own key, {b['key_id']}, and checks with it.")
        out.append("Against that declaration: " + "; ".join(f"{'passed' if c['ok'] else 'FAILED'} {c['check'].replace('_', ' ')} ({c['detail']})" for c in b["checks"]) + ".")
    else:
        out.append("Authorized by: no buyer's intent is recorded for this payment.")
    a = p.get("buyer_authentication")
    if a:
        out.append(f"Buyer authentication: {a['method']}, {a['result']}" + (f", reference {a['reference']}" if a.get("reference") else "") + (f", ECI {a['eci']}" if a.get("eci") else "")
                   + (f", by {a['provider']}" if a.get("provider") else "") + (f", at {a['at']}" if a.get("at") else "") + (f"; the evidence's SHA-256 is {a['sha256']}" if a.get("sha256") else "") + ".")
    else:
        out.append("Buyer authentication: none recorded.")
    if delivery:
        out.append("Delivery: " + ", ".join(x for x in (delivery.get("method"), delivery.get("delivered_at") and f"delivered {delivery['delivered_at']}",
                                                       delivery.get("reference") and f"reference {delivery['reference']}", delivery.get("sha256") and f"proof SHA-256 {delivery['sha256']}") if x) + ".")
    out.append("")
    out.append(f"Every statement above comes from a file in this package sealed with {p['entity']}'s key {key_id}, or with the buyer's own key. Check the package with: spr-verify <folder> --key {key_id}")
    return "\n".join(out) + "\n"


def _profile_facts_of(counterparty_type, counterparty_id, receipt):
    out, ident = {}, _identifier_of(counterparty_id)
    if counterparty_type or ident:
        out["counterparty_ref"] = {"type": counterparty_type, "identifier": ident}
    if receipt and (receipt.get("ref") or receipt.get("sha256")):
        sha = receipt.get("sha256")
        if sha and not re.fullmatch(r"[0-9a-fA-F]{64}", sha):
            raise ValueError("receipt.sha256 is the receipt's SHA-256 in hexadecimal (64 characters)")
        out["receipt"] = {"ref": receipt.get("ref"), "sha256": sha.lower() if sha else None, "kind": receipt.get("kind")}
    return out


def _line(row) -> str:
    return json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"


def _pem(key) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def _writes(fn):
    @functools.wraps(fn)
    def wrapper(self, *a, **k):
        return self._locked(lambda: fn(self, *a, **k))
    return wrapper




def _iso(d: datetime) -> str:
    d = d.astimezone(timezone.utc)
    s = d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
    return s.replace(".000Z", "Z")


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


_INSTANT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})")


def _instant(value, what: str) -> datetime:
    """A time the agent gives must carry its offset. Without one, Python reads it in this computer's time zone."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise ValueError(f"{what} must carry its time zone: a datetime without tzinfo could be any time zone")
        return value
    if not isinstance(value, str) or not _INSTANT.fullmatch(value):
        raise ValueError(f"{what} must be an ISO 8601 time with its offset, such as 2026-10-28T12:00:00Z or 2026-10-28T12:00:00-07:00. "
                         f"{json.dumps(value)} has none, so it could be any time zone")
    return _parse(value)


# A local book's limits (mandate.json) are written by whoever keeps the book, so a check against them shows the agent
# stayed inside limits the company's own folder declares. It is not authority granted by someone else.
SELF_DECLARED = "self-declared"


def _duration(s: str) -> timedelta:
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?", s or "")
    if not m or not any(m.groups()):
        raise ValueError(f"expires_in must be an ISO 8601 duration such as PT1H or P3D, got {s}")
    return timedelta(days=int(m[1] or 0), hours=int(m[2] or 0), minutes=int(m[3] or 0))


class SprBook:
    def __init__(self, dir: str, agent_id: str, entity: str, owner: Optional[str] = None, time_zone: str = "UTC",
                 binding: bool = False, key: Optional[ed25519.Ed25519PrivateKey] = None, now=None, producer: Optional[dict] = None,
                 allow_synced_folder: bool = False, agent_type: Optional[str] = None, agent_provider: Optional[str] = None,
                 agent_version: Optional[str] = None, entity_type: Optional[str] = None, entity_identifier=None):
        if not (agent_id or "").strip() or not (entity or "").strip():
            raise ValueError("The book needs the agent's ID (agent_id) and the company it pays for (entity)")
        self.dir, self.agent_id, self.entity, self.owner = dir, agent_id, entity, owner
        self.time_zone, self.binding, self._now = time_zone, binding, now or (lambda: datetime.now(timezone.utc))
        self._zone = _zone_for(time_zone)
        self.producer = producer or SDK_PRODUCER
        # Machine Payment Profile (RFC 0001): sealed only when set. entity_identifier is "scheme:value", such as "lei:5493…".
        self.agent_type, self.agent_provider, self.agent_version = agent_type, agent_provider, agent_version
        self.entity_type, self.entity_identifier = entity_type, entity_identifier
        os.makedirs(dir, exist_ok=True)
        synced = synced_folder_of(dir)
        if synced and not allow_synced_folder and os.environ.get("SPR_ALLOW_SYNCED_FOLDER") != "1":
            raise ValueError(f"The book's folder {dir} is inside {synced}, which syncs to the cloud: the private key would be uploaded, and two machines "
                             "syncing one book would not see each other's lock. Choose a folder outside it, or pass allow_synced_folder=True "
                             "(SPR_ALLOW_SYNCED_FOLDER=1) if you accept that.")
        self.key_file = None if key is not None else os.path.join(dir, "key.pem")
        self._depth = 0
        self.key = None
        self._reset()

        def setup():
            k = key
            if k is None:
                if os.path.exists(self.key_file):
                    _warn_if_open(self.key_file)
                    with open(self.key_file, "rb") as f:
                        k = serialization.load_pem_private_key(f.read(), None)
                else:
                    k = ed25519.Ed25519PrivateKey.generate()
                    fd = os.open(self.key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, "wb") as f:
                        f.write(_pem(k))
                    _protect_key_file(self.key_file)
            if not isinstance(k, ed25519.Ed25519PrivateKey):
                raise ValueError("The book's key must be Ed25519")
            self.key, self.key_id = k, L.key_id_for(k)
            if self.key_id in TEST_KEY_IDS:
                raise ValueError(f"Key {self.key_id} is a published test key from the SPR vectors; anyone can sign with it. Use a key of your own")
            self._check_not_retired()
            if self.key_id not in self.keyring:
                self._append("keys.jsonl", {"key_id": self.key_id, "algorithm": "ed25519", "public_pem": L.public_key_pem_of(k),
                                            "created_at": _iso(self._now()), "owner": entity})
        self._locked(setup)

    # ---- the folder ----
    # What is in memory, rebuilt from the files. Each file is read from where the last read stopped, so a write by
    # another process is picked up and a large book is not read again on every call.
    def _reset(self):
        self._offsets = {}
        self.keyring = {}
        self.intents = {}
        self._by_nonce = {}
        self.cancellations = {}
        self.records = []
        self._by_payment = {}
        self.labels = []
        self.approved_checks = []  # pre-payment checks that approved, for the duplicate check
        self.buyer_intents = {}  # payload hash -> {intent, key}: buyers' own sealed intents, kept by a merchant

    def _refresh(self):
        for n in FILES:
            p = os.path.join(self.dir, n)
            if not os.path.exists(p):
                if self._offsets.get(n):
                    self._reset()
                    return self._refresh()
                continue
            size, start = os.path.getsize(p), self._offsets.get(n, 0)
            if size < start:
                self._reset()
                return self._refresh()
            if size == start:
                continue
            with open(p, "rb") as f:
                f.seek(start)
                buf = f.read(size - start)
            end = buf.rfind(b"\n")
            if end < 0:
                continue
            self._offsets[n] = start + end + 1
            for l in buf[: end + 1].decode("utf-8").split("\n"):
                if l.strip():
                    self._ingest(n, json.loads(l))

    def _ingest(self, name, row):
        if name == "keys.jsonl":
            self.keyring[row["key_id"]] = row
        elif name == "intents.jsonl":
            self.intents[row["payload"]["intent_id"]] = row
            self._by_nonce[L.intent_nonce(row["seal"]["payload_sha256"])] = row
        elif name == "cancellations.jsonl":
            self.cancellations[row["payload"]["intent_id"]] = row
        elif name == "records.jsonl":
            self.records.append(row)
            self._by_payment[_payment_key(row["payload"])] = row
        elif name == "labels.jsonl":
            self.labels.append(row)
        elif name == "checks.jsonl" and row["payload"].get("decision") == "approve":
            self.approved_checks.append(row["payload"])
        elif name == "buyer-intents.jsonl":
            self.buyer_intents[L.normalize_seal(row["intent"]["seal"])["payload_sha256"]] = row

    def _locked(self, fn):
        if self._depth > 0:
            self._depth += 1
            try:
                return fn()
            finally:
                self._depth -= 1
        lock, deadline = os.path.join(self.dir, "book.lock"), time.monotonic() + LOCK_WAIT
        while True:
            try:
                fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as f:
                    f.write(json.dumps({"pid": os.getpid(), "host": socket.gethostname(), "at": _iso(datetime.now(timezone.utc))}))
                break
            except (FileExistsError, PermissionError) as e:
                # On Windows a lock another process is letting go of can refuse the open with PermissionError for a moment.
                if isinstance(e, PermissionError) and time.monotonic() > deadline:
                    raise
                if isinstance(e, FileExistsError) and _lock_owner_gone(lock):
                    try:
                        os.remove(lock)
                    except OSError:
                        pass
                    continue
                try:
                    if time.time() - os.path.getmtime(lock) > LOCK_STALE:
                        os.remove(lock)
                        continue
                except OSError:
                    time.sleep(0.005)
                    continue
                if time.monotonic() > deadline:
                    raise TimeoutError(f"The book at {self.dir} is busy: another process has held book.lock for over {int(LOCK_WAIT)} seconds. "
                                       "If no other process is using the book, delete book.lock.")
                time.sleep(0.02)
        self._depth = 1
        try:
            self._refresh()
            if self.key is not None:
                self._check_not_retired()
            return fn()
        finally:
            self._depth = 0
            for attempt in range(50):
                try:
                    os.remove(lock)
                    break
                except FileNotFoundError:
                    break
                except PermissionError:
                    if attempt == 49:
                        raise
                    time.sleep(0.02)

    def _check_not_retired(self):
        """Another process may have rotated the key: pick up the new key from key.pem, or stop if the key was passed in."""
        while True:
            nxt = next((k for k in self.keyring.values() if ((k.get("rotation") or {}).get("payload") or {}).get("from") == self.key_id), None)
            if not nxt:
                return
            if not self.key_file:
                raise ValueError(f"The book's key {self.key_id} was rotated to {nxt['key_id']}; open the book with the new key")
            with open(self.key_file, "rb") as f:
                k = serialization.load_pem_private_key(f.read(), None)
            if L.key_id_for(k) == self.key_id:
                raise ValueError(f"The book's key {self.key_id} was rotated to {nxt['key_id']}, but key.pem still holds the old key")
            self.key, self.key_id = k, L.key_id_for(k)

    def _append(self, name, row):
        path = os.path.join(self.dir, name)
        _set_aside_torn_tail(path)
        with open(path, "a", encoding="utf-8", newline="") as f:
            f.write(_line(row))
            f.flush()
            os.fsync(f.fileno())
        self._refresh()

    def _agent_info(self):
        a = {"id": self.agent_id, "owner": self.owner}
        for k, v in (("type", self.agent_type), ("provider", self.agent_provider), ("version", self.agent_version)):
            if v:
                a[k] = v
        return a

    def _principal_info(self):
        ident = _identifier_of(self.entity_identifier)
        return {"principal": {"type": self.entity_type, "identifier": ident}} if self.entity_type or ident else {}

    def _seal_row(self, payload):
        return {"payload": payload, "seal": L.seal_with(payload, self.key)}

    def _mandate(self):
        p = os.path.join(self.dir, "mandate.json")
        if not os.path.exists(p):
            return None
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def _local_date(self, at: datetime) -> str:
        return at.astimezone(self._zone).strftime("%Y-%m-%d")

    def _mandate_checks(self, amount, currency, at, payee=...):
        # With a payee given (... skips it), a mandate that lists its payees is checked against it too.
        m = self._mandate()
        if not m:
            return {"decision": "none", "authority": "none", "checks": [], "mandate_id": None}
        checks = []
        if m.get("currency"):
            checks.append({"check": "currency", "ok": not currency or currency == m["currency"], "detail": f"Mandate in {m['currency']}; intent in {currency or 'no currency'}"})
        if "max_per_payment_minor" in m:
            checks.append({"check": "per_payment", "ok": amount is None or amount <= m["max_per_payment_minor"], "detail": f"Limit {m['max_per_payment_minor']}; up to {amount if amount is not None else 'no amount given'}"})
        if m.get("valid_from") or m.get("valid_until"):
            ok = (not m.get("valid_from") or at >= _parse(m["valid_from"])) and (not m.get("valid_until") or at <= _parse(m["valid_until"]))
            checks.append({"check": "in_date", "ok": ok, "detail": f"Valid {m.get('valid_from') or 'any time'} to {m.get('valid_until') or 'no end'}"})
        if isinstance(m.get("payees"), list) and payee is not ...:
            listed = [k for k in (_payee_key(x["id"] if isinstance(x, dict) and not x.get("value") else x) for x in m["payees"]) if k]
            ok = payee is not None and payee in listed
            detail = ("No payee given, and the mandate pays only the payees it lists" if payee is None
                      else f"{payee} is on the mandate's list of payees" if ok else f"{payee} is not on the mandate's list of payees")
            checks.append({"check": "approved_payee", "ok": ok, "detail": detail})
        return {"decision": "within_mandate" if all(c["ok"] for c in checks) else "outside_mandate", "authority": SELF_DECLARED, "checks": checks,
                "mandate_id": m.get("mandate_id")}

    # ---- before paying ----
    @_writes
    def declare(self, purpose: str, max_amount_minor: Optional[int] = None, currency: Optional[str] = None, counterparty: Optional[str] = None,
                expected_amount_minor: Optional[int] = None, rail: Optional[str] = None, rail_ref: Optional[dict] = None,
                terms: Optional[dict] = None, expires_in: Optional[str] = None, expires_in_hours: Optional[int] = None,
                product: Optional[str] = None, payee_id=None) -> dict:
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
        payee = _identifier_of(payee_id) if payee_id else None
        pre = self._mandate_checks(cap if cap is not None else expected_amount_minor, cur, now, _payee_key(payee) if payee else ...)
        payload = {
            "schema": INTENT_SCHEMA, "intent_id": "int_" + secrets.token_hex(10),
            "agent": self._agent_info(), "entity": self.entity, **self._principal_info(), "mandate_id": pre.get("mandate_id"),
            **({"mandate": _mandate_ref_of(self._mandate())} if self._mandate() else {}),
            "purpose": purpose.strip(), "counterparty": counterparty, **({"payee": payee} if payee else {}), "expected_amount_minor": expected_amount_minor,
            "max_amount_minor": cap, "currency": cur, "rail": rail, "rail_ref": rail_ref, "terms": terms, **({"product": str(product)} if product else {}),
            "declared_at": _iso(now), "expires_at": _iso(now + ttl), "precheck": {"decision": pre["decision"], "authority": pre["authority"], "checks": pre["checks"]},
            "producer": self.producer,
        }
        row = self._seal_row(payload)
        self._append("intents.jsonl", row)
        return {"intent_id": payload["intent_id"], "decision": pre["decision"], "authority": pre["authority"], "checks": pre["checks"], "declared_at": payload["declared_at"],
                "expires_at": payload["expires_at"], "max_amount_minor": cap, "seal": row["seal"],
                "binding": {"scheme": L.INTENT_NONCE_SCHEME, "nonce": L.intent_nonce(row["seal"]["payload_sha256"])} if self.binding else None}

    record_intent = declare

    def nonce_for(self, intent_id: str, seq: int = 0) -> str:
        i = self.intents.get(intent_id)
        if not i:
            raise KeyError(f"No intent {intent_id} in this book")
        return L.intent_nonce(i["seal"]["payload_sha256"], seq)

    @_writes
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
        return row["payload"]

    def get_intent(self, intent_id: str) -> dict:
        self._refresh()
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
            return self._by_nonce.get(nonce.lower())
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

    @_writes
    def check_payment(self, amount_minor: int, currency: str, counterparty: Optional[str] = None, intent_id: Optional[str] = None,
                      nonce: Optional[str] = None, payee_id=None, invoice_ref: Optional[str] = None,
                      ) -> dict:
        now = self._now()
        payee = _payee_key(payee_id)
        cur = currency.upper()
        i = self._intent_for(intent_id, nonce)
        consent = self._consent(i, now, amount_minor, cur, nonce) if i else None
        m = self._mandate_checks(abs(amount_minor), cur, now, payee)
        intent_payee = _payee_key(i["payload"]["payee"]) if i and i["payload"].get("payee") else None
        checks = [{"check": "open_intent", "ok": bool(i), "detail": f"Intent {i['payload']['intent_id']}" if i else "No intent named or matched by the nonce"}]
        checks += [c for c in (consent or {}).get("checks", []) if c["severity"] == "hard"]
        if intent_payee:
            checks.append({"check": "payee_matches_intent", "ok": payee == intent_payee,
                           "detail": f"Paying {payee}, the payee the intent named" if payee == intent_payee else f"The intent named {intent_payee}; this payment is to {payee or 'a payee not given'}"})
        checks += m["checks"]
        checks += self._duplicate_checks(_ref_text(invoice_ref), payee, counterparty, abs(amount_minor), cur, now, i["payload"]["intent_id"] if i else None)
        request = {"amount_minor": amount_minor, "currency": currency, "counterparty": counterparty, "intent_id": intent_id, "nonce": nonce,
                   "payee_id": payee_id, "invoice_ref": invoice_ref}
        row = self._seal_row({"schema": "luca.payment-check/0.1", "id": "pck_" + secrets.token_hex(8), "checked_at": _iso(now), "agent": self.agent_id,
                              "intent_id": i["payload"]["intent_id"] if i else None,
                              "request": {k: v for k, v in request.items() if v is not None}, "decision": "approve" if all(c["ok"] for c in checks) else "decline",
                              "authority": m["authority"], "checks": checks, "producer": self.producer})
        self._append("checks.jsonl", row)
        if row["payload"]["decision"] == "approve":
            self.approved_checks.append(row["payload"])
        return {"id": row["payload"]["id"], "decision": row["payload"]["decision"], "authority": m["authority"], "checks": checks,
                "reasons": [f"{c['check']}: {c['detail']}" for c in checks if not c["ok"]], "seal": row["seal"]}

    def _current(self):
        return list(self._by_payment.values())

    def _duplicate_checks(self, invoice, payee, counterparty, amount, currency, at, intent_id):
        """The same invoice paid twice, or (where the mandate sets duplicate_window) the same amount to the same payee again
        within the window. Payments already recorded count, and so do approvals under another intent, since a payment
        approved a moment ago may not be recorded yet. A retry under the same intent is not a duplicate."""
        out = []
        party_of = lambda pk, name: pk or (f"name:{name}" if name else None)
        party = party_of(payee, counterparty)
        rec_party = lambda r: party_of(_payee_key((r.get("counterparty_ref") or {}).get("identifier")), r.get("counterparty"))
        chk_party = lambda c: party_of(_payee_key((c.get("request") or {}).get("payee_id")), (c.get("request") or {}).get("counterparty"))
        other_intent = lambda c: (c.get("intent_id") or (c.get("request") or {}).get("intent_id")) != intent_id
        outflows = [r["payload"] for r in self._current() if r["payload"].get("direction") != "inflow" and r["payload"].get("state") != "refunded"]
        if invoice:
            same = lambda x: not party or not x or x == party
            paid = next((r for r in outflows if (r.get("payment_refs") or {}).get("invoice_ref") == invoice and same(rec_party(r))), None)
            appr = next((c for c in self.approved_checks if _ref_text((c.get("request") or {}).get("invoice_ref")) == invoice and other_intent(c) and same(chk_party(c))), None)
            detail = (f"Invoice {invoice} was already paid: {paid['record_id']}" if paid else
                      f"Invoice {invoice} was already approved for payment: {appr['id']}" if appr else f"Invoice {invoice} has not been paid before")
            out.append({"check": "not_already_paid", "ok": not paid and not appr, "detail": detail})
        w = (self._mandate() or {}).get("duplicate_window")
        if w and party:
            try:
                since = at - _duration(w)
            except ValueError:
                raise ValueError(f"duplicate_window in mandate.json must be an ISO 8601 duration such as P1D or PT12H, got {w}")
            same_amount = lambda a, c: abs(a) == amount and str(c or "").upper() == currency
            paid = next((r for r in outflows if rec_party(r) == party and same_amount(r["amount_minor"], r["currency"]) and _parse(r["occurred_at"]) >= since), None)
            appr = next((c for c in self.approved_checks if chk_party(c) == party and other_intent(c)
                         and same_amount((c.get("request") or {}).get("amount_minor") or 0, (c.get("request") or {}).get("currency")) and _parse(c["checked_at"]) >= since), None)
            hit = paid["record_id"] if paid else appr["id"] if appr else None
            out.append({"check": "not_a_repeat", "ok": not hit,
                        "detail": f"The same amount to {party} within {w}: {hit}" if hit else f"No payment of the same amount to {party} within {w}"})
        return out

    # ---- after paying ----
    @_writes
    def seal(self, rail: str, source_id: str, amount_minor: int, currency: str, occurred_at: Optional[str] = None, counterparty: Optional[str] = None,
             intent_id: Optional[str] = None, memo: Optional[str] = None, state: Optional[str] = None, direction: str = "outflow",
             nonce: Optional[str] = None, evidence: Optional[dict] = None, correction: Optional[dict] = None,
             network: Optional[str] = None, evidence_type: Optional[str] = None, settlement_provider: Optional[str] = None,
             counterparty_type: Optional[str] = None, counterparty_id=None, receipt: Optional[dict] = None,
             order_id: Optional[str] = None, processor_transaction_id: Optional[str] = None, invoice_ref: Optional[str] = None,
             buyer_intent: Optional[dict] = None, buyer_key=None, buyer_authentication: Optional[dict] = None,
             ) -> dict:
        if not rail or not source_id:
            raise ValueError("rail and source_id are required")
        if not L._safe_int(amount_minor):
            raise ValueError("amount_minor must be an integer in minor units")
        if not currency:
            raise ValueError("currency is required")
        cur = currency.upper()
        src = source_id.lower() if re.fullmatch(r"0x[0-9a-fA-F]+", source_id) else source_id
        key = f"{self.entity}:{rail}:{src}"
        earlier = self._by_payment.get(key)
        # Without occurred_at the record says so and takes the time of sealing; a retry keeps the time first sealed.
        given = occurred_at is not None
        at = _instant(occurred_at, "occurred_at") if given else _parse(earlier["payload"]["occurred_at"]) if earlier else self._now()
        time_note = None if given else (earlier["payload"].get("occurred_at_source") if earlier else "not given: the time the book sealed it")
        nonce = nonce.lower() if nonce else None
        i = self._intent_for(intent_id, nonce)
        if intent_id and not i:
            raise KeyError(f"No intent {intent_id} in this book")
        consent = self._consent(i, at, amount_minor, cur, nonce) if i and direction == "outflow" else None
        refs = _payment_refs_of({"order_id": order_id, "processor_transaction_id": processor_transaction_id, "invoice_ref": invoice_ref},
                                earlier["payload"] if earlier else None)
        # At a merchant: the buyer's own sealed intent, checked with the buyer's key, and how the buyer authenticated.
        buyer = self._buyer_intent_of(buyer_intent, buyer_key, at, amount_minor, cur) if buyer_intent else None
        b_intent = buyer["ref"] if buyer else (earlier["payload"].get("buyer_intent") if earlier else None)
        b_auth = _buyer_auth_of(buyer_authentication) or (earlier["payload"].get("buyer_authentication") if earlier else None)
        facts = {"direction": direction, "state": "refunded" if amount_minor < 0 else "pending" if state == "pending" else "cleared",
                 "amount_minor": amount_minor, "currency": cur, "occurred_at": _iso(at), "counterparty": counterparty, "memo": memo,
                 "intent": {"intent_id": i["payload"]["intent_id"], "payload_sha256": i["seal"]["payload_sha256"]} if i else None}
        if refs:
            facts["payment_refs"] = refs
        if b_intent:
            facts["buyer_intent"] = b_intent
        if b_auth:
            facts["buyer_authentication"] = b_auth
        # The same facts again are a retry. Different facts under the same payment are a correction, and need a reason;
        # only a pending payment clearing is taken as it comes.
        fix = None
        if earlier:
            changed = [k for k, v in facts.items() if L.canonicalize(v) != L.canonicalize(earlier["payload"].get(k))]
            if not changed:
                return {"status": "unchanged", "record_id": earlier["payload"]["record_id"], "seal": earlier["seal"]}
            # Taken as it comes: a pending payment clearing, and an order or processor reference added where none was sealed.
            had = earlier["payload"].get("payment_refs") or {}
            added = lambda k: ((k == "payment_refs" and all((refs or {}).get(f) == v for f, v in had.items()))
                               or (k in ("buyer_intent", "buyer_authentication") and k not in earlier["payload"]))
            clearing = all((k == "state" and earlier["payload"].get("state") == "pending") or added(k) for k in changed)
            reason = (correction or {}).get("reason")
            reason = reason.strip() if isinstance(reason, str) else ""
            if not clearing and not reason:
                return {"status": "conflict", "record_id": earlier["payload"]["record_id"], "sealed": False,
                        "differs": [{"field": k, "sealed": earlier["payload"].get(k), "given": facts[k]} for k in changed],
                        "how": "Nothing was sealed. If the sealed record is wrong, call again with correction={'reason': ...}. If this is another payment, give it its own source_id."}
            if reason:
                fix = {"reason": reason}
        version = earlier["payload"]["version"] + 1 if earlier else 1
        source_input = {k: v for k, v in {"rail": rail, "source_id": source_id, "amount_minor": amount_minor, "currency": currency, "occurred_at": occurred_at,
                        "counterparty": counterparty, "intent_id": intent_id, "memo": memo, "state": state, "nonce": nonce, "evidence": evidence,
                        "network": network, "evidence_type": evidence_type, "settlement_provider": settlement_provider,
                        "counterparty_type": counterparty_type, "counterparty_id": counterparty_id, "receipt": receipt,
                        "order_id": order_id, "processor_transaction_id": processor_transaction_id, "invoice_ref": invoice_ref,
                        }.items() if v is not None}
        payload = {
            "schema": RECORD_SCHEMA, "record_id": f"LR-{rail.upper()}-{L.sha256_hex(key)[:10].upper()}-v{version}",
            "version": version, "supersedes": earlier["payload"]["record_id"] if earlier else None,
            "changed": [k for k in facts if earlier and L.canonicalize(facts[k]) != L.canonicalize(earlier["payload"].get(k))],
            "entity": self.entity, "entity_id": self.entity, "rail": rail, "reported_by": "agent",
            "source": {"id": src, "payload_sha256": L.hash_source_payload(source_input)},
            **facts,
            **({"occurred_at_source": time_note} if time_note else {}),
            **({"correction": fix} if fix else {}),
            "time_zone": self.time_zone, "settled_on": self._local_date(at),
            "agent": self._agent_info(),
            "rail_authorization": [{"scheme": f"{rail}_payment", "reference": nonce}] if nonce else [],
            "consent": consent, "evidence": _evidence_of(source_id, evidence, evidence_type, network, settlement_provider),
            **self._principal_info(), **_profile_facts_of(counterparty_type, counterparty_id, receipt), "producer": self.producer,
        }
        problems = L.check_record(payload)["problems"]
        if problems:
            raise ValueError(f"The record would not meet SPR: {'; '.join(problems)}")
        if buyer and buyer["ref"]["payload_sha256"] not in self.buyer_intents:
            b = {"intent": buyer["intent"], "key": buyer["key"]}
            self._append("buyer-intents.jsonl", b)
            self.buyer_intents[buyer["ref"]["payload_sha256"]] = b
        row = self._seal_row(payload)
        self._append("records.jsonl", row)
        return {"status": "new_version" if earlier else "recorded", "record_id": payload["record_id"],
                "within_consent": consent["within_consent"] if consent else None, "binding": consent["binding"]["status"] if consent else None,
                "checks": consent["checks"] if consent else [],
                "seal": row["seal"]}

    record_settlement = seal

    def _buyer_intent_of(self, intent: dict, key, at: datetime, amount: int, currency: str) -> dict:
        """The buyer's sealed intent as a merchant receives it at checkout, with the buyer's public key. Its seal must check
        with that key; then it is compared with the payment: declared before it, not expired, and within its cap."""
        pem = key if isinstance(key, str) else (key or {}).get("public_pem")
        if not pem:
            raise ValueError("buyer_key is the buyer's public key (PEM, or {'public_pem': ...}), so the buyer's intent can be checked")
        try:
            kid = L.key_id_for(pem)
        except Exception:
            raise ValueError("buyer_key is not a public key SPR can read (Ed25519, PEM)")
        s = L.normalize_seal((intent or {}).get("seal") or {})
        if s["key_id"] != kid:
            raise ValueError(f"The buyer's intent is sealed by {s['key_id']}, not by the buyer key given ({kid})")
        alg = (key.get("algorithm") if isinstance(key, dict) else None) or s["algorithm"]
        if not L.verify_seal(intent.get("payload"), s, pem, alg)["ok"]:
            raise ValueError("The buyer's intent does not check with the buyer's key: it was changed, or sealed by another key")
        c = L.check_intent(intent["payload"])
        if not c["ok"]:
            raise ValueError(f"The buyer's intent is missing SPR's core fields: {'; '.join(c['problems'])}")
        ip, checks = intent["payload"], []
        checks.append({"check": "declared_before_payment", "ok": at + CLOCK_SKEW >= _parse(ip["declared_at"]), "detail": f"Declared {ip['declared_at']}; paid {_iso(at)}"})
        checks.append({"check": "before_intent_expiry", "ok": at <= _parse(ip["expires_at"]), "detail": f"Expires {ip['expires_at']}; paid {_iso(at)}"})
        if ip.get("max_amount_minor") is not None:
            comparable = not ip.get("currency") or ip["currency"] == currency
            checks.append({"check": "within_intent_cap", "ok": comparable and abs(amount) <= ip["max_amount_minor"],
                           "detail": f"Cap {ip['max_amount_minor']}; paid {abs(amount)} ({currency} minor units)" if comparable
                           else f"Paid in {currency}, which cannot be compared with the {ip['currency']} cap"})
        entity = (key.get("entity") if isinstance(key, dict) else None) or ip.get("entity")
        k = {"key_id": kid, "algorithm": (key.get("algorithm") if isinstance(key, dict) else None) or "ed25519", "public_pem": L.public_key_pem_of(pem), **({"entity": entity} if entity else {})}
        return {"intent": {"payload": ip, "seal": intent["seal"]}, "key": k,
                "ref": {"intent_id": ip["intent_id"], "payload_sha256": s["payload_sha256"], "key_id": kid, "entity": ip.get("entity") or entity,
                        "agent": (ip.get("agent") or {}).get("id"), "purpose": ip["purpose"], "within_intent": all(x["ok"] for x in checks), "checks": checks}}

    # ---- the label (SPR section 7) ----
    @_writes
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
        return row

    @_writes
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
        return row

    def verify_record(self, record_id: str) -> dict:
        self._refresh()
        r = next((x for x in self.records if x["payload"]["record_id"] == record_id), None)
        if not r:
            raise KeyError(f"No record {record_id} in this book")
        # Checked with the key that sealed it, which may be an earlier key of the book.
        key_id = L.normalize_seal(r["seal"])["key_id"]
        k = self.keyring.get(key_id)
        v = L.verify_seal(r["payload"], r["seal"], k["public_pem"]) if k else {"ok": False, "hash_matches": False, "signature_valid": False}
        core = L.check_record(r["payload"])
        return {"record_id": record_id, **v, "ok": v["ok"] and core["ok"], "core_fields": core, "key_id": key_id}

    def list_records(self, all: bool = False) -> list:
        self._refresh()
        return [{"record_id": r["payload"]["record_id"], "rail": r["payload"]["rail"], "amount_minor": r["payload"]["amount_minor"],
                 "currency": r["payload"]["currency"], "settled_on": r["payload"]["settled_on"], "counterparty": r["payload"].get("counterparty"),
                 "intent_id": (r["payload"].get("intent") or {}).get("intent_id"), "within_consent": (r["payload"].get("consent") or {}).get("within_consent"),
                 "payload_sha256": r["seal"]["payload_sha256"]} for r in (self.records if all else self._current())]

    def public_key(self) -> dict:
        """The book's public key: what finance registers with Luca once, so the book can be sent (send_to_luca)."""
        return {"key_id": self.key_id, "public_pem": L.public_key_pem_of(self.key), "entity": self.entity, "agent_id": self.agent_id}

    def package_files(self) -> dict:
        """The book as a package (SPR section 8): each file by name, as text, with a sealed manifest of their hashes."""
        def build():
            files = {}
            for n in FILES:
                p = os.path.join(self.dir, n)
                if os.path.exists(p):
                    with open(p, encoding="utf-8", newline="") as f:
                        files[n] = f.read()
            return self._seal_package(files)
        return self._locked(build)

    def _seal_package(self, files: dict, part: Optional[dict] = None) -> dict:
        pkg = {"schema": "luca.local-package/0.1", "entity": self.entity, "generated_at": _iso(self._now()), "producer": self.producer,
               "format": L.SPEC_VERSION, **({"part": part} if part else {}),
               "files": [{"name": n, "sha256": L.sha256_hex(t.encode("utf-8"))} for n, t in files.items()]}
        return {**files, "manifest.json": json.dumps({"package": pkg, "seal": L.seal_with(pkg, self.key)}, indent=2, ensure_ascii=False) + "\n"}

    def package_parts(self, max_records: int = PART_MAX_RECORDS, max_bytes: int = PART_MAX_BYTES) -> list:
        """The book in parts that each stand on their own: every version of a payment stays in one part, with the intents
        and withdrawals its records name, and the book's keys. A book under the limits is one part, the whole book."""
        def build():
            whole = sum(os.path.getsize(os.path.join(self.dir, n)) for n in FILES if os.path.exists(os.path.join(self.dir, n)))
            if len(self.records) <= max_records and whole <= max_bytes:
                return [self.package_files()]
            chains = {}
            for r in self.records:
                chains.setdefault(_payment_key(r["payload"]), []).append(r)
            keys_text = "".join(_line(k) for k in self.keyring.values())
            groups, cur, size = [], [], 0
            for chain in chains.values():
                b = sum(len(_line(r).encode("utf-8")) for r in chain)
                if cur and (len(cur) + len(chain) > max_records or size + b > max_bytes):
                    groups.append(cur)
                    cur, size = [], 0
                cur += chain
                size += b
            if cur:
                groups.append(cur)
            parts = []
            for n, g in enumerate(groups, 1):
                ids = list(dict.fromkeys((r["payload"].get("intent") or {}).get("intent_id") for r in g if (r["payload"].get("intent") or {}).get("intent_id")))
                files = {"keys.jsonl": keys_text}
                intents = [self.intents[i] for i in ids if i in self.intents]
                if intents:
                    files["intents.jsonl"] = "".join(_line(i) for i in intents)
                cancels = [self.cancellations[i] for i in ids if i in self.cancellations]
                if cancels:
                    files["cancellations.jsonl"] = "".join(_line(c) for c in cancels)
                files["records.jsonl"] = "".join(_line(r) for r in g)
                buyers = [self.buyer_intents[h] for h in dict.fromkeys((r["payload"].get("buyer_intent") or {}).get("payload_sha256") for r in g) if h in self.buyer_intents]
                if buyers:
                    files["buyer-intents.jsonl"] = "".join(_line(b) for b in buyers)
                parts.append(self._seal_package(files, {"index": n, "of": len(groups)}))
            return parts
        return self._locked(build)

    @_writes
    def rotate_key(self, key: Optional[ed25519.Ed25519PrivateKey] = None, reason: Optional[str] = None) -> dict:
        """A new key for the book, handed over by the old one: keys.jsonl gains the new public key with a handover sealed
        by the old key. Records sealed before stay checkable. The book's own key.pem is replaced; a key passed in is yours to keep."""
        if not self.key_file and key is None:
            raise ValueError("This book's key was passed in; pass the new one as rotate_key(key=...)")
        nxt = key or ed25519.Ed25519PrivateKey.generate()
        if not isinstance(nxt, ed25519.Ed25519PrivateKey):
            raise ValueError("The book's key must be Ed25519")
        handover = {"schema": KEY_ROTATION_SCHEMA, "from": self.key_id, "to": L.key_id_for(nxt), "to_public_pem": L.public_key_pem_of(nxt),
                    "at": _iso(self._now()), "entity": self.entity, **({"reason": str(reason)} if reason else {})}
        if handover["to"] == handover["from"]:
            raise ValueError("The new key is the key the book already has")
        if handover["to"] in TEST_KEY_IDS:
            raise ValueError(f"Key {handover['to']} is a published test key from the SPR vectors; use a key of your own")
        if self.key_file:
            tmp = self.key_file + ".new"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(_pem(nxt))
            _protect_key_file(tmp)
            os.replace(tmp, self.key_file)
        self._append("keys.jsonl", {"key_id": handover["to"], "algorithm": "ed25519", "public_pem": handover["to_public_pem"],
                                    "created_at": handover["at"], "owner": self.entity,
                                    "rotation": {"payload": handover, "seal": L.seal_with(handover, self.key)}})
        self.key, self.key_id = nxt, handover["to"]
        return {"from": handover["from"], "to": handover["to"], "at": handover["at"], "key_file": self.key_file,
                "next": "If Luca keeps this book, send it again: the handover registers the new key"}

    def export_package(self, out_dir: str, overwrite: bool = False) -> dict:
        """An export never goes into the book's own folder, and never replaces an earlier export unless overwrite=True."""
        if os.path.realpath(out_dir) == os.path.realpath(self.dir):
            raise ValueError("Export to a folder of its own, outside the book's folder, which holds the private key")
        if os.path.isdir(out_dir) and not overwrite and any(os.path.exists(os.path.join(out_dir, n)) for n in L.PACKAGE_FILES):
            raise ValueError(f"{out_dir} already holds an export; choose another folder, or pass overwrite=True to replace it")
        os.makedirs(out_dir, exist_ok=True)
        files = self.package_files()
        for n, text in files.items():
            with open(os.path.join(out_dir, n), "w", encoding="utf-8", newline="") as f:
                f.write(text)
        check = verify_folder(out_dir)
        return {"folder": out_dir, "files": list(files), "verified": check["ok"], "passed": check["passed"], "failed": check["failed"]}

    # ---- disputes (SPR section 8.1) ----
    def dispute_pack_files(self, record_id: str, delivery: Optional[dict] = None, note: Optional[str] = None) -> dict:
        """One payment's evidence for a chargeback response: every version of its record, the buyer's sealed intent and key,
        a sealed statement of what the evidence shows and the same statement in plain words, under a sealed manifest.
        Luca supplies the evidence; the merchant decides whether and how to submit it, and the card network decides."""
        def build():
            base = re.sub(r"-v\d+$", "", str(record_id or ""))
            cur = next((r for r in self._current() if re.sub(r"-v\d+$", "", r["payload"]["record_id"]) == base), None)
            if not cur:
                raise KeyError(f"No record {record_id} in this book")
            key = _payment_key(cur["payload"])
            chain = [r for r in self.records if _payment_key(r["payload"]) == key]
            files = {"keys.jsonl": "".join(_line(k) for k in self.keyring.values())}
            ids = list(dict.fromkeys((r["payload"].get("intent") or {}).get("intent_id") for r in chain if (r["payload"].get("intent") or {}).get("intent_id")))
            intents = [self.intents[i] for i in ids if i in self.intents]
            if intents:
                files["intents.jsonl"] = "".join(_line(i) for i in intents)
            cancels = [self.cancellations[i] for i in ids if i in self.cancellations]
            if cancels:
                files["cancellations.jsonl"] = "".join(_line(c) for c in cancels)
            files["records.jsonl"] = "".join(_line(r) for r in chain)
            buyers = [self.buyer_intents[h] for h in dict.fromkeys((r["payload"].get("buyer_intent") or {}).get("payload_sha256") for r in chain) if h in self.buyer_intents]
            if buyers:
                files["buyer-intents.jsonl"] = "".join(_line(b) for b in buyers)
            p = cur["payload"]
            summary = _dispute_summary(p, delivery, self.key_id)
            dispute = {"schema": L.DISPUTE_SCHEMA, "entity": self.entity, "record_id": p["record_id"], "records": [r["payload"]["record_id"] for r in chain],
                       "payment": {"rail": p["rail"], "source_id": p["source"]["id"], "amount_minor": p["amount_minor"], "currency": p["currency"],
                                   "occurred_at": p.get("occurred_at"), "direction": p.get("direction")},
                       "payment_refs": p.get("payment_refs"), "buyer_intent": p.get("buyer_intent"), "buyer_authentication": p.get("buyer_authentication"),
                       "delivery": delivery, "note": note, "generated_at": _iso(self._now()), "producer": self.producer,
                       "summary_sha256": L.sha256_hex(summary.encode("utf-8"))}
            files["dispute.json"] = json.dumps({"dispute": dispute, "seal": L.seal_with(dispute, self.key)}, indent=2, ensure_ascii=False) + "\n"
            files["summary.txt"] = summary
            return self._seal_package(files)
        return self._locked(build)

    def export_dispute_pack(self, record_id: str, out_dir: str, delivery: Optional[dict] = None, note: Optional[str] = None, overwrite: bool = False) -> dict:
        """A dispute package for one payment, written to a folder of its own and checked with the book's key."""
        if os.path.realpath(out_dir) == os.path.realpath(self.dir):
            raise ValueError("Export to a folder of its own, outside the book's folder, which holds the private key")
        if os.path.isdir(out_dir) and not overwrite and any(os.path.exists(os.path.join(out_dir, n)) for n in L.PACKAGE_FILES):
            raise ValueError(f"{out_dir} already holds an export; choose another folder, or pass overwrite=True to replace it")
        files = self.dispute_pack_files(record_id, delivery, note)
        os.makedirs(out_dir, exist_ok=True)
        for n, text in files.items():
            with open(os.path.join(out_dir, n), "w", encoding="utf-8", newline="") as f:
                f.write(text)
        check = verify_folder(out_dir, expected_keys=[self.key_id])
        return {"folder": out_dir, "files": list(files), "verified": check["ok"], "passed": check["passed"], "failed": check["failed"], "summary": files["summary.txt"]}

    # ---- Luca, the hosted service (optional) ----
    def send_to_luca(self, url: Optional[str] = None, api_key: Optional[str] = None, max_records: int = PART_MAX_RECORDS,
                     max_bytes: int = PART_MAX_BYTES) -> dict:
        """Sends the book to Luca's hosted service, which checks every seal before it stores anything. The key is
        registered with Luca first (register_with_luca). Sending it again changes nothing. A book over one import's
        limits goes in parts, one after the other."""
        parts = self.package_parts(max_records, max_bytes)
        if len(parts) == 1:
            return _luca_call(url, api_key, "/v1/spr/import", {"files": parts[0]})
        results = [_luca_call(url, api_key, "/v1/spr/import", {"files": p}) for p in parts]
        total = lambda k: sum(r.get(k, 0) for r in results)
        return {"parts": len(results), **{k: total(k) for k in ["created", "versioned", "unchanged", "read_from_rail", "differs_from_rail", "held_for_key_approval"]}, "results": results}

    def register_with_luca(self, entity_id: str, url: Optional[str] = None, api_key: Optional[str] = None, agent_only: bool = False) -> dict:
        """Asks Luca to accept this book's key for one of the company's entities, with a finance user's key."""
        body = {"public_pem": L.public_key_pem_of(self.key), "entity_id": entity_id, "book_entity": self.entity}
        if agent_only:
            body["agent_id"] = self.agent_id
        return _luca_call(url, api_key, "/v1/spr/keys", body)


class LucaError(Exception):
    def __init__(self, status: int, message: str, detail: dict):
        super().__init__(message)
        self.status, self.detail = status, detail


_LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def luca_url(url: str, path: str, allow_insecure_local: bool = False) -> str:
    """The book and the API key go to Luca only over HTTPS. Plain HTTP is allowed to this computer alone, and only when
    asked for (LUCA_ALLOW_INSECURE_LOCAL=1), for local development."""
    from urllib.parse import urlsplit
    u = urlsplit(url)
    full = url.rstrip("/") + path
    if u.scheme == "https" and u.hostname:
        return full
    local = u.scheme == "http" and (u.hostname or "") in _LOOPBACK
    if local and (allow_insecure_local or os.environ.get("LUCA_ALLOW_INSECURE_LOCAL") == "1"):
        return full
    if local:
        raise ValueError(f"Refusing to send the book and the API key over plain HTTP to {u.netloc}. For local development only, set LUCA_ALLOW_INSECURE_LOCAL=1")
    raise ValueError(f"Luca's address must start with https:// (got {u.scheme}://{u.netloc}): the book and the API key are never sent unencrypted")


def _luca_call(url: Optional[str], api_key: Optional[str], path: str, body: dict) -> dict:
    import urllib.error
    import urllib.request
    url, api_key = url or os.environ.get("LUCA_URL"), api_key or os.environ.get("LUCA_API_KEY")
    if not url or not api_key:
        raise ValueError("Give Luca's address and an API key (url, api_key), or set LUCA_URL and LUCA_API_KEY")
    target = luca_url(url, path)
    req = urllib.request.Request(target, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"})

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            raise LucaError(0, "Luca's address answered with a redirect; refused, so the book and the API key are not sent on", {})
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8") or "{}")
        except ValueError:
            detail = {}
        raise LucaError(e.code, detail.get("error") or f"Luca answered {e.code}", detail) from None


def verify_folder(folder: str, expected_keys: Optional[list] = None, buyer_keys: Optional[list] = None) -> dict:
    """Checks a package folder, reading only the package's own files, from inside the folder, and no links."""
    root = os.path.realpath(folder)

    def read(name):
        if name not in L.PACKAGE_FILES and name != "key.pem":
            raise ValueError(f"{json.dumps(name)} is not a file of a package")
        p = os.path.join(root, name)
        if not os.path.lexists(p):
            return None
        if os.path.islink(p):
            raise ValueError(f"{name} is a link; a package holds only plain files")
        real = os.path.realpath(p)
        if os.path.dirname(real) != root:
            raise ValueError(f"{name} is outside the package folder")
        with open(real, "rb") as f:
            return f.read()
    return L.verify_package(read, expected_keys, buyer_keys)
