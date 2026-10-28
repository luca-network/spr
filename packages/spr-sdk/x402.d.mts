// Types for the SPR SDK's x402 wrapper.
import type { SprBook, IntentReceipt, SealResult } from "./index.mjs";
export interface Signer { address: `0x${string}`; signTypedData(args: any): Promise<`0x${string}`> }
export interface IntentBinding {
  nonce: `0x${string}`; expiresAt?: string;
  check?: (req: { amount: string; payTo: string; asset: string; network: string; nonce: string | null }) => Promise<{ decision: "approve" | "decline"; reasons: string[]; id: string }> | { decision: "approve" | "decline"; reasons: string[]; id: string };
}
export declare class PaymentDeclinedByLuca extends Error { checkId: string; reasons: string[]; constructor(checkId: string, reasons: string[]) }
export declare class IntentBoundExactEvmScheme {
  readonly scheme: "exact"; findDefaultAsset: any; lastBound: boolean;
  constructor(signer: Signer, binding: IntentBinding);
  createPaymentPayload(x402Version: number, requirements: any, context?: any): Promise<any>;
}
export interface LucaOptions {
  purpose: string; max_amount_minor?: number; expected_amount_minor?: number; currency?: string; counterparty?: string;
  terms?: Record<string, unknown>; expires_in?: string;
}
export type LucaResponse = Response & { luca?: { intent: IntentReceipt; record: SealResult | null; status: "paid" | "not_paid" | "free" } };
export declare function withLuca(book: SprBook, options: { signer: Signer; fetch?: typeof fetch; bind?: boolean }):
  (input: RequestInfo | URL, init?: RequestInit & { luca?: LucaOptions }) => Promise<LucaResponse>;
