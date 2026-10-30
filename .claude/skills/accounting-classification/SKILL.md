# Skill: accounting-classification

## Purpose

Classify SPR payment records using the five-layer Deliverable 2 model.

## Five-layer model

1. **Company profile** – jurisdiction, reporting framework (US_GAAP / IFRS), business model
2. **Item taxonomy** – category (hardware, data, API, subscription, …), whether resold
3. **Transaction relationship** – `internal_use` vs `customer_delivery`
4. **Accounting treatment** – one of: OPERATING_EXPENSE, PREPAID_ASSET, FIXED_ASSET,
   INVENTORY, COST_OF_REVENUE, INTERCOMPANY
5. **Account mapping** – industry template → GL account code + GAAP/IFRS reference

## Key examples

| Scenario | Amount | delivery_context | Treatment |
|----------|--------|-----------------|-----------|
| Market data for pricing model | $15 | `internal_use` | OPERATING_EXPENSE |
| Market data billed to customer | $15 | `customer_delivery` | COST_OF_REVENUE |
| Laptop, cap threshold $2,500 | $3,200 | — | FIXED_ASSET |
| Laptop, cap threshold $2,500 | $800 | — | OPERATING_EXPENSE |

## Industry templates

`software_saas`, `media_content`, `research`, `professional_services`,
`ecommerce_retail`, `financial_services`, `general`

## Missing context policy

If `delivery_context` is absent for a data/API purchase, classify() produces an **advisory
exception** (requires_action: false) and proceeds with the template default. If the industry
is unknown or missing, classify() returns result: null and a blocking exception.

**Do not silently default to OPERATING_EXPENSE for any unknown context** – record the
exception for human review.

## GAAP/IFRS references

Account references in the templates are illustrative examples only. They have NOT been
validated against an authoritative US GAAP or IFRS taxonomy. Always map to your own
chart of accounts and have your accountant confirm the treatment before posting.
