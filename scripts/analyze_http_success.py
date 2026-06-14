#!/usr/bin/env python3
"""
Analyze HTTP-request behavior for NO-SERVICE experiments.

This script computes:
1) Descriptive stats (mean/median) of HTTP requests among successful executions.
2) Association tests between HTTP request count and success, for two success definitions:
   A) success = no explicit error (covers both result_count == 0 and result_count > 0)
   B) success = result_count > 0 (and no explicit error)

Why this design:
- We use point-biserial correlation (Pearson with binary success) as a standard
  correlation measure between a continuous and binary variable.
- We report permutation-test p-values to avoid parametric assumptions and to keep
  the script dependency-light (no SciPy/statsmodels required).
- We add Mann-Whitney U as a robust nonparametric check that successful executions
  tend to have higher HTTP counts than unsuccessful ones.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple


# Error semantics align with the dashboard/export scripts in this repo.
CATEGORY_NO_ERROR_VALUES = {
    "",
    "n/a",
    "none",
    "no results",
    "no comunica results",
}
RAW_NO_ERROR_VALUES = {
    "",
    "null",
    "-",
    "n/a",
    "none",
    "no results",
    "no comunica results",
    "- (no results)",
    "general: no results",
}


@dataclass
class Execution:
    run_id: str
    query_name: str
    http_requests: float
    has_explicit_error: bool
    results_count: Optional[float]


@dataclass
class AnalysisResult:
    name: str
    n_total: int
    n_success: int
    n_failure: int
    success_http_mean: float
    success_http_median: float
    failure_http_mean: float
    failure_http_median: float
    point_biserial_r: float
    point_biserial_perm_p_two_sided: float
    point_biserial_perm_p_positive: float
    mean_success_minus_failure: float
    mean_diff_perm_p_two_sided: float
    mean_diff_perm_p_positive: float
    mann_whitney_u: float
    mann_whitney_z: float
    mann_whitney_p_two_sided: float
    mann_whitney_p_positive: float


def _median(values: Sequence[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return float("nan")
    mid = n // 2
    if n % 2 == 1:
        return float(ordered[mid])
    return float((ordered[mid - 1] + ordered[mid]) / 2.0)


def _mean(values: Sequence[float]) -> float:
    if not values:
        return float("nan")
    return float(sum(values) / len(values))


def _to_numeric(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric):
        return None
    return numeric


def has_explicit_error(record: dict) -> bool:
    raw = record.get("error_raw")
    category = record.get("error_category")
    raw_text = "" if raw is None else str(raw).strip().lower()
    category_text = "" if category is None else str(category).strip().lower()
    return not (raw_text in RAW_NO_ERROR_VALUES and category_text in CATEGORY_NO_ERROR_VALUES)


def load_no_service_executions(main_json_path: Path) -> Tuple[List[Execution], Dict[str, int]]:
    payload = json.loads(main_json_path.read_text(encoding="utf-8"))
    runs = payload.get("runs", [])
    records = payload.get("records", [])

    # Restrict to experiments flagged as NO-SERVICE at run level.
    no_service_run_ids = {
        str(run["run_id"])
        for run in runs
        if str(run.get("service_description_mode") or "").strip().lower() == "no-service"
    }

    diagnostics = {
        "records_seen": 0,
        "records_kept": 0,
        "excluded_summary_rows": 0,
        "excluded_non_no_service_runs": 0,
        "excluded_missing_http": 0,
        "excluded_negative_http": 0,
    }

    executions: List[Execution] = []
    for rec in records:
        diagnostics["records_seen"] += 1

        if rec.get("is_run_summary_row"):
            diagnostics["excluded_summary_rows"] += 1
            continue

        run_id = str(rec.get("run_id") or "")
        if run_id not in no_service_run_ids:
            diagnostics["excluded_non_no_service_runs"] += 1
            continue

        http_count = _to_numeric(rec.get("http_requests"))
        if http_count is None:
            diagnostics["excluded_missing_http"] += 1
            continue
        if http_count < 0:
            # Defensive: HTTP request counts should be non-negative.
            diagnostics["excluded_negative_http"] += 1
            continue

        results_count = _to_numeric(rec.get("results_count"))
        executions.append(
            Execution(
                run_id=run_id,
                query_name=str(rec.get("query_name") or ""),
                http_requests=http_count,
                has_explicit_error=has_explicit_error(rec),
                results_count=results_count,
            )
        )
        diagnostics["records_kept"] += 1

    return executions, diagnostics


def success_def_no_explicit_error(execution: Execution) -> bool:
    # Definition A: successful if no explicit error, regardless of result cardinality.
    return not execution.has_explicit_error


def success_def_positive_results(execution: Execution) -> bool:
    # Definition B: successful only when a non-error execution produced >0 results.
    return (not execution.has_explicit_error) and (execution.results_count is not None) and (execution.results_count > 0.0)


def point_biserial_r(xs: Sequence[float], ys_binary: Sequence[int]) -> float:
    n = len(xs)
    if n == 0 or n != len(ys_binary):
        return float("nan")
    mean_x = _mean(xs)
    mean_y = _mean(ys_binary)
    sxx = sum((x - mean_x) ** 2 for x in xs)
    syy = sum((y - mean_y) ** 2 for y in ys_binary)
    if sxx <= 0 or syy <= 0:
        return float("nan")
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys_binary))
    return float(sxy / math.sqrt(sxx * syy))


def permutation_p_value(
    xs: Sequence[float],
    ys_binary: Sequence[int],
    stat_fn: Callable[[Sequence[float], Sequence[int]], float],
    n_permutations: int,
    rng: random.Random,
) -> Tuple[float, float, float]:
    observed = stat_fn(xs, ys_binary)
    if math.isnan(observed):
        return observed, float("nan"), float("nan")

    perm = list(ys_binary)
    ge_two_sided = 0
    ge_positive = 0
    obs_abs = abs(observed)
    for _ in range(n_permutations):
        rng.shuffle(perm)
        s = stat_fn(xs, perm)
        if abs(s) >= obs_abs:
            ge_two_sided += 1
        if s >= observed:
            ge_positive += 1

    # Add-one smoothing for unbiased Monte Carlo p-value.
    p_two = (ge_two_sided + 1) / (n_permutations + 1)
    p_pos = (ge_positive + 1) / (n_permutations + 1)
    return observed, p_two, p_pos


def stat_mean_success_minus_failure(xs: Sequence[float], ys_binary: Sequence[int]) -> float:
    success = [x for x, y in zip(xs, ys_binary) if y == 1]
    failure = [x for x, y in zip(xs, ys_binary) if y == 0]
    if not success or not failure:
        return float("nan")
    return _mean(success) - _mean(failure)


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def mann_whitney_u(success_values: Sequence[float], failure_values: Sequence[float]) -> Tuple[float, float, float, float]:
    """
    Return (U_success, z, p_two_sided, p_one_sided_success_greater).
    Uses tie-corrected normal approximation.
    """
    n1 = len(success_values)
    n0 = len(failure_values)
    if n1 == 0 or n0 == 0:
        return float("nan"), float("nan"), float("nan"), float("nan")

    pooled = [(v, 1) for v in success_values] + [(v, 0) for v in failure_values]
    pooled.sort(key=lambda t: t[0])

    # Average ranks for ties.
    ranks = [0.0] * len(pooled)
    i = 0
    tie_sizes: List[int] = []
    while i < len(pooled):
        j = i + 1
        while j < len(pooled) and pooled[j][0] == pooled[i][0]:
            j += 1
        avg_rank = (i + 1 + j) / 2.0
        for k in range(i, j):
            ranks[k] = avg_rank
        tie_sizes.append(j - i)
        i = j

    rank_sum_success = sum(rank for rank, (_, group) in zip(ranks, pooled) if group == 1)
    u_success = rank_sum_success - n1 * (n1 + 1) / 2.0

    mean_u = n1 * n0 / 2.0
    tie_term = sum(t**3 - t for t in tie_sizes)
    n = n1 + n0
    var_u = (n1 * n0 / 12.0) * ((n + 1) - tie_term / (n * (n - 1))) if n > 1 else 0.0
    if var_u <= 0:
        return u_success, float("nan"), float("nan"), float("nan")

    z = (u_success - mean_u) / math.sqrt(var_u)
    p_two = 2.0 * (1.0 - _normal_cdf(abs(z)))
    p_pos = 1.0 - _normal_cdf(z)  # H1: success has larger values -> large positive z
    return u_success, z, p_two, p_pos


def run_analysis(
    executions: Sequence[Execution],
    name: str,
    success_predicate: Callable[[Execution], bool],
    n_permutations: int,
    seed: int,
) -> AnalysisResult:
    xs = [e.http_requests for e in executions]
    ys = [1 if success_predicate(e) else 0 for e in executions]

    success_values = [x for x, y in zip(xs, ys) if y == 1]
    failure_values = [x for x, y in zip(xs, ys) if y == 0]

    rng_corr = random.Random(seed)
    corr, corr_p_two, corr_p_pos = permutation_p_value(
        xs,
        ys,
        stat_fn=point_biserial_r,
        n_permutations=n_permutations,
        rng=rng_corr,
    )

    rng_diff = random.Random(seed + 1)
    mean_diff, mean_diff_p_two, mean_diff_p_pos = permutation_p_value(
        xs,
        ys,
        stat_fn=stat_mean_success_minus_failure,
        n_permutations=n_permutations,
        rng=rng_diff,
    )

    u, z, p_two, p_pos = mann_whitney_u(success_values, failure_values)

    return AnalysisResult(
        name=name,
        n_total=len(xs),
        n_success=len(success_values),
        n_failure=len(failure_values),
        success_http_mean=_mean(success_values),
        success_http_median=_median(success_values),
        failure_http_mean=_mean(failure_values),
        failure_http_median=_median(failure_values),
        point_biserial_r=corr,
        point_biserial_perm_p_two_sided=corr_p_two,
        point_biserial_perm_p_positive=corr_p_pos,
        mean_success_minus_failure=mean_diff,
        mean_diff_perm_p_two_sided=mean_diff_p_two,
        mean_diff_perm_p_positive=mean_diff_p_pos,
        mann_whitney_u=u,
        mann_whitney_z=z,
        mann_whitney_p_two_sided=p_two,
        mann_whitney_p_positive=p_pos,
    )


def format_result(result: AnalysisResult) -> str:
    return "\n".join(
        [
            f"=== {result.name} ===",
            f"N (query executions): {result.n_total}",
            f"Successes: {result.n_success} | Failures: {result.n_failure}",
            (
                "Successful HTTP requests: "
                f"mean={result.success_http_mean:.3f}, median={result.success_http_median:.3f}"
            ),
            (
                "Failure HTTP requests: "
                f"mean={result.failure_http_mean:.3f}, median={result.failure_http_median:.3f}"
            ),
            (
                "Point-biserial correlation (HTTP vs success): "
                f"r={result.point_biserial_r:.4f}, "
                f"perm p(two-sided)={result.point_biserial_perm_p_two_sided:.6f}, "
                f"perm p(positive)={result.point_biserial_perm_p_positive:.6f}"
            ),
            (
                "Mean difference (success - failure, HTTP requests): "
                f"{result.mean_success_minus_failure:.4f}, "
                f"perm p(two-sided)={result.mean_diff_perm_p_two_sided:.6f}, "
                f"perm p(positive)={result.mean_diff_perm_p_positive:.6f}"
            ),
            (
                "Mann-Whitney U (success > failure): "
                f"U={result.mann_whitney_u:.2f}, z={result.mann_whitney_z:.4f}, "
                f"p(two-sided)={result.mann_whitney_p_two_sided:.6f}, "
                f"p(positive)={result.mann_whitney_p_positive:.6f}"
            ),
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze HTTP requests vs success in NO-SERVICE experiments.")
    parser.add_argument(
        "--main-json",
        default="docs/data/main.json",
        help="Path to aggregate main dashboard dataset JSON.",
    )
    parser.add_argument(
        "--permutations",
        type=int,
        default=20000,
        help="Number of permutations for Monte Carlo p-values.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for permutation tests.",
    )
    parser.add_argument(
        "--out-json",
        default="",
        help="Optional output path for machine-readable JSON results.",
    )
    args = parser.parse_args()

    main_json_path = Path(args.main_json)
    executions, diagnostics = load_no_service_executions(main_json_path)
    if not executions:
        raise SystemExit("No eligible NO-SERVICE executions with valid HTTP request counts were found.")

    result_a = run_analysis(
        executions=executions,
        name="Definition A: success = no explicit error (includes both =0 and >0 results)",
        success_predicate=success_def_no_explicit_error,
        n_permutations=args.permutations,
        seed=args.seed,
    )
    result_b = run_analysis(
        executions=executions,
        name="Definition B: success = result_count > 0 (non-error only)",
        success_predicate=success_def_positive_results,
        n_permutations=args.permutations,
        seed=args.seed + 1000,
    )

    print("Diagnostics:")
    for key, value in diagnostics.items():
        print(f"- {key}: {value}")
    print()
    print(format_result(result_a))
    print()
    print(format_result(result_b))

    if args.out_json:
        output = {
            "diagnostics": diagnostics,
            "definition_a": result_a.__dict__,
            "definition_b": result_b.__dict__,
            "parameters": {
                "main_json": str(main_json_path),
                "permutations": args.permutations,
                "seed": args.seed,
            },
        }
        out_path = Path(args.out_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
        print(f"\nWrote JSON results: {out_path}")


if __name__ == "__main__":
    main()
