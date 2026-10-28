// The reference library against its own test vectors, and the checker as a separate process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runVectors } from "../packages/spr/vectors/run.mjs";

const vectors = JSON.parse(readFileSync(new URL("../packages/spr/vectors/vectors.json", import.meta.url), "utf8"));

test("the library gives the answers in the test vectors", () => {
  const out = runVectors(vectors);
  assert.equal(out.failed, 0, out.results.filter((r) => !r.ok).map((r) => `${r.what}: ${r.detail}`).join("\n"));
  assert.ok(out.passed >= 60);
});

test("spr-verify runs the vectors in its own process", () => {
  const out = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("../packages/spr/bin/spr-verify.mjs", import.meta.url)), "--vectors", "--json"], { encoding: "utf8" }));
  assert.equal(out.failed, 0);
});
