# RFC 0001: Terms, and optional fields for the Machine Payment Profile

- **Status:** open for comment until 30 November 2026
- **Proposed by:** a representative of Luca
- **Type:** a clarification (the terms) and an addition of optional members (the fields). Nothing here changes what an existing record must hold or how it is checked.

## Summary

SPR records machine payments, and Luca has proposed a Machine Payment Profile for XBRL GL so that the same facts can be carried in accounting and reporting systems. This RFC does two things:

1. It defines five terms the specification and its documentation use.
2. It names optional members that intents and records MAY carry, so the facts in the profile have one agreed place in an SPR payload, and adds an xBRL-CSV export of a book.

The reference library and SDKs from version 0.1.7 write these members when they are given. Their names are provisional until this RFC is decided; if the decision changes a name, the SDKs will read both.

## 1. Terms

| Term | Meaning |
|---|---|
| **Machine payment** | A payment started by software, with no person approving that individual payment when it is made. SPR records machine payments. |
| **AI agent payment** | A machine payment started by an AI agent acting for a principal: the company or person it pays for. The principal is a record's `entity`; the agent is `agent.id`. |
| **Autonomous agent payment** | An AI agent payment made within limits set in advance, such as an intent or a mandate, and not approved by a person one by one. |
| **Machine-to-machine payment** | A machine payment in which the payee is also software (an API, a service or another agent) and accepts payment with no person involved. x402 is an example. |
| **Subledger** | The detailed record of a principal's agent payments, each sealed, from which summary entries are posted to the general ledger, and to which every general-ledger line can be traced back. An SPR book is a subledger. |

## 2. Optional members

Each member appears only when the producer has the fact. A reader that does not understand a member keeps it, as for any member (section 6), because the seal covers it.

**On intents and records**

| Member | Profile concept | Meaning |
|---|---|---|
| `agent.type` | agentType | The kind of agent, such as `autonomous-agent` or `assistant` |
| `agent.provider` | agentProvider | Who built or operates the agent software |
| `agent.version` | agentVersion | The agent's own version. `producer` remains the version of the software that sealed the payload. |
| `principal.type` | principalType | `organization` or `person` |
| `principal.identifier` | principalIdentifier | `{ scheme, value }`, such as `{ "scheme": "lei", "value": "5493…" }`. `entity` remains the principal's name. |

**On intents**

| Member | Profile concept | Meaning |
|---|---|---|
| `mandate` | mandateReference and the rest | `{ id, issuer, scope, valid_from, valid_until, sha256 }`: the standing authority the intent was checked against. `sha256` is over the canonical JSON of the mandate document (section 1), so the document can be kept elsewhere and still be matched. `precheck.authority` says who vouches for the mandate (`self-declared` for a book's own `mandate.json`). |
| `product` | productOrServiceReference | What is being bought: a product, plan or service reference |

**On records**

| Member | Profile concept | Meaning |
|---|---|---|
| `evidence.kind` | settlementEvidenceType | `onchain`, `provider_reference` or another kind |
| `evidence.network` | paymentNetwork | The network the payment settled on, such as `base` |
| `evidence.provider` | settlementProvider | Who settled it, such as an x402 facilitator |
| `counterparty_ref` | counterpartyType, counterpartyIdentifier, counterpartyResolutionMethod | `{ type, identifier: { scheme, value } }`; the scheme says how the counterparty was identified (`wallet`, `domain`, `did`, `lei` and so on). `counterparty` remains its name. |
| `receipt` | supporting receipt or document | `{ ref, sha256, kind }`: where the receipt is kept and its hash, never the receipt itself |
| `buyer_intent` | (proposed) buyerIntentReference, buyerIntentHash | At a merchant: the buyer's own sealed intent, its hash and the buyer's key, with the checks of the payment against it. Added in 0.2.0, during the comment period. |
| `buyer_authentication` | (proposed) buyerAuthenticationMethod, buyerAuthenticationResult | How the buyer authenticated at checkout (`3ds`, `passkey`, `network_token`, `otp`, `agent_mandate`), its result and reference; never the evidence itself. Added in 0.2.0. |
| `payment_refs` | orderReference, processorTransactionReference, invoiceReference | `{ order_id, processor_transaction_id, invoice_ref }`: the merchant's order ID, the payment processor's own transaction ID and the invoice paid, so the buyer's finance team, the merchant's, the processor and a card network can find the same payment. Added in 0.1.10, during the comment period. |

## 3. xBRL-CSV

`exportXbrlCsv` in the JavaScript SDK, and the `export_xbrl_csv` tool of the MCP server, write a book's payments as xBRL-CSV in the concepts of the draft profile: one row per payment (the current version of each record), with the intent it was paid under. The concepts are in the namespace `https://github.com/luca-network/spr/xbrl/mpp/draft-0.2`. No taxonomy is published yet, so the report names none; it is offered so that the profile can be reviewed against real data.

Amounts appear twice: `paymentAmount` in decimal, with the asset's decimals, and `paymentAmountMinor` as SPR holds it, an integer in the asset's minor unit.

## Questions for comment

1. Should `principal.identifier` require a scheme from a fixed list?
2. Should `mandate.sha256` be required whenever `mandate` is present?
3. Should the profile's concepts that SPR adds (the intent, the binding, the assurance source) be proposed to XBRL as part of the profile, or kept as an SPR extension?

Comment on the pull request that adds this file, or write to hello@luca.network.
