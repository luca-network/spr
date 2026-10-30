// SPR Accounting Export – industry templates (Phase 2).
//
// Seven industry templates encoded as versioned data (not scattered conditionals).
// Each template provides:
//   - accounts: map from treatment → { code, name, gaap_ref, ifrs_ref }
//   - threshold_rules: conditions that change treatment based on amount or context
//   - default_treatment: fallback when no rule matches
//
// IMPORTANT: GAAP/IFRS account references here are illustrative examples based on
// commonly used numbering conventions. They have NOT been validated against an
// authoritative taxonomy source. Implementations MUST NOT claim formal taxonomy
// conformance without independent verification. Users must map to their own chart
// of accounts via the company GL mapping.
//
// Deliverable 2 traceability: each template references the industry profile section
// that drove its design. Template versions allow deterministic re-export.

import { Treatment } from "./contracts.mjs";

export const TEMPLATES_VERSION = "1.0.0";

// ── Helper ────────────────────────────────────────────────────────────────────────────────
const acct = (code, name, gaap_ref = null, ifrs_ref = null) => ({ code, name, gaap_ref, ifrs_ref });

// ── Templates ─────────────────────────────────────────────────────────────────────────────

export const INDUSTRY_TEMPLATES = {

  software_saas: {
    name: "software_saas",
    description: "SaaS and software companies; agent AI, API calls, cloud spend",
    version: "1.0.0",
    default_treatment: Treatment.OPERATING_EXPENSE,
    accounts: {
      [Treatment.OPERATING_EXPENSE]: acct("6100", "Technology & Software Expense", "ASC 730 / ASC 350-40", "IAS 38"),
      [Treatment.COST_OF_REVENUE]:   acct("5100", "Cost of Revenue – API & Data", "ASC 606", "IFRS 15"),
      [Treatment.PREPAID_ASSET]:     acct("1310", "Prepaid Software Subscriptions", "ASC 350-40", "IAS 38"),
      [Treatment.FIXED_ASSET]:       acct("1520", "Computer Equipment", "ASC 360", "IAS 16"),
      [Treatment.INVENTORY]:         acct("1410", "Inventory – Software Licenses", "ASC 330", "IAS 2"),
      [Treatment.INTERCOMPANY]:      acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
    },
    threshold_rules: [
      // COGS rule evaluated first: any purchase for customer delivery → Cost of Revenue.
      // This prevents the capitalization rule below from mis-classifying customer-delivery
      // hardware as a fixed asset instead of COGS.
      {
        id: "saas_cogs",
        description: "Costs billed directly to customers → COGS",
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "saas_capitalization",
        description: "Hardware/equipment above threshold → fixed asset (internal use only)",
        applies_to_categories: ["hardware", "equipment", "laptop", "computer", "server"],
        capitalization_threshold_minor: 250000, // $2,500 in cents
        above_threshold_treatment: Treatment.FIXED_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
        useful_life_years: { min: 3, max: 5 },
        note: "Threshold is illustrative; companies set their own capitalization policy.",
      },
      {
        id: "saas_prepaid",
        description: "Annual subscriptions paid upfront → prepaid asset",
        applies_to_categories: ["subscription", "saas", "license"],
        prepaid_threshold_months: 3,
        above_threshold_treatment: Treatment.PREPAID_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
      },
    ],
  },

  media_content: {
    name: "media_content",
    description: "Media, publishing, content platforms",
    version: "1.0.0",
    default_treatment: Treatment.OPERATING_EXPENSE,
    accounts: {
      [Treatment.OPERATING_EXPENSE]: acct("6200", "Content Acquisition & Licensing", "ASC 920", "IAS 38"),
      [Treatment.COST_OF_REVENUE]:   acct("5200", "Cost of Content Delivery", "ASC 606", "IFRS 15"),
      [Treatment.PREPAID_ASSET]:     acct("1320", "Prepaid Content Licenses", "ASC 920", "IAS 38"),
      [Treatment.FIXED_ASSET]:       acct("1530", "Production Equipment", "ASC 360", "IAS 16"),
      [Treatment.INVENTORY]:         acct("1420", "Content Inventory", "ASC 330", "IAS 2"),
      [Treatment.INTERCOMPANY]:      acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
    },
    threshold_rules: [
      {
        id: "media_cogs",
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "media_capitalization",
        applies_to_categories: ["equipment", "camera", "hardware"],
        capitalization_threshold_minor: 250000,
        above_threshold_treatment: Treatment.FIXED_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
        useful_life_years: { min: 3, max: 7 },
      },
    ],
  },

  research: {
    name: "research",
    description: "Research organisations, universities, R&D-intensive companies",
    version: "1.0.0",
    default_treatment: Treatment.OPERATING_EXPENSE,
    accounts: {
      [Treatment.OPERATING_EXPENSE]: acct("6300", "Research & Development Expense", "ASC 730", "IAS 38"),
      [Treatment.COST_OF_REVENUE]:   acct("5300", "Cost of Research Services", "ASC 606", "IFRS 15"),
      [Treatment.PREPAID_ASSET]:     acct("1330", "Prepaid Research Subscriptions", "ASC 340", "IAS 38"),
      [Treatment.FIXED_ASSET]:       acct("1540", "Research Equipment", "ASC 360", "IAS 16"),
      [Treatment.INVENTORY]:         acct("1430", "Research Supplies", "ASC 330", "IAS 2"),
      [Treatment.INTERCOMPANY]:      acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
    },
    threshold_rules: [
      {
        id: "research_capitalization",
        applies_to_categories: ["equipment", "hardware", "laptop", "computer", "server", "instrument"],
        capitalization_threshold_minor: 250000,
        above_threshold_treatment: Treatment.FIXED_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
        useful_life_years: { min: 3, max: 7 },
        note: "Many jurisdictions expense all R&D costs; verify local rules before capitalising.",
      },
      {
        id: "research_data_internal",
        applies_to_categories: ["data", "database", "market_data", "api"],
        applies_when: { delivery_context: "internal_use" },
        treatment: Treatment.OPERATING_EXPENSE,
      },
      {
        id: "research_data_external",
        applies_to_categories: ["data", "database", "market_data", "api"],
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
    ],
  },

  professional_services: {
    name: "professional_services",
    description: "Consulting, legal, accounting, advisory firms",
    version: "1.0.0",
    default_treatment: Treatment.OPERATING_EXPENSE,
    accounts: {
      [Treatment.OPERATING_EXPENSE]: acct("6400", "Professional & Admin Expense", "ASC 720", "IAS 1"),
      [Treatment.COST_OF_REVENUE]:   acct("5400", "Cost of Services – Direct Labour", "ASC 606", "IFRS 15"),
      [Treatment.PREPAID_ASSET]:     acct("1340", "Prepaid Services", "ASC 340", "IAS 38"),
      [Treatment.FIXED_ASSET]:       acct("1550", "Office Equipment", "ASC 360", "IAS 16"),
      [Treatment.INVENTORY]:         acct("1440", "Supplies Inventory", "ASC 330", "IAS 2"),
      [Treatment.INTERCOMPANY]:      acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
    },
    threshold_rules: [
      {
        id: "ps_cogs_data",
        applies_to_categories: ["data", "api", "market_data"],
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "ps_cogs_all",
        description: "Any purchase for customer delivery → COGS",
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "ps_capitalization",
        applies_to_categories: ["equipment", "hardware", "laptop", "computer"],
        capitalization_threshold_minor: 250000,
        above_threshold_treatment: Treatment.FIXED_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
        useful_life_years: { min: 3, max: 5 },
      },
    ],
  },

  ecommerce_retail: {
    name: "ecommerce_retail",
    description: "E-commerce, retail, marketplace operators",
    version: "1.0.0",
    default_treatment: Treatment.OPERATING_EXPENSE,
    accounts: {
      [Treatment.OPERATING_EXPENSE]: acct("6500", "Operating & Admin Expense", "ASC 420", "IAS 1"),
      [Treatment.COST_OF_REVENUE]:   acct("5500", "Cost of Goods Sold", "ASC 330", "IAS 2"),
      [Treatment.PREPAID_ASSET]:     acct("1350", "Prepaid Costs", "ASC 340", "IFRS 15"),
      [Treatment.FIXED_ASSET]:       acct("1560", "Warehouse & Store Equipment", "ASC 360", "IAS 16"),
      [Treatment.INVENTORY]:         acct("1450", "Merchandise Inventory", "ASC 330", "IAS 2"),
      [Treatment.INTERCOMPANY]:      acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
    },
    threshold_rules: [
      {
        id: "retail_cogs_data",
        applies_to_categories: ["data", "api"],
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "retail_inventory",
        applies_to_categories: ["merchandise", "product", "goods", "stock"],
        applies_when: { for_resale: true },
        treatment: Treatment.INVENTORY,
      },
      {
        id: "retail_capitalization",
        applies_to_categories: ["equipment", "hardware"],
        capitalization_threshold_minor: 250000,
        above_threshold_treatment: Treatment.FIXED_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
        useful_life_years: { min: 3, max: 10 },
      },
    ],
  },

  financial_services: {
    name: "financial_services",
    description: "Banks, fintechs, payment processors, investment firms",
    version: "1.0.0",
    default_treatment: Treatment.OPERATING_EXPENSE,
    accounts: {
      [Treatment.OPERATING_EXPENSE]: acct("6600", "Technology & Data Expense", "ASC 350", "IAS 38"),
      [Treatment.COST_OF_REVENUE]:   acct("5600", "Cost of Financial Services", "ASC 606", "IFRS 15"),
      [Treatment.PREPAID_ASSET]:     acct("1360", "Prepaid Technology", "ASC 350-40", "IAS 38"),
      [Treatment.FIXED_ASSET]:       acct("1570", "Technology Infrastructure", "ASC 360", "IAS 16"),
      [Treatment.INVENTORY]:         acct("1460", "N/A – Financial Services", null, null),
      [Treatment.INTERCOMPANY]:      acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
    },
    threshold_rules: [
      {
        id: "finserv_cogs_data",
        applies_to_categories: ["data", "market_data", "api", "feed"],
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "finserv_cogs_all",
        description: "Any purchase for customer delivery → COGS",
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "finserv_capitalization",
        applies_to_categories: ["hardware", "server", "infrastructure"],
        capitalization_threshold_minor: 250000,
        above_threshold_treatment: Treatment.FIXED_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
        useful_life_years: { min: 3, max: 7 },
      },
    ],
  },

  general: {
    name: "general",
    description: "General business; use when no specific industry profile applies",
    version: "1.0.0",
    default_treatment: Treatment.OPERATING_EXPENSE,
    accounts: {
      [Treatment.OPERATING_EXPENSE]: acct("6000", "General Operating Expense", null, null),
      [Treatment.COST_OF_REVENUE]:   acct("5000", "Cost of Revenue", null, null),
      [Treatment.PREPAID_ASSET]:     acct("1300", "Prepaid Expenses", null, null),
      [Treatment.FIXED_ASSET]:       acct("1500", "Fixed Assets", null, null),
      [Treatment.INVENTORY]:         acct("1400", "Inventory", null, null),
      [Treatment.INTERCOMPANY]:      acct("2100", "Intercompany Payable", null, null),
    },
    threshold_rules: [
      {
        id: "general_cogs",
        applies_when: { delivery_context: "customer_delivery" },
        treatment: Treatment.COST_OF_REVENUE,
      },
      {
        id: "general_capitalization",
        applies_to_categories: ["hardware", "equipment", "laptop", "computer", "server"],
        capitalization_threshold_minor: 250000,
        above_threshold_treatment: Treatment.FIXED_ASSET,
        below_threshold_treatment: Treatment.OPERATING_EXPENSE,
        useful_life_years: { min: 3, max: 5 },
      },
    ],
  },
};

export const KNOWN_INDUSTRIES = Object.keys(INDUSTRY_TEMPLATES);

export function getTemplate(industryKey) {
  const t = INDUSTRY_TEMPLATES[industryKey];
  if (!t) throw new Error(`Unknown industry template: ${industryKey}. Known: ${KNOWN_INDUSTRIES.join(", ")}`);
  return t;
}
