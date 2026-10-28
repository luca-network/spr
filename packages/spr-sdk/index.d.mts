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
  intent_id: string; decision: string; checks: Check[]; declared_at: string; expires_at: string; max_amount_minor: number | null;
  seal: Seal; binding: { scheme: string; nonce: string } | null;
}
export interface SettlementInput {
  rail: string; source_id: string; amount_minor: number; currency: string; occurred_at?: string; counterparty?: string;
  intent_id?: string; memo?: string; state?: "cleared" | "pending"; direction?: "outflow" | "inflow"; nonce?: string | null;
  x402?: { authorization?: { nonce?: string } }; evidence?: Record<string, unknown>;
}
export interface SealResult {
  status: "recorded" | "new_version" | "unchanged"; record_id: string; within_consent?: boolean | null; binding?: string | null;
  checks?: Check[]; seal: Seal;
}
export interface PaymentCheck { id: string; decision: "approve" | "decline"; checks: Check[]; reasons: string[]; seal: Seal }
export interface Label { label_id: string; record_id: string; shared: any; shared_sha256: string; sign_this: string; signatures: any[]; state?: string }
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
}
export interface SprTool { name: string; description: string; parameters: Record<string, any>; run(args: any): unknown }
export declare function sprTools(book: SprBook): SprTool[];
export declare function toOpenAIAgentsTools(book: SprBook, tool: (def: any) => any): any[];
export declare function toLangChainTools(book: SprBook, tool: (fn: any, def: any) => any): any[];
