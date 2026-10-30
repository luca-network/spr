# Tutorial 13: Python SDK — Classify and Export

**Audience:** Python Developers  
**Time:** 20 minutes  
**Prev:** [Settlement Confidence and What It Means](12-settlement-confidence.md)  
**Next:** [Security Constraints and Key Management](14-security-constraints-and-key-management.md)

---

## Prerequisites

```bash
cd python
pip install -e .
python3 -m unittest discover -s tests  # verify baseline
```

## Classify a record in Python

```python
from spr.classify import classify

sealed_record = {
    "id": "spr_0191abc...",
    "amount": 1500,
    "currency": "USD",
    "ts": "2026-10-30T12:00:00.000Z",
    "intent": "Claude API call",
    "seal": { ... }
}

context = {
    "delivery_context": "internal_use",
    "for_resale": False,
}

company_profile = {
    "industry": "software_saas",
    "reporting_framework": "GAAP",
    "capitalization_threshold_minor": 250000,
    "jurisdiction": "US",
}

result, exceptions = classify(sealed_record, context, company_profile)

print(result["treatment"])      # OPERATING_EXPENSE
print(result["account_code"])   # 6000
print(result["rule_id"])        # saas.internal_use.below_threshold
```

## Python classification result fields

The Python result is a dict with the same fields as the JavaScript result:

| Field | Type | Description |
|-------|------|-------------|
| `treatment` | str | Accounting treatment constant |
| `account_code` | str | GL account code |
| `account_name` | str | GL account name |
| `gaap_ref` | str or None | Illustrative GAAP reference |
| `ifrs_ref` | str or None | Illustrative IFRS reference |
| `rule_id` | str | Rule that produced this result |
| `classify_version` | str | Python SDK version |
| `taxonomy_note` | str | Disclaimer if illustrative |

## Handling exceptions in Python

```python
result, exceptions = classify(record, {"delivery_context": None}, company_profile)

for exc in exceptions:
    print(exc["severity"], exc["code"], exc["message"])
# advisory MISSING_DELIVERY_CONTEXT delivery_context not provided; defaulting to internal_use
```

## Cross-language compatibility

The Python `classify()` function uses the same five-layer logic and industry templates as
the JavaScript `classify()` function. A record classified in Python will produce the same
treatment as when classified in JavaScript with the same inputs.

However, the `classify_version` field reflects the Python SDK version (e.g. `"python-0.1.0"`),
which is useful for tracing which SDK version produced a classification result.

## Running the Python tests

```bash
cd python
python3 -m unittest discover -s tests -v
```

The Python test suite mirrors the JavaScript test suite: same scenarios, same expected treatments,
same exception codes. Both must pass before any release.

## Python-specific notes

- Python `SprBook` is in `python/spr/book.py`
- Classification logic is in `python/spr/classify.py`
- No Python accounting export function yet (planned); use the JavaScript SDK for full exports

---

**Next:** [Security Constraints and Key Management](14-security-constraints-and-key-management.md)
