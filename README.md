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
- Main summary metrics exclude `old-results` by design; users can opt in via UI toggle.
