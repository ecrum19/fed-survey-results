#!/usr/bin/env python3
"""
Export publication-ready figures from dashboard data.

Outputs:
  1) Query outcome heatmap by experiment run
  2) Queries with result sets >0 by run
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np
import matplotlib.patheffects as pe
from matplotlib.colors import ListedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import Patch


os.environ["MPLBACKEND"] = "Agg"
os.environ["MPLCONFIGDIR"] = "/tmp/mplconfig"
os.environ["XDG_CACHE_HOME"] = "/tmp"
Path(os.environ["MPLCONFIGDIR"]).mkdir(parents=True, exist_ok=True)

import matplotlib

matplotlib.use("Agg", force=True)


EXPERIMENT_LABEL_REPLACEMENTS: List[Tuple[str, str]] = [
    ("EX1-NRL", "NOINDEX-ASK-NRL"),
    ("EX2-NRL", "NOINDEX-COUNT-NRL"),
    ("EX3-NRL", "VOID-TRIPLE-NRL"),
    ("EX4-NRL", "VOID-BLOCK-NRL"),
    ("EX1", "NOINDEX-ASK"),
    ("EX2", "NOINDEX-COUNT"),
    ("EX3", "VOID-TRIPLE"),
    ("EX4", "VOID-BLOCK"),
]

CONTROL_RUN_DISPLAY_CONFIG: Dict[str, str] = {
    "experiments/old-results/default-service-test-1": "SERVICE-CONTROL-COMUNICA-2025-03-31",
    "experiments/service-control-31-03-25-comunica": "SERVICE-CONTROL-COMUNICA-2025-03-25",
    "experiments/service-control-31-03-25-endpoint": "SERVICE-CONTROL-MANUAL-ENDPOINT-2025-03-25",
    "experiments/service-control-20-4-26": "SERVICE-CONTROL-COMUNICA-2026-04-26",
}

LEGACY_QUERY_STEM_MAP: Dict[str, str] = {
    "Q00000004": "117_biosodafrontend_glioblastoma_orthologs_rat",
    "Q00000005": "118_biosodafrontend_rat_brain_human_cancer",
    "Q00000007": "027-biosodafrontend",
    "Q00000008": "028-biosodafrontend",
    "Q00000010": "116_biosodafrontend_rabit_mouse_orthologs",
    "Q00000011": "15-rat-TP53-biosodafrontend",
}

SERVICE_MODE_COLORS = {
    "with-service": "#0072B2",  # blue
    "no-service": "#E69F00",    # orange
}


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def normalize_query_stem(raw_name: Optional[str]) -> Optional[str]:
    if not raw_name:
        return None
    stem = str(raw_name).strip()
    if not stem:
        return None
    stem = re.sub(r"\.rq$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"_ns$", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"_ws$", "", stem, flags=re.IGNORECASE)
    stem = LEGACY_QUERY_STEM_MAP.get(stem, stem)
    return stem or None


def map_experiment_family_label(text: str) -> str:
    mapped = str(text)
    for source, target in EXPERIMENT_LABEL_REPLACEMENTS:
        mapped = re.sub(rf"\b{re.escape(source)}\b", target, mapped)
    return mapped


def get_run_display_label(run_id: str, run_label: str) -> str:
    if run_id in CONTROL_RUN_DISPLAY_CONFIG:
        return CONTROL_RUN_DISPLAY_CONFIG[run_id]
    return map_experiment_family_label(run_label or "")


def get_run_timestamp(run: dict, records: List[dict]) -> float:
    dt = parse_iso(run.get("run_start"))
    if dt:
        return dt.timestamp()
    starts = [parse_iso(r.get("start")) for r in records if r.get("run_id") == run.get("run_id")]
    starts = [s for s in starts if s]
    if starts:
        return min(starts).timestamp()
    # Fallback keeps deterministic ordering.
    return 0.0


@dataclass
class QueryRunSummary:
    attempts: int = 0
    has_error: bool = False
    has_numeric_result: bool = False
    max_results: Optional[float] = None
    # For variability markers, compare only non-error numeric results.
    has_non_error_numeric_result: bool = False
    max_non_error_results: Optional[float] = None


def has_explicit_error(record: dict) -> bool:
    raw = record.get("error_raw")
    category = record.get("error_category")
    raw_text = "" if raw is None else str(raw).strip().lower()
    category_text = "" if category is None else str(category).strip().lower()

    category_no_error_values = {
        "",
        "n/a",
        "none",
        "no results",
        "no comunica results",
    }
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
    raw_looks_non_error = raw_text in raw_no_error_values
    category_looks_non_error = category_text in category_no_error_values
    return not (raw_looks_non_error and category_looks_non_error)


def build_query_run_summaries(records: Iterable[dict]) -> Dict[Tuple[str, str], QueryRunSummary]:
    by_key: Dict[Tuple[str, str], QueryRunSummary] = {}
    for record in records:
        if record.get("is_run_summary_row"):
            continue
        stem = normalize_query_stem(record.get("query_name"))
        run_id = record.get("run_id")
        if not stem or not run_id:
            continue
        key = (stem, run_id)
        summary = by_key.setdefault(key, QueryRunSummary())
        summary.attempts += 1
        record_has_error = has_explicit_error(record)
        if record_has_error:
            summary.has_error = True
        result = record.get("results_count")
        if result is not None:
            try:
                value = float(result)
            except (TypeError, ValueError):
                value = None
            if value is not None and not np.isnan(value):
                summary.has_numeric_result = True
                if summary.max_results is None or value > summary.max_results:
                    summary.max_results = value
                if not record_has_error:
                    summary.has_non_error_numeric_result = True
                    if summary.max_non_error_results is None or value > summary.max_non_error_results:
                        summary.max_non_error_results = value
    return by_key


def outcome_code(summary: Optional[QueryRunSummary]) -> int:
    # 0: missing, 1: error, 2: zero, 3: >0
    if summary is None:
        return 0
    if summary.has_error:
        return 1
    if summary.has_numeric_result:
        if float(summary.max_results or 0) > 0:
            return 3
        return 2
    return 0


def export_heatmap(main_data: dict, query_aliases: Dict[str, str], out_path: Path, dpi: int) -> None:
    runs = list(main_data.get("runs", []))
    records = list(main_data.get("records", []))
    runs_by_id = {r["run_id"]: r for r in runs}

    sorted_runs = sorted(
        runs,
        key=lambda r: (get_run_timestamp(r, records), get_run_display_label(r.get("run_id", ""), r.get("run_label", ""))),
    )

    stems = sorted(
        {
            normalize_query_stem(record.get("query_name"))
            for record in records
            if not record.get("is_run_summary_row")
        } - {None},
        key=lambda stem: query_aliases.get(stem, stem),
    )

    summaries = build_query_run_summaries(records)
    matrix = np.zeros((len(sorted_runs), len(stems)), dtype=int)
    for row_idx, run in enumerate(sorted_runs):
        for col_idx, stem in enumerate(stems):
            matrix[row_idx, col_idx] = outcome_code(summaries.get((stem, run["run_id"])))

    # Query-level variability: true when non-error numeric result counts differ across runs.
    stems_with_non_error_variability = set()
    for stem in stems:
        non_error_values: List[float] = []
        for run in sorted_runs:
            summary = summaries.get((stem, run["run_id"]))
            if summary and summary.has_non_error_numeric_result and summary.max_non_error_results is not None:
                non_error_values.append(float(summary.max_non_error_results))
        if len(non_error_values) >= 2 and not all(value == non_error_values[0] for value in non_error_values):
            stems_with_non_error_variability.add(stem)

    # Color-blind friendly mapping (Okabe-Ito family):
    # 0 missing -> gray, 1 error -> reddish purple, 2 zero -> orange, 3 positive -> blue
    cmap = ListedColormap(["#999999", "#CC79A7", "#E69F00", "#0072B2"])
    fig_w = max(12.0, 3.5 + 0.24 * len(stems))
    fig_h = max(6.8, 2.8 + 0.28 * len(sorted_runs))
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), constrained_layout=True)
    ax.imshow(matrix, cmap=cmap, vmin=0, vmax=3, aspect="auto", interpolation="nearest")

    x_labels = [query_aliases.get(stem, stem) for stem in stems]
    y_labels = [get_run_display_label(run["run_id"], run.get("run_label", "")) for run in sorted_runs]
    ax.set_xticks(np.arange(len(stems)))
    ax.set_yticks(np.arange(len(sorted_runs)))
    ax.set_xticklabels(x_labels, rotation=45, ha="right", fontsize=7)
    ax.set_yticklabels(y_labels, fontsize=8)

    ax.set_xlabel("Query (canonical stem / alias)", fontsize=11)
    ax.set_ylabel("Experiment Run (chronological)", fontsize=11)
    ax.set_title("Federated Query Outcomes by Query and Experiment Run", fontsize=14, pad=14)

    ax.set_xticks(np.arange(-0.5, len(stems), 1), minor=True)
    ax.set_yticks(np.arange(-0.5, len(sorted_runs), 1), minor=True)
    ax.grid(which="minor", color="white", linewidth=0.35)
    ax.tick_params(which="minor", bottom=False, left=False)

    # In-cell "not equal" marker for non-error cells where that query's
    # non-error result count varies across runs.
    marker_points: List[Tuple[int, int]] = []
    for row_idx, run in enumerate(sorted_runs):
        for col_idx, stem in enumerate(stems):
            if stem not in stems_with_non_error_variability:
                continue
            summary = summaries.get((stem, run["run_id"]))
            # Decorate all non-error numeric cells (>0 and =0).
            if summary is None or summary.has_error or not summary.has_non_error_numeric_result:
                continue
            if summary.max_non_error_results is None:
                continue
            marker_points.append((row_idx, col_idx))

    for row_idx, col_idx in marker_points:
        marker_text = ax.text(
            col_idx,
            row_idx,
            "≠",
            ha="center",
            va="center",
            fontsize=8.2,
            color="#FFFFFF",
            fontweight="bold",
            zorder=5,
        )
        marker_text.set_path_effects(
            [
                pe.Stroke(linewidth=1.35, foreground="#0F172A"),
                pe.Normal(),
            ]
        )

    legend_handles = [
        Patch(facecolor="#0072B2", edgecolor="none", label="Result count > 0"),
        Patch(facecolor="#E69F00", edgecolor="none", label="Result count = 0"),
        Patch(facecolor="#CC79A7", edgecolor="none", label="Explicit error encountered"),
        Patch(facecolor="#999999", edgecolor="none", label="No data"),
        Line2D(
            [0],
            [0],
            marker="$≠$",
            color="none",
            markerfacecolor="#0F172A",
            markeredgecolor="#0F172A",
            markeredgewidth=0.0,
            markersize=7.0,
            label="Query has result-count variation",
        ),
    ]
    ax.legend(
        handles=legend_handles,
        title="Outcome Category",
        title_fontsize=10,
        fontsize=9,
        loc="upper left",
        bbox_to_anchor=(-0.20, -0.07),
        ncol=2,
        frameon=True,
        framealpha=0.95,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=dpi, bbox_inches="tight")
    plt.close(fig)


def export_positive_by_run(main_data: dict, out_path: Path, dpi: int) -> None:
    runs = list(main_data.get("runs", []))
    records = [r for r in main_data.get("records", []) if not r.get("is_run_summary_row")]
    run_record_map: Dict[str, List[dict]] = {}
    for record in records:
        run_record_map.setdefault(record["run_id"], []).append(record)

    sorted_runs = sorted(
        runs,
        key=lambda r: (get_run_timestamp(r, records), get_run_display_label(r.get("run_id", ""), r.get("run_label", ""))),
    )

    labels = []
    values = []
    colors = []
    for run in sorted_runs:
        run_id = run["run_id"]
        run_records = run_record_map.get(run_id, [])
        positive = sum(1 for rec in run_records if (rec.get("results_count") or 0) > 0)
        labels.append(get_run_display_label(run_id, run.get("run_label", "")))
        values.append(positive)
        mode = str(run.get("service_description_mode") or "unknown")
        colors.append(SERVICE_MODE_COLORS.get(mode, "#8A94A6"))

    fig_w = max(11.0, 3.0 + 0.55 * len(labels))
    fig, ax = plt.subplots(figsize=(fig_w, 6.8), constrained_layout=True)
    x = np.arange(len(labels))
    bars = ax.bar(x, values, color=colors, edgecolor="#32485d", linewidth=0.6)

    ax.set_title("Queries with Non-Empty Result Sets (>0) by Experiment Run", fontsize=14, pad=12)
    ax.set_xlabel("Experiment Run (chronological)", fontsize=11)
    ax.set_ylabel("Queries with result set > 0 (count)", fontsize=11)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.grid(axis="y", linestyle="--", linewidth=0.6, alpha=0.45)
    ax.set_axisbelow(True)

    for bar in bars:
        h = bar.get_height()
        ax.text(
            bar.get_x() + bar.get_width() / 2.0,
            h + 0.15,
            f"{int(h)}",
            ha="center",
            va="bottom",
            fontsize=7,
            color="#1f3345",
        )

    legend_handles = [
        Patch(facecolor=SERVICE_MODE_COLORS["with-service"], label="WITH SERVICE"),
        Patch(facecolor=SERVICE_MODE_COLORS["no-service"], label="NO SERVICE"),
    ]
    ax.legend(handles=legend_handles, title="Query Form", title_fontsize=10, fontsize=9, loc="upper right", frameon=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=dpi, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Export paper-ready figures from dashboard JSON data.")
    parser.add_argument("--main-json", default="docs/data/main.json", help="Path to dashboard main dataset JSON.")
    parser.add_argument("--queries-json", default="docs/data/queries.json", help="Path to dashboard queries JSON.")
    parser.add_argument(
        "--out-dir",
        default="iswc_2026_paper/figures",
        help="Directory where exported PNG figures will be written.",
    )
    parser.add_argument("--dpi", type=int, default=400, help="PNG export DPI.")
    args = parser.parse_args()

    main_data = json.loads(Path(args.main_json).read_text(encoding="utf-8"))
    queries_data = json.loads(Path(args.queries_json).read_text(encoding="utf-8"))
    query_aliases = dict(queries_data.get("query_aliases", {}))

    out_dir = Path(args.out_dir)
    heatmap_png = out_dir / "query_outcome_heatmap.png"
    positive_png = out_dir / "queries_with_results_gt0_by_run.png"

    export_heatmap(main_data, query_aliases, heatmap_png, args.dpi)
    export_positive_by_run(main_data, positive_png, args.dpi)

    print(f"Wrote heatmap figure: {heatmap_png}")
    print(f"Wrote >0 results figure: {positive_png}")


if __name__ == "__main__":
    main()
