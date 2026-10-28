// Types for the SPR library (index.mjs). See SPEC.md for the format.
import type { KeyObject, JsonWebKey } from "node:crypto";

export declare const SPEC_VERSION: string;

export declare function canonicalize(value: unknown): string;
export declare function sha256Hex(data: string | Uint8Array): string;
export declare function payloadSha256(payload: unknown): string;
export declare function hashSourcePayload(value: unknown): string;

export type SealAlgorithm = "ed25519" | "ed25519-digest";
export interface Seal { payload_sha256: string; signature: string; key_id: string; algorithm: SealAlgorithm | string }
export interface SealLike { payload_sha256?: string; payloadHash?: string; payload_hash?: string; signature: string; key_id?: string; keyId?: string; algorithm?: string }
export interface SealCheck { ok: boolean; hash_matches: boolean; signature_valid: boolean; key_matches: boolean }

export declare function keyIdFor(key: KeyObject | string): string;
export declare function publicKeyPemOf(key: KeyObject | string): string;
export declare const SEAL_DIGEST_PREFIX: string;
export declare const SEAL_ALGORITHMS: SealAlgorithm[];
export declare function digestMessage(hash: string): Buffer;
export declare function sealWith(payload: unknown, privateKey: KeyObject | string, options?: { algorithm?: SealAlgorithm; keyId?: string }): Seal;
export declare function normalizeSeal(seal: SealLike): Seal;
export declare function verifySeal(payload: unknown, seal: SealLike, publicKey: KeyObject | string | null, algorithm?: string): SealCheck;

export interface PathStep { sibling: string; side: "left" | "right" }
export declare function merkleRoot(leaves: string[]): string;
export declare function merklePath(leaves: string[], index: number): PathStep[];
export declare function rootFromPath(leaf: string, path: PathStep[]): string;
export declare function recordsRoot(records: { id: string; payload_sha256: string }[]): string;

export declare const INTENT_NONCE_SCHEME: string;
export declare function intentNonce(intentPayloadSha256: string, seq?: number): `0x${string}`;

export declare const LABEL_SCHEMA: string;
export declare function labelSharedSha256(shared: unknown): string;
export declare function labelSigningInput(labelId: string, sharedSha256: string): string;
export declare function jwkThumbprint(jwk: JsonWebKey | Record<string, any>): string;
export declare function checkPublicJwk(jwk: unknown): { kty: "OKP"; crv: "Ed25519"; x: string } | { kty: "EC"; crv: "P-256"; x: string; y: string };
export declare function signLabel(privateKey: KeyObject | string, labelId: string, sharedSha256: string): string;
export declare function verifyLabelSignature(jwk: JsonWebKey | Record<string, any>, labelId: string, sharedSha256: string, signature: string): boolean;

export interface CoreCheck { ok: boolean; problems: string[] }
export declare const RECORD_SCHEMA_PATTERN: RegExp;
export declare const INTENT_SCHEMA_PATTERN: RegExp;
export declare function checkRecord(payload: unknown): CoreCheck;
export declare function checkIntent(payload: unknown): CoreCheck;

export interface PackageCheck { ok: boolean; passed: number; failed: number; results: { what: string; ok: boolean; detail: string }[] }
export declare function verifyPackage(read: (name: string) => Buffer | null): PackageCheck;
