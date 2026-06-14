# Fed Survey Results Dashboard

This repository now includes a static GitHub Pages dashboard for interactive exploration of experiment results in [`experiments/`](./experiments).

The dashboard is located at [`docs/index.html`](./docs/index.html), and data artifacts are generated into [`docs/data/`](./docs/data).

## What it shows

- Federated query run metadata (run id, dates, durations)
- Query-level outcomes (produced results, result counts)
- Error categories and source counts
- HTTP request counts (when available)
- Service-description indicator (`_ns` / `no-service` = no service descriptions)
- Optional inclusion of `experiments/old-results/` (excluded from main summary by default)
- Query Explorer views from `queries/original/` and `queries/no-service/`, including:
  - query text inspection
  - query-structure stats (from `queries/stat.json` when available)
  - observed execution stats from experiment runs

## Data pipeline

Data generation script: [`scripts/build-dashboard-data.mjs`](./scripts/build-dashboard-data.mjs)

Behavior:

1. Uses existing `summary.json` files when present.
2. If `summary.json` is missing, reconstructs run summaries from batch/log files using the same parsing behavior as the upstream experiment post-processing script.
3. Writes:
   - `docs/data/main.json` (main runs only)
   - `docs/data/old-results.json` (old results only)
   - `docs/data/summary.json` (main summary only)
   - `docs/data/summary-old-results.json`
   - `docs/data/queries.json` (query catalog + stats + observed performance)
   - `docs/data/general-query-statistics.json` (SIB query-analysis structural statistics summary/buckets/detail rows)

## Commands

```bash
npm run build:data
```

- Regenerates dashboard datasets.
- Also writes missing run-level `summary.json` and `summary.csv` files when they can be reconstructed.

```bash
npm run build:data:no-write
```

- Regenerates dashboard datasets without writing missing summaries back into `experiments/`.

```bash
npm run export:paper-figures
```

- Exports publication-ready PNG figures to `iswc_2026_paper/figures/`:
  - `query_outcome_heatmap.png`
  - `queries_with_results_gt0_by_run.png`

## GitHub Pages setup (simple)

Use GitHub Pages built directly from the repository:

1. In GitHub: **Settings -> Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`
4. Folder: `/docs`

The site entrypoint is `docs/index.html`.

## Notes

- The dashboard does not fabricate missing values.
- Unknown or unavailable values are shown as `N/A`.
- Dashboard favicon is defined in [`docs/assets/favicon.svg`](./docs/assets/favicon.svg) and linked from [`docs/index.html`](./docs/index.html).
- General Query Statistics section is sourced from `queries/stat.json`, aligned with [constraintAutomaton/query-analysis-sib-swiss-federated-query/results/stat.json](https://github.com/constraintAutomaton/query-analysis-sib-swiss-federated-query/blob/main/results/stat.json).
- Main summary metrics exclude `old-results` by design; users can opt in via UI toggle.
- Dashboard state is encoded into URL query params (filters, selected view, selected query/experiments, period focus), so shared links reopen the same data display.
- Experiment family labels are remapped in webpage display for readability:
  - `EX1` -> `NOMETA-ASK`
  - `EX2` -> `NOMETA-COUNT`
  - `EX3` -> `VOID-TRIPLE`
  - `EX4` -> `VOID-BLOCK`
  - `EX1-NRL` -> `NOMETA-ASK-NRL`
  - `EX2-NRL` -> `NOMETA-COUNT-NRL`
  - `EX3-NRL` -> `VOID-TRIPLE-NRL`
  - `EX4-NRL` -> `VOID-BLOCK-NRL`
