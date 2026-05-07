#!/usr/bin/env python3
"""
Generate a publication-friendly figure for UniProt-implicated query success by experiment.

Success definition used here:
- successful execution = result set count > 0

Input data:
- docs/data/queries.json (to identify UniProt-implicated canonical query stems)
- docs/data/main.json (to aggregate run-level outcomes)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Set

import matplotlib.pyplot as plt
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[1]
QUERIES_JSON = REPO_ROOT / "docs" / "data" / "queries.json"
MAIN_JSON = REPO_ROOT / "docs" / "data" / "main.json"
OUTPUT_PNG = REPO_ROOT / "iswc_2026_paper" / "figures" / "uniprot_success_by_experiment.png"


@dataclass
class RunStats:
    run_id: str
    run_label: str
    total: int = 0
    success_gt0: int = 0
    zero_results_no_explicit_error: int = 0
    explicit_error: int = 0

    @property
    def success_rate(self) -> float:
        if self.total == 0:
            return 0.0
        return self.success_gt0 / self.total


def load_json(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_stem(raw_name: str | None) -> str | None:
    if not raw_name or not isinstance(raw_name, str):
        return None
    stem = raw_name.strip()
    if stem.endswith(".rq"):
        stem = stem[:-3]
    if stem.endswith("_ns"):
        stem = stem[:-3]
    if stem.endswith("_ws"):
        stem = stem[:-3]
    return stem or None


def contains_uniprot_endpoint(text: str) -> bool:
    return "https://sparql.uniprot.org/sparql/" in text


def summary_implicates_uniprot(summary: Dict) -> bool:
    # Check query text variants.
    for variant in summary.get("variants", []):
        if contains_uniprot_endpoint(str(variant.get("query_text", ""))):
            return True

    # Check SIB context rows.
    for row in summary.get("sib_rows", []):
        for value in row.values():
            if contains_uniprot_endpoint(str(value or "")):
                return True

    # Check parsed SERVICE IRIs from canonical summary.
    for iri in summary.get("parsed_stats", {}).get("service_iris", []):
        if contains_uniprot_endpoint(str(iri or "")):
            return True

    return False


def has_explicit_error(record: Dict) -> bool:
    raw = str(record.get("error_raw") or "").strip().lower()
    category = str(record.get("error_category") or "").strip().lower()

    raw_no_error_values = {
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
    category_no_error_values = {
        "",
        "n/a",
        "none",
        "no results",
        "no comunica results",
    }
    return not (raw in raw_no_error_values and category in category_no_error_values)


def map_experiment_label(run_id: str, run_label: str) -> str:
    # Keep labels aligned with the dashboard naming conventions.
    control_labels = {
        "experiments/old-results/default-service-test-1": "SERVICE-COMUNICA-2025-03-31",
        "experiments/service-control-31-03-25-comunica": "SERVICE-COMUNICA-2025-03-25",
        "experiments/service-control-31-03-25-endpoint": "SERVICE-MANUAL-ENDPOINT-2025-03-25",
        "experiments/service-control-20-4-26": "SERVICE-COMUNICA-2026-04-26",
    }
    if run_id in control_labels:
        return control_labels[run_id]

    label = run_label or run_id
    replacements = [
        ("EX1-NRL", "NOMETA-ASK-NRL"),
        ("EX2-NRL", "NOMETA-COUNT-NRL"),
        ("EX3-NRL", "VOID-TRIPLE-NRL"),
        ("EX4-NRL", "VOID-BLOCK-NRL"),
        ("EX1", "NOMETA-ASK"),
        ("EX2", "NOMETA-COUNT"),
        ("EX3", "VOID-TRIPLE"),
        ("EX4", "VOID-BLOCK"),
    ]
    for src, dst in replacements:
        label = label.replace(src, dst)
    return label


def collect_uniprot_stems(queries_data: Dict) -> Set[str]:
    stems: Set[str] = set()
    for summary in queries_data.get("summaries", []):
        stem = summary.get("query_stem")
        if stem and summary_implicates_uniprot(summary):
            stems.add(stem)
    return stems


def collect_run_stats(main_data: Dict, uniprot_stems: Set[str]) -> List[RunStats]:
    by_run: Dict[str, RunStats] = {}

    for record in main_data.get("records", []):
        if record.get("is_run_summary_row"):
            continue
        stem = normalize_stem(record.get("query_name"))
        if not stem or stem not in uniprot_stems:
            continue

        run_id = str(record.get("run_id"))
        run_label = str(record.get("run_label") or run_id)
        if run_id not in by_run:
            by_run[run_id] = RunStats(run_id=run_id, run_label=run_label)

        stats = by_run[run_id]
        stats.total += 1

        results_count = int(record.get("results_count") or 0)
        explicit_error = has_explicit_error(record)
        if results_count > 0:
            stats.success_gt0 += 1
        elif explicit_error:
            stats.explicit_error += 1
        else:
            stats.zero_results_no_explicit_error += 1

    # Sort by the chronological order already used in main.json runs list.
    run_order = [run["run_id"] for run in main_data.get("runs", [])]
    run_rank = {run_id: idx for idx, run_id in enumerate(run_order)}
    rows = list(by_run.values())
    rows.sort(key=lambda item: (run_rank.get(item.run_id, 10_000), item.run_id))
    return rows


def plot(rows: Iterable[RunStats]) -> None:
    rows = list(rows)
    if not rows:
        raise RuntimeError("No UniProt run rows found; cannot render figure.")

    labels = [map_experiment_label(row.run_id, row.run_label) for row in rows]
    success = np.array([row.success_gt0 for row in rows], dtype=float)
    zero_no_err = np.array([row.zero_results_no_explicit_error for row in rows], dtype=float)
    errors = np.array([row.explicit_error for row in rows], dtype=float)
    totals = np.array([row.total for row in rows], dtype=float)
    rates = np.array([row.success_rate * 100.0 for row in rows], dtype=float)

    # Color-blind friendly palette.
    color_success = "#009E73"
    color_zero = "#56B4E9"
    color_error = "#D55E00"
    color_rate = "#332288"

    fig, ax = plt.subplots(figsize=(15, 6.5), dpi=220)
    x = np.arange(len(labels))

    # Stacked bars show full decomposition per run.
    bar_success = ax.bar(x, success, color=color_success, edgecolor="#1f1f1f", linewidth=0.35, label="Successful (>0 results)")
    ax.bar(x, zero_no_err, bottom=success, color=color_zero, edgecolor="#1f1f1f", linewidth=0.35, label="=0 results, no explicit error")
    ax.bar(x, errors, bottom=success + zero_no_err, color=color_error, edgecolor="#1f1f1f", linewidth=0.35, label="Explicit error")

    # Secondary axis for success rate.
    ax2 = ax.twinx()
    ax2.plot(x, rates, color=color_rate, marker="o", markersize=4, linewidth=1.5, label="Execution success rate (%)")
    ax2.set_ylabel("Execution Success Rate (%)", fontsize=11)
    ax2.set_ylim(0, max(100.0, rates.max() + 10.0))

    # Annotate success numerator/denominator above bars.
    for idx, (s, t, r) in enumerate(zip(success, totals, rates)):
        ax.text(
            idx,
            s + 0.6,
            f"{int(s)}/{int(t)} ({r:.1f}%)",
            ha="center",
            va="bottom",
            fontsize=7.7,
            rotation=90,
            color="#1f1f1f",
        )

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8.7)
    ax.set_ylabel("UniProt-Implicated Query Attempts (count)", fontsize=11)
    ax.set_xlabel("Experiment Run", fontsize=11)
    ax.set_title(
        "UniProt-Implicated Query Outcomes by Experiment\n"
        "Success defined as result set count > 0",
        fontsize=13,
        fontweight="bold",
    )
    ax.grid(axis="y", linestyle="--", alpha=0.25)

    # Combined legend from both axes.
    handles1, labels1 = ax.get_legend_handles_labels()
    handles2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(handles1 + handles2, labels1 + labels2, loc="upper left", frameon=True, fontsize=9)

    fig.tight_layout()
    OUTPUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUTPUT_PNG, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    queries_data = load_json(QUERIES_JSON)
    main_data = load_json(MAIN_JSON)

    uniprot_stems = collect_uniprot_stems(queries_data)
    rows = collect_run_stats(main_data, uniprot_stems)
    plot(rows)

    print(f"[OK] UniProt-implicated canonical query stems: {len(uniprot_stems)}")
    print(f"[OK] Runs with UniProt-attempt data: {len(rows)}")
    print(f"[OK] Wrote figure: {OUTPUT_PNG}")


if __name__ == "__main__":
    main()
