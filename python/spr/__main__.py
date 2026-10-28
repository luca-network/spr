"""python -m spr <package folder> [--json]  |  python -m spr --vectors [<vectors.json>] [--json]

With --vectors and no file, the test vectors packed with this package are run."""
import json
import os
import sys

from . import run_vectors, verify_folder

args = sys.argv[1:]
as_json = "--json" in args
if "--vectors" in args:
    path = next((a for a in args if not a.startswith("--")), None) or os.path.join(os.path.dirname(__file__), "vectors.json")
    if not os.path.exists(path):
        print(f"No test vectors at {path}; give the path to a vectors.json")
        sys.exit(2)
    with open(path, encoding="utf-8") as f:
        out = run_vectors(json.load(f))
else:
    folder = next((a for a in args if not a.startswith("--")), None)
    if not folder:
        print(__doc__)
        sys.exit(2)
    out = verify_folder(folder)
if as_json:
    print(json.dumps(out, indent=2))
else:
    for r in out["results"]:
        print(f"  {'PASS' if r['ok'] else 'FAIL'}  {r['what']}" + ("" if r["ok"] or not r["detail"] else f"\n        {r['detail']}"))
    print(f"\n{out['passed']} passed, {out['failed']} failed")
sys.exit(1 if out["failed"] else 0)
