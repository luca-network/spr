"""python -m spr <package folder> [--key <public key file or key ID>]... [--json]  |  python -m spr --vectors [<vectors.json>] [--json]

Without --key the result shows the package is consistent with the keys it carries: anyone can make a consistent
package with a key of their own. With the company's public key (from the company, not from the package), every seal
must be by that key or a key it handed over to. With --vectors and no file, the vectors packed with this package run."""
import json
import os
import re
import sys

from . import run_vectors, verify_folder

args = sys.argv[1:]
as_json = "--json" in args
keys, rest, i = [], [], 0
while i < len(args):
    if args[i] == "--key":
        if i + 1 >= len(args):
            print("--key needs a public key file or a key ID")
            sys.exit(2)
        keys.append(args[i + 1])
        i += 2
        continue
    if not args[i].startswith("--"):
        rest.append(args[i])
    i += 1
if "--vectors" in args:
    path = rest[0] if rest else os.path.join(os.path.dirname(__file__), "vectors.json")
    if not os.path.exists(path):
        print(f"No test vectors at {path}; give the path to a vectors.json")
        sys.exit(2)
    with open(path, encoding="utf-8") as f:
        out = run_vectors(json.load(f))
else:
    if not rest:
        print(__doc__)
        sys.exit(2)
    expected = []
    for k in keys:
        if re.fullmatch(r"ed25519:[0-9a-f]{16}", k):
            expected.append(k)
        else:
            with open(k, encoding="utf-8") as f:
                expected.append(f.read())
    out = verify_folder(rest[0], expected)
if as_json:
    print(json.dumps(out, indent=2))
else:
    if "signers" in out:
        print(f"  Sealed by: {', '.join(out['signers']) or 'nothing sealed'}")
    for r in out["results"]:
        print(f"  {'PASS' if r['ok'] else 'FAIL'}  {r['what']}" + ("" if r["ok"] or not r["detail"] else f"\n        {r['detail']}"))
    trust = out.get("trust")
    tail = ("" if trust is None else
            " · NOT sealed by the company key you gave" if trust == "untrusted" else
            " · the package fails these checks" if out["failed"] else
            " · verified against the company key you gave" if trust == "expected-key" else
            " · consistency only: these checks use the keys inside the package; pass --key with the company's public key to check whose it is")
    print(f"\n{out['passed']} passed, {out['failed']} failed{tail}")
sys.exit(1 if out["failed"] else 0)
