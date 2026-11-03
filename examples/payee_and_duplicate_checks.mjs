// The checks before an agent pays (SPR 0.1.11): a payee the agent was never meant to pay is declined, and so is the
// same invoice paid twice. Every answer is sealed with the company's key.
//   npm install @luca-network/spr-sdk
//   node payee_and_duplicate_checks.mjs
import { SprBook } from "@luca-network/spr-sdk";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "spr-checks-"));
const book = new SprBook({ dir, agentId: "agt_payables", entity: "Example Co" });

// The company's limits: the payees its agents may pay, and a day in which the same amount to the same payee is a repeat.
// Keep mandate.json where the agent can't write, or the agent could add a payee.
writeFileSync(join(dir, "mandate.json"), JSON.stringify({
  mandate_id: "ap-2026", currency: "USD", max_per_payment_minor: 500000,
  payees: ["domain:acme.example", "wallet:0x59dd0305c70fdd714d9a022a1b0daf93e7dcec6d"],
  duplicate_window: "P1D",
}));

const show = (what, c) => console.log(`${what}: ${c.decision}${c.reasons.length ? `\n    ${c.reasons.join("\n    ")}` : ""}`);

// 1. The agent is about to pay Acme's invoice INV-7.
const intent = book.declare({ purpose: "Pay Acme invoice INV-7 for October hosting", max_amount_minor: 45000, currency: "USD", payee_id: "domain:acme.example" });

// 2. Something told the agent to pay another account. The check declines it.
show("Paying an account the intent doesn't name", book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: intent.intent_id,
  payee_id: "domain:acme-billing.example", invoice_ref: "INV-7" }));

// 3. The right payee: approved, then paid and recorded with the invoice number.
show("Paying Acme", book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: intent.intent_id, payee_id: "domain:acme.example", invoice_ref: "INV-7" }));
book.seal({ rail: "stripe", source_id: "pi_inv7", amount_minor: 42000, currency: "USD", occurred_at: new Date().toISOString(), intent_id: intent.intent_id,
  counterparty: "Acme", counterparty_id: "domain:acme.example", invoice_ref: "INV-7" });

// 4. A second run of the agent tries to pay INV-7 again. Declined, naming the record that already paid it.
const again = book.declare({ purpose: "Pay Acme invoice INV-7", max_amount_minor: 45000, currency: "USD" });
show("Paying INV-7 a second time", book.checkPayment({ amount_minor: 42000, currency: "USD", intent_id: again.intent_id, payee_id: "domain:acme.example", invoice_ref: "INV-7" }));

// Every check above is in the book, sealed. An export checks with the SPR library alone.
console.log(`\nExport checks: ${book.exportPackage(join(dir, "..", `${dir.split(/[\\/]/).pop()}-export`)).verified}`);
