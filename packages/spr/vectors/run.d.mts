// Types for vectors/run.mjs.
import type { KeyObject } from "node:crypto";
export declare const ed25519FromSeed: (seedHex: string) => KeyObject;
export declare function runVectors(v: unknown): { spec: string; passed: number; failed: number; results: { what: string; ok: boolean; detail: string }[] };
