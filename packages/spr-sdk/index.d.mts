// Types for the SPR SDK. See README.md.
import type { KeyObject } from "node:crypto";
import type { Seal, CoreCheck, SealCheck } from "@luca-network/spr";
export * as spr from "@luca-network/spr";

export declare const SDK_PRODUCER: { name: string; version: string };
export interface BookConfig {
  dir: string; agentId: string; entity: string; owner?: string | null; timeZone?: string;
  binding?: boolean; key?: KeyObject | string; now?: () => Date; producer?: { name: string; version: string };
}
export interface Check { check: string; ok: boolean; detail: string; severity?: "hard" | "note" }
export interface IntentInput {
  purpose: string; counterparty?: string; expected_amount_minor?: number; max_amount_minor?: number; currency?: string;
  rail?: string; rail_ref?: Record<string, string>; terms?: Record<string, unknown>; expires_in?: string; expires_in_hours?: number;
}
export interface IntentReceipt {
  intent_id: string; decision: "none" | "within_mandate" | "outside_mandate"; authority: Authority; checks: Check[]; declared_at: string; expires_at: string; max_amount_minor: number | null;
  seal: Seal; binding: { scheme: string; nonce: string } | null;
}
/** "self-declared": the book's own mandate.json, written by whoever keeps the book. "none": no mandate.json. */
export type Authority = "self-declared" | "none";
export interface SettlementInput {
  /** ISO 8601 with its offset (Z or ±hh:mm); a time without one is refused. Omitted: the time of sealing, and the record says so. */
  rail: string; source_id: string; amount_minor: number; currency: string; occurred_at?: string; counterparty?: string;
  /** Only to correct a payment already sealed with different facts: the new version carries the reason. */
  correction?: { reason: string };
  intent_id?: string; memo?: string; state?: "cleared" | "pending"; direction?: "outflow" | "inflow"; nonce?: string | null;
  x402?: { authorization?: { nonce?: string } }; evidence?: Record<string, unknown>;
}
/** "conflict": different facts for a payment already sealed, given without a correction. Nothing is sealed, and
 *  differs lists what differs. */
export interface SealResult {
  status: "recorded" | "new_version" | "unchanged" | "conflict"; record_id: string; within_consent?: boolean | null; binding?: string | null;
  checks?: Check[]; seal?: Seal; sealed?: false; differs?: { field: string; sealed: unknown; given: unknown }[]; how?: string;
}
export interface PaymentCheck { id: string; decision: "approve" | "decline"; authority: Authority; checks: Check[]; reasons: string[]; seal: Seal }
export interface Label { label_id: string; record_id: string; shared: any; shared_sha256: string; sign_this: string; signatures: any[]; state?: string }
export declare const PART_MAX_RECORDS: number;
export declare const PART_MAX_BYTES: number;
export declare class SprBook {
  constructor(cfg: BookConfig);
  readonly dir: string; readonly keyId: string;
  declare(input: IntentInput): IntentReceipt;
  recordIntent(input: IntentInput): IntentReceipt;
  nonceFor(intentId: string, seq?: number): `0x${string}`;
  checkPayment(input: { amount_minor: number; currency: string; counterparty?: string; intent_id?: string; nonce?: string | null;
  }): PaymentCheck;
  seal(input: SettlementInput): SealResult;
  recordSettlement(input: SettlementInput): SealResult;
  cancelIntent(intentId: string, reason: string): any;
  getIntent(intentId: string): any;
  label(recordId: string, opts: { counterparty: string; product?: { code: string; label: string } | null; tax?: { jurisdiction?: string; treatment?: string }; network?: string; service_period?: unknown }): Label;
  counterpartySignature(labelId: string, jwk: Record<string, any>, signature: string): Label;
  verifyRecord(recordId: string): SealCheck & { record_id: string; core_fields: CoreCheck; key_id: string; how_to_check: string };
  listRecords(opts?: { all?: boolean }): { record_id: string; rail: string; amount_minor: number; currency: string; settled_on: string; counterparty: string | null; intent_id: string | null; within_consent: boolean | null; payload_sha256: string }[];
  exportPackage(outDir: string): { folder: string; files: string[]; verified: boolean; passed: number; failed: number };
  /** The book's public key, which finance registers with Luca once. */
  publicKey(): { key_id: string; public_pem: string; entity: string; agent_id: string };
  /** The book as a package: each file by name, as text, with a sealed manifest. */
  packageFiles(): Record<string, string>;
  /** The book in parts that each stand on their own (every version of a payment in one part); one part when it fits. */
  packageParts(opts?: PartOptions): Record<string, string>[];
  /** A new key for the book, handed over by the old one in keys.jsonl. Records sealed before stay checkable. */
  rotateKey(opts?: { key?: KeyObject | string; reason?: string }): { from: string; to: string; at: string; key_file: string | null; next: string };
  /** Sends the book to Luca, which checks every seal before storing anything. url and apiKey default to LUCA_URL and LUCA_API_KEY. */
  sendToLuca(opts?: LucaOptions): Promise<LucaImport>;
  /** Asks Luca to accept this book's key for an entity, with a finance user's key. */
  registerWithLuca(opts: LucaOptions & { entityId: string; agentOnly?: boolean }): Promise<{ change: { id: string; status: string } }>;
}
export interface PartOptions { /** Default 4000 */ maxRecords?: number; /** Default 8 MiB */ maxBytes?: number }
export interface LucaOptions extends PartOptions { url?: string; apiKey?: string; fetch?: typeof fetch }
export interface LucaImport {
  /** When the book went in parts: how many, and each part's own answer in results. */
  parts?: number; results?: LucaImport[];
  import_id: string; package_sha256: string; entity_id: string; checks: { passed: number; failed: number };
  records_in_package: number; current_records: number; created: number; versioned: number; unchanged: number; read_from_rail: number; differs_from_rail: number;
  items: { spr_record_id: string; spr_payload_sha256: string; record_id: string | null; outcome: "created" | "versioned" | "unchanged" | "read_from_rail";
    differs: { field: string; rail: unknown; spr: unknown }[] | null }[];
}
export interface SprTool { name: string; description: string; parameters: Record<string, any>; run(args: any): unknown }
export declare function sprTools(book: SprBook): SprTool[];
export declare function toOpenAIAgentsTools(book: SprBook, tool: (def: any) => any): any[];
export declare function toLangChainTools(book: SprBook, tool: (fn: any, def: any) => any): any[];
