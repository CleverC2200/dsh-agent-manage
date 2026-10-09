#!/usr/bin/env python3
"""Compute V2 section 5.5 baselines from explicitly mapped, supplied snapshots.

Pure arithmetic only: no network, credentials, candidate ranking or business writes.
"""
import argparse
from datetime import datetime
import json
import math
from pathlib import Path
import re
import sys


class InputError(ValueError):
    """An input cannot support the requested calculation."""


def text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"{field}: non-empty string required")
    return value


def number(value, field, minimum=0):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{field}: finite number required; missing is not zero")
    try:
        result = float(value)
    except (OverflowError, ValueError):
        raise InputError(f"{field}: finite number required") from None
    if not math.isfinite(result) or result < minimum:
        raise InputError(f"{field}: finite number >= {minimum} required")
    return result


def month(value, field):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise InputError(f"{field}: YYYY-MM required")
    try:
        date = datetime.strptime(value, "%Y-%m")
    except ValueError:
        raise InputError(f"{field}: invalid month") from None
    return date.year * 12 + date.month - 1


def validate_envelope(data):
    if not isinstance(data, dict) or type(data.get("schema_version")) is not int or data["schema_version"] != 1:
        raise InputError("schema_version: integer 1 required")
    if data.get("data_mode") not in ("provided", "mock", "live"):
        raise InputError("data_mode: provided/mock/live required (caller declaration, not verification)")
    for key in ("period_mapping_confirmation", "candidate_policy_confirmation"):
        text(data.get(key), key)
    base = month(data.get("base_month"), "base_month")
    target = month(data.get("target_month"), "target_month")
    if target != base + 1:
        raise InputError("target_month must immediately follow base_month")
    if month(data.get("prior_base_month"), "prior_base_month") != base - 12:
        raise InputError("prior_base_month must be the base month one year earlier")
    if month(data.get("prior_target_month"), "prior_target_month") != target - 12:
        raise InputError("prior_target_month must be the target month one year earlier")
    try:
        snapshot = datetime.fromisoformat(text(data.get("snapshot_at"), "snapshot_at").replace("Z", "+00:00"))
    except ValueError:
        raise InputError("snapshot_at: ISO timestamp with timezone required") from None
    if snapshot.tzinfo is None or snapshot.strftime("%Y-%m") != data["base_month"]:
        raise InputError("snapshot_at must have timezone and fall in base_month")
    records = data.get("records")
    if not isinstance(records, list) or not records:
        raise InputError("records: non-empty array required")
    keys = set()
    for row in records:
        if not isinstance(row, dict):
            raise InputError("each record must be an object")
        # A customer/SKU cannot appear twice even under a different unit.
        key = (text(row.get("customer_id"), "customer_id"), text(row.get("sku_id"), "sku_id"))
        text(row.get("unit"), "unit")
        text(row.get("source_ref"), "source_ref")
        if key in keys:
            raise InputError(f"duplicate customer/SKU: {key}")
        keys.add(key)


def calculate_row(row):
    result = {k: row[k] for k in ("customer_id", "sku_id", "unit", "source_ref")}
    result.update(status="blocked", forecast1=None, forecast2=None, recommended_baseline=None,
                  final_forecast=None, amount=None, issues=[], basis="ontology-v2-section-5.5-draft")
    try:
        eligible = row.get("eligible")
        if eligible is False:
            result.update(status="excluded", issues=[text(row.get("exclusion_reason"), "exclusion_reason")])
            return result
        if eligible is not True:
            raise InputError("eligible: candidate eligibility unresolved")
        if row.get("product_kind") not in ("regular", "new", "short_shelf"):
            raise InputError("product_kind: regular/new/short_shelf required")
        if row["product_kind"] != "regular":
            raise InputError("new/short_shelf products require a separate evidenced method")
        if type(row.get("seasonal")) is not bool:
            raise InputError("seasonal: explicit boolean required")
        quality = row.get("quality_issues")
        if not isinstance(quality, list) or any(not isinstance(x, str) or not x.strip() for x in quality):
            raise InputError("quality_issues: explicit array of non-empty issue strings required")
        plan = number(row.get("base_plan_qty"), "base_plan_qty")
        actual = number(row.get("base_actual_to_cutoff_qty"), "base_actual_to_cutoff_qty")
        h0 = number(row.get("prior_base_actual_qty"), "prior_base_actual_qty")
        h1 = number(row.get("prior_target_actual_qty"), "prior_target_actual_qty")
        if h0 == 0:
            raise InputError("prior_base_actual_qty is zero; ratio method unavailable")
        weights = row.get("weights", {"yoy": 0.5, "mom": 0.5})
        if not isinstance(weights, dict) or set(weights) != {"yoy", "mom"}:
            raise InputError("weights: exactly yoy and mom required")
        wy, wm = number(weights["yoy"], "weights.yoy"), number(weights["mom"], "weights.mom")
        if not math.isclose(wy + wm, 1.0, rel_tol=0, abs_tol=1e-9):
            raise InputError("weights must sum to 1")
        estimate = max(plan, actual)
        yoy, mom = estimate / h0 - 1, h1 / h0 - 1
        f1 = h1 * (1 + yoy) * wy + estimate * (1 + mom) * wm
        values = [estimate, yoy, mom, f1]
        f2 = None
        issues = list(quality)
        gy, gm = row.get("target_yoy_growth"), row.get("target_mom_growth")
        # Validate each provided growth even if its partner is missing.
        if gy is not None:
            gy = number(gy, "target_yoy_growth", -1)
        if gm is not None:
            gm = number(gm, "target_mom_growth", -1)
        if gy is None or gm is None:
            issues.append("growth plan missing: forecast2 unavailable; no automatic forecast1 substitution")
        else:
            f2 = h1 * (1 + gy) * wy + estimate * (1 + gm) * wm
            values.append(f2)
        if not all(math.isfinite(v) for v in values):
            raise InputError("calculation overflow; no numerical forecast emitted")
        if row["seasonal"]:
            issues.append("seasonal adjustment unimplemented/unconfirmed; baseline only")
        result.update(status="partial" if issues else "calculated", forecast1=f1, forecast2=f2,
                      recommended_baseline=f2, final_forecast=f2 if not issues else None,
                      issues=issues, weights={"yoy": wy, "mom": wm},
                      weight_basis="provided" if "weights" in row else "V2 section 5.5 default 50/50",
                      intermediate={"base_estimate_qty": estimate, "base_yoy_growth": yoy,
                                    "prior_target_mom_growth": mom},
                      inputs={k: row.get(k) for k in ("base_plan_qty", "base_actual_to_cutoff_qty",
                              "prior_base_actual_qty", "prior_target_actual_qty",
                              "target_yoy_growth", "target_mom_growth")})
    except (InputError, OverflowError) as error:
        result["issues"] = [str(error)]
    return result


def forecast(data):
    validate_envelope(data)
    rows = [calculate_row(row) for row in data["records"]]
    counts = {status: sum(row["status"] == status for row in rows)
              for status in ("calculated", "partial", "blocked", "excluded")}
    return {"schema_version": 1, "artifact_status": "draft", "business_review": "pending",
            "data_mode": data["data_mode"], "source_verified_by_calculator": False,
            **{key: data[key] for key in ("snapshot_at", "base_month", "target_month",
               "prior_base_month", "prior_target_month", "period_mapping_confirmation",
               "candidate_policy_confirmation")},
            "coverage": {"input_rows": len(rows), **counts, "full_candidate_pool_coverage": "unknown"},
            "rows": rows, "external_writes": False}


def reject_constant(value):
    raise InputError(f"invalid JSON numeric constant: {value}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    args = parser.parse_args()
    try:
        result = forecast(json.loads(args.input.read_text(encoding="utf-8"), parse_constant=reject_constant))
    except (ValueError, OSError) as error:
        print(json.dumps({"status": "blocked", "error": str(error)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
