# ADR 0002: Classification Policy Precedence

**Status:** Accepted  
**Date:** 2026-10-30  
**Deciders:** Luca Records engineering

---

## Context

The five-layer classification engine (`classify.mjs`) must decide how to handle conflicts between:

- Per-record override categories (set by an AI agent at payment time)
- Company-level GL mappings (maintained by the accounting team)
- Industry template defaults (built into the SDK)
- Missing or ambiguous context (delivery_context not set; industry not registered)

The classification is advisory — it produces a draft journal entry that a human accountant must
review. It is not an authoritative determination of accounting treatment. Despite this, the
precedence rules must be predictable and auditable.

---

## Decision

**Precedence (highest to lowest):**

1. **Per-record override** (`context.override_categories`) — explicit override from the agent that
   created the record. Recorded as `rule_id: "override"` in the classification result.
2. **Company GL mapping** (`companyMapping.accounts`) — chart-of-accounts lookup keyed by
   treatment. If a mapping exists, its account code and name replace the template default.
3. **Industry template** (`industry-templates.mjs`) — versioned template for the company's
   registered industry. Provides default treatment and account codes.
4. **`general` template fallback** — used when no industry is registered or the registered
   industry has no matching template. Produces a NEEDS_REVIEW exception.
5. **Exception** — when required context is missing (delivery_context, industry, amount), an
   exception record is produced instead of a classification. The journal is still generated as
   DRAFT with a placeholder account code.

---

## Alternatives considered

### Strict failure on missing context

Reject records with missing context rather than generating exceptions. Simpler but breaks the
export for any record with incomplete metadata. Accounting teams need partial exports to identify
what needs manual review.

### No industry templates; company mapping only

Would require every company to maintain a full chart of accounts mapping. Templates reduce
configuration burden and provide auditable defaults. Templates are marked with a `classify_version`
so changes are traceable.

---

## Consequences

**Positive:**
- Predictable, documented precedence; auditors can trace each classification to its rule.
- Missing context produces exceptions, not crashes; exports remain complete.
- Templates are versioned (`industry_templates_version`) so classification results carry provenance.

**Negative/risks:**
- The `general` fallback may produce technically incorrect account codes for some industries.
  All fallback results include `taxonomy_note: "illustrative/unverified"`.
- Override categories bypass all policy checks; agents with override authority must be governed
  externally.

---

## Security and compatibility impact

- Classification results are never sealed or signed; they carry no cryptographic authority.
- The `classify_version` field in each result records the SDK version used, enabling re-classification
  if policy changes.
- Adding a new industry template is additive and backward-compatible; removing one would require
  a major version bump and migration guide.

---

## References

- `packages/spr-sdk/classify.mjs` – `classify()`, five-layer logic
- `packages/spr-sdk/industry-templates.mjs` – seven versioned templates
- `packages/spr-sdk/contracts.mjs` – `Treatment` enum, `makeExceptionRecord()`
- `test/accounting.test.mjs` – "missing industry → exception", "advisory exception for missing delivery_context"
- `python/spr/classify.py` – Python mirror
- ADR 0005 (ERP adapters vs portable export)
