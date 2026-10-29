#!/usr/bin/env node
// Checks an SPR package (an export of a company's book, or a book's own folder) without Luca: every seal with the
// key it names, the core fields, version chains, each record's intent, the intent nonce where a record says the
// payment was bound, and every key handover.
//
//   spr-verify <package folder> [--key <public key file or key ID>]... [--json]
//   spr-verify --vectors        checks this library against vectors/vectors.json
//
// Without --key the result shows the package is consistent with the keys it carries: anyone can make a consistent
// package with a key of their own. With the company's public key (from the company, not from the package), every
// seal must be by that key or a key it handed over to.
//
// Exit code 0 when every check passes, 1 otherwise, 2 when the command is wrong.
import { readFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPackage, PACKAGE_FILES } from "../index.mjs";
import { runVectors } from "../vectors/run.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
if (args.includes("--vectors")) {
  const out = runVectors(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../vectors/vectors.json"), "utf8")));
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else { for (const r of out.results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.what}${r.ok || !r.detail ? "" : `\n        ${r.detail}`}`); console.log(`\n${out.passed} passed, ${out.failed} failed`); }
  process.exit(out.failed ? 1 : 0);
}
const keys = [], rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--key") { const v = args[++i]; if (!v) { console.error("--key needs a public key file or a key ID"); process.exit(2); } keys.push(v); }
  else if (!args[i].startsWith("--")) rest.push(args[i]);
}
const dir = rest[0];
if (!dir) { console.error("usage: spr-verify <package folder> [--key <public key file or key ID>]... [--json] | --vectors"); process.exit(2); }
const expectedKeys = keys.map((k) => /^ed25519:[0-9a-f]{16}$/.test(k) ? k : readFileSync(k, "utf8"));

// Only the package's own files, read from inside its folder: no other names, no links, nothing outside.
const root = realpathSync(resolve(dir));
const read = (name) => {
  if (![...PACKAGE_FILES, "key.pem"].includes(name)) throw new Error(`${JSON.stringify(name)} is not a file of a package`);
  const p = join(root, name);
  if (!existsSync(p)) return null;
  if (lstatSync(p).isSymbolicLink()) throw new Error(`${name} is a link; a package holds only plain files`);
  const real = realpathSync(p);
  if (!real.startsWith(root + sep)) throw new Error(`${name} is outside the package folder`);
  return readFileSync(real);
};
const out = verifyPackage(read, { expectedKeys });
if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`  Sealed by: ${out.signers.join(", ") || "nothing sealed"}`);
  for (const r of out.results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.what}${r.ok || !r.detail ? "" : `\n        ${r.detail}`}`);
  const tail = out.trust === "untrusted" ? "NOT sealed by the company key you gave"
    : out.failed ? "the package fails these checks"
    : out.trust === "expected-key" ? "verified against the company key you gave"
    : "consistency only: these checks use the keys inside the package; pass --key with the company's public key to check whose it is";
  console.log(`\n${out.passed} passed, ${out.failed} failed · ${tail}`);
}
process.exit(out.failed ? 1 : 0);
