"""Tests for the SPR classification engine (Phase 6, Python)."""
import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from spr.classify import classify, infer_categories, Treatment, KNOWN_INDUSTRIES


def make_record(**kwargs):
    base = {
        "record_id": "LR-STRIPE-TEST0000001-v1",
        "version": 1, "supersedes": None,
        "schema": "luca.record/0.7",
        "entity": "Example Co", "rail": "stripe",
        "direction": "outflow", "state": "cleared",
        "source": {"id": "pi_test", "payload_sha256": "0" * 64},
        "amount_minor": 1500, "currency": "USD",
        "occurred_at": "2026-10-28T12:00:00Z",
        "settled_on": "2026-10-28",
        "counterparty": "Data Provider Ltd",
        "reported_by": "agent",
        "_spr_payload_sha256": "a" * 64,
    }
    base.update(kwargs)
    return base


INTERNAL_PROFILE = {"industry": "research", "reporting_framework": "US_GAAP"}
CUSTOMER_PROFILE = {"industry": "software_saas", "reporting_framework": "US_GAAP"}


class TestInferCategories(unittest.TestCase):
    def test_laptop_detection(self):
        cats = infer_categories("Purchased a MacBook Pro laptop for engineering")
        self.assertIn("laptop", cats)
        self.assertIn("hardware", cats)
        self.assertIn("equipment", cats)

    def test_data_api_detection(self):
        cats = infer_categories("market data feed via API call for pricing model")
        self.assertIn("data", cats)
        self.assertIn("api", cats)

    def test_empty_text(self):
        cats = infer_categories("")
        self.assertEqual(cats, [])


class TestClassifyTreatment(unittest.TestCase):
    def test_data_internal_use_operating_expense(self):
        r = make_record(amount_minor=1500, purpose="market data for the pricing model")
        out = classify(r, {"delivery_context": "internal_use"}, INTERNAL_PROFILE)
        self.assertIsNotNone(out["result"])
        self.assertEqual(out["result"]["treatment"], Treatment.OPERATING_EXPENSE)

    def test_data_customer_delivery_cost_of_revenue(self):
        r = make_record(amount_minor=1500, purpose="market data for the pricing model")
        out = classify(r, {"delivery_context": "customer_delivery"}, CUSTOMER_PROFILE)
        self.assertIsNotNone(out["result"])
        self.assertEqual(out["result"]["treatment"], Treatment.COST_OF_REVENUE)

    def test_laptop_3200_above_threshold_fixed_asset(self):
        r = make_record(amount_minor=320000, purpose="laptop for the engineering team")
        out = classify(r, {"delivery_context": "internal_use"}, INTERNAL_PROFILE)
        self.assertIsNotNone(out["result"], f"Expected result, got exceptions: {out['exceptions']}")
        self.assertEqual(out["result"]["treatment"], Treatment.FIXED_ASSET)

    def test_laptop_800_below_threshold_operating_expense(self):
        r = make_record(amount_minor=80000, purpose="laptop for the engineering team")
        out = classify(r, {"delivery_context": "internal_use"}, INTERNAL_PROFILE)
        self.assertIsNotNone(out["result"])
        self.assertEqual(out["result"]["treatment"], Treatment.OPERATING_EXPENSE)

    def test_custom_threshold_overrides_template(self):
        r = make_record(amount_minor=80000, purpose="laptop for the engineering team")
        profile = {**INTERNAL_PROFILE, "capitalization_threshold_minor": 50000}
        out = classify(r, {"delivery_context": "internal_use"}, profile)
        self.assertIsNotNone(out["result"])
        self.assertEqual(out["result"]["treatment"], Treatment.FIXED_ASSET)

    def test_missing_industry_returns_exception(self):
        r = make_record()
        out = classify(r, {}, {})
        self.assertIsNone(out["result"])
        self.assertTrue(any(e["exception_type"] == "missing_context" for e in out["exceptions"]))

    def test_unknown_industry_returns_exception(self):
        r = make_record()
        out = classify(r, {}, {"industry": "nonexistent"})
        self.assertIsNone(out["result"])
        self.assertTrue(any("Unknown industry" in e["message"] for e in out["exceptions"]))

    def test_data_no_delivery_context_advisory_exception(self):
        r = make_record(purpose="api data feed")
        out = classify(r, {}, INTERNAL_PROFILE)
        # Advisory exception should be present but result is not None
        self.assertIsNotNone(out["result"])
        advisory = [e for e in out["exceptions"] if e.get("requires_action") is False]
        self.assertTrue(len(advisory) > 0, "Expected advisory exception for missing delivery_context")

    def test_result_has_traceability_fields(self):
        r = make_record(amount_minor=1500)
        out = classify(r, {"delivery_context": "internal_use"}, INTERNAL_PROFILE)
        result = out["result"]
        self.assertIsNotNone(result)
        self.assertIn("rule_id", result)
        self.assertIn("classify_version", result)
        self.assertIn("template_version", result)
        self.assertIn("industry", result)

    def test_all_known_industries_have_operating_expense_account(self):
        from spr.classify import INDUSTRY_TEMPLATES
        for industry in KNOWN_INDUSTRIES:
            tpl = INDUSTRY_TEMPLATES[industry]
            self.assertIn(Treatment.OPERATING_EXPENSE, tpl["accounts"],
                          f"Industry {industry} missing OPERATING_EXPENSE account")

    def test_result_does_not_claim_settlement(self):
        r = make_record()
        out = classify(r, {"delivery_context": "internal_use"}, INTERNAL_PROFILE)
        if out["result"]:
            self.assertNotIn("settled", str(out["result"]).lower().replace("settled_on", ""))


if __name__ == "__main__":
    unittest.main()
