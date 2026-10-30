"""SPR Accounting Export – classification engine (Phase 2, Python mirror).

Implements the five-layer Deliverable 2 classification model.
Mirrors packages/spr-sdk/classify.mjs and packages/spr-sdk/industry-templates.mjs.

IMPORTANT: GAAP/IFRS account references are illustrative. Map to your own chart of accounts.
"""
from __future__ import annotations

import re
from typing import Any, Optional

CLASSIFY_VERSION = "1.0.0"
CLASSIFY_SCHEMA = "luca.classification/0.1"

# ── Treatments ────────────────────────────────────────────────────────────────────────────
class Treatment:
    OPERATING_EXPENSE = "OPERATING_EXPENSE"
    PREPAID_ASSET     = "PREPAID_ASSET"
    FIXED_ASSET       = "FIXED_ASSET"
    INVENTORY         = "INVENTORY"
    COST_OF_REVENUE   = "COST_OF_REVENUE"
    INTERCOMPANY      = "INTERCOMPANY"

# ── Industry templates ────────────────────────────────────────────────────────────────────
def _acct(code, name, gaap=None, ifrs=None):
    return {"code": code, "name": name, "gaap_ref": gaap, "ifrs_ref": ifrs}

INDUSTRY_TEMPLATES: dict[str, dict] = {
    "software_saas": {
        "name": "software_saas", "version": "1.0.0",
        "default_treatment": Treatment.OPERATING_EXPENSE,
        "accounts": {
            Treatment.OPERATING_EXPENSE: _acct("6100", "Technology & Software Expense", "ASC 730 / ASC 350-40", "IAS 38"),
            Treatment.COST_OF_REVENUE:   _acct("5100", "Cost of Revenue – API & Data", "ASC 606", "IFRS 15"),
            Treatment.PREPAID_ASSET:     _acct("1310", "Prepaid Software Subscriptions", "ASC 350-40", "IAS 38"),
            Treatment.FIXED_ASSET:       _acct("1520", "Computer Equipment", "ASC 360", "IAS 16"),
            Treatment.INVENTORY:         _acct("1410", "Inventory – Software Licenses", "ASC 330", "IAS 2"),
            Treatment.INTERCOMPANY:      _acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
        },
        "threshold_rules": [
            {"id": "saas_capitalization", "applies_to_categories": ["hardware", "equipment", "laptop", "computer", "server"],
             "capitalization_threshold_minor": 250000, "above_threshold_treatment": Treatment.FIXED_ASSET,
             "below_threshold_treatment": Treatment.OPERATING_EXPENSE, "useful_life_years": {"min": 3, "max": 5}},
            {"id": "saas_cogs", "applies_when": {"delivery_context": "customer_delivery"},
             "applies_to_categories": ["data", "api", "market_data"], "treatment": Treatment.COST_OF_REVENUE},
        ],
    },
    "research": {
        "name": "research", "version": "1.0.0",
        "default_treatment": Treatment.OPERATING_EXPENSE,
        "accounts": {
            Treatment.OPERATING_EXPENSE: _acct("6300", "Research & Development Expense", "ASC 730", "IAS 38"),
            Treatment.COST_OF_REVENUE:   _acct("5300", "Cost of Research Services", "ASC 606", "IFRS 15"),
            Treatment.PREPAID_ASSET:     _acct("1330", "Prepaid Research Subscriptions", "ASC 340", "IAS 38"),
            Treatment.FIXED_ASSET:       _acct("1540", "Research Equipment", "ASC 360", "IAS 16"),
            Treatment.INVENTORY:         _acct("1430", "Research Supplies", "ASC 330", "IAS 2"),
            Treatment.INTERCOMPANY:      _acct("2100", "Intercompany Payable", "ASC 850", "IAS 24"),
        },
        "threshold_rules": [
            {"id": "research_capitalization", "applies_to_categories": ["hardware", "equipment", "laptop", "computer", "server"],
             "capitalization_threshold_minor": 250000, "above_threshold_treatment": Treatment.FIXED_ASSET,
             "below_threshold_treatment": Treatment.OPERATING_EXPENSE, "useful_life_years": {"min": 3, "max": 7}},
            {"id": "research_data_internal", "applies_to_categories": ["data", "api", "market_data"],
             "applies_when": {"delivery_context": "internal_use"}, "treatment": Treatment.OPERATING_EXPENSE},
            {"id": "research_data_external", "applies_to_categories": ["data", "api", "market_data"],
             "applies_when": {"delivery_context": "customer_delivery"}, "treatment": Treatment.COST_OF_REVENUE},
        ],
    },
    "general": {
        "name": "general", "version": "1.0.0",
        "default_treatment": Treatment.OPERATING_EXPENSE,
        "accounts": {
            Treatment.OPERATING_EXPENSE: _acct("6000", "General Operating Expense"),
            Treatment.COST_OF_REVENUE:   _acct("5000", "Cost of Revenue"),
            Treatment.PREPAID_ASSET:     _acct("1300", "Prepaid Expenses"),
            Treatment.FIXED_ASSET:       _acct("1500", "Fixed Assets"),
            Treatment.INVENTORY:         _acct("1400", "Inventory"),
            Treatment.INTERCOMPANY:      _acct("2100", "Intercompany Payable"),
        },
        "threshold_rules": [
            {"id": "general_capitalization", "applies_to_categories": ["hardware", "equipment", "laptop", "computer", "server"],
             "capitalization_threshold_minor": 250000, "above_threshold_treatment": Treatment.FIXED_ASSET,
             "below_threshold_treatment": Treatment.OPERATING_EXPENSE, "useful_life_years": {"min": 3, "max": 5}},
            {"id": "general_cogs", "applies_when": {"delivery_context": "customer_delivery"},
             "treatment": Treatment.COST_OF_REVENUE},
        ],
    },
}
# Add remaining templates mirroring JS
for _key in ("media_content", "professional_services", "ecommerce_retail", "financial_services"):
    INDUSTRY_TEMPLATES[_key] = {
        "name": _key, "version": "1.0.0",
        "default_treatment": Treatment.OPERATING_EXPENSE,
        "accounts": {
            Treatment.OPERATING_EXPENSE: _acct("6000", "Operating Expense"),
            Treatment.COST_OF_REVENUE:   _acct("5000", "Cost of Revenue"),
            Treatment.PREPAID_ASSET:     _acct("1300", "Prepaid Expenses"),
            Treatment.FIXED_ASSET:       _acct("1500", "Fixed Assets"),
            Treatment.INVENTORY:         _acct("1400", "Inventory"),
            Treatment.INTERCOMPANY:      _acct("2100", "Intercompany Payable"),
        },
        "threshold_rules": [
            {"id": f"{_key}_capitalization", "applies_to_categories": ["hardware", "equipment", "laptop", "computer"],
             "capitalization_threshold_minor": 250000, "above_threshold_treatment": Treatment.FIXED_ASSET,
             "below_threshold_treatment": Treatment.OPERATING_EXPENSE},
            {"id": f"{_key}_cogs", "applies_when": {"delivery_context": "customer_delivery"},
             "treatment": Treatment.COST_OF_REVENUE},
        ],
    }

KNOWN_INDUSTRIES = list(INDUSTRY_TEMPLATES.keys())

# ── Category inference ────────────────────────────────────────────────────────────────────
_CATEGORY_PATTERNS = [
    (["data", "market_data"],       [r"\bdata\b", r"\bfeed\b", r"\bmarket.?data\b", r"\bdataset\b"]),
    (["api"],                       [r"\bapi\b"]),
    (["subscription", "saas"],      [r"\bsubscription\b", r"\bsaas\b"]),
    (["license"],                   [r"\blicen[sc]e\b"]),
    (["laptop", "hardware", "equipment"], [r"\blaptop\b", r"\bnotebook\b", r"\bmacbook\b"]),
    (["computer", "hardware", "equipment"], [r"\bcomputer\b", r"\bdesktop\b", r"\bworkstation\b"]),
    (["server", "hardware", "equipment"], [r"\bserver\b"]),
    (["hardware", "equipment"],     [r"\bhardware\b", r"\bequipment\b"]),
]

def infer_categories(text: str = "") -> list[str]:
    found: set[str] = set()
    for tags, patterns in _CATEGORY_PATTERNS:
        if any(re.search(p, text, re.I) for p in patterns):
            found.update(tags)
    return list(found)


def _make_exception(record_id, digest, exception_type, message, details=None, requires_action=True, export_id=None):
    return {"record_id": record_id, "spr_payload_sha256": digest, "exception_type": exception_type,
            "message": message, "details": details, "requires_action": requires_action, "export_id": export_id}


def classify(record: dict, context: dict = None, company_profile: dict = None) -> dict:
    """classify(record, context, company_profile) → { result, exceptions }

    record: SPR record payload dict
    context: { delivery_context, for_resale, override_categories, export_id }
    company_profile: { industry, reporting_framework, capitalization_threshold_minor, jurisdiction }
    """
    context = context or {}
    company_profile = company_profile or {}
    exceptions = []
    record_id = record.get("record_id", "unknown")
    digest = record.get("_spr_payload_sha256")
    export_id = context.get("export_id")

    # Layer 1: validate company profile
    industry = company_profile.get("industry")
    if not industry:
        exceptions.append(_make_exception(record_id, digest, "missing_context", "company_profile.industry is required", export_id=export_id))
        return {"result": None, "exceptions": exceptions}
    if industry not in INDUSTRY_TEMPLATES:
        exceptions.append(_make_exception(record_id, digest, "missing_context", f"Unknown industry: {industry}", export_id=export_id))
        return {"result": None, "exceptions": exceptions}

    template = INDUSTRY_TEMPLATES[industry]
    framework = company_profile.get("reporting_framework", "US_GAAP")
    cap_threshold_override = company_profile.get("capitalization_threshold_minor")

    # Layer 2: item taxonomy
    purpose_text = " ".join(filter(None, [record.get("purpose"), record.get("memo"), record.get("counterparty"), context.get("description")]))
    categories = context.get("override_categories") or infer_categories(purpose_text)

    # Layer 3: delivery context
    delivery_context = context.get("delivery_context")

    # Layer 4: rule matching
    selected_treatment = None
    applied_rule_id = None

    for rule in template.get("threshold_rules", []):
        cat_match = (not rule.get("applies_to_categories") or
                     any(c in categories for c in rule["applies_to_categories"]))
        ctx_match = True
        applies_when = rule.get("applies_when", {})
        if applies_when.get("delivery_context") and applies_when["delivery_context"] != delivery_context:
            ctx_match = False
        if "for_resale" in applies_when and applies_when["for_resale"] != bool(context.get("for_resale")):
            ctx_match = False

        if not cat_match or not ctx_match:
            continue

        if "capitalization_threshold_minor" in rule:
            threshold = cap_threshold_override if cap_threshold_override is not None else rule["capitalization_threshold_minor"]
            amt = abs(record.get("amount_minor", 0))
            selected_treatment = rule["above_threshold_treatment"] if amt >= threshold else rule["below_threshold_treatment"]
            applied_rule_id = rule["id"]
            break

        if "treatment" in rule:
            selected_treatment = rule["treatment"]
            applied_rule_id = rule["id"]
            break

    if not selected_treatment:
        selected_treatment = template["default_treatment"]
        applied_rule_id = f"{template['name']}.default"

    # Layer 5: account mapping
    account_info = template["accounts"].get(selected_treatment)
    if not account_info:
        exceptions.append(_make_exception(record_id, digest, "missing_gl_mapping",
                                          f"No account for treatment {selected_treatment} in template {industry}",
                                          {"treatment": selected_treatment, "industry": industry}, export_id=export_id))
        return {"result": None, "exceptions": exceptions}

    # Advisory: warn about missing delivery context for data/API
    if not delivery_context and any(c in categories for c in ["data", "api", "market_data"]):
        exceptions.append(_make_exception(record_id, digest, "missing_context",
                                          "delivery_context required for accurate data/API classification. Using default.",
                                          {"categories": categories}, requires_action=False, export_id=export_id))

    result = {
        "schema": CLASSIFY_SCHEMA, "record_id": record_id,
        "treatment": selected_treatment,
        "account_code": account_info["code"], "account_name": account_info["name"],
        "gaap_ref": account_info.get("gaap_ref"), "ifrs_ref": account_info.get("ifrs_ref"),
        "framework": framework, "industry": industry,
        "template_version": template["version"], "rule_id": applied_rule_id,
        "classify_version": CLASSIFY_VERSION,
        "categories": categories, "delivery_context": delivery_context,
        "for_resale": bool(context.get("for_resale")),
        "taxonomy_note": "GAAP/IFRS references are illustrative; not validated against authoritative taxonomy.",
    }
    return {"result": result, "exceptions": exceptions}
