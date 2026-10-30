// SPR Accounting Export – classification engine (Phase 2).
//
// Implements the five-layer Deliverable 2 classification model:
//   Layer 1: Company profile (jurisdiction, framework, business model)
//   Layer 2: Item taxonomy (category, whether resold)
//   Layer 3: Transaction relationship (internal-use vs customer-delivery)
//   Layer 4: Accounting treatment selection (six treatments)
//   Layer 5: Industry account + GAAP/IFRS mapping
//
// Design principles:
//   - Rules determine classification; AI is a suggestion source only
//   - Missing context → ExceptionRecord, not silent default operating expense
//   - Every result is traceable to a rule ID and template version
//   - This module never modifies SPR sealed records

import { Treatment, makeExceptionRecord } from "./contracts.mjs";
import { INDUSTRY_TEMPLATES, getTemplate } from "./industry-templates.mjs";

export const CLASSIFY_VERSION = "1.0.0";
export const CLASSIFY_SCHEMA = "luca.classification/0.1";

// ── Category normalisation ────────────────────────────────────────────────────────────────
// Maps raw purpose/counterparty text to canonical category tags.
// This is a simple keyword-based rule; production systems should use richer taxonomies.
const CATEGORY_KEYWORDS = [
  { tags: ["data", "market_data"],       patterns: [/\bdata\b/i, /\bfeed\b/i, /\bmarket[ _-]?data\b/i, /\bdataset\b/i] },
  { tags: ["api"],                       patterns: [/\bapi\b/i, /\bapi[ _-]?call\b/i, /\bapi[ _-]?access\b/i] },
  { tags: ["subscription", "saas"],      patterns: [/\bsubscription\b/i, /\bsaas\b/i, /\bsoftware[ _-]?service\b/i] },
  { tags: ["license"],                   patterns: [/\blicen[sc]e\b/i] },
  { tags: ["laptop", "hardware", "equipment"], patterns: [/\blaptop\b/i, /\bnotebook\b/i, /\bmacbook\b/i] },
  { tags: ["computer", "hardware", "equipment"], patterns: [/\bcomputer\b/i, /\bdesktop\b/i, /\bworkstation\b/i] },
  { tags: ["server", "hardware", "equipment"], patterns: [/\bserver\b/i, /\binstance\b/i, /\bvm\b/i, /\bcloud[ _-]?compute\b/i] },
  { tags: ["hardware", "equipment"],     patterns: [/\bhardware\b/i, /\bequipment\b/i, /\bdevice\b/i] },
  { tags: ["merchandise", "goods"],      patterns: [/\bmerchandise\b/i, /\bgoods\b/i, /\bproduct\b/i] },
];

export function inferCategories(text = "") {
  const found = new Set();
  for (const { tags, patterns } of CATEGORY_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) tags.forEach((t) => found.add(t));
  }
  return [...found];
}

// ── Layer 1: Company profile validation ──────────────────────────────────────────────────
export function validateCompanyProfile(profile = {}) {
  const problems = [];
  if (!profile.industry) problems.push("company_profile.industry is required for classification");
  else if (!INDUSTRY_TEMPLATES[profile.industry]) problems.push(`Unknown industry: ${profile.industry}`);
  const framework = profile.reporting_framework ?? "US_GAAP";
  if (!["US_GAAP", "IFRS", "OTHER"].includes(framework)) problems.push(`Unknown reporting_framework: ${framework}`);
  return { ok: problems.length === 0, problems, framework };
}

// ── Main classification function ──────────────────────────────────────────────────────────
/**
 * classify(record, context, companyProfile) → { result, exceptions }
 *
 * record: SPR record payload (from records.jsonl)
 * context: {
 *   delivery_context: "internal_use" | "customer_delivery" | null,
 *   for_resale: boolean,
 *   override_categories: string[]  (optional; overrides inferred categories)
 * }
 * companyProfile: {
 *   industry: string,   // key from INDUSTRY_TEMPLATES
 *   reporting_framework: "US_GAAP" | "IFRS" | "OTHER",
 *   capitalization_threshold_minor: number | null   (null → use template default)
 *   jurisdiction: string | null
 * }
 *
 * Returns:
 *   result: classification result or null if exception
 *   exceptions: ExceptionRecord[]
 */
export function classify(record, context = {}, companyProfile = {}) {
  const exceptions = [];
  const recordId = record?.record_id ?? "unknown";
  const digest = record?._spr_payload_sha256 ?? null;
  const exportId = context.export_id ?? null;

  // Layer 1: validate company profile
  const profileCheck = validateCompanyProfile(companyProfile);
  if (!profileCheck.ok) {
    profileCheck.problems.forEach((msg) =>
      exceptions.push(makeExceptionRecord({
        record_id: recordId, spr_payload_sha256: digest,
        exception_type: "missing_context",
        message: msg, export_id: exportId,
      }))
    );
    return { result: null, exceptions };
  }

  const template = getTemplate(companyProfile.industry);
  const framework = profileCheck.framework;

  // Layer 2: item taxonomy
  const purposeText = [record?.purpose, record?.memo, record?.counterparty, context.description].filter(Boolean).join(" ");
  const categories = context.override_categories?.length
    ? context.override_categories
    : inferCategories(purposeText);

  // Layer 3: delivery context
  const deliveryContext = context.delivery_context ?? null;

  // Layer 4: rule-based treatment selection
  let selectedTreatment = null;
  let appliedRuleId = null;
  const capThreshold = companyProfile.capitalization_threshold_minor ?? null;

  for (const rule of template.threshold_rules) {
    // Check category match
    const categoryMatch = !rule.applies_to_categories ||
      rule.applies_to_categories.some((c) => categories.includes(c));

    // Check context match
    let contextMatch = true;
    if (rule.applies_when) {
      if (rule.applies_when.delivery_context && rule.applies_when.delivery_context !== deliveryContext) contextMatch = false;
      if (rule.applies_when.for_resale !== undefined && rule.applies_when.for_resale !== Boolean(context.for_resale)) contextMatch = false;
    }

    if (!categoryMatch || !contextMatch) continue;

    // Capitalisation rule
    if (rule.capitalization_threshold_minor !== undefined) {
      const threshold = capThreshold ?? rule.capitalization_threshold_minor;
      const amt = Math.abs(record?.amount_minor ?? 0);
      selectedTreatment = amt >= threshold
        ? rule.above_threshold_treatment
        : rule.below_threshold_treatment;
      appliedRuleId = rule.id;
      break;
    }

    // Prepaid rule: requires subscription period to determine above/below threshold.
    // Without it, use the conservative below_threshold_treatment (typically OPERATING_EXPENSE)
    // and emit an advisory exception so the reviewer can supply the period.
    if (rule.prepaid_threshold_months !== undefined) {
      const periodMonths = context.subscription_period_months ?? null;
      selectedTreatment = (periodMonths !== null && periodMonths >= rule.prepaid_threshold_months)
        ? rule.above_threshold_treatment
        : rule.below_threshold_treatment;
      appliedRuleId = rule.id;
      if (periodMonths === null) {
        exceptions.push(makeExceptionRecord({
          record_id: recordId, spr_payload_sha256: digest,
          exception_type: "missing_context",
          message: `subscription_period_months is required to determine prepaid vs. expense treatment (threshold: ${rule.prepaid_threshold_months} months). Defaulting to ${selectedTreatment}.`,
          details: { rule_id: rule.id, prepaid_threshold_months: rule.prepaid_threshold_months },
          requires_action: false,
          export_id: exportId,
        }));
      }
      break;
    }

    // Direct treatment assignment
    if (rule.treatment) {
      selectedTreatment = rule.treatment;
      appliedRuleId = rule.id;
      break;
    }
  }

  // If no specific rule matched, use template default
  if (!selectedTreatment) {
    selectedTreatment = template.default_treatment;
    appliedRuleId = `${template.name}.default`;
  }

  // Layer 5: account mapping
  const accountInfo = template.accounts[selectedTreatment];
  if (!accountInfo) {
    exceptions.push(makeExceptionRecord({
      record_id: recordId, spr_payload_sha256: digest,
      exception_type: "missing_gl_mapping",
      message: `No account mapping for treatment ${selectedTreatment} in template ${template.name}`,
      details: { treatment: selectedTreatment, industry: companyProfile.industry },
      export_id: exportId,
    }));
    return { result: null, exceptions };
  }

  // Warn about missing delivery context for data/API purchases
  if (!deliveryContext && categories.some((c) => ["data", "api", "market_data"].includes(c))) {
    exceptions.push(makeExceptionRecord({
      record_id: recordId, spr_payload_sha256: digest,
      exception_type: "missing_context",
      message: "delivery_context (internal_use or customer_delivery) is required for accurate classification of data/API purchases. Using default treatment.",
      details: { categories, applied_treatment: selectedTreatment },
      requires_action: false, // advisory only, classification proceeds
      export_id: exportId,
    }));
  }

  const result = {
    schema: CLASSIFY_SCHEMA,
    record_id: recordId,
    treatment: selectedTreatment,
    account_code: accountInfo.code,
    account_name: accountInfo.name,
    gaap_ref: accountInfo.gaap_ref,
    ifrs_ref: accountInfo.ifrs_ref,
    framework,
    industry: companyProfile.industry,
    template_version: template.version,
    rule_id: appliedRuleId,
    classify_version: CLASSIFY_VERSION,
    categories,
    delivery_context: deliveryContext,
    for_resale: Boolean(context.for_resale),
    taxonomy_note: "GAAP/IFRS account references are illustrative and have not been validated against an authoritative taxonomy. Map to your own chart of accounts before use.",
  };

  return { result, exceptions };
}
