#!/usr/bin/env node
// Checks a local Luca package (the folder the MCP server's local mode keeps, or one it exported) without
// Luca: every seal with the key it names, the core fields, version chains, each record's intent, and the
// intent nonce where a record says the payment was bound.
//
//   node spr-verify.mjs <package folder> [--json]
//   node spr-verify.mjs --vectors        checks this library against vectors/vectors.json
//
// Exit code 0 when every check passes, 1 otherwise.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackage } from "../index.mjs";
import { runVectors } from "../vectors/run.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const print = (out) => {
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else {
    for (const r of out.results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.what}${r.ok || !r.detail ? "" : `\n        ${r.detail}`}`);
    console.log(`\n${out.passed} passed, ${out.failed} failed`);
  }
  process.exit(out.failed ? 1 : 0);
};
if (args.includes("--vectors")) {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../vectors/vectors.json");
  print(runVectors(JSON.parse(readFileSync(file, "utf8"))));
}
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) { console.error("usage: node spr-verify.mjs <package folder> [--json] | --vectors"); process.exit(2); }
print(verifyPackage((name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : null));
