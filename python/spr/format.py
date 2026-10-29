"""SPR, the Sealed Payment Record (lib/spr/SPEC.md), in Python. Apache-2.0.

The same answers as the JavaScript reference library on every test vector: canonical JSON, hashes, seals and
key IDs, Merkle roots and paths, the intent nonce, two-sided labels, the core fields of records and
intents, and the check of a package. Needs the `cryptography` package.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from typing import Any, Callable, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

SPEC_VERSION = "spr/draft-1"
MAX_SAFE = 2**53 - 1

# ---- 1. canonical JSON ---------------------------------------------------------------------------------
# Object members sorted by UTF-16 code unit (not by code point, Python's default), no whitespace, strings
# written as JavaScript's JSON.stringify writes them, and safe integers only.
_ESC = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _string(s: str) -> str:
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch in _ESC:
            out.append(_ESC[ch])
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:   # control characters and lone surrogates
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _utf16_key(k: str) -> bytes:
    return k.encode("utf-16-be", "surrogatepass")


def canonicalize(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        if abs(v) > MAX_SAFE:
            raise ValueError(f"canonicalize: only safe integers can be signed, got {v}")
        return str(v)
    if isinstance(v, float):
        # A JSON reader in JavaScript reads 2.0 as the integer 2; anything with a fraction is refused.
        if v.is_integer() and abs(v) <= MAX_SAFE:
            return str(int(v))
        raise ValueError(f"canonicalize: only safe integers can be signed, got {v}")
    if isinstance(v, str):
        return _string(v)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(canonicalize(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v.keys(), key=_utf16_key)
        return "{" + ",".join(_string(k) + ":" + canonicalize(v[k]) for k in keys) + "}"
    raise TypeError(f"canonicalize: unsupported type {type(v).__name__}")


# ---- 2. hashes -------------------------------------------------------------------------------------------
def sha256_hex(data: str | bytes) -> str:
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


def payload_sha256(payload: Any) -> str:
    return sha256_hex(canonicalize(payload))


def _is_index(k: str) -> bool:
    return k.isdigit() and (k == "0" or not k.startswith("0")) and int(k) < 2**32 - 1


def hash_source_payload(v: Any) -> str:
    """A rail's own payload, hashed as the reference library does: JSON with members sorted, numbers as written.
    JavaScript lists integer-like member names first, in numeric order; that is followed here."""
    def order(o):
        if isinstance(o, list):
            return [order(x) for x in o]
        if isinstance(o, dict):
            ks = sorted(o.keys(), key=_utf16_key)
            ks = sorted([k for k in ks if _is_index(k)], key=int) + [k for k in ks if not _is_index(k)]
            return {k: order(o[k]) for k in ks}
        return o
    return sha256_hex(json.dumps(order(v), separators=(",", ":"), ensure_ascii=False))


# ---- 3. keys and seals -----------------------------------------------------------------------------------
SEAL_DIGEST_PREFIX = "luca.seal/1:"
SEAL_ALGORITHMS = ("ed25519", "ed25519-digest")


def _public(key):
    if isinstance(key, (str, bytes)):
        key = serialization.load_pem_public_key(key.encode() if isinstance(key, str) else key)
    if isinstance(key, (ed25519.Ed25519PrivateKey, ec.EllipticCurvePrivateKey)):
        key = key.public_key()
    return key


def key_id_for(key) -> str:
    der = _public(key).public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return "ed25519:" + sha256_hex(base64.b64encode(der).decode("ascii"))[:16]


def public_key_pem_of(key) -> str:
    return _public(key).public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode("ascii")


def ed25519_from_seed(seed_hex: str) -> ed25519.Ed25519PrivateKey:
    return ed25519.Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed_hex))


def digest_message(h: str) -> bytes:
    return (SEAL_DIGEST_PREFIX + h).encode("utf-8")


def seal_with(payload: Any, private_key, algorithm: str = "ed25519", key_id: Optional[str] = None) -> dict:
    if algorithm not in SEAL_ALGORITHMS:
        raise ValueError(f"unknown seal algorithm {algorithm}")
    if isinstance(private_key, (str, bytes)):
        private_key = serialization.load_pem_private_key(private_key.encode() if isinstance(private_key, str) else private_key, None)
    if not isinstance(private_key, ed25519.Ed25519PrivateKey):
        raise ValueError("a seal key must be Ed25519")
    can = canonicalize(payload)
    h = sha256_hex(can)
    msg = digest_message(h) if algorithm == "ed25519-digest" else can.encode("utf-8")
    return {"payload_sha256": h, "signature": base64.b64encode(private_key.sign(msg)).decode("ascii"),
            "key_id": key_id or key_id_for(private_key), "algorithm": algorithm}


def normalize_seal(s: dict) -> dict:
    return {"payload_sha256": s.get("payload_sha256") or s.get("payloadHash") or s.get("payload_hash"), "signature": s.get("signature"),
            "key_id": s.get("key_id") or s.get("keyId"), "algorithm": s.get("algorithm") or "ed25519"}


def verify_seal(payload: Any, seal: dict, public_key, algorithm: Optional[str] = None) -> dict:
    s = normalize_seal(seal)
    try:
        can = canonicalize(payload)
    except (ValueError, TypeError):
        return {"ok": False, "hash_matches": False, "signature_valid": False, "key_matches": False}
    hash_matches = sha256_hex(can) == s["payload_sha256"]
    try:
        pub = _public(public_key) if public_key is not None else None
    except Exception:
        pub = None
    try:
        key_matches = pub is not None and (not s["key_id"] or key_id_for(pub) == s["key_id"])
    except Exception:
        key_matches = False
    alg = algorithm or s["algorithm"]
    signature_valid = False
    if isinstance(pub, ed25519.Ed25519PublicKey):
        try:
            pub.verify(base64.b64decode(s["signature"]), digest_message(s["payload_sha256"]) if alg == "ed25519-digest" else can.encode("utf-8"))
            signature_valid = True
        except (InvalidSignature, ValueError, TypeError):
            signature_valid = False
    ok = hash_matches and signature_valid and key_matches
    return {"ok": ok, "hash_matches": hash_matches, "signature_valid": signature_valid, "key_matches": key_matches}


# ---- 4. Merkle trees -------------------------------------------------------------------------------------
def _pair(l: str, r: str) -> str:
    return sha256_hex(bytes.fromhex(l + r))


def merkle_root(leaves: list[str]) -> str:
    if not leaves:
        return sha256_hex("")
    level = list(leaves)
    while len(level) > 1:
        level = [(_pair(level[i], level[i + 1]) if i + 1 < len(level) else level[i]) for i in range(0, len(level), 2)]
    return level[0]


def merkle_path(leaves: list[str], index: int) -> list[dict]:
    path, level, i = [], list(leaves), index
    while len(level) > 1:
        j = i + 1 if i % 2 == 0 else i - 1
        if j < len(level):
            path.append({"sibling": level[j], "side": "right" if i % 2 == 0 else "left"})
        level = [(_pair(level[k], level[k + 1]) if k + 1 < len(level) else level[k]) for k in range(0, len(level), 2)]
        i //= 2
    return path


def root_from_path(leaf: str, path: list[dict]) -> str:
    h = leaf
    for p in path:
        h = _pair(h, p["sibling"]) if p["side"] == "right" else _pair(p["sibling"], h)
    return h


def records_root(records: list[dict]) -> str:
    return merkle_root([r["payload_sha256"] for r in sorted(records, key=lambda r: _utf16_key(r["id"]))])


# ---- 5. the intent nonce ---------------------------------------------------------------------------------
INTENT_NONCE_SCHEME = "luca.intent-nonce/1"


def intent_nonce(intent_payload_sha256: str, seq: int = 0) -> str:
    if not re.fullmatch(r"[0-9a-fA-F]{64}", intent_payload_sha256 or ""):
        raise ValueError("intent payload hash must be 64 hex characters")
    if not isinstance(seq, int) or isinstance(seq, bool) or seq < 0:
        raise ValueError("seq must be a whole number")
    return "0x" + sha256_hex(f"{INTENT_NONCE_SCHEME}:{intent_payload_sha256.lower()}:{seq}")


# ---- 6. two-sided labels ---------------------------------------------------------------------------------
LABEL_SCHEMA = "luca.label/1"


def label_shared_sha256(shared: Any) -> str:
    return payload_sha256(shared)


def label_signing_input(label_id: str, shared_sha256: str) -> str:
    return canonicalize({"schema": LABEL_SCHEMA, "label_id": label_id, "shared_sha256": shared_sha256})


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _unb64(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def jwk_thumbprint(jwk: dict) -> str:
    members = {"crv": jwk["crv"], "kty": jwk["kty"], "x": jwk["x"]} if jwk.get("kty") == "OKP" else {"crv": jwk["crv"], "kty": jwk["kty"], "x": jwk["x"], "y": jwk["y"]}
    return _b64u(hashlib.sha256(json.dumps(members, separators=(",", ":")).encode()).digest())


def _jwk_key(jwk: dict):
    if jwk.get("kty") == "OKP" and jwk.get("crv") == "Ed25519":
        return ed25519.Ed25519PublicKey.from_public_bytes(_unb64(jwk["x"]))
    if jwk.get("kty") == "EC" and jwk.get("crv") == "P-256":
        return ec.EllipticCurvePublicNumbers(int.from_bytes(_unb64(jwk["x"]), "big"), int.from_bytes(_unb64(jwk["y"]), "big"), ec.SECP256R1()).public_key()
    raise ValueError("the JWK must be an Ed25519 (kty OKP) or P-256 (kty EC) public key")


def check_public_jwk(jwk: Any) -> dict:
    if not isinstance(jwk, dict):
        raise ValueError("a public JWK is required")
    if "d" in jwk or "p" in jwk:
        raise ValueError("the JWK holds a private key; only the public key is accepted")
    _jwk_key(jwk)
    return {"kty": "OKP", "crv": "Ed25519", "x": jwk["x"]} if jwk["kty"] == "OKP" else {"kty": "EC", "crv": "P-256", "x": jwk["x"], "y": jwk["y"]}


def sign_label(private_key, label_id: str, shared_sha256: str) -> str:
    msg = label_signing_input(label_id, shared_sha256).encode("utf-8")
    if isinstance(private_key, ed25519.Ed25519PrivateKey):
        return _b64u(private_key.sign(msg))
    r, s = decode_dss_signature(private_key.sign(msg, ec.ECDSA(hashes.SHA256())))
    return _b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))


def verify_label_signature(jwk: dict, label_id: str, shared_sha256: str, signature: str) -> bool:
    if not isinstance(signature, str) or not signature:
        return False
    msg = label_signing_input(label_id, shared_sha256).encode("utf-8")
    try:
        key, sig = _jwk_key(jwk), _unb64(signature)
        if isinstance(key, ed25519.Ed25519PublicKey):
            key.verify(sig, msg)
        else:
            if len(sig) != 64:
                return False
            key.verify(encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")), msg, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False


def _safe_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and abs(v) <= MAX_SAFE




# ---- 8. core fields --------------------------------------------------------------------------------------
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$")
RECORD_SCHEMA_PATTERN = re.compile(r"^luca\.record/\d+\.\d+$")
INTENT_SCHEMA_PATTERN = re.compile(r"^luca\.intent/\d+\.\d+$")
_str = lambda v: isinstance(v, str) and len(v) > 0


def check_record(p: Any) -> dict:
    if not isinstance(p, dict):
        return {"ok": False, "problems": ["a record payload is an object"]}
    problems = []
    def need(ok, what):
        if not ok:
            problems.append(what)
    need(isinstance(p.get("schema"), str) and bool(RECORD_SCHEMA_PATTERN.match(p["schema"])), "schema is luca.record/<major>.<minor>")
    need(_str(p.get("record_id")), "record_id is a non-empty string")
    need(_safe_int(p.get("version")) and p["version"] >= 1, "version is an integer from 1")
    need(p.get("supersedes") is None or _str(p.get("supersedes")), "supersedes is the record_id of the version replaced, or null")
    need((p.get("version") == 1) == (p.get("supersedes") is None), "version 1 supersedes nothing; a later version names the one it replaces")
    need(_str(p.get("entity")), "entity names the company whose record this is")
    need(_str(p.get("rail")), "rail names the payment rail")
    need(p.get("direction") in ("inflow", "outflow"), "direction is inflow or outflow")
    need(isinstance(p.get("source"), dict) and _str(p["source"].get("id")), "source.id is the rail's own reference for the payment")
    need(_str(p.get("state")), "state is given")
    need(_safe_int(p.get("amount_minor")), "amount_minor is an integer in the currency's minor unit")
    need(_str(p.get("currency")), "currency is given")
    need(p.get("occurred_at") is None or (isinstance(p["occurred_at"], str) and bool(_INSTANT.match(p["occurred_at"]))), "occurred_at is an ISO 8601 instant with its offset, or null")
    need(p.get("settled_on") is None or (isinstance(p["settled_on"], str) and bool(_DATE.match(p["settled_on"]))), "settled_on is a date (YYYY-MM-DD), or null")
    if p.get("intent"):
        need(_str(p["intent"].get("intent_id")), "intent.intent_id names the intent the payment was made under")
    return {"ok": not problems, "problems": problems}


def check_intent(p: Any) -> dict:
    if not isinstance(p, dict):
        return {"ok": False, "problems": ["an intent payload is an object"]}
    problems = []
    def need(ok, what):
        if not ok:
            problems.append(what)
    need(isinstance(p.get("schema"), str) and bool(INTENT_SCHEMA_PATTERN.match(p["schema"])), "schema is luca.intent/<major>.<minor>")
    need(_str(p.get("intent_id")), "intent_id is a non-empty string")
    need(_str(p.get("purpose")), "purpose says, in a sentence, why the payment is made")
    need(isinstance(p.get("declared_at"), str) and bool(_INSTANT.match(p["declared_at"])), "declared_at is an ISO 8601 instant")
    need(isinstance(p.get("expires_at"), str) and bool(_INSTANT.match(p["expires_at"])), "expires_at is an ISO 8601 instant")
    cap = p.get("max_amount_minor")
    need(cap is None or (_safe_int(cap) and cap > 0), "max_amount_minor is a positive integer, or null")
    need(p.get("currency") is None or _str(p.get("currency")), "currency is given, or null")
    return {"ok": not problems, "problems": problems}


# ---- 9. a package ----------------------------------------------------------------------------------------
KEY_ROTATION_SCHEMA = "luca.key-rotation/0.1"


def check_key_handover(row: dict, keys: dict) -> dict:
    """A key row that carries a handover, sealed by the earlier key it names, found in keys (key_id -> row)."""
    rot = (row or {}).get("rotation") or {}
    h, seal = rot.get("payload"), rot.get("seal")
    if not h or not seal:
        return {"ok": False, "detail": "no handover"}
    if h.get("schema") != KEY_ROTATION_SCHEMA:
        return {"ok": False, "detail": f"the handover's schema is not {KEY_ROTATION_SCHEMA}"}
    if h.get("to") != row.get("key_id") or h.get("to_public_pem") != row.get("public_pem") or key_id_for(row["public_pem"]) != row["key_id"]:
        return {"ok": False, "detail": "the handover does not name this key"}
    s = normalize_seal(seal)
    if s["key_id"] != h.get("from") or h.get("from") == h.get("to"):
        return {"ok": False, "detail": "the handover is not sealed by the earlier key it names"}
    prev = keys.get(h["from"])
    if not prev:
        return {"ok": False, "detail": f"key {h['from']} is not in the list of keys"}
    v = verify_seal(h, s, prev["public_pem"], prev.get("algorithm") or s["algorithm"])
    return {"ok": v["ok"], "detail": "" if v["ok"] else "the handover is not the one sealed" if not v["hash_matches"] else "the earlier key's signature does not verify"}


PACKAGE_FILES = ["manifest.json", "keys.jsonl", "intents.jsonl", "cancellations.jsonl", "checks.jsonl", "records.jsonl", "labels.jsonl"]
_KEY_ID = re.compile(r"ed25519:[0-9a-f]{16}")


def check_record_set(payloads: list) -> dict:
    """One record ID with two different contents, or two records of one payment with the same version, means two
    writers sealed different facts (section 6)."""
    problems, by_id, by_version = [], {}, {}
    for p in payloads:
        h = payload_sha256(p)
        rid = (p or {}).get("record_id")
        if rid in by_id and by_id[rid] != h:
            problems.append(f"record {rid} appears twice with different content")
        by_id[rid] = h
        src = ((p or {}).get("source") or {}).get("id")
        k = (p.get("entity"), p.get("rail"), src, p.get("version"))
        if k in by_version and by_version[k] != rid:
            problems.append(f"payment {src} on {p.get('rail')} has two version {p.get('version')} records: {by_version[k]} and {rid}")
        by_version.setdefault(k, rid)
    return {"ok": not problems, "problems": problems}


def verify_package(read: Callable[[str], Optional[bytes]], expected_keys: Optional[list] = None) -> dict:
    """Every check of a package (section 8). Without expected_keys the result shows the package is consistent with the
    keys it carries (trust "consistency-only"). With the company's public keys or key IDs, every seal must be by one
    of them or by a key one of them handed over to (trust "expected-key"); any other signer fails."""
    results = []
    def check(what, ok, detail=""):
        results.append({"what": what, "ok": bool(ok), "detail": detail})
        return ok
    cache = {}
    def get(name):
        if name not in cache:
            try:
                cache[name] = read(name)
            except Exception as e:  # a name outside the package, a link, an unreadable file
                check(f"{name} can be read", False, str(e))
                cache[name] = None
        return cache[name]
    def jsonl(name):
        b = get(name)
        return [json.loads(l) for l in b.decode("utf-8").split("\n") if l.strip()] if b else []
    holds_key = bool(get("key.pem"))
    kind = "book" if holds_key and not get("manifest.json") else "package"
    if kind == "book":
        check("this is a book's own folder: its seals and fields are checked below; it holds the private key, so share an export of it instead", True)
    elif holds_key:
        check("the package holds no private key", False, "key.pem is a private key and must never be shared")
    keys = {k["key_id"]: k for k in jsonl("keys.jsonl")}
    signers = []
    def seal_ok(payload, seal):
        s = normalize_seal(seal or {})
        if s["key_id"] not in signers:
            signers.append(s["key_id"])
        k = keys.get(s["key_id"])
        if not k:
            return False, f"key {s['key_id']} is not in keys.jsonl"
        v = verify_seal(payload, s, k["public_pem"], k.get("algorithm") or s["algorithm"])
        return v["ok"], "" if v["ok"] else ("the payload's hash is not the sealed hash" if not v["hash_matches"] else "the signature does not verify with that key")
    good_handover = set()
    for k in keys.values():
        if not k.get("rotation"):
            continue
        c = check_key_handover(k, keys)
        if c["ok"]:
            good_handover.add(k["key_id"])
        check(f"key {k['key_id']} was handed over by key {(k['rotation'].get('payload') or {}).get('from')}, which sealed the handover", c["ok"], c["detail"])
    mb = get("manifest.json")
    if kind == "package" and check("manifest.json is present", bool(mb)):
        m = json.loads(mb.decode("utf-8"))
        ok, why = seal_ok(m.get("package"), m.get("seal"))
        check("the manifest is sealed", ok, why)
        for f in (m.get("package") or {}).get("files", []):
            name = (f or {}).get("name")
            if not isinstance(name, str) or name not in PACKAGE_FILES or name == "manifest.json":
                check("the manifest names only the package's own files", False, f"{json.dumps(name)} is not one of {', '.join(PACKAGE_FILES[1:])}")
                continue
            b = get(name)
            check(f"{name} is the file the manifest names", bool(b) and sha256_hex(b) == f["sha256"], "its SHA-256 differs" if b else "missing")
    intents, records = jsonl("intents.jsonl"), jsonl("records.jsonl")
    by_intent = {}
    for i in intents:
        p = i.get("payload") or {}
        ok, why = seal_ok(p, i.get("seal"))
        check(f"intent {p.get('intent_id')} is sealed", ok, why)
        c = check_intent(p)
        check(f"intent {p.get('intent_id')} has the core fields", c["ok"], "; ".join(c["problems"]))
        by_intent[p.get("intent_id")] = i
    for name in ["cancellations.jsonl", "checks.jsonl"]:
        for row in jsonl(name):
            p = row.get("payload") or {}
            ok, why = seal_ok(p, row.get("seal"))
            check(f"{'pre-payment check' if name == 'checks.jsonl' else 'withdrawal of intent'} {p.get('id') or p.get('intent_id')} is sealed", ok, why)
    by_record = {(r.get("payload") or {}).get("record_id"): r for r in records}
    for r in records:
        p = r.get("payload") or {}
        ok, why = seal_ok(p, r.get("seal"))
        check(f"record {p.get('record_id')} is sealed", ok, why)
        c = check_record(p)
        check(f"record {p.get('record_id')} has the core fields", c["ok"], "; ".join(c["problems"]))
        if p.get("supersedes"):
            check(f"record {p['record_id']} replaces a version in the package", p["supersedes"] in by_record, p["supersedes"])
        it = (p.get("intent") or {}).get("intent_id")
        if it:
            i = by_intent.get(it)
            check(f"record {p['record_id']}: its intent is in the package", bool(i), it)
            if i:
                check(f"record {p['record_id']}: it names the intent's sealed hash", normalize_seal(i["seal"])["payload_sha256"] == p["intent"].get("payload_sha256"))
            b = (p.get("consent") or {}).get("binding") or {}
            if i and b.get("nonce"):
                expected = intent_nonce(normalize_seal(i["seal"])["payload_sha256"], b["seq"] if isinstance(b.get("seq"), int) else 0)
                check(f"record {p['record_id']}: bound only when the nonce is the intent's fingerprint", (b.get("status") == "bound") == (b["nonce"].lower() == expected), f"expected {expected}")
    rs = check_record_set([r.get("payload") or {} for r in records])
    check("no record ID holds two different records, and no payment has two records of one version", rs["ok"], "; ".join(rs["problems"]))
    expected = [k if isinstance(k, str) and _KEY_ID.fullmatch(k) else key_id_for(k) for k in (expected_keys or [])]
    trust = "consistency-only"
    if expected:
        trusted, grew = set(expected), True
        while grew:
            grew = False
            for kid in good_handover:
                if kid not in trusted and keys[kid]["rotation"]["payload"]["from"] in trusted:
                    trusted.add(kid)
                    grew = True
        strangers = [k for k in signers if k not in trusted]
        trust = "expected-key" if check(f"every seal is by the company's expected key {' or '.join(expected)}, or a key it handed over to", not strangers,
                                        f"sealed by {', '.join(strangers)}, which the expected key did not hand over to" if strangers else "") else "untrusted"
    failed = sum(1 for r in results if not r["ok"])
    return {"kind": kind, "ok": failed == 0, "trust": trust, "signers": signers, "expected_keys": expected,
            "passed": len(results) - failed, "failed": failed, "results": results}


# ---- the vectors -----------------------------------------------------------------------------------------
def run_vectors(v: dict) -> dict:
    results = []
    def check(what, ok, detail=""):
        results.append({"what": what, "ok": bool(ok), "detail": detail})
    def same(what, got, want):
        check(what, got == want, f"got {got}, want {want}")
    keys = {}
    for name, k in v["keys"].items():
        priv = ed25519_from_seed(k["seed_hex"])
        keys[name] = priv
        same(f"key {name}: public key from the seed", priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex(), k["public_hex"])
        same(f"key {name}: key ID", key_id_for(priv), k["key_id"])
    for c in v["canonical"]:
        same(f"canonical: {c['name']}", canonicalize(c["input"]), c["canonical"])
        same(f"canonical: {c['name']}, SHA-256", sha256_hex(c["canonical"]), c["sha256"])
    for c in v["canonical_rejects"]:
        try:
            canonicalize(json.loads(c["input_json"]))
            check(f"canonical rejects: {c['name']}", False, "it was accepted")
        except (ValueError, TypeError):
            check(f"canonical rejects: {c['name']}", True)
    for s in v["seals"]:
        made = seal_with(s["payload"], keys[s["key"]], s["algorithm"])
        same(f"seal {s['name']}: payload hash", made["payload_sha256"], s["seal"]["payload_sha256"])
        same(f"seal {s['name']}: signature (Ed25519 is deterministic)", made["signature"], s["seal"]["signature"])
        check(f"seal {s['name']}: verifies", verify_seal(s["payload"], s["seal"], keys[s["key"]])["ok"])
        check(f"seal {s['name']}: a changed payload fails", not verify_seal(s["tampered"], s["seal"], keys[s["key"]])["ok"])
    for m in v["merkle"]:
        same(f"merkle {m['name']}: root", merkle_root(m["leaves"]), m["root"])
        for p in m["paths"]:
            same(f"merkle {m['name']}: path of leaf {p['index']}", merkle_path(m["leaves"], p["index"]), p["path"])
            same(f"merkle {m['name']}: leaf {p['index']} reaches the root", root_from_path(m["leaves"][p["index"]], p["path"]), m["root"])
    for r in v["records_root"]:
        same(f"records root: {r['name']}", records_root(r["records"]), r["root"])
    for n in v["intent_nonce"]:
        same(f"intent nonce: {n['name']}", intent_nonce(n["intent_payload_sha256"], n["seq"]), n["nonce"])
    for t in v["jwk_thumbprints"]:
        same(f"JWK thumbprint: {t['name']}", jwk_thumbprint(t["jwk"]), t["thumbprint"])
    for l in v["labels"]:
        same(f"label {l['name']}: shared SHA-256", label_shared_sha256(l["shared"]), l["shared_sha256"])
        same(f"label {l['name']}: what is signed", label_signing_input(l["label_id"], l["shared_sha256"]), l["signing_input"])
        for s in l["signatures"]:
            check(f"label {l['name']}: {s['alg']} signature verifies", verify_label_signature(s["jwk"], l["label_id"], l["shared_sha256"], s["signature"]))
            check(f"label {l['name']}: {s['alg']} signature fails on another digest", not verify_label_signature(s["jwk"], l["label_id"], "0" * 64, s["signature"]))
            if s.get("key") in keys:
                same(f"label {l['name']}: {s['alg']} signature (deterministic)", sign_label(keys[s["key"]], l["label_id"], l["shared_sha256"]), s["signature"])
    for r in v["records"]:
        c = check_record(r["payload"])
        check(f"record core fields: {r['name']}", c["ok"] == r["ok"], "; ".join(c["problems"]) or "it passed")
    for r in v["intents"]:
        c = check_intent(r["payload"])
        check(f"intent core fields: {r['name']}", c["ok"] == r["ok"], "; ".join(c["problems"]) or "it passed")
    for r in v.get("record_sets", []):
        c = check_record_set(r["records"])
        check(f"record set: {r['name']}", c["ok"] == r["ok"], "; ".join(c["problems"]) or "it passed")
    for k in v.get("key_handovers", []):
        c = check_key_handover(k["key"], {x["key_id"]: x for x in k["keys"]})
        check(f"key handover: {k['name']}", c["ok"] == k["ok"], c["detail"] or "it passed")
    failed = sum(1 for r in results if not r["ok"])
    return {"spec": v.get("spec"), "passed": len(results) - failed, "failed": failed, "results": results}
