# Luca Records SPR — Accounting Export Tutorials

This folder contains 14 tutorials covering the SPR accounting export feature, from first
principles to advanced integration patterns.

## Prerequisites

- Node.js 20+ (or Python 3.11+)
- `npm install` in the repo root

## Tutorial index

| # | Title | Audience |
|---|-------|----------|
| 01 | [What Is a Sealed Payment Record?](01-what-is-a-sealed-payment-record.md) | Anyone |
| 02 | [Creating Your First SPR Book](02-creating-your-first-spr-book.md) | Developers |
| 03 | [Sealing and Verifying Records](03-sealing-and-verifying-records.md) | Developers |
| 04 | [Understanding Accounting Classification](04-understanding-accounting-classification.md) | Developers / Accountants |
| 05 | [Industry Templates and Account Codes](05-industry-templates-and-account-codes.md) | Developers / Accountants |
| 06 | [Generating a Draft Journal](06-generating-a-draft-journal.md) | Developers / Accountants |
| 07 | [Running the Full Accounting Export](07-running-the-full-accounting-export.md) | Developers |
| 08 | [Reading the Export Files](08-reading-the-export-files.md) | Developers / Accountants |
| 09 | [Exception Handling and Missing Context](09-exception-handling-and-missing-context.md) | Developers |
| 10 | [ERP Import — QuickBooks Online Sample](10-erp-import-quickbooks-online.md) | Accountants / Integrators |
| 11 | [ERP Import — SAP FI Sample](11-erp-import-sap-fi.md) | Integrators |
| 12 | [Settlement Confidence and What It Means](12-settlement-confidence.md) | Anyone |
| 13 | [Python SDK — Classify and Export](13-python-sdk-classify-and-export.md) | Python Developers |
| 14 | [Security Constraints and Key Management](14-security-constraints-and-key-management.md) | All |

---

- [Capability Provenance](CAPABILITY_PROVENANCE.md) — what local SPR can and cannot claim

## What these tutorials do NOT cover

- Posting journal entries to a live ERP (requires ERP credentials and approval)
- Rail settlement confirmation (requires hosted Luca)
- Production key management (use your organisation's secrets manager)

See `README.md` at the repo root for the full local SPR vs hosted Luca capability matrix.
