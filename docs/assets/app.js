/**
 * Dashboard controller.
 *
 * Layout model:
 * - Global filters feed Overview + Monthly sections.
 * - Data Explorer has two user modes:
 *   1) By Query
 *   2) By Experiment
 */

const state = {
  mainDataset: null,
  queriesDataset: null,
  generalQueryStats: null,
  summary: null,
  notesText: null,
  monthFocus: null,
  selectedOverviewEndpoint: "uniprot",

  explorerMode: "query",
  selectedQueryStem: null,
  selectedQueryVariantByStem: new Map(),
  selectedExperimentIds: new Set(),
  experimentSelectionInitialized: false,
  pendingFocusTarget: null,
};

let isApplyingUrlState = false;
let activeHeatmapLegendItem = null;
let metricTooltipEl = null;
let activeMetricHelpEl = null;
const CACHE_BUSTER = window.__DASHBOARD_VERSION__ || String(Date.now());

const dom = {
  dataMeta: document.getElementById("dataMeta"),
  notesMeta: document.getElementById("notesMeta"),
  notesContent: document.getElementById("notesContent"),
  runFilter: document.getElementById("runFilter"),
  outcomeFilter: document.getElementById("outcomeFilter"),
  errorFilter: document.getElementById("errorFilter"),
  serviceFilter: document.getElementById("serviceFilter"),
  minSourcesFilter: document.getElementById("minSourcesFilter"),
  maxDurationFilter: document.getElementById("maxDurationFilter"),
  startDateFilter: document.getElementById("startDateFilter"),
  endDateFilter: document.getElementById("endDateFilter"),
  searchFilter: document.getElementById("searchFilter"),
  resetFilters: document.getElementById("resetFilters"),

  kpiGrid: document.getElementById("kpiGrid"),
  runSuccessChart: document.getElementById("runSuccessChart"),
  errorCategoryChart: document.getElementById("errorCategoryChart"),
  runMedianChart: document.getElementById("runMedianChart"),
  runPositiveResultCountChart: document.getElementById("runPositiveResultCountChart"),
  noServiceAlgorithmChart: document.getElementById("noServiceAlgorithmChart"),
  endpointOutcomeToggleRow: document.getElementById("endpointOutcomeToggleRow"),
  endpointOutcomeChart: document.getElementById("endpointOutcomeChart"),
  queryResultsByRunOverviewChart: document.getElementById("queryResultsByRunOverviewChart"),
  queryErrorTypeHeatmapChart: document.getElementById("queryErrorTypeHeatmapChart"),

  monthPills: document.getElementById("monthPills"),
  monthSuccessChart: document.getElementById("monthSuccessChart"),
  monthVolumeChart: document.getElementById("monthVolumeChart"),
  monthlyRunGrid: document.getElementById("monthlyRunGrid"),
  generalQueryStatsMeta: document.getElementById("generalQueryStatsMeta"),
  generalStatsSummaryTableBody: document.getElementById("generalStatsSummaryTableBody"),
  generalStatsBucketTableHead: document.getElementById("generalStatsBucketTableHead"),
  generalStatsBucketTableBody: document.getElementById("generalStatsBucketTableBody"),
  generalStatsDetailTableBody: document.getElementById("generalStatsDetailTableBody"),

  modeByQuery: document.getElementById("modeByQuery"),
  modeByExperiment: document.getElementById("modeByExperiment"),
  queryPane: document.getElementById("queryPane"),
  experimentPane: document.getElementById("experimentPane"),

  queryListSearch: document.getElementById("queryListSearch"),
  queryList: document.getElementById("queryList"),
  querySelectedTitle: document.getElementById("querySelectedTitle"),
  querySelectedMeta: document.getElementById("querySelectedMeta"),
  queryDurationChart: document.getElementById("queryDurationChart"),
  queryResultsChart: document.getElementById("queryResultsChart"),
  queryHttpOutcomeChart: document.getElementById("queryHttpOutcomeChart"),
  queryResultVariabilityMeta: document.getElementById("queryResultVariabilityMeta"),
  queryResultVariabilityChart: document.getElementById("queryResultVariabilityChart"),
  queryRunTableMeta: document.getElementById("queryRunTableMeta"),
  queryRunsTableBody: document.getElementById("queryRunsTableBody"),
  queryTextDetail: document.getElementById("queryTextDetail"),
  queryVariantSelect: document.getElementById("queryVariantSelect"),
  querySibMeta: document.getElementById("querySibMeta"),
  querySibTableHead: document.getElementById("querySibTableHead"),
  querySibTableBody: document.getElementById("querySibTableBody"),

  selectAllExperiments: document.getElementById("selectAllExperiments"),
  clearExperiments: document.getElementById("clearExperiments"),
  experimentList: document.getElementById("experimentList"),
  experimentSelectedMeta: document.getElementById("experimentSelectedMeta"),
  selectedRunSuccessChart: document.getElementById("selectedRunSuccessChart"),
  selectedRunDurationChart: document.getElementById("selectedRunDurationChart"),
  selectedRunErrorChart: document.getElementById("selectedRunErrorChart"),
  httpRequestMatrixMeta: document.getElementById("httpRequestMatrixMeta"),
  httpDisplayMode: document.getElementById("httpDisplayMode"),
  httpQueryFilter: document.getElementById("httpQueryFilter"),
  httpTopN: document.getElementById("httpTopN"),
  httpAggregateMode: document.getElementById("httpAggregateMode"),
  httpMatrixContainer: document.getElementById("httpMatrixContainer"),
  httpBarContainer: document.getElementById("httpBarContainer"),
  httpRequestMatrix: document.getElementById("httpRequestMatrix"),
  httpRequestBarChart: document.getElementById("httpRequestBarChart"),
  successOnlyMeta: document.getElementById("successOnlyMeta"),
  successOnlyResultsChart: document.getElementById("successOnlyResultsChart"),
  successOnlyDurationChart: document.getElementById("successOnlyDurationChart"),
  failureErrorChart: document.getElementById("failureErrorChart"),
  httpByRunChart: document.getElementById("httpByRunChart"),
  experimentQueryTableMeta: document.getElementById("experimentQueryTableMeta"),
  experimentQueryTableBody: document.getElementById("experimentQueryTableBody"),
  focusModal: document.getElementById("focusModal"),
  focusModalTitle: document.getElementById("focusModalTitle"),
  focusModalContent: document.getElementById("focusModalContent"),
  focusModalClose: document.getElementById("focusModalClose"),
};

const focusView = {
  isOpen: false,
  movedNode: null,
  placeholder: null,
  focusBeforeOpen: null,
};

function versionedPath(relativePath) {
  const separator = relativePath.includes("?") ? "&" : "?";
  return `${relativePath}${separator}v=${encodeURIComponent(CACHE_BUSTER)}`;
}

function initializeVersionedAssets() {
  const complexityFrame = document.getElementById("generalStatsInteractiveFigure");
  if (complexityFrame && complexityFrame.src !== versionedPath("./assets/Queries_Summary_Figure_interactive.html")) {
    complexityFrame.src = versionedPath("./assets/Queries_Summary_Figure_interactive.html");
  }
}

const EXPANDABLE_SURFACE_SELECTOR = ".chart-card, .table-wrap, .http-matrix-wrap, .http-chart-wrap, .interactive-figure-wrap";
const INTERACTIVE_BLOCK_SELECTOR = "button, a, input, select, textarea, label, summary, [role='button']";
const URL_MATCH_RE = /https?:\/\/[^\s<>"']+/gi;
const CHART_CAPTIONS = Object.freeze({
  runSuccessChart: "Each bar shows execution success rate: the percentage of query attempts in a run with result set count > 0. This is the clearest high-level reliability signal when comparing run configurations.",
  errorCategoryChart: "Bars count failed query attempts by high-level error group (Client-side HTTP, Server-side HTTP, Transport-level, Timeout-related, Other) in the current scope.",
  runMedianChart: "Bars show median runtime per run in seconds. This helps compare typical execution cost between runs without over-weighting extreme outliers.",
  runPositiveResultCountChart: "Bars show the number of query attempts per run with non-empty result sets (>0). This highlights runs that produced useful, non-empty outputs.",
  noServiceAlgorithmChart: "This chart compares only NO-SERVICE algorithm families using direct experimental outcomes: explicit-error-free rate, >0-result rate, and median HTTP requests among successful (no-explicit-error) query attempts.",
  endpointOutcomeChart: "For the selected endpoint, stacked bars show counts of >0 results, =0 results without explicit error, and explicit errors per run. The line overlays execution success rate (>0 results only).",
  queryResultsByRunOverviewChart: "Heatmap cells show per-query outcomes by run with distinct states for >0 results, 0 results, explicit errors, and missing data. A ≠ marker flags queries whose non-error raw result counts differ between runs, highlighting cross-run result instability.",
  queryErrorTypeHeatmapChart: "Heatmap cells show whether each query-run pair had explicit errors. Non-error outcomes (both 0 and >0 results) share one color, while explicit errors are colored by high-level error group with raw messages available on hover.",
  monthSuccessChart: "Each bar is execution success rate within one user-defined testing period, where success means result set count > 0. It indicates whether robustness improved, declined, or stayed stable across study phases.",
  monthVolumeChart: "Bars show how many query records were executed in each user-defined testing period. This gives workload context for interpreting period-level outcome trends.",
  generalStatsInteractiveFigureChart: "This interactive figure shows query complexity by triple-pattern count, grouped by federation-member cardinality, with OPTIONAL and UNION markers to highlight structural query features.",
  queryDurationChart: "For the selected query, bars show runtime per experiment run in seconds. This reveals run-to-run execution variability for the same query logic.",
  queryResultsChart: "For the selected query, bars show result count per run. This is useful for spotting consistency issues, empty-result behavior, or large output shifts across runs.",
  queryHttpOutcomeChart: "Each point is one query attempt with a recorded HTTP request count. Experiments without HTTP request numbers are not represented in this figure. The x-axis uses raw HTTP request count, and duplicate x/outcome points are lightly dodged within their outcome band for visibility.",
  queryResultVariabilityChart: "This timeline highlights result-count shifts for the selected query across chronological runs. Red bars indicate explicit changes between adjacent time points, making instability easy to spot.",
  selectedRunSuccessChart: "Each bar is execution success rate for one selected experiment, where success means result set count > 0. This allows direct side-by-side comparison of reliability among the chosen runs.",
  selectedRunDurationChart: "Bars show median runtime (seconds) for each selected experiment. It summarizes typical cost per run for the current selection.",
  selectedRunErrorChart: "Bars count failed queries by high-level error group within selected experiments.",
  httpRequestBarChart: "Grouped bars show per-query HTTP request load across selected experiments using the chosen aggregation. This highlights high-cost queries and cross-run request amplification.",
  successOnlyResultsChart: "Bars total result counts from successful queries per experiment. It summarizes useful output volume while excluding failed attempts.",
  successOnlyDurationChart: "Bars show median runtime of only successful queries by experiment. This reveals efficiency of successful executions independent of failure overhead.",
  failureErrorChart: "Bars count failed queries by high-level error group (failed attempts only). Raw error text remains available in detailed views and heatmap tooltips.",
  httpByRunChart: "Bars show median HTTP requests per selected experiment. This helps quantify network/API pressure and compare request efficiency across runs.",
});
const METRIC_DEFINITIONS = Object.freeze({
  executionSuccessRate: "Execution success rate is the percentage of query attempts with result set count > 0. Result count = 0 and explicit errors are not counted as execution success.",
  queryRecords: "Query records are individual query-attempt rows in the filtered dataset.",
  emptyResults: "Empty results count parseable query attempts where result set size equals 0 and no explicit error was recorded.",
  producedResults: "Produced results counts query attempts where result set size is strictly greater than zero.",
  attempts: "Attempts are the number of query records represented in the current scope.",
  medianDuration: "Median duration is the 50th percentile of observed runtimes in seconds for the current scope.",
  maxResults: "Max results is the largest result-set size observed in the current scope.",
  runsInView: "Runs in view is the number of unique experiment runs represented by the current filters.",
  experiments: "Experiments is the number of selected runs included in this view.",
  successfulRecords: "Successful records are query attempts with result set count > 0.",
  avgResultsOnSuccess: "Average results on success is the mean result-set size over successful records (result set count > 0).",
  knownHttpRecords: "Known HTTP records are query attempts with a non-null HTTP request count.",
  queries: "Queries is the number of query records represented in this section.",
});
const LEGACY_QUERY_STEM_MAP = Object.freeze({
  Q00000004: "117_biosodafrontend_glioblastoma_orthologs_rat",
  Q00000005: "118_biosodafrontend_rat_brain_human_cancer",
  Q00000007: "027-biosodafrontend",
  Q00000008: "028-biosodafrontend",
  Q00000010: "116_biosodafrontend_rabit_mouse_orthologs",
  Q00000011: "15-rat-TP53-biosodafrontend",
});
const EXPERIMENT_LABEL_REPLACEMENTS = Object.freeze([
  ["EX1-NRL", "NOMETA-ASK-NRL"],
  ["EX2-NRL", "NOMETA-COUNT-NRL"],
  ["EX3-NRL", "VOID-TRIPLE-NRL"],
  ["EX4-NRL", "VOID-BLOCK-NRL"],
  ["EX1", "NOMETA-ASK"],
  ["EX2", "NOMETA-COUNT"],
  ["EX3", "VOID-TRIPLE"],
  ["EX4", "VOID-BLOCK"],
]);
const CONTROL_RUN_DISPLAY_CONFIG = Object.freeze({
  // Clear display names for WITH-SERVICE runs used across charts, tables, and filters.
  "experiments/old-results/default-service-test-1": {
    displayLabel: "SERVICE-COMUNICA-2025-03-31",
    tagLabel: "With-SERVICE run",
  },
  "experiments/service-control-31-03-25-comunica": {
    displayLabel: "SERVICE-COMUNICA-2025-03-25",
    tagLabel: "With-SERVICE run",
  },
  "experiments/service-control-31-03-25-endpoint": {
    displayLabel: "SERVICE-MANUAL-ENDPOINT-2025-03-25",
    tagLabel: "With-SERVICE run",
  },
  "experiments/service-control-20-4-26": {
    displayLabel: "SERVICE-COMUNICA-2026-04-26",
    tagLabel: "With-SERVICE run",
  },
});
const TEMPORAL_GROUP_META = Object.freeze({
  "spring-2025": { key: "spring-2025", label: "Spring 2025", order: 0 },
  "fall-2025": { key: "fall-2025", label: "Fall 2025", order: 1 },
  "winter-2026": { key: "winter-2026", label: "Winter 2026", order: 2 },
  "spring-2026": { key: "spring-2026", label: "Spring 2026", order: 3 },
});
const TEMPORAL_GROUP_ORDER = Object.freeze([
  "spring-2025",
  "fall-2025",
  "winter-2026",
  "spring-2026",
]);
const NO_SERVICE_ALGORITHM_META = Object.freeze([
  { key: "NOMETA-ASK", label: "NOMETA-ASK", color: "#0072B2" },
  { key: "NOMETA-COUNT", label: "NOMETA-COUNT", color: "#56B4E9" },
  { key: "VOID-TRIPLE", label: "VOID-TRIPLE", color: "#009E73" },
  { key: "VOID-BLOCK", label: "VOID-BLOCK", color: "#E69F00" },
]);
const OVERVIEW_ENDPOINT_META = Object.freeze([
  { key: "uniprot", label: "UniProt", endpointUrl: "https://sparql.uniprot.org/sparql/" },
  { key: "rhea", label: "Rhea", endpointUrl: "https://sparql.rhea-db.org/sparql" },
  { key: "bgee", label: "Bgee", endpointUrl: "https://www.bgee.org/sparql" },
  { key: "oma", label: "OMA", endpointUrl: "https://sparql.omabrowser.org/sparql" },
  { key: "orthodb", label: "OrthoDB", endpointUrl: "https://sparql.orthodb.org/sparql" },
  { key: "swisslipids", label: "SwissLipids", endpointUrl: "https://sparql.swisslipids.org/sparql/" },
  { key: "emi", label: "EMI/DBGI", endpointUrl: "https://biosoda.unil.ch/emi/sparql" },
]);
const RUN_TEMPORAL_GROUP_OVERRIDES = Object.freeze({
  // Spring 2025 controls
  "experiments/old-results/default-service-test-1": "spring-2025",
  "experiments/service-control-31-03-25-comunica": "spring-2025",
  "experiments/service-control-31-03-25-endpoint": "spring-2025",
  // Fall 2025 campaign
  "experiments/EX1-17-9-25": "fall-2025",
  "experiments/EX2-13-10-25": "fall-2025",
  "experiments/EX3-16-10-25": "fall-2025",
  "experiments/EX4-24-10-25": "fall-2025",
  // Winter 2026 campaign
  "experiments/EX1-NRL-14-11-25": "winter-2026",
  "experiments/EX1-17-11-25": "winter-2026",
  "experiments/EX2-19-11-25": "winter-2026",
  "experiments/EX3-24-11-25": "winter-2026",
  "experiments/EX4-26-11-25": "winter-2026",
  "experiments/EX2-NRL-01-12-25": "winter-2026",
  "experiments/EX1-31-1-26": "winter-2026",
  // Spring 2026 campaign
  "experiments/EX1-17-4-26": "spring-2026",
  "experiments/EX2-17-4-26": "spring-2026",
  "experiments/EX3-17-4-26": "spring-2026",
  "experiments/EX4-17-4-26": "spring-2026",
  "experiments/EX1-NRL-17-4-26": "spring-2026",
  "experiments/service-control-20-4-26": "spring-2026",
  "experiments/EX1-12-06-26": "spring-2026",
  "experiments/EX2-12-06-26": "spring-2026",
  "experiments/EX3-12-06-26": "spring-2026",
  "experiments/EX4-12-06-26": "spring-2026",
  "experiments/EX1-NRL-12-06-26": "spring-2026",
});

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatCompactNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(Number(value));
}

function formatAxisNumber(value) {
  if (Math.abs(value) >= 10000) {
    return formatCompactNumber(value, 1);
  }
  return formatNumber(value, 1);
}

function metricLabel(label, metricKey) {
  const definition = METRIC_DEFINITIONS[metricKey];
  if (!definition) {
    return label;
  }
  return `
    <span class="metric-label-wrap">
      ${label}
      <span
        class="metric-help"
        tabindex="0"
        role="note"
        data-metric-definition="${escapeHtmlAttr(definition)}"
        aria-label="${escapeHtmlAttr(`Metric definition: ${definition}`)}"
      >ⓘ</span>
    </span>
  `;
}

function ensureMetricTooltipElement() {
  if (metricTooltipEl instanceof HTMLElement) {
    return metricTooltipEl;
  }
  const tooltip = document.createElement("div");
  tooltip.className = "metric-help-tooltip hidden";
  tooltip.setAttribute("role", "tooltip");
  document.body.appendChild(tooltip);
  metricTooltipEl = tooltip;
  return metricTooltipEl;
}

function metricHelpText(element) {
  if (!(element instanceof HTMLElement)) {
    return "";
  }
  const direct = element.dataset.metricDefinition || element.getAttribute("data-metric-definition");
  if (direct) {
    return String(direct);
  }
  const title = element.getAttribute("title");
  if (title) {
    return String(title);
  }
  const aria = element.getAttribute("aria-label") || "";
  const prefix = "Metric definition:";
  if (aria.startsWith(prefix)) {
    return aria.slice(prefix.length).trim();
  }
  return "";
}

function hydrateMetricHelpAnchors() {
  document.querySelectorAll(".metric-help").forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const title = node.getAttribute("title");
    if (title && !node.dataset.metricDefinition) {
      node.dataset.metricDefinition = title;
    }
    // Use a custom tooltip layer instead of relying on native title behavior.
    node.removeAttribute("title");
  });
}

function hideMetricTooltip() {
  if (!(metricTooltipEl instanceof HTMLElement)) {
    return;
  }
  metricTooltipEl.classList.add("hidden");
  metricTooltipEl.removeAttribute("style");
  metricTooltipEl.textContent = "";
  activeMetricHelpEl = null;
}

function positionMetricTooltip(anchorEl, pointerEvent = null) {
  if (!(metricTooltipEl instanceof HTMLElement) || !(anchorEl instanceof HTMLElement)) {
    return;
  }
  const padding = 12;
  const offset = 12;
  const tooltipRect = metricTooltipEl.getBoundingClientRect();
  let left;
  let top;
  if (pointerEvent && Number.isFinite(pointerEvent.clientX) && Number.isFinite(pointerEvent.clientY)) {
    left = pointerEvent.clientX + offset;
    top = pointerEvent.clientY + offset;
  } else {
    const anchorRect = anchorEl.getBoundingClientRect();
    left = anchorRect.left + anchorRect.width + 8;
    top = anchorRect.top + (anchorRect.height / 2);
  }
  if (left + tooltipRect.width + padding > window.innerWidth) {
    left = Math.max(padding, window.innerWidth - tooltipRect.width - padding);
  }
  if (top + tooltipRect.height + padding > window.innerHeight) {
    top = Math.max(padding, window.innerHeight - tooltipRect.height - padding);
  }
  if (top < padding) {
    top = padding;
  }
  metricTooltipEl.style.left = `${left}px`;
  metricTooltipEl.style.top = `${top}px`;
}

function showMetricTooltip(anchorEl, pointerEvent = null) {
  if (!(anchorEl instanceof HTMLElement)) {
    return;
  }
  const text = metricHelpText(anchorEl);
  if (!text) {
    hideMetricTooltip();
    return;
  }
  const tooltip = ensureMetricTooltipElement();
  tooltip.textContent = text;
  tooltip.classList.remove("hidden");
  positionMetricTooltip(anchorEl, pointerEvent);
  activeMetricHelpEl = anchorEl;
}

function handleMetricHelpPointerOver(event) {
  if (!(event.target instanceof Element)) {
    return;
  }
  const target = event.target.closest(".metric-help");
  if (!(target instanceof HTMLElement)) {
    return;
  }
  showMetricTooltip(target, event);
}

function handleMetricHelpPointerMove(event) {
  if (!(activeMetricHelpEl instanceof HTMLElement)) {
    return;
  }
  positionMetricTooltip(activeMetricHelpEl, event);
}

function handleMetricHelpPointerOut(event) {
  if (!(event.target instanceof Element)) {
    return;
  }
  const target = event.target.closest(".metric-help");
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const related = event.relatedTarget;
  if (related instanceof Node && target.contains(related)) {
    return;
  }
  hideMetricTooltip();
}

function handleMetricHelpFocusIn(event) {
  if (!(event.target instanceof Element)) {
    return;
  }
  const target = event.target.closest(".metric-help");
  if (!(target instanceof HTMLElement)) {
    return;
  }
  showMetricTooltip(target);
}

function handleMetricHelpFocusOut(event) {
  if (!(event.target instanceof Element)) {
    return;
  }
  const target = event.target.closest(".metric-help");
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const related = event.relatedTarget;
  if (related instanceof Node && target.contains(related)) {
    return;
  }
  hideMetricTooltip();
}

function formatDateTime(value) {
  if (!value) {
    return "null";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "null";
  }
  return date.toISOString().replace("T", " ").replace(".000Z", "Z");
}

function formatNullableNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "null";
  }
  return formatNumber(value, digits);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTextWithLinks(text) {
  if (!text) {
    return "";
  }

  const source = String(text);
  const parts = [];
  let cursor = 0;
  URL_MATCH_RE.lastIndex = 0;

  for (const match of source.matchAll(URL_MATCH_RE)) {
    const rawUrl = match[0];
    const start = match.index ?? 0;
    const end = start + rawUrl.length;
    const cleanUrl = rawUrl.replace(/[),.;]+$/g, "");
    const trailing = rawUrl.slice(cleanUrl.length);

    parts.push(escapeHtml(source.slice(cursor, start)));

    if (cleanUrl) {
      parts.push(`<a class="sib-link" href="${escapeHtmlAttr(cleanUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cleanUrl)}</a>`);
    }
    if (trailing) {
      parts.push(escapeHtml(trailing));
    }

    cursor = end;
  }

  parts.push(escapeHtml(source.slice(cursor)));
  return parts.join("");
}

function ensureChartInfoCards() {
  document.querySelectorAll(".chart[id]").forEach((chart) => {
    if (!(chart instanceof HTMLElement)) {
      return;
    }

    const captionText = CHART_CAPTIONS[chart.id];
    if (!captionText) {
      return;
    }

    let frame = chart.closest(".chart-frame");
    if (!(frame instanceof HTMLElement)) {
      frame = document.createElement("div");
      frame.className = "chart-frame";
      chart.parentNode.insertBefore(frame, chart);
      frame.appendChild(chart);
    }
    frame.classList.toggle("interactive-figure-frame", chart.id === "generalStatsInteractiveFigureChart");

    let infoButton = frame.querySelector(".chart-info-btn");
    if (!(infoButton instanceof HTMLButtonElement)) {
      infoButton = document.createElement("button");
      infoButton.type = "button";
      infoButton.className = "chart-info-btn";
      infoButton.textContent = "i";
      infoButton.setAttribute("aria-label", "Show figure caption");
      infoButton.setAttribute("data-chart-id", chart.id);
      frame.appendChild(infoButton);
    }

    let caption = frame.querySelector(".chart-caption");
    if (!(caption instanceof HTMLElement)) {
      caption = document.createElement("div");
      caption.className = "chart-caption hidden";
      frame.appendChild(caption);
    }

    caption.innerHTML = `<strong>Figure caption:</strong> ${escapeHtml(captionText)}`;
    caption.setAttribute("data-chart-id", chart.id);
    const isExpanded = !caption.classList.contains("hidden");
    infoButton.setAttribute("aria-expanded", String(isExpanded));
    infoButton.setAttribute("title", isExpanded ? "Hide figure caption" : "Show figure caption");
  });
}

function toggleChartCaption(button) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const frame = button.closest(".chart-frame");
  const caption = frame?.querySelector(".chart-caption");
  if (!(caption instanceof HTMLElement)) {
    return;
  }
  const shouldOpen = caption.classList.contains("hidden");
  caption.classList.toggle("hidden", !shouldOpen);
  button.setAttribute("aria-expanded", String(shouldOpen));
  button.setAttribute("title", shouldOpen ? "Hide figure caption" : "Show figure caption");
}

function formatSibCellValue(rawValue) {
  const text = rawValue === null || rawValue === undefined ? "-" : String(rawValue).trim();
  if (!text || text === "-") {
    return "<span class='sib-null'>-</span>";
  }

  // Break dense endpoint lists and pipe-delimited metadata into readable rows.
  const normalized = text
    .replace(/\s*\|\s*/g, "\n")
    .replace(/,\s*(https?:\/\/)/gi, "\n$1");

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length <= 1) {
    return `<div class="sib-line">${renderTextWithLinks(lines[0] || normalized)}</div>`;
  }

  return `
    <ul class="sib-list">
      ${lines.map((line) => `<li class="sib-line">${renderTextWithLinks(line)}</li>`).join("")}
    </ul>
  `;
}

function normalizeNotesText(rawText) {
  if (!rawText) {
    return "";
  }
  return String(rawText).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function parseCsvCells(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parsePipeCells(line) {
  const normalized = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "");
  return normalized.split("|").map((cell) => cell.trim());
}

function looksLikeCsvTableLine(trimmed) {
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return false;
  }
  const commaMatches = trimmed.match(/,/g) || [];
  return commaMatches.length >= 2 && /^[^\s,]+,/.test(trimmed);
}

function looksLikePipeTableLine(trimmed) {
  if (!trimmed) {
    return false;
  }
  const pipeMatches = trimmed.match(/\|/g) || [];
  return pipeMatches.length >= 2;
}

function normalizeNotesCell(value) {
  const text = (value ?? "").trim().replace(/^\*+\s*/, "");
  const withMappedLegacyIds = Object.entries(LEGACY_QUERY_STEM_MAP).reduce((current, [legacy, mapped]) => {
    const withFileName = current.replace(new RegExp(`\\b${legacy}\\.rq\\b`, "g"), `${mapped}.rq`);
    return withFileName.replace(new RegExp(`\\b(?:biosodafrontend#)?${legacy}\\b`, "g"), mapped);
  }, text);
  const normalized = mapExperimentFamilyLabel(withMappedLegacyIds).trim();
  return normalized || "-";
}

function inferGeneratedHeaders(width, contextLabel = "", delimiter = ",") {
  const context = String(contextLabel || "").toLowerCase();

  if (delimiter === "|" && context.includes("no service void testing")) {
    const fiveCol = ["Query File", "Status", "HTTP Requests", "Results", "Error Code"];
    const fourCol = ["Query File", "Status", "HTTP Requests", "Details"];
    return (width >= 5 ? fiveCol : fourCol).slice(0, width);
  }

  if (
    context.includes("control run results")
    || context.includes("broken queries")
    || context.includes("no results queries")
    || context.includes("timeout queries")
  ) {
    return ["Query Name", "Source", "Comunica Results", "Native Endpoint Results", "Details", "Notes"].slice(0, width);
  }

  if (width === 2) {
    return ["Metric", "Value"];
  }

  if (width === 3) {
    return ["Item", "Value", "Notes"];
  }

  return Array.from({ length: width }, (_, index) => `Field ${index + 1}`);
}

function alignHeaderToWidth(header, width) {
  const next = [...header];
  while (next.length < width) {
    next.push(`Field ${next.length + 1}`);
  }
  return next.slice(0, width);
}

function looksLikeHeaderRow(cells) {
  if (!cells.length) {
    return false;
  }
  const normalized = cells.map((cell) => cell.toLowerCase().trim());
  const joined = normalized.join(" ");
  return /(query|status|source|result|error|http|details|name)/.test(joined);
}

function renderDelimitedTable(rawRows, delimiter, contextLabel = "") {
  const parsedRows = rawRows
    .map((row) => (delimiter === "," ? parseCsvCells(row) : parsePipeCells(row)))
    .map((cells) => cells.map((cell) => normalizeNotesCell(cell)))
    .filter((cells) => cells.length > 0);

  if (!parsedRows.length) {
    return "";
  }

  const width = parsedRows.reduce((maxWidth, row) => Math.max(maxWidth, row.length), 0);
  const rows = parsedRows.map((row) => {
    const padded = [...row];
    while (padded.length < width) {
      padded.push("-");
    }
    return padded;
  });

  let header = [];
  let bodyRows = rows;
  if (looksLikeHeaderRow(rows[0])) {
    header = alignHeaderToWidth(rows[0], width);
    bodyRows = rows.slice(1);
  } else {
    header = inferGeneratedHeaders(width, contextLabel, delimiter);
    header = alignHeaderToWidth(header, width);
  }

  return `
    <div class="notes-table-wrap">
      <table class="notes-table">
        <thead>
          <tr>${header.map((cell) => `<th>${renderTextWithLinks(cell)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderTextWithLinks(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function updateNotesContextLabel(currentLabel, nextText) {
  const next = String(nextText || "").trim();
  return next || currentLabel;
}

function mapLegacyStem(stem) {
  if (!stem) {
    return stem;
  }
  return LEGACY_QUERY_STEM_MAP[stem] || stem;
}

function mapExperimentFamilyLabel(text) {
  if (text === null || text === undefined) {
    return "";
  }
  return EXPERIMENT_LABEL_REPLACEMENTS.reduce((mapped, [source, target]) => (
    mapped.replace(new RegExp(`\\b${source}\\b`, "g"), target)
  ), String(text));
}

function normalizeNotesSectionTitle(line) {
  return line
    .replace(/^==\s*/, "")
    .replace(/\s*=+\s*$/, "")
    .trim();
}

function normalizeNotesSubtitle(line) {
  return line.replace(/:\s*$/, "").trim();
}

function normalizeNotesParagraphContext(line) {
  return line.replace(/\s*[–-]\s*$/, "").trim();
}

function normalizeQueryStem(rawName) {
  if (!rawName || typeof rawName !== "string") {
    return null;
  }
  let stem = rawName.trim();
  stem = stem.replace(/\.rq$/i, "");
  stem = stem.replace(/_ns$/i, "");
  stem = stem.replace(/_ws$/i, "");
  stem = mapLegacyStem(stem);
  return stem || null;
}

function renderNotesAsHtml(rawText) {
  const text = normalizeNotesText(rawText);
  if (!text.trim()) {
    return "";
  }

  const lines = text.split("\n");
  const html = [];
  let listItems = [];
  let tableRows = [];
  let tableDelimiter = null;
  let tableContextLabel = "";
  let currentContextLabel = "";

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    html.push(`<ul class="notes-list">${listItems.join("")}</ul>`);
    listItems = [];
  };

  // Flushes the currently collected delimited rows into a rendered HTML table.
  const flushTable = () => {
    if (!tableRows.length || !tableDelimiter) {
      return;
    }
    html.push(renderDelimitedTable(tableRows, tableDelimiter, tableContextLabel));
    tableRows = [];
    tableDelimiter = null;
    tableContextLabel = "";
  };

  const startTableIfNeeded = (delimiter) => {
    flushList();
    if (tableDelimiter && tableDelimiter !== delimiter) {
      flushTable();
    }
    if (!tableDelimiter) {
      tableDelimiter = delimiter;
      tableContextLabel = currentContextLabel;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      flushTable();
      continue;
    }

    if (/^_{5,}$/.test(trimmed)) {
      flushList();
      flushTable();
      html.push('<hr class="notes-divider" />');
      continue;
    }

    if (looksLikeCsvTableLine(trimmed)) {
      startTableIfNeeded(",");
      tableRows.push(trimmed);
      continue;
    }

    if (looksLikePipeTableLine(trimmed)) {
      startTableIfNeeded("|");
      tableRows.push(trimmed);
      continue;
    }

    if (/^-{5,}$/.test(trimmed) && tableDelimiter) {
      // Common markdown/table separator row, not user data.
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      flushTable();
      listItems.push(`<li>${renderTextWithLinks(mapExperimentFamilyLabel(bulletMatch[1]))}</li>`);
      continue;
    }

    flushList();
    flushTable();

    if (trimmed.startsWith("==")) {
      const title = normalizeNotesSectionTitle(trimmed);
      currentContextLabel = updateNotesContextLabel(currentContextLabel, title);
      html.push(`<h3 class="notes-title">${renderTextWithLinks(mapExperimentFamilyLabel(title))}</h3>`);
      continue;
    }

    if (trimmed.endsWith(":")) {
      const subtitle = normalizeNotesSubtitle(trimmed);
      currentContextLabel = updateNotesContextLabel(currentContextLabel, subtitle);
      html.push(`<h4 class="notes-subtitle">${renderTextWithLinks(mapExperimentFamilyLabel(subtitle))}</h4>`);
      continue;
    }

    currentContextLabel = updateNotesContextLabel(currentContextLabel, normalizeNotesParagraphContext(trimmed));
    html.push(`<p class="notes-paragraph">${renderTextWithLinks(mapExperimentFamilyLabel(trimmed))}</p>`);
  }

  flushList();
  flushTable();
  return html.join("");
}

function renderNotesSection() {
  if (!dom.notesMeta || !dom.notesContent) {
    return;
  }

  const noteText = normalizeNotesText(state.notesText || "");
  if (!noteText.trim()) {
    dom.notesMeta.textContent = "No notes file was loaded.";
    dom.notesContent.innerHTML = "";
    return;
  }

  const nonEmptyLineCount = noteText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;

  dom.notesMeta.textContent = `Source: Experiment Outcomes (notes).txt | Non-empty lines: ${nonEmptyLineCount}`;
  dom.notesContent.innerHTML = renderNotesAsHtml(noteText);
}

function parseIso(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function mean(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatServiceMode(mode) {
  if (mode === "with-service") {
    return "with service descriptions";
  }
  if (mode === "no-service") {
    return "no service descriptions";
  }
  if (mode === "mixed") {
    return "mixed service/no-service";
  }
  return "service mode unknown";
}

function formatServiceModeBadge(mode) {
  if (mode === "with-service") {
    return "WITH SERVICE";
  }
  if (mode === "no-service") {
    return "NO-SERVICE";
  }
  if (mode === "mixed") {
    return "MIXED";
  }
  return "UNKNOWN";
}

const CHART_COLORS = Object.freeze({
  primary: "#0072B2",
  secondary: "#56B4E9",
  success: "#009E73",
  warning: "#E69F00",
  danger: "#D55E00",
  neutral: "#8A94A6",
});

const ERROR_HEATMAP_BASE_COLORS = Object.freeze({
  noError: "#2A9D8F",
  missing: "#94A3B8",
  fallbackError: "#7E3AF2",
});

const ERROR_HEATMAP_CATEGORY_PALETTE = Object.freeze([
  "#CC79A7",
  "#D55E00",
  "#0072B2",
  "#E69F00",
  "#56B4E9",
  "#882255",
  "#332288",
  "#117733",
  "#AA4499",
  "#999933",
  "#661100",
  "#44AA99",
]);

const SERVICE_MODE_COLOR = Object.freeze({
  "with-service": CHART_COLORS.primary,
  "no-service": CHART_COLORS.success,
  mixed: CHART_COLORS.warning,
  unknown: CHART_COLORS.neutral,
});

function syncServiceModeLegendColors() {
  // Keep overview legend swatches aligned with the run colors used by overview charts.
  document.documentElement.style.setProperty("--legend-with-service-color", SERVICE_MODE_COLOR["with-service"]);
  document.documentElement.style.setProperty("--legend-no-service-color", SERVICE_MODE_COLOR["no-service"]);
}

function normalizeServiceModeValue(mode) {
  if (mode === "with-service" || mode === "no-service" || mode === "mixed") {
    return mode;
  }
  return "unknown";
}

function normalizeErrorCategoryLabel(value) {
  const label = typeof value === "string" ? value.trim() : "";
  return label || "Uncategorized explicit error";
}

function normalizeErrorGroupLabel(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "client-side http") {
    return "Client-side HTTP";
  }
  if (text === "server-side http") {
    return "Server-side HTTP";
  }
  if (text === "transport-level" || text === "transport level") {
    return "Transport-level";
  }
  if (text === "timeout-related") {
    return "Timeout-related";
  }
  if (text === "other errors" || text === "other error" || text === "other") {
    return "Other";
  }
  return "Other";
}

function deriveErrorGroupFromText(errorCategory, errorRaw) {
  const categoryText = errorCategory === null || errorCategory === undefined ? "" : String(errorCategory).trim().toLowerCase();
  const rawText = errorRaw === null || errorRaw === undefined ? "" : String(errorRaw).trim().toLowerCase();
  const combined = `${categoryText} ${rawText}`.trim();

  if (
    /\btimeout\b|\btimed out\b|\bdeadline\b|\blong runtime\b|\bterminated\b|\baborted\b/.test(combined)
    || /\bhttp\s*408\b|\bhttp\s*504\b|\berror\s*408\b|\berror\s*504\b/.test(combined)
  ) {
    return "Timeout-related";
  }
  if (
    /\bclient-side\b|\bhttp\s*4\d\d\b|\berror\s*4\d\d\b|\bbad request\b|\bforbidden\b|\bnot found\b|\brate limited\b/.test(combined)
  ) {
    return "Client-side HTTP";
  }
  if (
    /\bserver-side\b|\bhttp\s*5\d\d\b|\berror\s*5\d\d\b/.test(combined)
  ) {
    return "Server-side HTTP";
  }
  if (
    /\bfetch failure\b|\brequest failed\b|\bdereference failure\b|\binvalid endpoint response\b|\bnetwork\b|\bsocket\b|\beconnreset\b|\beconnrefused\b|\benotfound\b|\bconnection refused\b/.test(combined)
  ) {
    return "Transport-level";
  }
  return "Other";
}

function getRecordErrorGroup(record) {
  if (!hasExplicitError(record)) {
    return "No explicit error";
  }
  if (record && typeof record.error_group === "string" && record.error_group.trim()) {
    return normalizeErrorGroupLabel(record.error_group);
  }
  return deriveErrorGroupFromText(record?.error_category, record?.error_raw);
}

function normalizeErrorMessageLabel(rawValue, fallbackCategory = null) {
  const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
  const normalized = text.toLowerCase();
  const nonMessageMarkers = new Set([
    "",
    "-",
    "none",
    "null",
    "n/a",
    "no results",
    "no comunica results",
    "- (no results)",
    "general: no results",
  ]);
  if (!nonMessageMarkers.has(normalized)) {
    return text.replace(/\s+/g, " ").trim();
  }
  return normalizeErrorCategoryLabel(fallbackCategory);
}

function summarizeErrorMessages(errorMessageCounts, limit = 3) {
  if (!(errorMessageCounts instanceof Map) || errorMessageCounts.size === 0) {
    return "No explicit error message text recorded.";
  }
  const ranked = [...errorMessageCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  return ranked
    .slice(0, limit)
    .map(([message, count]) => `${truncateLabel(message, 190)} (${formatNumber(count, 0)})`)
    .join(" | ");
}

function selectDominantErrorCategory(errorCategoryCounts) {
  if (!(errorCategoryCounts instanceof Map) || errorCategoryCounts.size === 0) {
    return null;
  }
  const ranked = [...errorCategoryCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  return ranked[0][0] || null;
}

function buildErrorCategoryColorMap(errorCategories) {
  const sortedCategories = [...new Set(errorCategories.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const colorMap = new Map();
  sortedCategories.forEach((category, index) => {
    if (index < ERROR_HEATMAP_CATEGORY_PALETTE.length) {
      colorMap.set(category, ERROR_HEATMAP_CATEGORY_PALETTE[index]);
      return;
    }
    const hue = (index * 137) % 360;
    colorMap.set(category, `hsl(${hue} 62% 44%)`);
  });
  return colorMap;
}

function parseRunLabelDate(runLabel) {
  if (!runLabel || typeof runLabel !== "string") {
    return null;
  }

  const matches = [...runLabel.matchAll(/(?:^|[^0-9])(\d{1,2})-(\d{1,2})-(\d{2,4})(?:[^0-9]|$)/g)];
  if (!matches.length) {
    return null;
  }

  // Use the last date-like token in the run label, which usually carries the run date.
  const [, ddRaw, mmRaw, yyRaw] = matches[matches.length - 1];
  const day = Number(ddRaw);
  const month = Number(mmRaw);
  let year = Number(yyRaw);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }
  if (yyRaw.length === 2) {
    year += 2000;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return Date.UTC(year, month - 1, day);
}

function getRunChronologyTimestamp(run, runRecords = []) {
  const candidates = [];
  if (run?.run_start) {
    const runStart = parseIso(run.run_start);
    if (runStart) {
      candidates.push(runStart.valueOf());
    }
  }
  if (run?.run_end) {
    const runEnd = parseIso(run.run_end);
    if (runEnd) {
      candidates.push(runEnd.valueOf());
    }
  }

  runRecords.forEach((record) => {
    const start = parseIso(record.start);
    const end = parseIso(record.end);
    if (start) {
      candidates.push(start.valueOf());
    }
    if (end) {
      candidates.push(end.valueOf());
    }
  });

  const labelDate = parseRunLabelDate(run?.run_label || "");
  if (labelDate !== null) {
    candidates.push(labelDate);
  }

  return candidates.length ? Math.min(...candidates) : Number.POSITIVE_INFINITY;
}

function getRunModeFromRecords(runRecords) {
  const modeSet = new Set(
    runRecords
      .map((record) => normalizeServiceModeValue(record.service_description_mode))
      .filter((mode) => mode !== "unknown"),
  );
  if (!modeSet.size) {
    return "unknown";
  }
  if (modeSet.size > 1) {
    return "mixed";
  }
  return [...modeSet][0];
}

function getRunServiceMode(run, runRecords = []) {
  const explicitMode = normalizeServiceModeValue(run?.service_description_mode);
  if (explicitMode !== "unknown") {
    return explicitMode;
  }
  return getRunModeFromRecords(runRecords);
}

function getRunModeColor(run, runRecords = []) {
  const mode = getRunServiceMode(run, runRecords);
  return SERVICE_MODE_COLOR[mode] || SERVICE_MODE_COLOR.unknown;
}

function sortRunsChronologically(runs, records = []) {
  const recordsByRunId = new Map(runs.map((run) => [run.run_id, []]));
  records.forEach((record) => {
    if (recordsByRunId.has(record.run_id)) {
      recordsByRunId.get(record.run_id).push(record);
    }
  });

  return [...runs].sort((a, b) => {
    const aRecords = recordsByRunId.get(a.run_id) || [];
    const bRecords = recordsByRunId.get(b.run_id) || [];
    const aTs = getRunChronologyTimestamp(a, aRecords);
    const bTs = getRunChronologyTimestamp(b, bRecords);
    if (aTs !== bTs) {
      return aTs - bTs;
    }
    return String(a.run_label || a.run_id).localeCompare(String(b.run_label || b.run_id));
  });
}

function hasExplicitError(record) {
  const raw = record?.error_raw;
  const category = record?.error_category;
  const rawText = raw === null || raw === undefined ? "" : String(raw).trim().toLowerCase();
  const categoryText = category === null || category === undefined ? "" : String(category).trim().toLowerCase();

  const categoryNoErrorValues = new Set([
    "",
    "n/a",
    "none",
    "no results",
    "no comunica results",
  ]);

  const rawNoErrorValues = new Set([
    "",
    "null",
    "-",
    "n/a",
    "none",
    "no results",
    "no comunica results",
    "- (no results)",
    "general: no results",
  ]);

  // Non-error markers are common in this dataset (for example "None" or "No Results").
  const rawLooksNonError = rawNoErrorValues.has(rawText);
  const categoryLooksNonError = categoryNoErrorValues.has(categoryText);

  return !(rawLooksNonError && categoryLooksNonError);
}

function hasPositiveResultSet(record) {
  // Execution success for reporting is strictly a non-empty result set.
  return Number(record?.results_count || 0) > 0;
}

function hasNoExplicitError(record) {
  return !hasExplicitError(record);
}

function getRunControlLabel(runId) {
  if (typeof runId !== "string") {
    return null;
  }
  return CONTROL_RUN_DISPLAY_CONFIG[runId]?.tagLabel || null;
}

function getRunDisplayLabel(runId, runLabel) {
  const controlDisplay = CONTROL_RUN_DISPLAY_CONFIG[runId]?.displayLabel;
  if (controlDisplay) {
    return controlDisplay;
  }
  const mappedRunLabel = mapExperimentFamilyLabel(runLabel || "");
  return mappedRunLabel;
}

function getNoServiceAlgorithmFamily(runId, runLabel) {
  const displayLabel = getRunDisplayLabel(runId, runLabel);
  if (!displayLabel) {
    return null;
  }
  const normalized = String(displayLabel).toUpperCase();
  const matched = NO_SERVICE_ALGORITHM_META.find((item) => {
    if (normalized.startsWith(`${item.key}-`)) {
      return true;
    }
    return normalized === item.key;
  });
  return matched?.key || null;
}

function renderRunControlTag(runId) {
  const controlLabel = getRunControlLabel(runId);
  if (!controlLabel) {
    return "";
  }
  return `<span class="tag control">${escapeHtml(controlLabel)}</span>`;
}

function markExpandableSurfaces() {
  document.querySelectorAll(EXPANDABLE_SURFACE_SELECTOR).forEach((node) => {
    node.classList.add("expandable-surface");
    if (!node.hasAttribute("tabindex")) {
      node.setAttribute("tabindex", "0");
    }
    if (!node.hasAttribute("aria-label")) {
      node.setAttribute("aria-label", "Open in fullscreen");
    }
  });
}

function getFocusViewTitle(node) {
  const directChartTitle = node.matches(".chart-card")
    ? node.querySelector("h3")
    : node.closest(".chart-card")?.querySelector("h3");
  if (directChartTitle?.textContent?.trim()) {
    return directChartTitle.textContent.trim();
  }

  const tableMeta = node.previousElementSibling;
  if (tableMeta?.classList?.contains("table-meta") && tableMeta.textContent.trim()) {
    return tableMeta.textContent.trim();
  }

  const detailTitle = node.closest(".query-detail, .explorer-detail-pane, .panel")?.querySelector("h3, h2");
  if (detailTitle?.textContent?.trim()) {
    return detailTitle.textContent.trim();
  }

  return "Expanded View";
}

function closeFocusView() {
  if (!focusView.isOpen || !focusView.movedNode) {
    return;
  }

  const {
    movedNode,
    placeholder,
    focusBeforeOpen,
  } = focusView;

  if (placeholder?.parentNode) {
    placeholder.parentNode.insertBefore(movedNode, placeholder);
    placeholder.remove();
  } else {
    document.querySelector(".page-shell")?.appendChild(movedNode);
  }

  dom.focusModal.classList.add("hidden");
  dom.focusModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  focusView.isOpen = false;
  focusView.movedNode = null;
  focusView.placeholder = null;
  focusView.focusBeforeOpen = null;

  if (focusBeforeOpen && typeof focusBeforeOpen.focus === "function") {
    focusBeforeOpen.focus({ preventScroll: true });
  }

  window.requestAnimationFrame(() => {
    resizeAllCharts();
  });
  syncUrlDashboardState();
}

function openFocusView(node) {
  if (!node || focusView.isOpen) {
    return;
  }
  if (!node.parentNode) {
    return;
  }

  const placeholder = document.createComment("focus-view-placeholder");
  node.parentNode.insertBefore(placeholder, node);

  focusView.isOpen = true;
  focusView.movedNode = node;
  focusView.placeholder = placeholder;
  focusView.focusBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  dom.focusModalTitle.textContent = getFocusViewTitle(node);
  dom.focusModalContent.appendChild(node);
  dom.focusModal.classList.remove("hidden");
  dom.focusModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  window.requestAnimationFrame(() => {
    resizeAllCharts();
  });

  dom.focusModalClose.focus({ preventScroll: true });
  syncUrlDashboardState();
}

function handleExpandableClick(event) {
  if (focusView.isOpen) {
    const clickedCloseButton = event.target.closest("#focusModalClose");
    if (clickedCloseButton || event.target === dom.focusModal) {
      closeFocusView();
    }
    return;
  }

  if (event.defaultPrevented || event.button !== 0) {
    return;
  }

  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed) {
    return;
  }

  if (event.target.closest(INTERACTIVE_BLOCK_SELECTOR)) {
    return;
  }

  const surface = event.target.closest(".expandable-surface");
  if (!surface || surface.closest("#focusModal")) {
    return;
  }

  event.preventDefault();
  openFocusView(surface);
}

function handleExpandableKeydown(event) {
  if (event.key === "Escape" && focusView.isOpen) {
    event.preventDefault();
    closeFocusView();
    return;
  }

  if (focusView.isOpen) {
    return;
  }

  const active = document.activeElement;
  const isSurfaceFocused = active instanceof HTMLElement && active.classList.contains("expandable-surface");
  if (!isSurfaceFocused) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openFocusView(active);
  }
}

function syncExplorerListViewportHeights() {
  // In stacked/mobile layout, let CSS and content determine natural heights.
  if (window.matchMedia("(max-width: 980px)").matches) {
    [dom.queryList, dom.experimentList].forEach((list) => {
      if (!(list instanceof HTMLElement)) {
        return;
      }
      list.style.height = "";
      list.style.maxHeight = "";
    });
    return;
  }

  const bottomGutter = 8;
  const minListHeight = 180;
  const lists = [dom.queryList, dom.experimentList];

  lists.forEach((list) => {
    if (!(list instanceof HTMLElement)) {
      return;
    }

    // Skip hidden list panes; keep their previous value as fallback.
    if (list.offsetParent === null) {
      return;
    }

    const grid = list.closest(".explorer-grid");
    const detailPane = grid?.querySelector(".explorer-detail-pane");
    const listRect = list.getBoundingClientRect();

    let available = null;
    if (detailPane) {
      // In query mode, bound the query list by the first table-collapsible block.
      // This keeps the list naturally shorter and aligned to that content section.
      if (list.id === "queryList") {
        const anchor = detailPane.querySelector(".table-collapsible");
        if (anchor instanceof HTMLElement) {
          const anchorRect = anchor.getBoundingClientRect();
          available = Math.floor(anchorRect.bottom - listRect.top);
        }
      }

      if (!Number.isFinite(available) || available <= 0) {
        available = Math.floor(detailPane.getBoundingClientRect().height);
      }
    }

    if (!Number.isFinite(available) || available <= 0) {
      const viewportHeight = Math.floor(window.visualViewport?.height || window.innerHeight || 0);
      if (!viewportHeight) {
        return;
      }
      available = Math.floor(viewportHeight - listRect.top - 14);
    }

    const height = Math.max(minListHeight, Math.floor(available - bottomGutter));
    list.style.height = `${height}px`;
    list.style.maxHeight = `${height}px`;
  });
}

function scheduleExplorerListHeightSync() {
  window.requestAnimationFrame(syncExplorerListViewportHeights);
}

function variantRank(variantType) {
  if (variantType === "original") {
    return 0;
  }
  if (variantType === "no-service") {
    return 1;
  }
  if (variantType === "no-service-broken") {
    return 2;
  }
  return 3;
}

function variantLabel(variantType) {
  if (variantType === "original") {
    return "Service version (original)";
  }
  if (variantType === "no-service") {
    return "No-service version";
  }
  if (variantType === "no-service-broken") {
    return "No-service broken variant";
  }
  return variantType;
}

function truncateLabel(text, maxLength = 22) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 2))}..`;
}

function normalizeYearToken(yearToken) {
  if (!yearToken) {
    return null;
  }
  const year = Number(yearToken);
  if (!Number.isFinite(year)) {
    return null;
  }
  if (String(yearToken).length === 2) {
    return String(2000 + year);
  }
  return String(year);
}

function abbreviateRunLabelForAxis(label) {
  if (!label) {
    return "";
  }
  const source = String(label);

  const mappedPatterns = [
    { key: "NOMETA-ASK", short: "NMA" },
    { key: "NOMETA-COUNT", short: "NMC" },
    { key: "VOID-TRIPLE", short: "VT" },
    { key: "VOID-BLOCK", short: "VB" },
  ];
  for (const pattern of mappedPatterns) {
    const mappedMatch = source.match(new RegExp(`^${pattern.key}(-NRL)?-(\\d{1,2})-(\\d{1,2})-(\\d{2,4})$`));
    if (mappedMatch) {
      const nrlFlag = mappedMatch[1] ? "-N" : "";
      const day = String(mappedMatch[2]).padStart(2, "0");
      const month = String(mappedMatch[3]).padStart(2, "0");
      const year = normalizeYearToken(mappedMatch[4]) || mappedMatch[4];
      return `${pattern.short}${nrlFlag} ${year}-${month}-${day}`;
    }
  }

  const controlComunica = source.match(/^SERVICE(?:-CONTROL)?-COMUNICA-(\d{4})-(\d{2})-(\d{2})$/);
  if (controlComunica) {
    return `SC-C ${controlComunica[1]}-${controlComunica[2]}-${controlComunica[3]}`;
  }
  const controlEndpoint = source.match(/^SERVICE(?:-CONTROL)?-MANUAL-ENDPOINT-(\d{4})-(\d{2})-(\d{2})$/);
  if (controlEndpoint) {
    return `SC-E ${controlEndpoint[1]}-${controlEndpoint[2]}-${controlEndpoint[3]}`;
  }

  return truncateLabel(source, 20);
}

function abbreviateQueryLabelForHeatmap(label) {
  if (!label) {
    return "";
  }
  const source = String(label).trim();
  if (!source) {
    return "";
  }

  const compactSource = source.replace(/^biosodafrontend#/i, "").trim();
  const numericLead = compactSource.match(/^(\d+[a-z]?)/i);
  if (numericLead) {
    return numericLead[1].toUpperCase();
  }

  const underscored = compactSource.split("_").filter(Boolean);
  if (underscored.length >= 2) {
    return `${underscored[0].slice(0, 4)}.${underscored[1].slice(0, 4)}`.toUpperCase();
  }
  if (underscored.length === 1 && underscored[0].length > 0) {
    return truncateLabel(underscored[0], 7).toUpperCase();
  }

  const hyphenated = compactSource.split("-").filter(Boolean);
  if (hyphenated.length >= 2) {
    return `${hyphenated[0].slice(0, 3)}.${hyphenated[1].slice(0, 3)}`.toUpperCase();
  }

  return truncateLabel(compactSource.replace(/\s+/g, ""), 7).toUpperCase();
}

const chartRegistry = new Map();

function setChartCardTitle(chartEl, title) {
  if (!(chartEl instanceof HTMLElement) || !title) {
    return;
  }
  const heading = chartEl.closest(".chart-card")?.querySelector("h3");
  if (heading) {
    heading.innerHTML = title;
  }
}

function aggregateHttp(values, mode) {
  if (!values.length) {
    return null;
  }
  if (mode === "mean") {
    return mean(values);
  }
  if (mode === "max") {
    return Math.max(...values);
  }
  return median(values);
}

function getMonthKey(isoValue) {
  const date = parseIso(isoValue);
  if (!date) {
    return null;
  }
  return date.toISOString().slice(0, 7);
}

function monthLabel(monthKey) {
  if (!monthKey) {
    return "Unknown";
  }
  const [year, month] = monthKey.split("-");
  return `${month}-${year}`;
}

function getRecordMonthKey(record) {
  return getMonthKey(record.start) || getMonthKey(record.end);
}

function inferTemporalGroupFromDate(date) {
  if (!date) {
    return null;
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  if (year === 2025 && month >= 3 && month <= 5) {
    return "spring-2025";
  }
  if (year === 2025 && month >= 9 && month <= 12) {
    return "fall-2025";
  }
  if (year === 2026 && month >= 1 && month <= 2) {
    return "winter-2026";
  }
  if (year === 2026 && month >= 3 && month <= 6) {
    return "spring-2026";
  }
  return null;
}

function getRecordTemporalGroupKey(record) {
  const runId = record?.run_id;
  if (runId && RUN_TEMPORAL_GROUP_OVERRIDES[runId]) {
    return RUN_TEMPORAL_GROUP_OVERRIDES[runId];
  }
  const start = parseIso(record?.start);
  const end = parseIso(record?.end);
  return inferTemporalGroupFromDate(start) || inferTemporalGroupFromDate(end) || "unassigned";
}

function temporalGroupLabel(groupKey) {
  return TEMPORAL_GROUP_META[groupKey]?.label || "Unassigned";
}

function temporalGroupSortValue(groupKey) {
  if (TEMPORAL_GROUP_META[groupKey]) {
    return TEMPORAL_GROUP_META[groupKey].order;
  }
  return Number.MAX_SAFE_INTEGER;
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && !Number.isNaN(Number(value));
}

function clearChartElement(chartEl) {
  if (!(chartEl instanceof HTMLElement)) {
    return;
  }
  const existingChart = chartRegistry.get(chartEl.id);
  if (existingChart) {
    existingChart.destroy();
    chartRegistry.delete(chartEl.id);
  }
  chartEl.innerHTML = "";
}

function resizeAllCharts() {
  chartRegistry.forEach((chart) => {
    if (chart && typeof chart.resize === "function") {
      chart.resize();
    }
  });
}

function buildChartCanvas(chartEl) {
  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  chartEl.appendChild(canvas);
  return canvas;
}

function chartLabelLimit(labelCount) {
  if (labelCount > 40) {
    return 11;
  }
  if (labelCount > 20) {
    return 14;
  }
  return 20;
}

function getChartJs() {
  return window.Chart || null;
}

function chartBaseOptions(xLabel, yLabel, labelsFull) {
  const tickLimit = chartLabelLimit(labelsFull.length);
  const axisLabels = labelsFull.map((label) => abbreviateRunLabelForAxis(label));
  const denseLabels = labelsFull.length > 12;
  const tickAngle = 45;
  const tickMax = labelsFull.length > 30 ? 12 : labelsFull.length > 16 ? 14 : 18;

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: "index",
      intersect: false,
      axis: "x",
    },
    animation: {
      duration: 320,
      easing: "easeOutQuart",
    },
    layout: {
      padding: { top: 4, right: 8, bottom: 0, left: 0 },
    },
    plugins: {
      legend: {
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          color: "#264f70",
          font: { size: 10 },
        },
      },
      tooltip: {
        enabled: true,
        backgroundColor: "#f8fbff",
        titleColor: "#1d2a37",
        bodyColor: "#1d2a37",
        borderColor: "#80b7df",
        borderWidth: 1,
        titleFont: { family: "Source Sans 3, Segoe UI, sans-serif", size: 12, weight: "700" },
        bodyFont: { family: "Source Sans 3, Segoe UI, sans-serif", size: 12 },
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: xLabel,
          color: "#345a79",
          font: { size: 12, weight: "600" },
        },
        grid: { display: false },
        ticks: {
          color: "#4d6980",
          font: { size: denseLabels ? 9 : 10 },
          maxRotation: tickAngle,
          minRotation: tickAngle,
          callback: (_, index) => truncateLabel(axisLabels[index], tickLimit),
          autoSkip: denseLabels,
          maxTicksLimit: tickMax,
        },
      },
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: yLabel,
          color: "#345a79",
          font: { size: 12, weight: "600" },
        },
        ticks: {
          color: "#4d6980",
          callback: (value) => formatAxisNumber(Number(value)),
        },
        grid: {
          color: "#e7eff7",
          drawBorder: false,
        },
      },
    },
  };
}

function renderNoDataPlot(chartEl, message, xLabel, yLabel) {
  void xLabel;
  void yLabel;
  if (!(chartEl instanceof HTMLElement)) {
    return;
  }
  chartEl.innerHTML = `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function renderBarChart(svg, data, valueLabelFormatter, options = {}) {
  const chartEl = svg;
  const yLabel = options.yLabel || "Value";
  const xLabel = options.xLabel || "Category";

  clearChartElement(chartEl);

  if (!data.length) {
    renderNoDataPlot(chartEl, "No data for current selection", xLabel, yLabel);
    return;
  }

  const numericValues = data.map((item) => item.value).filter((value) => hasNumericValue(value)).map(Number);

  if (!numericValues.length) {
    renderNoDataPlot(chartEl, "No numeric values for current selection", xLabel, yLabel);
    return;
  }

  const ChartJs = getChartJs();
  if (!ChartJs) {
    chartEl.innerHTML = "<div class='chart-empty'>Interactive chart library not available.</div>";
    return;
  }

  const canvas = buildChartCanvas(chartEl);
  const xValues = data.map((item) => item.label);
  const rawValues = data.map((item) => (hasNumericValue(item.value) ? Number(item.value) : 0));
  const missingFlags = data.map((item) => !hasNumericValue(item.value));
  const valueText = rawValues.map((value, index) => (missingFlags[index] ? "null" : valueLabelFormatter(value)));
  const barColors = data.map((item, index) => (missingFlags[index] ? "#c8d3de" : (item.color || CHART_COLORS.primary)));
  const serviceModes = data.map((item) => normalizeServiceModeValue(item.service_mode));
  const hasServiceMetadata = data.some((item) => item.service_mode !== undefined && item.service_mode !== null);
  const runIds = data.map((item) => (
    item.run_id ? getRunDisplayLabel(item.run_id, item.run_label || item.run_id) : null
  ));

  const chartData = {
    labels: xValues,
    datasets: [{
      label: yLabel,
      data: rawValues,
      backgroundColor: barColors,
      borderColor: barColors.map((color) => `${color}`),
      borderWidth: 1,
      borderRadius: 4,
      maxBarThickness: 38,
      metaValueText: valueText,
      metaMissingFlags: missingFlags,
    }],
  };

  const chartOptions = chartBaseOptions(xLabel, yLabel, xValues);
  chartOptions.plugins.legend.display = false;
  chartOptions.plugins.tooltip.callbacks = {
    title: (items) => {
      const index = items[0]?.dataIndex ?? 0;
      return `${xLabel}: ${xValues[index]}`;
    },
    label: (context) => `${yLabel}: ${valueText[context.dataIndex]}`,
    afterLabel: (context) => {
      const idx = context.dataIndex;
      const lines = [];
      if (runIds[idx]) {
        lines.push(`Run ID: ${runIds[idx]}`);
      }
      if (hasServiceMetadata) {
        lines.push(`Service mode: ${formatServiceModeBadge(serviceModes[idx])}`);
      }
      lines.push(`Missing value: ${missingFlags[idx] ? "Yes" : "No"}`);
      return lines;
    },
  };

  const instance = new ChartJs(canvas.getContext("2d"), {
    type: "bar",
    data: chartData,
    options: chartOptions,
  });
  chartRegistry.set(chartEl.id, instance);
}

function renderGroupedBarChart(svg, groups, series, options = {}) {
  const chartEl = svg;
  const yLabel = options.yLabel || "Value";
  const xLabel = options.xLabel || "Category";

  clearChartElement(chartEl);

  if (!groups.length || !series.length) {
    renderNoDataPlot(chartEl, "No data for current selection", xLabel, yLabel);
    return;
  }

  const values = groups
    .flatMap((group) => series.map((run) => group.values.get(run.run_id)))
    .filter((value) => hasNumericValue(value))
    .map((value) => Number(value));
  if (!values.length) {
    renderNoDataPlot(chartEl, "No numeric values for current selection", xLabel, yLabel);
    return;
  }

  const ChartJs = getChartJs();
  if (!ChartJs) {
    chartEl.innerHTML = "<div class='chart-empty'>Interactive chart library not available.</div>";
    return;
  }

  const canvas = buildChartCanvas(chartEl);
  const xValues = groups.map((group) => group.label);
  const valueFormatter = typeof options.valueFormatter === "function"
    ? options.valueFormatter
    : (value) => formatNumber(value, 0);
  const barColorResolver = typeof options.getBarColor === "function" ? options.getBarColor : null;
  const tooltipLinesResolver = typeof options.getTooltipLines === "function" ? options.getTooltipLines : null;

  const datasets = series.map((run, runIndex) => {
    const runLabel = getRunDisplayLabel(run.run_id, run.run_label);
    const runMode = getRunServiceMode(run);
    const yRaw = groups.map((group) => {
      const value = group.values.get(run.run_id);
      return hasNumericValue(value) ? Number(value) : 0;
    });
    const missingFlags = groups.map((group) => !hasNumericValue(group.values.get(run.run_id)));
    const yDisplay = yRaw.map((value, rowIndex) => (
      missingFlags[rowIndex]
        ? "null"
        : valueFormatter(value, { group: groups[rowIndex], run, groupIndex: rowIndex, runIndex })
    ));
    const baseColor = getRunModeColor(run);
    const pointColors = yRaw.map((value, rowIndex) => {
      if (missingFlags[rowIndex]) {
        return "#d4dde6";
      }
      if (barColorResolver) {
        const resolvedColor = barColorResolver({
          group: groups[rowIndex],
          run,
          value,
          missing: false,
          groupIndex: rowIndex,
          runIndex,
        });
        if (typeof resolvedColor === "string" && resolvedColor.trim()) {
          return resolvedColor;
        }
      }
      return baseColor;
    });
    return {
      label: truncateLabel(runLabel, 30),
      fullRunLabel: runLabel,
      runIdDisplay: getRunDisplayLabel(run.run_id, run.run_label || run.run_id),
      runMode,
      data: yRaw,
      metaValueText: yDisplay,
      metaMissingFlags: missingFlags,
      backgroundColor: pointColors,
      borderColor: pointColors.map((color, rowIndex) => (missingFlags[rowIndex] ? "#c4cfdb" : color)),
      borderWidth: 1,
      borderRadius: 3,
      maxBarThickness: 24,
    };
  });

  const chartOptions = chartBaseOptions(xLabel, yLabel, xValues);
  chartOptions.plugins.legend.display = options.legendDisplay === undefined ? true : Boolean(options.legendDisplay);
  chartOptions.plugins.tooltip.callbacks = {
    title: (items) => {
      const index = items[0]?.dataIndex ?? 0;
      return `${xLabel}: ${xValues[index]}`;
    },
    label: (context) => {
      const dataset = datasets[context.datasetIndex];
      const idx = context.dataIndex;
      return `${dataset.fullRunLabel}: ${dataset.metaValueText[idx]}`;
    },
    afterLabel: (context) => {
      const dataset = datasets[context.datasetIndex];
      const idx = context.dataIndex;
      const missingText = `Missing value: ${dataset.metaMissingFlags[idx] ? "Yes" : "No"}`;
      const lines = [`Run ID: ${dataset.runIdDisplay}`, `Service mode: ${formatServiceModeBadge(dataset.runMode)}`, missingText];
      if (tooltipLinesResolver) {
        const extraLines = tooltipLinesResolver({
          group: groups[idx],
          run: series[context.datasetIndex],
          value: dataset.data[idx],
          missing: dataset.metaMissingFlags[idx],
          groupIndex: idx,
          runIndex: context.datasetIndex,
        });
        if (Array.isArray(extraLines) && extraLines.length) {
          lines.push(...extraLines.filter((line) => typeof line === "string" && line.trim()));
        }
      }
      return lines;
    },
  };

  const instance = new ChartJs(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: xValues,
      datasets,
    },
    options: chartOptions,
  });
  chartRegistry.set(chartEl.id, instance);
}

function renderNoServiceAlgorithmEfficacyChart(chartEl, algorithmRows, periodLabel = null) {
  clearChartElement(chartEl);
  const xLabel = "NO-SERVICE algorithm family";
  const yLabel = "Rate (%)";

  if (!(chartEl instanceof HTMLElement)) {
    return;
  }
  if (!Array.isArray(algorithmRows) || !algorithmRows.length) {
    renderNoDataPlot(chartEl, "No NO-SERVICE algorithm data for current selection", xLabel, yLabel);
    return;
  }

  const ChartJs = getChartJs();
  if (!ChartJs) {
    chartEl.innerHTML = "<div class='chart-empty'>Interactive chart library not available.</div>";
    return;
  }

  const labels = algorithmRows.map((row) => row.label);
  const errorFreeRates = algorithmRows.map((row) => row.errorFreeRate * 100);
  const positiveRates = algorithmRows.map((row) => row.positiveRate * 100);
  const medianHttpSuccess = algorithmRows.map((row) => row.medianHttpSuccess);
  const maxRate = Math.max(...errorFreeRates, ...positiveRates, 0);
  const yMax = Math.max(10, Math.min(100, Math.ceil((maxRate + 2) / 5) * 5));

  const canvas = buildChartCanvas(chartEl);
  const chartOptions = chartBaseOptions(xLabel, yLabel, labels);
  chartOptions.scales.y.max = yMax;
  chartOptions.scales.y.suggestedMin = 0;
  chartOptions.scales.y.ticks.callback = (value) => `${Number(value).toFixed(0)}%`;
  chartOptions.scales.y1 = {
    beginAtZero: true,
    position: "right",
    title: {
      display: true,
      text: "Median HTTP requests for successful queries (count)",
      color: "#345a79",
      font: { size: 12, weight: "600" },
    },
    ticks: {
      color: "#4d6980",
      callback: (value) => formatAxisNumber(Number(value)),
    },
    grid: {
      drawOnChartArea: false,
    },
  };
  chartOptions.plugins.legend.display = true;
  chartOptions.interaction = {
    mode: "index",
    intersect: false,
    axis: "x",
  };
  chartOptions.plugins.tooltip.callbacks = {
    title: (items) => {
      const idx = items[0]?.dataIndex ?? 0;
      return `Algorithm: ${labels[idx]}`;
    },
    label: (context) => {
      const label = context.dataset.label || "Value";
      const value = context.dataset.yAxisID === "y1"
        ? `${formatNumber(Number(context.raw), 1)}`
        : `${Number(context.raw).toFixed(1)}%`;
      if (label.includes("Median HTTP")) {
        return `${label}: ${value}`;
      }
      return `${label}: ${value}`;
    },
    afterBody: (items) => {
      const idx = items[0]?.dataIndex ?? 0;
      const row = algorithmRows[idx];
      const lines = [
        `Attempts: ${formatNumber(row.attempts, 0)}`,
        `>0 results: ${formatNumber(row.positiveCount, 0)}/${formatNumber(row.attempts, 0)}`,
        `=0 results (no explicit error): ${formatNumber(row.zeroNoErrorCount, 0)}/${formatNumber(row.attempts, 0)}`,
        `Explicit errors: ${formatNumber(row.errorCount, 0)}/${formatNumber(row.attempts, 0)}`,
        `No explicit errors: ${formatNumber(row.errorFreeCount, 0)}`,
        `Successful HTTP sample size: ${formatNumber(row.successHttpCount, 0)}`,
      ];
      if (periodLabel) {
        lines.push(`Period: ${periodLabel}`);
      }
      return lines;
    },
  };

  const instance = new ChartJs(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "No explicit error rate",
          data: errorFreeRates,
          backgroundColor: "rgba(0, 114, 178, 0.78)",
          borderColor: "#0072B2",
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 42,
          order: 2,
        },
        {
          label: "Result set > 0 rate",
          data: positiveRates,
          backgroundColor: "rgba(230, 159, 0, 0.78)",
          borderColor: "#E69F00",
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 42,
          order: 2,
        },
        {
          type: "line",
          label: "Median HTTP requests (successful queries)",
          data: medianHttpSuccess,
          yAxisID: "y1",
          borderColor: "#332288",
          backgroundColor: "#332288",
          pointBackgroundColor: "#332288",
          pointBorderColor: "#f8fbff",
          pointBorderWidth: 1,
          pointRadius: 3.3,
          pointHoverRadius: 4.5,
          tension: 0.24,
          order: 1,
        },
      ],
    },
    options: chartOptions,
  });
  chartRegistry.set(chartEl.id, instance);
}

function renderEndpointOutcomeChart(chartEl, endpointMeta, runRows, periodLabel = null) {
  clearChartElement(chartEl);
  const xLabel = "Experiment Run";
  const yLabel = "Query Attempts (count)";

  if (!(chartEl instanceof HTMLElement)) {
    return;
  }
  if (!endpointMeta) {
    renderNoDataPlot(chartEl, "No endpoint selected", xLabel, yLabel);
    return;
  }
  if (!Array.isArray(runRows) || !runRows.length) {
    renderNoDataPlot(chartEl, `No data for ${endpointMeta.label} in current scope`, xLabel, yLabel);
    return;
  }

  const ChartJs = getChartJs();
  if (!ChartJs) {
    chartEl.innerHTML = "<div class='chart-empty'>Interactive chart library not available.</div>";
    return;
  }

  const labels = runRows.map((row) => row.label);
  const valuesPositive = runRows.map((row) => row.positiveCount);
  const valuesZeroNoError = runRows.map((row) => row.zeroNoErrorCount);
  const valuesError = runRows.map((row) => row.errorCount);
  const rates = runRows.map((row) => row.executionSuccessRate * 100);

  const canvas = buildChartCanvas(chartEl);
  const chartOptions = chartBaseOptions(xLabel, yLabel, labels);
  chartOptions.scales.y.stacked = true;
  chartOptions.scales.x.stacked = true;
  chartOptions.scales.y1 = {
    beginAtZero: true,
    position: "right",
    max: 100,
    title: {
      display: true,
      text: "Execution Success Rate (%)",
      color: "#345a79",
      font: { size: 12, weight: "600" },
    },
    ticks: {
      color: "#4d6980",
      callback: (value) => `${Number(value).toFixed(0)}%`,
    },
    grid: {
      drawOnChartArea: false,
    },
  };
  chartOptions.plugins.legend.display = true;
  chartOptions.plugins.legend.position = "top";
  chartOptions.plugins.tooltip.callbacks = {
    title: (items) => {
      const idx = items[0]?.dataIndex ?? 0;
      return `${xLabel}: ${labels[idx]}`;
    },
    label: (context) => {
      const label = context.dataset.label || "Value";
      if (context.dataset.yAxisID === "y1") {
        return `${label}: ${Number(context.raw).toFixed(1)}%`;
      }
      return `${label}: ${formatNumber(Number(context.raw), 0)}`;
    },
    afterBody: (items) => {
      const idx = items[0]?.dataIndex ?? 0;
      const row = runRows[idx];
      const lines = [
        `Run ID: ${row.runIdDisplay}`,
        `Endpoint: ${endpointMeta.label} (${endpointMeta.endpointUrl})`,
        `Execution success (>0): ${formatNumber(row.positiveCount, 0)}/${formatNumber(row.totalCount, 0)}`,
        `=0 and no explicit error: ${formatNumber(row.zeroNoErrorCount, 0)}/${formatNumber(row.totalCount, 0)}`,
        `Explicit error: ${formatNumber(row.errorCount, 0)}/${formatNumber(row.totalCount, 0)}`,
      ];
      if (periodLabel) {
        lines.push(`Period: ${periodLabel}`);
      }
      return lines;
    },
  };

  const instance = new ChartJs(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: ">0 results",
          data: valuesPositive,
          backgroundColor: "#009E73",
          borderColor: "#009E73",
          borderWidth: 1,
          borderRadius: 3,
          stack: "outcomes",
        },
        {
          label: "=0, no explicit error",
          data: valuesZeroNoError,
          backgroundColor: "#56B4E9",
          borderColor: "#56B4E9",
          borderWidth: 1,
          borderRadius: 3,
          stack: "outcomes",
        },
        {
          label: "Explicit error",
          data: valuesError,
          backgroundColor: "#D55E00",
          borderColor: "#D55E00",
          borderWidth: 1,
          borderRadius: 3,
          stack: "outcomes",
        },
        {
          type: "line",
          label: "Execution success rate",
          data: rates,
          yAxisID: "y1",
          borderColor: "#332288",
          backgroundColor: "#332288",
          pointBackgroundColor: "#332288",
          pointBorderColor: "#f8fbff",
          pointBorderWidth: 1,
          pointRadius: 3.2,
          pointHoverRadius: 4.4,
          tension: 0.22,
        },
      ],
    },
    options: chartOptions,
  });
  chartRegistry.set(chartEl.id, instance);
}

function renderQueryOutcomeHeatmap(chartEl, groups, series) {
  clearChartElement(chartEl);
  const xLabel = "Query";
  const yLabel = "Experiment Run";

  if (!groups.length || !series.length) {
    renderNoDataPlot(chartEl, "No data for current selection", xLabel, yLabel);
    return;
  }

  const compactRunColSize = 64;
  const compactHeaderSize = 44;
  const queryColumnWidth = groups.length
    ? `calc((100% - var(--heatmap-run-col-size)) / ${groups.length})`
    : "auto";
  const columnDefs = `
    <col class="run-label-col">
    ${groups.map(() => `<col class="query-heat-col" style="width:${queryColumnWidth};">`).join("")}
  `;

  const headerCells = groups.map((group) => {
    const consistencyLabel = group.consistencyState === "same"
      ? "Same non-error raw result count across runs"
      : group.consistencyState === "different"
        ? "Different non-error raw result counts across runs"
        : "Insufficient non-error data for cross-run comparison";
    const headerTitle = [`Query: ${group.label}`, `Cross-run consistency: ${consistencyLabel}`].join("\n");
    return `
      <th scope="col" class="query-col-head" title="${escapeHtmlAttr(headerTitle)}">
        <div class="query-col-head-text">
          <span class="heatmap-label-compact">${escapeHtml(abbreviateQueryLabelForHeatmap(group.label))}</span>
          <span class="heatmap-label-full">${escapeHtml(truncateLabel(group.label, 32))}</span>
        </div>
      </th>
    `;
  }).join("");

  const bodyRows = series.map((run) => {
    const runLabel = getRunDisplayLabel(run.run_id, run.run_label);
    const cells = groups.map((group) => {
      const value = group.values.get(run.run_id);
      const rawCount = group.rawValues.get(run.run_id);
      const cellMeta = group.cellMeta.get(run.run_id) || {
        attempts: 0,
        outcomeState: "missing",
        outcomeLabel: "Missing",
        hasError: false,
        errorCategories: [],
      };
      const isMissing = !hasNumericValue(value);
      const consistencyState = group.consistencyState;
      const isDifferentAcrossRuns = consistencyState === "different" && !isMissing && !cellMeta.hasError;
      const consistencyLabel = consistencyState === "same"
        ? "Same non-error raw result count across runs"
        : consistencyState === "different"
          ? "Different non-error raw result counts across runs"
          : "Insufficient non-error data for cross-run comparison";
      const cellTitle = [
        `Query: ${group.label}`,
        `Run: ${runLabel}`,
        `Outcome: ${cellMeta.outcomeLabel}`,
        `Raw result count: ${formatNullableNumber(rawCount, 0)}`,
        `Attempts represented: ${formatNumber(cellMeta.attempts, 0)}`,
        `Error categories: ${cellMeta.errorCategories.length ? cellMeta.errorCategories.join("; ") : "None"}`,
        `Cross-run consistency: ${consistencyLabel}`,
      ].join("\n");

      const stateClass = cellMeta.outcomeState === "error"
        ? "outcome-error"
        : cellMeta.outcomeState === "zero"
          ? "outcome-zero"
          : cellMeta.outcomeState === "positive"
            ? "outcome-positive"
            : "outcome-missing";
      const varianceIcon = isDifferentAcrossRuns ? "<span class=\"variance-icon\" aria-label=\"Non-error raw result counts vary across runs\" title=\"Non-error raw result counts vary across runs\">≠</span>" : "";
      return `
        <td
          class="heat-cell ${stateClass}"
          data-outcome="${escapeHtmlAttr(cellMeta.outcomeState)}"
          data-has-variance="${isDifferentAcrossRuns ? "true" : "false"}"
          data-tooltip-query="${escapeHtmlAttr(group.label)}"
          data-tooltip-run="${escapeHtmlAttr(runLabel)}"
          data-tooltip-outcome="${escapeHtmlAttr(cellMeta.outcomeLabel)}"
          data-tooltip-results="${escapeHtmlAttr(formatNullableNumber(rawCount, 0))}"
          data-tooltip-errors="${escapeHtmlAttr(cellMeta.errorCategories.length ? cellMeta.errorCategories.join("; ") : "None")}"
          data-tooltip-details-title="Consistency"
          data-tooltip-details="${escapeHtmlAttr(consistencyLabel)}"
          data-tooltip-consistency="${escapeHtmlAttr(consistencyLabel)}"
          aria-label="${escapeHtmlAttr(cellTitle)}"
        >
          ${varianceIcon}
        </td>
      `;
    }).join("");

    const runLabelShort = truncateLabel(abbreviateRunLabelForAxis(runLabel), 11);
    return `
      <tr>
        <th scope="row" class="run-row-head" title="${escapeHtmlAttr(runLabel)}">
          <span class="heatmap-label-compact">${escapeHtml(runLabelShort)}</span>
          <span class="heatmap-label-full">${escapeHtml(truncateLabel(runLabel, 38))}</span>
        </th>
        ${cells}
      </tr>
    `;
  }).join("");

  chartEl.innerHTML = `
    <div
      class="outcome-heatmap-wrap"
      style="--heatmap-run-col-size:${compactRunColSize}px; --heatmap-header-size:${compactHeaderSize}px;"
      role="img"
      aria-label="Heatmap of query outcomes by run"
    >
      <table class="outcome-heatmap-table">
        <colgroup>${columnDefs}</colgroup>
        <thead>
          <tr>
            <th scope="col" class="run-col-head">
              <span class="heatmap-label-compact">Run \\ Query</span>
              <span class="heatmap-label-full">${escapeHtml(yLabel)} \\ ${escapeHtml(xLabel)}</span>
            </th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>
    <div class="outcome-heatmap-tooltip hidden" role="tooltip"></div>
    <div class="outcome-heatmap-legend" aria-label="Heatmap legend">
      <span class="legend-item heatmap-legend-item" data-highlight-key="state:positive"><span class="legend-swatch swatch-positive"></span>Result count &gt; 0</span>
      <span class="legend-item heatmap-legend-item" data-highlight-key="state:zero"><span class="legend-swatch swatch-zero"></span>Result count = 0</span>
      <span class="legend-item heatmap-legend-item" data-highlight-key="state:error"><span class="legend-swatch swatch-error"></span>Explicit error encountered</span>
      <span class="legend-item heatmap-legend-item" data-highlight-key="state:missing"><span class="legend-swatch swatch-missing"></span>Missing</span>
      <span class="legend-item heatmap-legend-item" data-highlight-key="variance"><span class="legend-badge">≠</span>Non-error raw result count differs across runs for that query</span>
    </div>
  `;
}

function renderQueryErrorTypeHeatmap(chartEl, groups, series, errorCategoryTotals, errorCategoryMessageTotals) {
  clearChartElement(chartEl);
  const xLabel = "Query";
  const yLabel = "Experiment Run";

  if (!groups.length || !series.length) {
    renderNoDataPlot(chartEl, "No data for current selection", xLabel, yLabel);
    return;
  }

  const compactRunColSize = 64;
  const compactHeaderSize = 44;
  const queryColumnWidth = groups.length
    ? `calc((100% - var(--heatmap-run-col-size)) / ${groups.length})`
    : "auto";
  const columnDefs = `
    <col class="run-label-col">
    ${groups.map(() => `<col class="query-heat-col" style="width:${queryColumnWidth};">`).join("")}
  `;

  const observedErrorCategories = [...errorCategoryTotals.keys()];
  const errorColorMap = buildErrorCategoryColorMap(observedErrorCategories);

  const headerCells = groups.map((group) => `
    <th scope="col" class="query-col-head" title="${escapeHtmlAttr(`Query: ${group.label}`)}">
      <div class="query-col-head-text">
        <span class="heatmap-label-compact">${escapeHtml(abbreviateQueryLabelForHeatmap(group.label))}</span>
        <span class="heatmap-label-full">${escapeHtml(truncateLabel(group.label, 32))}</span>
      </div>
    </th>
  `).join("");

  const bodyRows = series.map((run) => {
    const runLabel = getRunDisplayLabel(run.run_id, run.run_label);
    const cells = groups.map((group) => {
      const cellMeta = group.cellMeta.get(run.run_id) || {
        attempts: 0,
        state: "missing",
        outcomeLabel: "Missing",
        dominantErrorCategory: null,
        errorCategories: [],
        errorMessages: [],
        rawResultCount: null,
      };
      const cellColor = cellMeta.state === "error"
        ? (errorColorMap.get(cellMeta.dominantErrorCategory) || ERROR_HEATMAP_BASE_COLORS.fallbackError)
        : cellMeta.state === "no-error"
          ? ERROR_HEATMAP_BASE_COLORS.noError
          : ERROR_HEATMAP_BASE_COLORS.missing;
      const detailText = cellMeta.state === "error"
        ? `Error message text: ${cellMeta.errorMessages.length ? cellMeta.errorMessages.map((message) => truncateLabel(message, 180)).join(" | ") : "No explicit error message text recorded."}`
        : cellMeta.state === "no-error"
          ? "No explicit error encountered (includes 0 and >0 results)."
          : "Missing query-run record for current scope.";

      const cellTitle = [
        `Query: ${group.label}`,
        `Run: ${runLabel}`,
        `Outcome: ${cellMeta.outcomeLabel}`,
        `Dominant explicit error: ${cellMeta.dominantErrorCategory || "None"}`,
        `Error messages: ${cellMeta.errorMessages.length ? cellMeta.errorMessages.join(" ; ") : "None"}`,
        `Raw result count: ${formatNullableNumber(cellMeta.rawResultCount, 0)}`,
        `Attempts represented: ${formatNumber(cellMeta.attempts, 0)}`,
        `Explicit error groups observed: ${cellMeta.errorCategories.length ? cellMeta.errorCategories.join("; ") : "None"}`,
      ].join("\n");

      return `
        <td
          class="heat-cell heat-cell-dynamic"
          style="background:${escapeHtmlAttr(cellColor)};"
          data-outcome="${escapeHtmlAttr(cellMeta.state)}"
          data-error-category="${escapeHtmlAttr(cellMeta.dominantErrorCategory || "")}"
          data-tooltip-query="${escapeHtmlAttr(group.label)}"
          data-tooltip-run="${escapeHtmlAttr(runLabel)}"
          data-tooltip-outcome="${escapeHtmlAttr(cellMeta.outcomeLabel)}"
          data-tooltip-results="${escapeHtmlAttr(formatNullableNumber(cellMeta.rawResultCount, 0))}"
          data-tooltip-errors="${escapeHtmlAttr(cellMeta.errorCategories.length ? cellMeta.errorCategories.join("; ") : "None")}"
          data-tooltip-details-title="Details"
          data-tooltip-details="${escapeHtmlAttr(detailText)}"
          data-tooltip-consistency="${escapeHtmlAttr(cellMeta.dominantErrorCategory || "No explicit error group")}"
          aria-label="${escapeHtmlAttr(cellTitle)}"
        ></td>
      `;
    }).join("");

    const runLabelShort = truncateLabel(abbreviateRunLabelForAxis(runLabel), 11);
    return `
      <tr>
        <th scope="row" class="run-row-head" title="${escapeHtmlAttr(runLabel)}">
          <span class="heatmap-label-compact">${escapeHtml(runLabelShort)}</span>
          <span class="heatmap-label-full">${escapeHtml(truncateLabel(runLabel, 38))}</span>
        </th>
        ${cells}
      </tr>
    `;
  }).join("");

  const sortedLegendErrors = [...errorCategoryTotals.entries()].sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  const errorLegendItems = sortedLegendErrors.map(([category, count]) => {
    const messageSummary = summarizeErrorMessages(errorCategoryMessageTotals?.get(category), 4);
    const detailText = [
      `Observed query-run cells: ${formatNumber(count, 0)}`,
      `Top message text examples: ${messageSummary}`,
    ].join(" | ");
    return `
    <span class="legend-item heatmap-legend-item error-legend-item"
      data-legend-title="${escapeHtmlAttr(category)}"
      data-legend-details="${escapeHtmlAttr(detailText)}"
      data-highlight-key="${escapeHtmlAttr(`error-category:${category}`)}"
    >
      <span class="legend-swatch" style="background:${escapeHtmlAttr(errorColorMap.get(category) || ERROR_HEATMAP_BASE_COLORS.fallbackError)};"></span>
      ${escapeHtml(category)} (${formatNumber(count, 0)})
    </span>
  `;
  }).join("");

  chartEl.innerHTML = `
    <div
      class="outcome-heatmap-wrap"
      style="--heatmap-run-col-size:${compactRunColSize}px; --heatmap-header-size:${compactHeaderSize}px;"
      role="img"
      aria-label="Heatmap of query error groups by run"
    >
      <table class="outcome-heatmap-table">
        <colgroup>${columnDefs}</colgroup>
        <thead>
          <tr>
            <th scope="col" class="run-col-head">
              <span class="heatmap-label-compact">Run \\ Query</span>
              <span class="heatmap-label-full">${escapeHtml(yLabel)} \\ ${escapeHtml(xLabel)}</span>
            </th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>
    <div class="outcome-heatmap-tooltip hidden" role="tooltip"></div>
    <div class="outcome-heatmap-legend legend-large" aria-label="Error group heatmap legend">
      <span class="legend-title">Explicit Error Groups (Current Scope)</span>
      <span class="legend-item heatmap-legend-item error-legend-item" data-highlight-key="state:no-error" data-legend-title="No explicit error" data-legend-details="Includes cells with result count = 0 and result count > 0, as long as no explicit error was recorded."><span class="legend-swatch" style="background:${ERROR_HEATMAP_BASE_COLORS.noError};"></span>No explicit error (includes 0 and &gt;0 results)</span>
      <span class="legend-item heatmap-legend-item error-legend-item" data-highlight-key="state:missing" data-legend-title="Missing" data-legend-details="No query-run record is available for this cell under the current filter scope."><span class="legend-swatch" style="background:${ERROR_HEATMAP_BASE_COLORS.missing};"></span>Missing</span>
      ${errorLegendItems}
    </div>
  `;
}

function hideHeatmapTooltip() {
  document.querySelectorAll(".outcome-heatmap-tooltip").forEach((tooltip) => {
    tooltip.classList.add("hidden");
    tooltip.removeAttribute("style");
    tooltip.innerHTML = "";
  });
}

function positionHeatmapTooltip(tooltip, event) {
  const padding = 12;
  const offset = 14;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + offset;
  let top = event.clientY + offset;

  if (left + rect.width + padding > window.innerWidth) {
    left = Math.max(padding, event.clientX - rect.width - offset);
  }
  if (top + rect.height + padding > window.innerHeight) {
    top = Math.max(padding, event.clientY - rect.height - offset);
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showHeatmapTooltip(cell, event) {
  const wrap = cell.closest(".outcome-heatmap-wrap");
  const tooltip = wrap?.parentElement?.querySelector(".outcome-heatmap-tooltip");
  if (!(tooltip instanceof HTMLElement)) {
    return;
  }

  const detailsTitle = cell.dataset.tooltipDetailsTitle || "Consistency";
  const detailsValue = cell.dataset.tooltipDetails || cell.dataset.tooltipConsistency || "-";

  tooltip.innerHTML = `
    <div class="heatmap-tooltip-kicker">${escapeHtml(cell.dataset.tooltipOutcome || "Outcome")}</div>
    <div class="heatmap-tooltip-title">${escapeHtml(cell.dataset.tooltipQuery || "Query")}</div>
    <dl>
      <div><dt>Run</dt><dd>${escapeHtml(cell.dataset.tooltipRun || "-")}</dd></div>
      <div><dt>Results</dt><dd>${escapeHtml(cell.dataset.tooltipResults || "-")}</dd></div>
      <div><dt>Errors</dt><dd>${escapeHtml(cell.dataset.tooltipErrors || "None")}</dd></div>
      <div><dt>${escapeHtml(detailsTitle)}</dt><dd>${escapeHtml(detailsValue)}</dd></div>
    </dl>
  `;
  tooltip.classList.remove("hidden");
  positionHeatmapTooltip(tooltip, event);
}

function showHeatmapLegendTooltip(legendItem, event) {
  const chartEl = legendItem.closest(".plot-chart");
  const tooltip = chartEl?.querySelector(".outcome-heatmap-tooltip");
  if (!(tooltip instanceof HTMLElement)) {
    return;
  }

  const title = legendItem.dataset.legendTitle || "Legend item";
  const details = legendItem.dataset.legendDetails || "No additional details available.";
  tooltip.innerHTML = `
    <div class="heatmap-tooltip-kicker">Legend definition</div>
    <div class="heatmap-tooltip-title">${escapeHtml(title)}</div>
    <dl>
      <div><dt>Details</dt><dd>${escapeHtml(details)}</dd></div>
    </dl>
  `;
  tooltip.classList.remove("hidden");
  positionHeatmapTooltip(tooltip, event);
}

function clearHeatmapLegendHighlights() {
  activeHeatmapLegendItem = null;
  document.querySelectorAll(".outcome-heatmap-wrap .heat-cell").forEach((cell) => {
    cell.classList.remove("heat-cell-highlighted", "heat-cell-dimmed");
  });
  document.querySelectorAll(".outcome-heatmap-legend .heatmap-legend-item.legend-active").forEach((item) => {
    item.classList.remove("legend-active");
  });
}

function applyHeatmapLegendHighlight(legendItem) {
  const chartEl = legendItem.closest(".plot-chart");
  if (!(chartEl instanceof HTMLElement)) {
    return;
  }
  const key = String(legendItem.dataset.highlightKey || "").trim();
  if (!key) {
    return;
  }

  const allLegendItems = chartEl.querySelectorAll(".outcome-heatmap-legend .heatmap-legend-item");
  allLegendItems.forEach((item) => item.classList.remove("legend-active"));
  legendItem.classList.add("legend-active");

  const cells = [...chartEl.querySelectorAll(".outcome-heatmap-wrap .heat-cell")];
  if (!cells.length) {
    return;
  }

  const matchingCells = cells.filter((cell) => {
    if (!(cell instanceof HTMLElement)) {
      return false;
    }
    if (key === "variance") {
      return cell.dataset.hasVariance === "true";
    }
    if (key.startsWith("state:")) {
      return String(cell.dataset.outcome || "") === key.slice("state:".length);
    }
    if (key.startsWith("error-category:")) {
      return String(cell.dataset.errorCategory || "") === key.slice("error-category:".length);
    }
    return false;
  });

  cells.forEach((cell) => {
    cell.classList.remove("heat-cell-highlighted", "heat-cell-dimmed");
    if (matchingCells.length) {
      cell.classList.add(matchingCells.includes(cell) ? "heat-cell-highlighted" : "heat-cell-dimmed");
    }
  });
}

function handleHeatmapPointerMove(event) {
  const legendHighlightItem = event.target.closest(".heatmap-legend-item");
  if (legendHighlightItem instanceof HTMLElement) {
    if (activeHeatmapLegendItem !== legendHighlightItem) {
      clearHeatmapLegendHighlights();
      applyHeatmapLegendHighlight(legendHighlightItem);
      activeHeatmapLegendItem = legendHighlightItem;
    }
  } else if (activeHeatmapLegendItem) {
    clearHeatmapLegendHighlights();
  }

  const legendItem = event.target.closest(".error-legend-item");
  if (legendItem instanceof HTMLElement) {
    showHeatmapLegendTooltip(legendItem, event);
    return;
  }

  const cell = event.target.closest(".heat-cell");
  if (!(cell instanceof HTMLElement)) {
    hideHeatmapTooltip();
    return;
  }
  showHeatmapTooltip(cell, event);
}

function renderHttpOutcomeScatterChart(chartEl, queryRecords, runsById) {
  const knownHttpRecords = queryRecords.filter((record) => hasNumericValue(record.http_requests));
  const missingHttpCount = queryRecords.length - knownHttpRecords.length;
  const httpValues = knownHttpRecords.map((record) => Number(record.http_requests));
  const useLogScale = httpValues.length > 0 && httpValues.every((value) => value > 0);
  const xLabel = useLogScale ? "HTTP Requests (count, log scale)" : "HTTP Requests (count)";
  const yLabel = "Outcome (1=no error, 0=error)";
  clearChartElement(chartEl);

  if (!queryRecords.length) {
    renderNoDataPlot(chartEl, "No records for selected query", xLabel, yLabel);
    return;
  }
  if (!knownHttpRecords.length) {
    renderNoDataPlot(chartEl, "No records with numeric HTTP request counts", xLabel, yLabel);
    return;
  }

  const basePoints = knownHttpRecords
    .map((record) => {
      const httpValue = record.http_requests;
      const run = runsById.get(record.run_id) || { run_id: record.run_id, run_label: record.run_label };
      const outcomeNoExplicitError = hasNoExplicitError(record);
      return {
        xBase: Number(httpValue),
        rawHttpRequests: Number(httpValue),
        runLabel: getRunDisplayLabel(run.run_id, run.run_label),
        start: record.start,
        duration: record.duration_seconds,
        resultsCount: record.results_count,
        noExplicitError: outcomeNoExplicitError,
        outcomeBase: outcomeNoExplicitError ? 1 : 0,
        errorCategory: record.error_category || "N/A",
      };
    })
    .filter(Boolean);

  // Resolve exact coordinate collisions without changing the HTTP request value.
  // The y offset only separates duplicate points inside the same categorical outcome band.
  const groupedPointIndexes = new Map();
  basePoints.forEach((point, index) => {
    const key = `${point.noExplicitError ? "no-error" : "explicit-error"}::${point.xBase}`;
    if (!groupedPointIndexes.has(key)) {
      groupedPointIndexes.set(key, []);
    }
    groupedPointIndexes.get(key).push(index);
  });
  const pointOffsetMap = new Map();
  groupedPointIndexes.forEach((indexes) => {
    const center = (indexes.length - 1) / 2;
    const step = indexes.length > 1
      ? Math.min(0.1, 0.24 / Math.max(center, 1))
      : 0;
    indexes.forEach((pointIndex, localIndex) => {
      pointOffsetMap.set(pointIndex, {
        offset: (localIndex - center) * step,
        groupSize: indexes.length,
        groupPosition: localIndex + 1,
      });
    });
  });

  const points = basePoints.map((point, index) => {
    const collision = pointOffsetMap.get(index) || { offset: 0, groupSize: 1, groupPosition: 1 };
    return {
      ...point,
      x: point.xBase,
      y: point.outcomeBase + collision.offset,
      collisionGroupSize: collision.groupSize,
      collisionGroupPosition: collision.groupPosition,
    };
  });

  if (!points.length) {
    renderNoDataPlot(chartEl, "No HTTP request data for selected query", xLabel, yLabel);
    return;
  }

  const ChartJs = getChartJs();
  if (!ChartJs) {
    chartEl.innerHTML = "<div class='chart-empty'>Interactive chart library not available.</div>";
    return;
  }

  const successPoints = points.filter((point) => point.noExplicitError);
  const failurePoints = points.filter((point) => !point.noExplicitError);
  const canvas = buildChartCanvas(chartEl);
  const datasets = [
    {
      label: "No explicit error",
      data: successPoints,
      parsing: false,
      backgroundColor: CHART_COLORS.success,
      borderColor: CHART_COLORS.success,
      borderWidth: 1,
      pointRadius: 6,
      pointHoverRadius: 8,
    },
    {
      label: "Explicit error",
      data: failurePoints,
      parsing: false,
      backgroundColor: CHART_COLORS.danger,
      borderColor: CHART_COLORS.danger,
      borderWidth: 1,
      pointRadius: 6,
      pointHoverRadius: 8,
    },
  ];

  const xMin = Math.min(...httpValues);
  const xMax = Math.max(...httpValues);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      // Force single-point hover semantics for this scatter chart.
      mode: "nearest",
      intersect: true,
      axis: "xy",
    },
    animation: {
      duration: 320,
      easing: "easeOutQuart",
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          color: "#264f70",
          font: { size: 10 },
        },
      },
      subtitle: {
        display: missingHttpCount > 0,
        text: `${formatNumber(missingHttpCount, 0)} record${missingHttpCount === 1 ? "" : "s"} omitted because HTTP request count is missing`,
        color: "#4d6980",
        font: { size: 11, weight: "600" },
        padding: { bottom: 4 },
      },
      tooltip: {
        enabled: true,
        mode: "nearest",
        intersect: true,
        backgroundColor: "#f8fbff",
        titleColor: "#1d2a37",
        bodyColor: "#1d2a37",
        borderColor: "#80b7df",
        borderWidth: 1,
        titleFont: { family: "Source Sans 3, Segoe UI, sans-serif", size: 12, weight: "700" },
        bodyFont: { family: "Source Sans 3, Segoe UI, sans-serif", size: 12 },
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          title: () => "Query attempt",
          label: (context) => {
            const point = context.raw;
            const outcomeLabel = point.noExplicitError ? "No explicit error" : "Explicit error";
            const lines = [
              `Run: ${point.runLabel || "-"}`,
              `Outcome: ${outcomeLabel}`,
              `HTTP requests: ${formatNumber(point.rawHttpRequests, 0)}`,
              `Results count: ${formatNullableNumber(point.resultsCount, 0)}`,
              `Duration: ${formatNullableNumber(point.duration, 2)} s`,
            ];
            if (point.collisionGroupSize > 1) {
              lines.push(`Same HTTP/outcome group: ${formatNumber(point.collisionGroupPosition, 0)} of ${formatNumber(point.collisionGroupSize, 0)}`);
            }
            return lines;
          },
          afterLabel: (context) => {
            const point = context.raw;
            return [
              `Start: ${formatDateTime(point.start)}`,
              `Error: ${point.errorCategory}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        type: useLogScale ? "logarithmic" : "linear",
        beginAtZero: !useLogScale,
        min: useLogScale ? Math.max(Number.MIN_VALUE, xMin / 1.5) : undefined,
        max: useLogScale && xMax > xMin ? xMax * 1.25 : undefined,
        title: {
          display: true,
          text: xLabel,
          color: "#345a79",
          font: { size: 12, weight: "600" },
        },
        ticks: {
          color: "#4d6980",
          maxRotation: 45,
          minRotation: 45,
          callback: (value) => formatAxisNumber(Number(value)),
        },
        grid: {
          color: "#e7eff7",
          drawBorder: false,
        },
      },
      y: {
        min: -0.25,
        max: 1.25,
        title: {
          display: true,
          text: yLabel,
          color: "#345a79",
          font: { size: 12, weight: "600" },
        },
        ticks: {
          color: "#4d6980",
          stepSize: 1,
          callback: (value) => {
            if (Number(value) === 1) {
              return "No error";
            }
            if (Number(value) === 0) {
              return "Error";
            }
            return "";
          },
        },
        grid: {
          color: "#e7eff7",
          drawBorder: false,
        },
      },
    },
  };

  const instance = new ChartJs(canvas.getContext("2d"), {
    type: "scatter",
    data: { datasets },
    options: chartOptions,
  });
  chartRegistry.set(chartEl.id, instance);
}

function getActiveRuns() {
  const mainRuns = state.mainDataset?.runs || [];
  return mainRuns;
}

function getActiveRecords() {
  const mainRecords = (state.mainDataset?.records || []).filter((record) => !record.is_run_summary_row);
  return mainRecords;
}

function getQuerySummaries() {
  return state.queriesDataset?.summaries || [];
}

function getQueryVariants() {
  return state.queriesDataset?.variants || [];
}

function getOverviewEndpointMeta(key) {
  if (!key) {
    return null;
  }
  return OVERVIEW_ENDPOINT_META.find((item) => item.key === key) || null;
}

function summaryImplicatesEndpoint(summary, endpointUrl) {
  if (!summary || !endpointUrl) {
    return false;
  }
  const hasMatch = (rawValue) => String(rawValue || "").includes(endpointUrl);
  const variantMatch = (summary.variants || []).some((variant) => hasMatch(variant.query_text));
  if (variantMatch) {
    return true;
  }
  const sibMatch = (summary.sib_rows || []).some((row) => Object.values(row || {}).some((value) => hasMatch(value)));
  if (sibMatch) {
    return true;
  }
  return (summary.parsed_stats?.service_iris || []).some((iri) => hasMatch(iri));
}

function getEndpointQueryStemSet(endpointMeta) {
  if (!endpointMeta) {
    return new Set();
  }
  const stems = (getQuerySummaries() || [])
    .filter((summary) => summaryImplicatesEndpoint(summary, endpointMeta.endpointUrl))
    .map((summary) => summary.query_stem)
    .filter(Boolean);
  return new Set(stems);
}

function getQueryAlias(stem) {
  if (!stem) {
    return null;
  }
  const aliases = state.queriesDataset?.query_aliases;
  if (!aliases || typeof aliases !== "object") {
    return null;
  }
  const alias = aliases[stem];
  if (!alias || alias === "-") {
    return null;
  }
  return alias;
}

function getQueryDisplayName(stem) {
  return getQueryAlias(stem) || stem;
}

function parseCsvParam(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAllKnownRuns() {
  const mainRuns = state.mainDataset?.runs || [];
  return mainRuns;
}

function buildRunIndexMaps() {
  const runs = getAllKnownRuns()
    .map((run) => run?.run_id)
    .filter((runId) => typeof runId === "string" && runId.trim());
  const uniqueRunIds = [...new Set(runs)];
  const runIdToIndex = new Map(uniqueRunIds.map((runId, index) => [runId, index]));
  const runIndexToId = new Map(uniqueRunIds.map((runId, index) => [index, runId]));
  return { runIdToIndex, runIndexToId };
}

function encodeExperimentSelection(selectedRunIds) {
  const ids = [...(selectedRunIds || [])];
  if (!ids.length) {
    return "";
  }
  const { runIdToIndex } = buildRunIndexMaps();
  const indexes = ids
    .map((runId) => runIdToIndex.get(runId))
    .filter((index) => Number.isInteger(index))
    .sort((a, b) => a - b);
  if (!indexes.length) {
    return "";
  }
  return indexes.map((index) => index.toString(36)).join(".");
}

function decodeExperimentSelection(encoded) {
  if (!encoded) {
    return [];
  }
  const parts = String(encoded)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return [];
  }
  const { runIndexToId } = buildRunIndexMaps();
  return parts
    .map((part) => Number.parseInt(part, 36))
    .filter((index) => Number.isInteger(index))
    .map((index) => runIndexToId.get(index))
    .filter((runId) => typeof runId === "string" && runId.trim());
}

function parseCompactStateParam(encoded) {
  const compact = {
    monthFocus: null,
    explorerMode: "query",
    runFilter: "",
    outcomeFilter: "all",
    errorFilter: "",
    serviceFilter: "all",
    minSourcesFilter: "",
    maxDurationFilter: "",
    startDateFilter: "",
    endDateFilter: "",
    searchFilter: "",
    queryListSearch: "",
    selectedQueryStem: null,
    selectedQueryVariant: null,
    selectedExperimentIds: [],
    httpDisplayMode: "matrix",
    httpAggregateMode: "median",
    httpQueryFilter: "",
    httpTopN: "35",
    selectedOverviewEndpoint: "uniprot",
    focusTarget: null,
  };

  if (!encoded) {
    return compact;
  }

  const fields = String(encoded)
    .split("~")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const field of fields) {
    const sep = field.indexOf(":");
    if (sep < 0) {
      continue;
    }
    const key = field.slice(0, sep);
    const value = decodeURIComponent(field.slice(sep + 1));
    if (!value) {
      continue;
    }
    if (key === "p") compact.monthFocus = value || null;
    else if (key === "m") compact.explorerMode = value === "e" ? "experiment" : "query";
    else if (key === "r") compact.runFilter = value;
    else if (key === "u") compact.outcomeFilter = value;
    else if (key === "e") compact.errorFilter = value;
    else if (key === "v") compact.serviceFilter = value;
    else if (key === "i") compact.minSourcesFilter = value;
    else if (key === "x") compact.maxDurationFilter = value;
    else if (key === "a") compact.startDateFilter = value;
    else if (key === "b") compact.endDateFilter = value;
    else if (key === "t") compact.searchFilter = value;
    else if (key === "qs") compact.queryListSearch = value;
    else if (key === "q") compact.selectedQueryStem = value;
    else if (key === "qv") compact.selectedQueryVariant = value;
    else if (key === "ex") compact.selectedExperimentIds = decodeExperimentSelection(value);
    else if (key === "hv") compact.httpDisplayMode = value;
    else if (key === "ha") compact.httpAggregateMode = value;
    else if (key === "hq") compact.httpQueryFilter = value;
    else if (key === "hn") compact.httpTopN = value;
    else if (key === "oe") compact.selectedOverviewEndpoint = value;
    else if (key === "f") compact.focusTarget = value || null;
  }

  return compact;
}

function resolveFocusTargetElement(targetToken) {
  if (!targetToken) {
    return null;
  }
  if (targetToken === "fig2" || targetToken === "generalStatsInteractiveFigureChart") {
    return document.getElementById("generalStatsInteractiveFigureChart");
  }
  return document.getElementById(targetToken);
}

function applyPendingFocusTarget() {
  if (!state.pendingFocusTarget || focusView.isOpen) {
    return;
  }
  const targetElement = resolveFocusTargetElement(state.pendingFocusTarget);
  state.pendingFocusTarget = null;
  if (!(targetElement instanceof HTMLElement)) {
    return;
  }
  const section = document.getElementById("generalQueryStatsSection");
  if (section instanceof HTMLElement) {
    section.scrollIntoView({ block: "center" });
  }
  openFocusView(targetElement);
  syncUrlDashboardState();
}

function setSelectValueIfPresent(selectEl, value) {
  if (!(selectEl instanceof HTMLSelectElement) || value === null || value === undefined || value === "") {
    return;
  }
  const exists = [...selectEl.options].some((option) => option.value === value);
  if (exists) {
    selectEl.value = value;
  }
}

function parseUrlDashboardState() {
  const params = new URLSearchParams(window.location.search);
  const compactParam = params.get("s");
  if (compactParam) {
    return parseCompactStateParam(compactParam);
  }
  const shortExperimentSelection = decodeExperimentSelection(params.get("ex"));
  const longExperimentSelection = parseCsvParam(params.get("experiments"));
  return {
    monthFocus: params.get("p") || params.get("period") || null,
    explorerMode: (params.get("m") === "e" || params.get("mode") === "experiment") ? "experiment" : "query",
    runFilter: params.get("r") || params.get("run") || "",
    outcomeFilter: params.get("u") || params.get("outcome") || "all",
    errorFilter: params.get("e") || params.get("error") || "",
    serviceFilter: params.get("v") || params.get("service") || "all",
    minSourcesFilter: params.get("i") || params.get("minSources") || "",
    maxDurationFilter: params.get("x") || params.get("maxDuration") || "",
    startDateFilter: params.get("a") || params.get("startDate") || "",
    endDateFilter: params.get("b") || params.get("endDate") || "",
    searchFilter: params.get("t") || params.get("search") || "",
    queryListSearch: params.get("qs") || params.get("qSearch") || "",
    selectedQueryStem: params.get("q") || params.get("query") || null,
    selectedQueryVariant: params.get("qv") || params.get("queryVariant") || null,
    selectedExperimentIds: shortExperimentSelection.length ? shortExperimentSelection : longExperimentSelection,
    httpDisplayMode: params.get("hv") || params.get("httpView") || "matrix",
    httpAggregateMode: params.get("ha") || params.get("httpAgg") || "median",
    httpQueryFilter: params.get("hq") || params.get("httpQuery") || "",
    httpTopN: params.get("hn") || params.get("httpTopN") || "35",
    selectedOverviewEndpoint: params.get("oe") || params.get("overviewEndpoint") || "uniprot",
    focusTarget: params.get("f") || params.get("focus") || null,
  };
}

function applyUrlDashboardState(urlState) {
  isApplyingUrlState = true;
  try {
    state.monthFocus = urlState.monthFocus || null;
    state.explorerMode = urlState.explorerMode === "experiment" ? "experiment" : "query";

    state.selectedQueryStem = urlState.selectedQueryStem || null;
    if (urlState.selectedQueryStem && urlState.selectedQueryVariant) {
      state.selectedQueryVariantByStem.set(urlState.selectedQueryStem, urlState.selectedQueryVariant);
    }

    state.selectedExperimentIds = new Set(urlState.selectedExperimentIds || []);
    state.experimentSelectionInitialized = state.selectedExperimentIds.size > 0;
    state.selectedOverviewEndpoint = urlState.selectedOverviewEndpoint || "uniprot";
    state.pendingFocusTarget = urlState.focusTarget || null;

    dom.queryListSearch.value = urlState.queryListSearch || "";
    dom.searchFilter.value = urlState.searchFilter || "";
    dom.minSourcesFilter.value = urlState.minSourcesFilter || "";
    dom.maxDurationFilter.value = urlState.maxDurationFilter || "";
    dom.startDateFilter.value = urlState.startDateFilter || "";
    dom.endDateFilter.value = urlState.endDateFilter || "";
    dom.httpQueryFilter.value = urlState.httpQueryFilter || "";

    const topN = Number(urlState.httpTopN);
    dom.httpTopN.value = Number.isFinite(topN) && topN > 0 ? String(Math.min(300, Math.floor(topN))) : "35";

    setSelectValueIfPresent(dom.runFilter, urlState.runFilter);
    setSelectValueIfPresent(dom.outcomeFilter, urlState.outcomeFilter);
    setSelectValueIfPresent(dom.errorFilter, urlState.errorFilter);
    setSelectValueIfPresent(dom.serviceFilter, urlState.serviceFilter);
    setSelectValueIfPresent(dom.httpDisplayMode, urlState.httpDisplayMode);
    setSelectValueIfPresent(dom.httpAggregateMode, urlState.httpAggregateMode);
  } finally {
    isApplyingUrlState = false;
  }
}

function syncUrlDashboardState() {
  if (isApplyingUrlState) {
    return;
  }
  const compactParts = [];
  const addPart = (key, value) => {
    if (value === null || value === undefined || value === "") {
      return;
    }
    compactParts.push(`${key}:${encodeURIComponent(String(value))}`);
  };

  if (state.monthFocus) addPart("p", state.monthFocus);
  if (state.explorerMode !== "query") addPart("m", state.explorerMode === "experiment" ? "e" : "q");

  if (dom.runFilter.value) addPart("r", dom.runFilter.value);
  if (dom.outcomeFilter.value && dom.outcomeFilter.value !== "all") addPart("u", dom.outcomeFilter.value);
  if (dom.errorFilter.value) addPart("e", dom.errorFilter.value);
  if (dom.serviceFilter.value && dom.serviceFilter.value !== "all") addPart("v", dom.serviceFilter.value);
  if (dom.minSourcesFilter.value) addPart("i", dom.minSourcesFilter.value);
  if (dom.maxDurationFilter.value) addPart("x", dom.maxDurationFilter.value);
  if (dom.startDateFilter.value) addPart("a", dom.startDateFilter.value);
  if (dom.endDateFilter.value) addPart("b", dom.endDateFilter.value);
  if (dom.searchFilter.value.trim()) addPart("t", dom.searchFilter.value.trim());
  if (dom.queryListSearch.value.trim()) addPart("qs", dom.queryListSearch.value.trim());

  if (state.selectedQueryStem) {
    addPart("q", state.selectedQueryStem);
    const queryVariant = state.selectedQueryVariantByStem.get(state.selectedQueryStem);
    if (queryVariant) {
      addPart("qv", queryVariant);
    }
  }

  if (state.selectedExperimentIds.size) {
    const encodedSelection = encodeExperimentSelection(state.selectedExperimentIds);
    if (encodedSelection) {
      addPart("ex", encodedSelection);
    }
  }

  if (dom.httpDisplayMode.value && dom.httpDisplayMode.value !== "matrix") addPart("hv", dom.httpDisplayMode.value);
  if (dom.httpAggregateMode.value && dom.httpAggregateMode.value !== "median") addPart("ha", dom.httpAggregateMode.value);
  if (dom.httpQueryFilter.value.trim()) addPart("hq", dom.httpQueryFilter.value.trim());
  if (dom.httpTopN.value && dom.httpTopN.value !== "35") addPart("hn", dom.httpTopN.value);
  if (state.selectedOverviewEndpoint && state.selectedOverviewEndpoint !== "uniprot") addPart("oe", state.selectedOverviewEndpoint);
  if (focusView.isOpen && focusView.movedNode?.id === "generalStatsInteractiveFigureChart") addPart("f", "fig2");

  const params = new URLSearchParams();
  if (compactParts.length) {
    params.set("s", compactParts.join("~"));
  }

  const url = new URL(window.location.href);
  const nextSearch = params.toString();
  const currentSearch = url.search.replace(/^\?/, "");
  if (nextSearch !== currentSearch) {
    url.search = nextSearch ? `?${nextSearch}` : "";
    history.replaceState(null, "", url);
  }
}

function updateRunOptions() {
  const previous = dom.runFilter.value;
  const runs = getActiveRuns();

  const options = ["<option value=''>All runs</option>"];
  for (const run of runs) {
    const modeLabel = formatServiceMode(run.service_description_mode);
    const displayLabel = getRunDisplayLabel(run.run_id, run.run_label);
    options.push(`<option value="${run.run_id}">${displayLabel} (${modeLabel})</option>`);
  }
  dom.runFilter.innerHTML = options.join("");

  if (runs.some((run) => run.run_id === previous)) {
    dom.runFilter.value = previous;
  }
}

function updateErrorOptions() {
  const previous = dom.errorFilter.value;
  const records = getActiveRecords();

  const categories = new Set();
  for (const record of records) {
    if (!hasExplicitError(record)) {
      continue;
    }
    categories.add(getRecordErrorGroup(record));
  }

  const sorted = [...categories].sort((a, b) => a.localeCompare(b));
  const options = ["<option value=''>All error groups</option>"];
  for (const category of sorted) {
    options.push(`<option value="${category}">${category}</option>`);
  }
  dom.errorFilter.innerHTML = options.join("");

  if (sorted.includes(previous)) {
    dom.errorFilter.value = previous;
  }
}

function filterOverviewRecords({ applyMonthFocus = true } = {}) {
  const records = getActiveRecords();

  const runFilter = dom.runFilter.value;
  const outcomeFilter = dom.outcomeFilter.value;
  const errorFilter = dom.errorFilter.value;
  const serviceFilter = dom.serviceFilter.value;
  const minSources = dom.minSourcesFilter.value === "" ? null : Number(dom.minSourcesFilter.value);
  const maxDuration = dom.maxDurationFilter.value === "" ? null : Number(dom.maxDurationFilter.value);
  const startDate = dom.startDateFilter.value ? new Date(`${dom.startDateFilter.value}T00:00:00Z`) : null;
  const endDate = dom.endDateFilter.value ? new Date(`${dom.endDateFilter.value}T23:59:59Z`) : null;
  const searchText = dom.searchFilter.value.trim().toLowerCase();

  return records.filter((record) => {
    if (runFilter && record.run_id !== runFilter) {
      return false;
    }
    if (outcomeFilter === "success" && !hasPositiveResultSet(record)) {
      return false;
    }
    if (outcomeFilter === "failure" && hasPositiveResultSet(record)) {
      return false;
    }
    if (outcomeFilter === "nonzero" && !(record.results_count > 0)) {
      return false;
    }

    if (errorFilter && getRecordErrorGroup(record) !== errorFilter) {
      return false;
    }

    if (serviceFilter === "no-service" && record.has_service_description !== false) {
      return false;
    }
    if (serviceFilter === "with-service" && record.has_service_description !== true) {
      return false;
    }
    if (serviceFilter === "unknown" && record.has_service_description !== null) {
      return false;
    }

    if (minSources !== null && record.source_count < minSources) {
      return false;
    }

    if (maxDuration !== null && record.duration_seconds !== null && record.duration_seconds > maxDuration) {
      return false;
    }

    if (startDate) {
      const recordStart = parseIso(record.start);
      if (!recordStart || recordStart < startDate) {
        return false;
      }
    }

    if (endDate) {
      const recordEnd = parseIso(record.end);
      if (!recordEnd || recordEnd > endDate) {
        return false;
      }
    }

    if (searchText) {
      const queryName = (record.query_name || "").toLowerCase();
      const queryStem = normalizeQueryStem(record.query_name);
      const queryAlias = queryStem ? getQueryDisplayName(queryStem).toLowerCase() : "";
      if (!queryName.includes(searchText) && !queryAlias.includes(searchText)) {
        return false;
      }
    }

    if (applyMonthFocus && state.monthFocus) {
      return getRecordTemporalGroupKey(record) === state.monthFocus;
    }

    return true;
  });
}

function renderOverviewKpis(records) {
  const runIds = new Set(records.map((record) => record.run_id));
  const succeeded = records.filter((record) => hasPositiveResultSet(record)).length;
  const emptyResults = records.filter((record) => hasNumericValue(record.results_count)
    && Number(record.results_count) === 0
    && !hasExplicitError(record)).length;
  const durations = records
    .map((record) => record.duration_seconds)
    .filter((value) => value !== null && value !== undefined);

  const kpis = [
    { label: metricLabel("Runs in view", "runsInView"), value: formatNumber(runIds.size, 0) },
    { label: metricLabel("Query records", "queryRecords"), value: formatNumber(records.length, 0) },
    { label: metricLabel("Produced results (&gt; 0)", "producedResults"), value: formatNumber(succeeded, 0) },
    { label: metricLabel("<strong>execution success rate</strong>", "executionSuccessRate"), value: formatPercent(records.length ? succeeded / records.length : null) },
    { label: metricLabel("Empty results (=0, parseable)", "emptyResults"), value: formatNumber(emptyResults, 0) },
    { label: metricLabel("Median duration (s)", "medianDuration"), value: formatNullableNumber(median(durations)) },
  ];

  dom.kpiGrid.innerHTML = kpis.map((kpi) => `
    <article class="kpi-card">
      <div class="kpi-label">${kpi.label}</div>
      <div class="kpi-value">${kpi.value}</div>
    </article>
  `).join("");
}

function renderOverviewCharts(records) {
  const runMap = new Map();
  const runsById = new Map(getActiveRuns().map((run) => [run.run_id, run]));
  const queryRunSummaryMap = new Map();
  const activePeriodLabel = state.monthFocus ? temporalGroupLabel(state.monthFocus) : null;
  for (const record of records) {
    if (!runMap.has(record.run_id)) {
      runMap.set(record.run_id, {
        runId: record.run_id,
        label: getRunDisplayLabel(record.run_id, record.run_label),
        runLabel: record.run_label,
        serviceMode: normalizeServiceModeValue(record.service_description_mode),
        total: 0,
        success: 0,
        noErrorCount: 0,
        positiveResultCount: 0,
        totalResultsCount: 0,
        durations: [],
        records: [],
      });
    }
    const run = runMap.get(record.run_id);
    run.total += 1;
    if (hasPositiveResultSet(record)) {
      run.success += 1;
    }
    if (!hasExplicitError(record)) {
      run.noErrorCount += 1;
    }
    if ((record.results_count || 0) > 0) {
      run.positiveResultCount += 1;
    }
    run.totalResultsCount += Number(record.results_count || 0);
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      run.durations.push(record.duration_seconds);
    }
    run.records.push(record);

    const stem = normalizeQueryStem(record.query_name);
    if (stem) {
      const key = `${stem}::${record.run_id}`;
      if (!queryRunSummaryMap.has(key)) {
        queryRunSummaryMap.set(key, {
          attempts: 0,
          hasError: false,
          errorCategories: new Set(),
          errorCategoryCounts: new Map(),
          errorRawCounts: new Map(),
          hasNumericResult: false,
          maxResults: null,
          // Used for heatmap variance markers: compare only non-error outcomes.
          hasNonErrorNumericResult: false,
          maxNonErrorResults: null,
        });
      }
      const summary = queryRunSummaryMap.get(key);
      summary.attempts += 1;
      const recordHasExplicitError = hasExplicitError(record);
      if (recordHasExplicitError) {
        summary.hasError = true;
        const errorCategory = getRecordErrorGroup(record);
        const errorMessage = normalizeErrorMessageLabel(record.error_raw, errorCategory);
        summary.errorCategories.add(errorCategory);
        summary.errorCategoryCounts.set(errorCategory, (summary.errorCategoryCounts.get(errorCategory) || 0) + 1);
        summary.errorRawCounts.set(errorMessage, (summary.errorRawCounts.get(errorMessage) || 0) + 1);
      }
      if (hasNumericValue(record.results_count)) {
        const numericCount = Number(record.results_count);
        summary.hasNumericResult = true;
        if (summary.maxResults === null || numericCount > summary.maxResults) {
          summary.maxResults = numericCount;
        }
        if (!recordHasExplicitError) {
          summary.hasNonErrorNumericResult = true;
          if (summary.maxNonErrorResults === null || numericCount > summary.maxNonErrorResults) {
            summary.maxNonErrorResults = numericCount;
          }
        }
      }
    }
  }

  const sortedRuns = [...runMap.values()].sort((a, b) => {
    const runA = runsById.get(a.runId) || { run_id: a.runId, run_label: a.runLabel, service_description_mode: a.serviceMode };
    const runB = runsById.get(b.runId) || { run_id: b.runId, run_label: b.runLabel, service_description_mode: b.serviceMode };
    const tsA = getRunChronologyTimestamp(runA, a.records);
    const tsB = getRunChronologyTimestamp(runB, b.records);
    if (tsA !== tsB) {
      return tsA - tsB;
    }
    return a.label.localeCompare(b.label);
  });

  const successBars = sortedRuns
    .map((run) => ({
      label: run.label,
      run_id: run.runId,
      service_mode: getRunServiceMode(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
      value: run.total ? (run.success / run.total) * 100 : 0,
      color: getRunModeColor(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
    }));
  const totalResultsBars = sortedRuns
    .map((run) => ({
      label: run.label,
      run_id: run.runId,
      service_mode: getRunServiceMode(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
      value: run.totalResultsCount,
      color: getRunModeColor(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
    }));

  if (activePeriodLabel) {
    setChartCardTitle(dom.runSuccessChart, `Results obtained by run (${activePeriodLabel})`);
    renderBarChart(dom.runSuccessChart, totalResultsBars, (value) => formatNumber(value, 0), { xLabel: "Experiment Run", yLabel: "Results Obtained (count)" });
  } else {
    setChartCardTitle(dom.runSuccessChart, "<strong>execution success rate</strong> by run");
    renderBarChart(dom.runSuccessChart, successBars, (value) => `${value.toFixed(1)}%`, { xLabel: "Experiment Run", yLabel: "Execution Success Rate (%)" });
  }

  const errorCounts = new Map();
  for (const record of records) {
    if (!hasExplicitError(record)) {
      continue;
    }
    const key = getRecordErrorGroup(record);
    errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
  }
  const errorBars = [...errorCounts.entries()]
    .map(([label, value]) => ({ label, value, color: CHART_COLORS.danger }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  if (activePeriodLabel) {
    setChartCardTitle(dom.errorCategoryChart, `Error groups (${activePeriodLabel})`);
  } else {
    setChartCardTitle(dom.errorCategoryChart, "Error group counts");
  }
  renderBarChart(dom.errorCategoryChart, errorBars, (value) => formatNumber(value, 0), { xLabel: "Error Group", yLabel: "Failed Queries (count)" });

  const medianBars = sortedRuns
    .map((run) => ({
      label: run.label,
      run_id: run.runId,
      service_mode: getRunServiceMode(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
      value: median(run.durations) ?? null,
      color: getRunModeColor(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
    }));

  if (activePeriodLabel) {
    setChartCardTitle(dom.runMedianChart, `Query runtime by run (${activePeriodLabel})`);
  } else {
    setChartCardTitle(dom.runMedianChart, "Median runtime by run (seconds)");
  }
  renderBarChart(dom.runMedianChart, medianBars, (value) => formatNumber(value, 1), { xLabel: "Experiment Run", yLabel: "Median Runtime (seconds)" });

  const positiveResultBars = sortedRuns
    .map((run) => ({
      label: run.label,
      run_id: run.runId,
      service_mode: getRunServiceMode(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
      value: run.positiveResultCount,
      color: getRunModeColor(runsById.get(run.runId) || { service_description_mode: run.serviceMode }, run.records),
    }));

  renderBarChart(dom.runPositiveResultCountChart, positiveResultBars, (value) => formatNumber(value, 0), { xLabel: "Experiment Run", yLabel: "Queries With Result Set > 0 (count)" });

  const noServiceAlgorithmMap = new Map(
    NO_SERVICE_ALGORITHM_META.map((item) => [item.key, {
      key: item.key,
      label: item.label,
      color: item.color,
      attempts: 0,
      errorFreeCount: 0,
      positiveCount: 0,
      zeroNoErrorCount: 0,
      errorCount: 0,
      successHttpValues: [],
    }]),
  );
  records.forEach((record) => {
    const runMeta = runsById.get(record.run_id);
    if (normalizeServiceModeValue(getRunServiceMode(runMeta, [])) !== "no-service") {
      return;
    }
    const familyKey = getNoServiceAlgorithmFamily(record.run_id, record.run_label);
    if (!familyKey || !noServiceAlgorithmMap.has(familyKey)) {
      return;
    }
    const bucket = noServiceAlgorithmMap.get(familyKey);
    bucket.attempts += 1;
    const recordHasError = hasExplicitError(record);
    if (!recordHasError) {
      bucket.errorFreeCount += 1;
      if (hasNumericValue(record.http_requests)) {
        const successHttpValue = Number(record.http_requests);
        if (successHttpValue >= 0) {
          bucket.successHttpValues.push(successHttpValue);
        }
      }
      if (hasNumericValue(record.results_count) && Number(record.results_count) === 0) {
        bucket.zeroNoErrorCount += 1;
      }
    } else {
      bucket.errorCount += 1;
    }
    if (hasNumericValue(record.results_count) && Number(record.results_count) > 0) {
      bucket.positiveCount += 1;
    }
  });
  const algorithmRows = NO_SERVICE_ALGORITHM_META
    .map((item) => noServiceAlgorithmMap.get(item.key))
    .filter((bucket) => bucket && bucket.attempts > 0)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      color: bucket.color,
      attempts: bucket.attempts,
      errorFreeCount: bucket.errorFreeCount,
      positiveCount: bucket.positiveCount,
      zeroNoErrorCount: bucket.zeroNoErrorCount,
      errorCount: bucket.errorCount,
      errorFreeRate: bucket.attempts ? bucket.errorFreeCount / bucket.attempts : 0,
      positiveRate: bucket.attempts ? bucket.positiveCount / bucket.attempts : 0,
      successHttpCount: bucket.successHttpValues.length,
      medianHttpSuccess: median(bucket.successHttpValues) ?? 0,
    }));
  if (activePeriodLabel) {
    setChartCardTitle(dom.noServiceAlgorithmChart, `NO-SERVICE algorithm efficacy (${activePeriodLabel})`);
  } else {
    setChartCardTitle(dom.noServiceAlgorithmChart, "NO-SERVICE algorithm efficacy comparison");
  }
  renderNoServiceAlgorithmEfficacyChart(dom.noServiceAlgorithmChart, algorithmRows, activePeriodLabel);

  const endpointChoices = OVERVIEW_ENDPOINT_META;
  if (!endpointChoices.some((item) => item.key === state.selectedOverviewEndpoint)) {
    state.selectedOverviewEndpoint = endpointChoices[0]?.key || "uniprot";
  }
  const selectedEndpointMeta = getOverviewEndpointMeta(state.selectedOverviewEndpoint);
  const endpointQueryStems = getEndpointQueryStemSet(selectedEndpointMeta);

  if (dom.endpointOutcomeToggleRow) {
    dom.endpointOutcomeToggleRow.innerHTML = endpointChoices.map((item) => `
      <button
        type="button"
        class="endpoint-toggle-btn ${item.key === state.selectedOverviewEndpoint ? "active" : ""}"
        data-endpoint-key="${escapeHtmlAttr(item.key)}"
        title="${escapeHtmlAttr(item.endpointUrl)}"
      >${escapeHtml(item.label)}</button>
    `).join("");
  }

  const endpointRunRows = sortedRuns
    .map((run) => {
      const endpointRecords = (run.records || []).filter((record) => {
        const stem = normalizeQueryStem(record.query_name);
        return stem && endpointQueryStems.has(stem);
      });
      const positiveCount = endpointRecords.filter((record) => hasPositiveResultSet(record)).length;
      const errorCount = endpointRecords.filter((record) => hasExplicitError(record)).length;
      const zeroNoErrorCount = endpointRecords.length - positiveCount - errorCount;
      const totalCount = endpointRecords.length;
      return {
        label: run.label,
        runIdDisplay: getRunDisplayLabel(run.runId, run.runLabel),
        positiveCount,
        zeroNoErrorCount,
        errorCount,
        totalCount,
        executionSuccessRate: totalCount > 0 ? positiveCount / totalCount : 0,
      };
    })
    .filter((row) => row.totalCount > 0);

  if (activePeriodLabel) {
    setChartCardTitle(dom.endpointOutcomeChart, `${escapeHtml(selectedEndpointMeta?.label || "Endpoint")} outcomes by run (${escapeHtml(activePeriodLabel)})`);
  } else {
    setChartCardTitle(dom.endpointOutcomeChart, `${escapeHtml(selectedEndpointMeta?.label || "Endpoint")} outcomes by run`);
  }
  renderEndpointOutcomeChart(dom.endpointOutcomeChart, selectedEndpointMeta, endpointRunRows, activePeriodLabel);

  const queryStems = [...new Set(
    records
      .map((record) => normalizeQueryStem(record.query_name))
      .filter(Boolean),
  )].sort((a, b) => getQueryDisplayName(a).localeCompare(getQueryDisplayName(b)));

  const overviewGroups = queryStems.map((stem) => {
    const values = new Map();
    const rawValues = new Map();
    const cellMeta = new Map();
    sortedRuns.forEach((run) => {
      const key = `${stem}::${run.runId}`;
      const summary = queryRunSummaryMap.get(key) || null;
      const rawValue = summary && summary.hasNumericResult ? summary.maxResults : null;
      rawValues.set(run.runId, rawValue);

      let outcomeState = "missing";
      let outcomeLabel = "Missing";
      if (summary) {
        if (summary.hasError) {
          outcomeState = "error";
          outcomeLabel = "Explicit error encountered";
        } else if (summary.hasNumericResult) {
          if (rawValue === 0) {
            outcomeState = "zero";
            outcomeLabel = "Result count = 0";
          } else if (rawValue > 0) {
            outcomeState = "positive";
            outcomeLabel = "Result count > 0";
          }
        }
      }

      cellMeta.set(run.runId, {
        attempts: summary?.attempts || 0,
        outcomeState,
        outcomeLabel,
        hasError: Boolean(summary?.hasError),
        errorCategories: summary ? [...summary.errorCategories] : [],
      });
      values.set(run.runId, outcomeState === "missing" ? null : 1);
    });

    const nonErrorNumericRawValues = sortedRuns
      .map((run) => queryRunSummaryMap.get(`${stem}::${run.runId}`))
      .filter((summary) => Boolean(summary?.hasNonErrorNumericResult) && hasNumericValue(summary?.maxNonErrorResults))
      .map((summary) => Number(summary.maxNonErrorResults));
    let consistencyState = "insufficient";
    if (nonErrorNumericRawValues.length >= 2) {
      const firstValue = nonErrorNumericRawValues[0];
      consistencyState = nonErrorNumericRawValues.every((value) => value === firstValue) ? "same" : "different";
    }

    return {
      label: getQueryDisplayName(stem),
      values,
      rawValues,
      cellMeta,
      consistencyState,
    };
  });

  const errorCategoryTotals = new Map();
  const errorCategoryMessageTotals = new Map();
  const errorOverviewGroups = queryStems.map((stem) => {
    const cellMeta = new Map();
    sortedRuns.forEach((run) => {
      const summary = queryRunSummaryMap.get(`${stem}::${run.runId}`) || null;
      if (!summary) {
        cellMeta.set(run.runId, {
          attempts: 0,
          state: "missing",
          outcomeLabel: "Missing",
          dominantErrorCategory: null,
          errorCategories: [],
          errorMessages: [],
          rawResultCount: null,
        });
        return;
      }

      if (summary.hasError) {
        const dominantErrorCategory = selectDominantErrorCategory(summary.errorCategoryCounts)
          || normalizeErrorCategoryLabel(null);
        errorCategoryTotals.set(dominantErrorCategory, (errorCategoryTotals.get(dominantErrorCategory) || 0) + 1);
        if (!errorCategoryMessageTotals.has(dominantErrorCategory)) {
          errorCategoryMessageTotals.set(dominantErrorCategory, new Map());
        }
        const messageTotals = errorCategoryMessageTotals.get(dominantErrorCategory);
        summary.errorRawCounts.forEach((count, message) => {
          messageTotals.set(message, (messageTotals.get(message) || 0) + count);
        });
        const rankedMessages = [...summary.errorRawCounts.entries()]
          .sort((a, b) => {
            if (b[1] !== a[1]) {
              return b[1] - a[1];
            }
            return a[0].localeCompare(b[0]);
          })
          .map(([message]) => message);
        cellMeta.set(run.runId, {
          attempts: summary.attempts || 0,
          state: "error",
          outcomeLabel: `Explicit error: ${dominantErrorCategory}`,
          dominantErrorCategory,
          errorCategories: [...summary.errorCategories].sort((a, b) => a.localeCompare(b)),
          errorMessages: rankedMessages,
          rawResultCount: summary.hasNumericResult ? summary.maxResults : null,
        });
        return;
      }

      cellMeta.set(run.runId, {
        attempts: summary.attempts || 0,
        state: "no-error",
        outcomeLabel: "No explicit error (0 or >0 results)",
        dominantErrorCategory: null,
        errorCategories: [],
        errorMessages: [],
        rawResultCount: summary.hasNumericResult ? summary.maxResults : null,
      });
    });

    return {
      label: getQueryDisplayName(stem),
      cellMeta,
    };
  });

  const runSeries = sortedRuns.map((run) => (runsById.get(run.runId) || {
    run_id: run.runId,
    run_label: run.runLabel,
    service_description_mode: run.serviceMode,
  }));

  setChartCardTitle(dom.queryResultsByRunOverviewChart, "Query outcome heatmap by experiment run");
  renderQueryOutcomeHeatmap(dom.queryResultsByRunOverviewChart, overviewGroups, runSeries);
  setChartCardTitle(dom.queryErrorTypeHeatmapChart, "Query error-type heatmap by experiment run");
  renderQueryErrorTypeHeatmap(
    dom.queryErrorTypeHeatmapChart,
    errorOverviewGroups,
    runSeries,
    errorCategoryTotals,
    errorCategoryMessageTotals,
  );
}

function getMonthlyStats(records) {
  const map = new Map(
    TEMPORAL_GROUP_ORDER.map((groupKey) => [groupKey, {
      monthKey: groupKey,
      label: temporalGroupLabel(groupKey),
      total: 0,
      success: 0,
      durations: [],
      runIds: new Set(),
    }]),
  );

  for (const record of records) {
    const monthKey = getRecordTemporalGroupKey(record);
    if (!map.has(monthKey)) {
      map.set(monthKey, {
        monthKey,
        label: temporalGroupLabel(monthKey),
        total: 0,
        success: 0,
        durations: [],
        runIds: new Set(),
      });
    }
    const month = map.get(monthKey);
    month.total += 1;
    if (hasPositiveResultSet(record)) {
      month.success += 1;
    }
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      month.durations.push(record.duration_seconds);
    }
    month.runIds.add(record.run_id);
  }

  return [...map.values()]
    .map((month) => ({
      ...month,
      successRate: month.total ? month.success / month.total : 0,
      medianDuration: median(month.durations),
    }))
    .sort((a, b) => {
      const orderDiff = temporalGroupSortValue(a.monthKey) - temporalGroupSortValue(b.monthKey);
      if (orderDiff !== 0) {
        return orderDiff;
      }
      return a.label.localeCompare(b.label);
    });
}

function renderMonthlyViews(recordsBeforeMonthFocus) {
  const monthly = getMonthlyStats(recordsBeforeMonthFocus);

  if (state.monthFocus && !monthly.some((item) => item.monthKey === state.monthFocus)) {
    state.monthFocus = null;
  }

  const pills = [
    `<button type="button" class="month-pill ${state.monthFocus === null ? "active" : ""}" data-month="all">All periods</button>`,
    ...monthly.map((month) => `
      <button type="button" class="month-pill ${state.monthFocus === month.monthKey ? "active" : ""}" data-month="${month.monthKey}">
        ${month.label} · ${month.total} q · ${formatPercent(month.successRate)}
      </button>
    `),
  ];
  dom.monthPills.innerHTML = pills.join("");

  dom.monthPills.querySelectorAll(".month-pill").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.month;
      state.monthFocus = value === "all" ? null : value;
      renderAll();
    });
  });

  const visibleMonths = state.monthFocus
    ? monthly.filter((month) => month.monthKey === state.monthFocus)
    : monthly;
  const runsById = new Map(getActiveRuns().map((run) => [run.run_id, run]));

  if (state.monthFocus && visibleMonths.length === 1) {
    const focusMonth = visibleMonths[0];
    const periodRecords = recordsBeforeMonthFocus.filter((record) => getRecordTemporalGroupKey(record) === state.monthFocus);
    const activeRuns = sortRunsChronologically(
      [...focusMonth.runIds]
        .map((runId) => runsById.get(runId))
        .filter(Boolean),
      periodRecords,
    );

    const runRecordMap = new Map(activeRuns.map((run) => [run.run_id, []]));
    periodRecords.forEach((record) => {
      if (runRecordMap.has(record.run_id)) {
        runRecordMap.get(record.run_id).push(record);
      }
    });

    const periodRunSuccessBars = activeRuns.map((run) => {
      const runRecords = runRecordMap.get(run.run_id) || [];
      const successes = runRecords.filter((record) => hasPositiveResultSet(record)).length;
      return {
        label: getRunDisplayLabel(run.run_id, run.run_label),
        run_id: run.run_id,
        service_mode: getRunServiceMode(run, runRecords),
        value: runRecords.length ? (successes / runRecords.length) * 100 : 0,
        color: getRunModeColor(run, runRecords),
      };
    });

    const errorCounts = new Map();
    periodRecords.forEach((record) => {
      if (!hasExplicitError(record)) {
        return;
      }
      const category = getRecordErrorGroup(record);
      errorCounts.set(category, (errorCounts.get(category) || 0) + 1);
    });

    const periodErrorBars = [...errorCounts.entries()]
      .map(([label, value]) => ({ label, value, color: CHART_COLORS.danger }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);

    setChartCardTitle(dom.monthSuccessChart, `Experiment <strong>execution success rates</strong> (${escapeHtml(focusMonth.label)})`);
    renderBarChart(dom.monthSuccessChart, periodRunSuccessBars, (value) => `${value.toFixed(1)}%`, {
      xLabel: "Experiment Run",
      yLabel: "Execution Success Rate (%)",
    });

    setChartCardTitle(
      dom.monthVolumeChart,
      `Error groups observed (${focusMonth.label}) · ${errorCounts.size} group${errorCounts.size === 1 ? "" : "s"}`,
    );
    renderBarChart(dom.monthVolumeChart, periodErrorBars, (value) => formatNumber(value, 0), {
      xLabel: "Error Group",
      yLabel: "Failed Queries (count)",
    });
  } else {
    const successBars = visibleMonths.map((month) => ({
      label: month.label,
      value: month.successRate * 100,
      color: CHART_COLORS.secondary,
    }));
    const volumeBars = visibleMonths.map((month) => ({
      label: month.label,
      value: month.total,
      color: CHART_COLORS.primary,
    }));

    setChartCardTitle(dom.monthSuccessChart, "<strong>execution success rate</strong> by period");
    renderBarChart(dom.monthSuccessChart, successBars, (value) => `${value.toFixed(1)}%`, { xLabel: "Testing Period", yLabel: "Execution Success Rate (%)" });

    setChartCardTitle(dom.monthVolumeChart, "Query volume by period");
    renderBarChart(dom.monthVolumeChart, volumeBars, (value) => formatNumber(value, 0), { xLabel: "Testing Period", yLabel: "Query Records (count)" });
  }

  if (!visibleMonths.length) {
    dom.monthlyRunGrid.innerHTML = "<article class='month-card'><h4>No period data</h4></article>";
    return;
  }

  dom.monthlyRunGrid.innerHTML = visibleMonths.map((month) => {
    const runItems = [...month.runIds]
      .map((runId) => runsById.get(runId))
      .filter(Boolean)
      .sort((a, b) => (b.query_count || 0) - (a.query_count || 0))
      .map((run) => `<li><code>${getRunDisplayLabel(run.run_id, run.run_label)}</code> · ${formatPercent(run.success_rate)} execution success rate · ${run.query_count} queries</li>`)
      .join("");

    return `
      <article class="month-card">
        <h4>${month.label}</h4>
        <div class="kpi-label">${metricLabel("Queries", "queries")}: ${month.total} · ${metricLabel("<strong>execution success rate</strong>", "executionSuccessRate")}: ${formatPercent(month.successRate)} · ${metricLabel("Median runtime", "medianDuration")}: ${formatNullableNumber(month.medianDuration)} s</div>
        <ul class="month-card-list">${runItems}</ul>
      </article>
    `;
  }).join("");
}

function renderGeneralQueryStatistics() {
  const stats = state.generalQueryStats;

  if (!stats || !Array.isArray(stats.query_rows) || !stats.query_rows.length) {
    dom.generalQueryStatsMeta.textContent = "No general query statistics dataset loaded.";
    dom.generalStatsSummaryTableBody.innerHTML = "";
    dom.generalStatsBucketTableHead.innerHTML = "";
    dom.generalStatsBucketTableBody.innerHTML = "";
    dom.generalStatsDetailTableBody.innerHTML = "";
    return;
  }

  const sourceUrl = stats.source_url || "N/A";
  dom.generalQueryStatsMeta.innerHTML = [
    `Source entries: ${formatNumber(stats.query_count, 0)}`,
    `Source: <a href="${escapeHtmlAttr(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceUrl)}</a>`,
  ].join(" | ");

  const summaryRows = Array.isArray(stats.summary_rows) ? stats.summary_rows : [];
  dom.generalStatsSummaryTableBody.innerHTML = summaryRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.feature_label)}</td>
      <td>${formatNumber(row.average, 2)}</td>
      <td>${formatNumber(row.maximum, 2)}</td>
      <td>${formatNumber(row.minimum, 2)}</td>
      <td>${formatNumber(row.std_dev, 2)}</td>
    </tr>
  `).join("");

  const bucketColumns = Array.isArray(stats.bucket_columns) ? stats.bucket_columns : [];
  const bucketRows = Array.isArray(stats.bucket_rows) ? stats.bucket_rows : [];
  dom.generalStatsBucketTableHead.innerHTML = `
    <tr>
      <th>Feature / Range</th>
      ${bucketColumns.map((columnLabel) => `<th>${escapeHtml(columnLabel)}</th>`).join("")}
    </tr>
  `;
  dom.generalStatsBucketTableBody.innerHTML = bucketRows.map((row) => `
    <tr>
      <td>${escapeHtml(row.feature_label)}</td>
      ${bucketColumns.map((columnLabel) => `<td>${formatNumber(Number(row.counts?.[columnLabel] || 0), 0)}</td>`).join("")}
    </tr>
  `).join("");

  dom.generalStatsDetailTableBody.innerHTML = stats.query_rows.map((row) => {
    const aliasLabel = row.query_stem ? getQueryDisplayName(row.query_stem) : null;
    const displayLabel = aliasLabel || row.query_label || row.query_stem || row.source_url || "Unknown query";
    return `
    <tr>
      <td>
        <a href="${escapeHtmlAttr(row.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayLabel)}</a>
      </td>
      <td>${formatNumber(row.number_triple_patterns, 0)}</td>
      <td>${formatNumber(row.number_optional, 0)}</td>
      <td>${formatNumber(row.number_union, 0)}</td>
      <td>${formatNumber(row.number_union_with_multiple_triple_triple_patterns, 0)}</td>
      <td>${formatNumber(row.number_federation_member, 0)}</td>
    </tr>
  `;
  }).join("");

}

function computeObservedStatsMap(records) {
  const map = new Map();

  for (const record of records) {
    const stem = normalizeQueryStem(record.query_name);
    if (!stem) {
      continue;
    }

    if (!map.has(stem)) {
      map.set(stem, {
        attempts: 0,
        successes: 0,
        resultsMax: 0,
        durations: [],
      });
    }

    const item = map.get(stem);
    item.attempts += 1;
    if (hasPositiveResultSet(record)) {
      item.successes += 1;
    }
    if ((record.results_count || 0) > item.resultsMax) {
      item.resultsMax = record.results_count || 0;
    }
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      item.durations.push(record.duration_seconds);
    }
  }

  return map;
}

function syncModeButtons() {
  dom.modeByQuery.classList.toggle("active", state.explorerMode === "query");
  dom.modeByExperiment.classList.toggle("active", state.explorerMode === "experiment");
  dom.queryPane.classList.toggle("hidden", state.explorerMode !== "query");
  dom.experimentPane.classList.toggle("hidden", state.explorerMode !== "experiment");
}

function queryChipClass(variant) {
  if (variant === "original") {
    return "original";
  }
  if (variant === "no-service") {
    return "no-service";
  }
  if (variant === "no-service-broken") {
    return "broken";
  }
  return "";
}

function preferredVariantForStem(stem) {
  const variants = getQueryVariants().filter((item) => item.query_stem === stem);
  if (!variants.length) {
    return null;
  }
  return [...variants].sort((a, b) => {
    const aRank = variantRank(a.query_variant);
    const bRank = variantRank(b.query_variant);
    return aRank - bRank;
  })[0];
}

function renderQueryList(records) {
  const observedMap = computeObservedStatsMap(records);
  const search = dom.queryListSearch.value.trim().toLowerCase();

  const filtered = getQuerySummaries()
    .filter((summary) => {
      const displayName = getQueryDisplayName(summary.query_stem).toLowerCase();
      return summary.query_stem.toLowerCase().includes(search) || displayName.includes(search);
    })
    .sort((a, b) => getQueryDisplayName(a.query_stem).localeCompare(getQueryDisplayName(b.query_stem)));

  if (!filtered.length) {
    state.selectedQueryStem = null;
    dom.queryList.innerHTML = "<div class='item-meta'>No queries match current search.</div>";
    return filtered;
  }

  if (!state.selectedQueryStem || !filtered.some((item) => item.query_stem === state.selectedQueryStem)) {
    state.selectedQueryStem = filtered[0].query_stem;
  }

  dom.queryList.innerHTML = filtered.map((summary) => {
    const observed = observedMap.get(summary.query_stem);
    const attempts = observed?.attempts || 0;
    const successRate = attempts ? observed.successes / attempts : null;
    const displayName = getQueryDisplayName(summary.query_stem);
    const subtitle = `Variants: ${summary.variant_count} · Main attempts: ${attempts} · Execution success rate: ${formatPercent(successRate)}`;

    return `
      <div class="query-item ${state.selectedQueryStem === summary.query_stem ? "active" : ""}">
        <button type="button" data-query-stem="${escapeHtmlAttr(summary.query_stem)}">
          <div class="item-title"><code class="truncate-scroll" title="${escapeHtmlAttr(displayName)}">${escapeHtml(displayName)}</code></div>
          <div class="item-meta">${escapeHtml(subtitle)}</div>
        </button>
      </div>
    `;
  }).join("");

  dom.queryList.querySelectorAll("button[data-query-stem]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedQueryStem = button.dataset.queryStem;
      renderExplorerQueryMode();
    });
  });

  return filtered;
}

function renderQueryDetail(records) {
  if (!state.selectedQueryStem) {
    dom.querySelectedTitle.textContent = "Selected Query";
    dom.querySelectedMeta.innerHTML = "";
    dom.queryRunsTableBody.innerHTML = "";
    dom.queryRunTableMeta.textContent = "No query selected.";
    dom.queryTextDetail.textContent = "Select a query to inspect its text and metadata.";
    dom.queryVariantSelect.innerHTML = "<option value=''>No variants</option>";
    dom.queryVariantSelect.disabled = true;
    dom.querySibMeta.textContent = "No query selected.";
    dom.queryResultVariabilityMeta.textContent = "Select a query to inspect temporal result stability.";
    dom.querySibTableHead.innerHTML = "";
    dom.querySibTableBody.innerHTML = "";
    clearChartElement(dom.queryDurationChart);
    clearChartElement(dom.queryResultsChart);
    clearChartElement(dom.queryHttpOutcomeChart);
    clearChartElement(dom.queryResultVariabilityChart);
    return;
  }

  const summary = getQuerySummaries().find((item) => item.query_stem === state.selectedQueryStem);
  const variants = getQueryVariants()
    .filter((item) => item.query_stem === state.selectedQueryStem)
    .sort((a, b) => variantRank(a.query_variant) - variantRank(b.query_variant));
  const preferred = preferredVariantForStem(state.selectedQueryStem);

  const queryRecords = records
    .filter((record) => normalizeQueryStem(record.query_name) === state.selectedQueryStem)
    .sort((a, b) => (parseIso(a.start)?.valueOf() || 0) - (parseIso(b.start)?.valueOf() || 0));
  const runsById = new Map(getActiveRuns().map((run) => [run.run_id, run]));

  const succeeded = queryRecords.filter((record) => hasPositiveResultSet(record)).length;
  const durations = queryRecords.map((record) => record.duration_seconds).filter((v) => v !== null && v !== undefined);
  const resultsMax = Math.max(0, ...queryRecords.map((record) => record.results_count || 0));
  const displayName = getQueryDisplayName(state.selectedQueryStem);
  const knownResultCounts = queryRecords
    .map((record) => (record.results_count === null || record.results_count === undefined ? null : Number(record.results_count)))
    .filter((value) => value !== null && !Number.isNaN(value));
  const uniqueResultCounts = [...new Set(knownResultCounts)];
  const hasResultVariability = uniqueResultCounts.length > 1;

  const resultFrequency = new Map();
  knownResultCounts.forEach((value) => {
    resultFrequency.set(value, (resultFrequency.get(value) || 0) + 1);
  });
  const mostFrequentResult = [...resultFrequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;

  dom.querySelectedTitle.textContent = `Query: ${displayName}`;

  const chips = [];
  chips.push(`<span class="stat-chip">${metricLabel("Attempts", "attempts")}: ${queryRecords.length}</span>`);
  chips.push(`<span class="stat-chip">${metricLabel("<strong>execution success rate</strong>", "executionSuccessRate")}: ${formatPercent(queryRecords.length ? succeeded / queryRecords.length : null)}</span>`);
  chips.push(`<span class="stat-chip">${metricLabel("Median duration", "medianDuration")}: ${formatNullableNumber(median(durations))} s</span>`);
  chips.push(`<span class="stat-chip">${metricLabel("Max results", "maxResults")}: ${formatNumber(resultsMax, 0)}</span>`);

  if (summary?.complexity_stats?.number_triple_patterns !== undefined) {
    chips.push(`<span class="stat-chip">Triple patterns: ${summary.complexity_stats.number_triple_patterns}</span>`);
  }
  if (summary?.complexity_stats?.number_federation_member !== undefined) {
    chips.push(`<span class="stat-chip">Federation members: ${summary.complexity_stats.number_federation_member}</span>`);
  }

  variants
    .map((variant) => variant.query_variant)
    .filter((value, index, all) => all.indexOf(value) === index)
    .forEach((variantType) => {
      chips.push(`<span class="query-chip ${queryChipClass(variantType)}">${variantType}</span>`);
    });
  chips.push(`<span class="stat-chip ${hasResultVariability ? "variability-alert" : "variability-stable"}">Result variability: ${hasResultVariability ? "Detected" : "Not detected"}</span>`);

  dom.querySelectedMeta.innerHTML = chips.join("");

  const durationBars = queryRecords.map((record) => ({
    label: getRunDisplayLabel(record.run_id, record.run_label),
    run_id: record.run_id,
    service_mode: getRunServiceMode(runsById.get(record.run_id) || { service_description_mode: record.service_description_mode }, [record]),
    value: record.duration_seconds ?? null,
    color: getRunModeColor(runsById.get(record.run_id) || { service_description_mode: record.service_description_mode }, [record]),
  }));
  const resultsBars = queryRecords.map((record) => ({
    label: getRunDisplayLabel(record.run_id, record.run_label),
    run_id: record.run_id,
    service_mode: getRunServiceMode(runsById.get(record.run_id) || { service_description_mode: record.service_description_mode }, [record]),
    value: record.results_count || 0,
    color: getRunModeColor(runsById.get(record.run_id) || { service_description_mode: record.service_description_mode }, [record]),
  }));

  let previousKnownResult = null;
  let changedTimePointCount = 0;
  const variabilityBars = queryRecords.map((record) => {
    const numericResult = record.results_count === null || record.results_count === undefined
      ? null
      : Number(record.results_count);
    const isKnown = numericResult !== null && !Number.isNaN(numericResult);
    const changedFromPrevious = isKnown && previousKnownResult !== null && numericResult !== previousKnownResult;
    if (changedFromPrevious) {
      changedTimePointCount += 1;
    }
    if (isKnown) {
      previousKnownResult = numericResult;
    }

    let color = CHART_COLORS.secondary;
    if (!isKnown) {
      color = CHART_COLORS.neutral;
    } else if (changedFromPrevious) {
      color = CHART_COLORS.danger;
    } else if (hasResultVariability && mostFrequentResult !== null && numericResult !== mostFrequentResult) {
      color = CHART_COLORS.warning;
    }

    return {
      label: getRunDisplayLabel(record.run_id, record.run_label),
      run_id: record.run_id,
      service_mode: getRunServiceMode(runsById.get(record.run_id) || { service_description_mode: record.service_description_mode }, [record]),
      value: numericResult,
      color,
    };
  });

  renderBarChart(dom.queryDurationChart, durationBars, (value) => formatNumber(value, 1), { xLabel: "Experiment Run", yLabel: "Runtime (seconds)" });
  renderBarChart(dom.queryResultsChart, resultsBars, (value) => formatNumber(value, 0), { xLabel: "Experiment Run", yLabel: "Results (count)" });
  renderHttpOutcomeScatterChart(dom.queryHttpOutcomeChart, queryRecords, runsById);
  renderBarChart(dom.queryResultVariabilityChart, variabilityBars, (value) => formatNumber(value, 0), { xLabel: "Chronological Run", yLabel: "Results (count)" });

  dom.queryResultVariabilityMeta.innerHTML = hasResultVariability
    ? `<span class="variability-highlight critical">Critical finding: result counts vary across time for this query.</span> Unique result counts: ${uniqueResultCounts.map((value) => formatNumber(value, 0)).join(", ")} · Change points: ${changedTimePointCount}`
    : `<span class="variability-highlight stable">Stable finding: result counts are consistent across observed runs.</span> Unique result count: ${uniqueResultCounts.length ? formatNumber(uniqueResultCounts[0], 0) : "null"}`;

  dom.queryRunTableMeta.textContent = `Showing ${queryRecords.length} run records for this query.`;
  dom.queryRunsTableBody.innerHTML = queryRecords.map((record) => {
    const noExplicitError = hasNoExplicitError(record);
    const badgeClass = noExplicitError ? "success" : "failure";
    const badgeText = noExplicitError ? "No explicit error" : "Explicit error";

    const runDisplayLabel = getRunDisplayLabel(record.run_id, record.run_label);
    const runAbbrevLabel = abbreviateRunLabelForAxis(runDisplayLabel);
    const runControlTag = renderRunControlTag(record.run_id);
    return `
      <tr>
        <td data-label="Run">
          <span class="run-label-cell" tabindex="0" aria-label="${escapeHtmlAttr(`Full experiment name: ${runDisplayLabel}`)}">
            <code class="truncate-scroll" title="${escapeHtmlAttr(runDisplayLabel)}">${escapeHtml(runAbbrevLabel)}</code>
            <span class="run-label-tooltip" role="tooltip">${escapeHtml(runDisplayLabel)}</span>
          </span>
          ${runControlTag}
        </td>
        <td data-label="Start">${formatDateTime(record.start)}</td>
        <td data-label="Duration (s)">${formatNullableNumber(record.duration_seconds)}</td>
        <td data-label="Outcome"><span class="badge ${badgeClass}">${badgeText}</span></td>
        <td data-label="Results">${formatNumber(record.results_count, 0)}</td>
        <td data-label="HTTP Requests">${record.http_requests === null || record.http_requests === undefined ? "N/A" : formatNumber(record.http_requests, 0)}</td>
        <td data-label="Error">
          <span class="tag error" title="${escapeHtmlAttr(`Original category: ${record.error_category || "N/A"}`)}">${escapeHtml(getRecordErrorGroup(record))}</span>
          <div class="error-raw">${escapeHtml(record.error_raw === null || record.error_raw === undefined || record.error_raw === "" ? "null" : String(record.error_raw))}</div>
        </td>
      </tr>
    `;
  }).join("");

  const byType = new Map();
  for (const variant of variants) {
    if (!byType.has(variant.query_variant)) {
      byType.set(variant.query_variant, variant);
    }
  }
  const variantOptions = [...byType.values()]
    .sort((a, b) => variantRank(a.query_variant) - variantRank(b.query_variant));

  const remembered = state.selectedQueryVariantByStem.get(state.selectedQueryStem);
  const preferredType = preferred?.query_variant || (variantOptions[0]?.query_variant ?? null);
  const selectedType = variantOptions.some((variant) => variant.query_variant === remembered)
    ? remembered
    : preferredType;
  const selectedVariant = variantOptions.find((variant) => variant.query_variant === selectedType)
    || variantOptions[0]
    || null;

  dom.queryVariantSelect.innerHTML = variantOptions.length
    ? variantOptions
      .map((variant) => `<option value="${escapeHtml(variant.query_variant)}">${escapeHtml(variantLabel(variant.query_variant))}</option>`)
      .join("")
    : "<option value=''>No variants</option>";
  dom.queryVariantSelect.disabled = variantOptions.length <= 1;

  if (selectedVariant) {
    dom.queryVariantSelect.value = selectedVariant.query_variant;
    state.selectedQueryVariantByStem.set(state.selectedQueryStem, selectedVariant.query_variant);
    dom.queryTextDetail.textContent = selectedVariant.query_text || "No query text available for this variant.";
  } else {
    dom.queryVariantSelect.value = "";
    dom.queryTextDetail.textContent = "No query text available for this selection.";
  }

  dom.queryVariantSelect.onchange = () => {
    const requestedType = dom.queryVariantSelect.value;
    state.selectedQueryVariantByStem.set(state.selectedQueryStem, requestedType);
    const nextVariant = variantOptions.find((variant) => variant.query_variant === requestedType) || null;
    dom.queryTextDetail.textContent = nextVariant?.query_text || "No query text available for this variant.";
  };

  const sibColumns = state.queriesDataset?.sib_columns || [];
  const sibRows = summary?.sib_rows || [];

  if (!sibColumns.length || !sibRows.length) {
    dom.querySibMeta.textContent = "No SIB curation metadata available for this query.";
    dom.querySibTableHead.innerHTML = "";
    dom.querySibTableBody.innerHTML = "";
    return;
  }

  dom.querySibMeta.textContent = `Showing ${sibRows.length} SIB curation row(s).`;
  dom.querySibTableHead.innerHTML = `
    <tr>${sibColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
  `;
  dom.querySibTableBody.innerHTML = sibRows.map((row) => `
    <tr>
      ${sibColumns.map((column) => `
        <td data-label="${escapeHtmlAttr(column)}"><div class="sib-cell-content">${formatSibCellValue(row[column] ?? "-")}</div></td>
      `).join("")}
    </tr>
  `).join("");
}

function renderExplorerQueryMode() {
  const activeRecords = getActiveRecords();
  renderQueryList(activeRecords);
  renderQueryDetail(activeRecords);
}

function syncExperimentSelection(activeRuns) {
  const validIds = new Set(activeRuns.map((run) => run.run_id));
  state.selectedExperimentIds = new Set(
    [...state.selectedExperimentIds].filter((runId) => validIds.has(runId)),
  );

  if (!state.experimentSelectionInitialized && activeRuns.length > 0) {
    state.selectedExperimentIds.add(activeRuns[0].run_id);
    state.experimentSelectionInitialized = true;
  }
}

function renderExperimentList(activeRuns) {
  dom.experimentList.innerHTML = activeRuns.map((run) => {
    const checked = state.selectedExperimentIds.has(run.run_id) ? "checked" : "";
    const modeLabel = formatServiceMode(run.service_description_mode);
    const runDisplayLabel = getRunDisplayLabel(run.run_id, run.run_label);
    const runControlTag = renderRunControlTag(run.run_id);
    return `
      <label class="experiment-item">
        <input type="checkbox" data-run-id="${escapeHtmlAttr(run.run_id)}" ${checked} />
        <div class="item-title item-title-experiment">
          <code class="experiment-run-name" title="${escapeHtmlAttr(runDisplayLabel)}">${escapeHtml(runDisplayLabel)}</code>
        </div>
        <div class="item-meta">${formatDateTime(run.run_start)} · ${run.query_count} queries · ${formatPercent(run.success_rate)} execution success rate · ${modeLabel} ${runControlTag}</div>
      </label>
    `;
  }).join("");

  dom.experimentList.querySelectorAll("input[type='checkbox'][data-run-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const runId = input.dataset.runId;
      if (input.checked) {
        state.selectedExperimentIds.add(runId);
      } else {
        state.selectedExperimentIds.delete(runId);
      }
      renderExplorerExperimentMode();
    });
  });
}

function renderExperimentSelectionMeta(selectedRuns, selectedRecords) {
  const successes = selectedRecords.filter((record) => hasPositiveResultSet(record)).length;
  const successRate = selectedRecords.length ? successes / selectedRecords.length : null;
  const chips = [
    `<span class="stat-chip">${metricLabel("Experiments", "experiments")}: ${selectedRuns.length}</span>`,
    `<span class="stat-chip">${metricLabel("Query records", "queryRecords")}: ${selectedRecords.length}</span>`,
    `<span class="stat-chip">${metricLabel("<strong>execution success rate</strong>", "executionSuccessRate")}: ${formatPercent(successRate)}</span>`,
    `<span class="stat-chip">${metricLabel("Median duration", "medianDuration")}: ${formatNullableNumber(median(selectedRecords.map((r) => r.duration_seconds).filter((v) => v !== null && v !== undefined)))} s</span>`,
  ];
  dom.experimentSelectedMeta.innerHTML = chips.join("");
}

function renderExperimentCharts(selectedRuns, selectedRecords) {
  const runRecordMap = new Map(selectedRuns.map((run) => [run.run_id, []]));
  for (const record of selectedRecords) {
    if (runRecordMap.has(record.run_id)) {
      runRecordMap.get(record.run_id).push(record);
    }
  }

  const successBars = selectedRuns.map((run) => {
    const records = runRecordMap.get(run.run_id) || [];
    const successes = records.filter((record) => hasPositiveResultSet(record)).length;
    return {
      label: getRunDisplayLabel(run.run_id, run.run_label),
      run_id: run.run_id,
      service_mode: getRunServiceMode(run, records),
      value: records.length ? (successes / records.length) * 100 : 0,
      color: getRunModeColor(run, records),
    };
  });

  const durationBars = selectedRuns.map((run) => {
    const durations = (runRecordMap.get(run.run_id) || [])
      .map((record) => record.duration_seconds)
      .filter((value) => value !== null && value !== undefined);
    return {
      label: getRunDisplayLabel(run.run_id, run.run_label),
      run_id: run.run_id,
      service_mode: getRunServiceMode(run, runRecordMap.get(run.run_id) || []),
      value: median(durations) ?? null,
      color: getRunModeColor(run, runRecordMap.get(run.run_id) || []),
    };
  });

  const errorMap = new Map();
  for (const record of selectedRecords) {
    if (!hasExplicitError(record)) {
      continue;
    }
    const key = getRecordErrorGroup(record);
    errorMap.set(key, (errorMap.get(key) || 0) + 1);
  }
  const errorBars = [...errorMap.entries()]
    .map(([label, value]) => ({ label, value, color: CHART_COLORS.danger }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  renderBarChart(dom.selectedRunSuccessChart, successBars, (value) => `${value.toFixed(1)}%`, { xLabel: "Experiment Run", yLabel: "Execution Success Rate (%)" });
  renderBarChart(dom.selectedRunDurationChart, durationBars, (value) => formatNumber(value, 1), { xLabel: "Experiment Run", yLabel: "Median Runtime (seconds)" });
  renderBarChart(dom.selectedRunErrorChart, errorBars, (value) => formatNumber(value, 0), { xLabel: "Error Group", yLabel: "Failed Queries (count)" });
}

function buildHttpViewData(selectedRuns, selectedRecords) {
  const aggregateMode = dom.httpAggregateMode.value || "median";
  const queryFilter = dom.httpQueryFilter.value.trim().toLowerCase();
  const requestedTopN = Number(dom.httpTopN.value);
  const topN = Number.isFinite(requestedTopN) && requestedTopN > 0 ? Math.min(300, requestedTopN) : 35;

  const byQueryRun = new Map();
  for (const record of selectedRecords) {
    const stem = normalizeQueryStem(record.query_name);
    if (!stem) {
      continue;
    }
    const displayName = getQueryDisplayName(stem).toLowerCase();
    if (queryFilter && !stem.toLowerCase().includes(queryFilter) && !displayName.includes(queryFilter)) {
      continue;
    }
    if (record.http_requests === null || record.http_requests === undefined) {
      continue;
    }
    const key = `${stem}::${record.run_id}`;
    if (!byQueryRun.has(key)) {
      byQueryRun.set(key, []);
    }
    byQueryRun.get(key).push(record.http_requests);
  }

  const allStems = [...new Set(
    [...byQueryRun.keys()]
      .map((key) => key.split("::")[0])
      .filter(Boolean),
  )];

  const rows = allStems.map((stem) => {
    const values = new Map();
    let total = 0;
    selectedRuns.forEach((run) => {
      const runValues = byQueryRun.get(`${stem}::${run.run_id}`) || [];
      const value = aggregateHttp(runValues, aggregateMode);
      values.set(run.run_id, value);
      if (value !== null) {
        total += value;
      }
    });
    return {
      stem,
      display_name: getQueryDisplayName(stem),
      total,
      values,
    };
  })
    .sort((a, b) => b.total - a.total || a.display_name.localeCompare(b.display_name))
    .slice(0, topN);

  const maxValue = rows.reduce((currentMax, row) => {
    const rowMax = Math.max(0, ...selectedRuns.map((run) => row.values.get(run.run_id) || 0));
    return Math.max(currentMax, rowMax);
  }, 0);

  const filledCells = rows.reduce((count, row) => (
    count + selectedRuns.filter((run) => row.values.get(run.run_id) !== null).length
  ), 0);

  return {
    aggregateMode,
    queryFilter,
    topN,
    rows,
    maxValue,
    filledCells,
  };
}

function renderHttpMatrixTable(selectedRuns, httpData) {
  const header = `
    <thead>
      <tr>
        <th class="query-col">Query</th>
        ${selectedRuns.map((run) => `
          <th title="${escapeHtmlAttr(getRunDisplayLabel(run.run_id, run.run_label || run.run_id))}">
            <span class="truncate-text" title="${escapeHtmlAttr(getRunDisplayLabel(run.run_id, run.run_label))}">${escapeHtml(truncateLabel(getRunDisplayLabel(run.run_id, run.run_label), 16))}</span>
          </th>
        `).join("")}
      </tr>
    </thead>
  `;

  const bodyRows = httpData.rows.map((row) => {
    const cells = selectedRuns.map((run) => {
      const value = row.values.get(run.run_id);
      if (value === null || value === undefined) {
        return "<td class='empty' title='No HTTP request data'>-</td>";
      }
      const display = Math.abs(value) >= 10000 ? formatCompactNumber(value, 1) : formatNumber(value, 0);
      const detailed = formatNumber(value, 0);
      return `<td data-http-value="${value}" title="${escapeHtmlAttr(`${httpData.aggregateMode} HTTP requests: ${detailed}`)}">${display}</td>`;
    }).join("");

    return `
      <tr>
        <th class="query-col">
          <code class="truncate-scroll" title="${escapeHtmlAttr(row.display_name)}">${escapeHtml(row.display_name)}</code>
        </th>
        ${cells}
      </tr>
    `;
  }).join("");

  dom.httpRequestMatrix.innerHTML = `<table class="http-matrix-table">${header}<tbody>${bodyRows}</tbody></table>`;

  const matrixCells = dom.httpRequestMatrix.querySelectorAll("td[data-http-value]");
  matrixCells.forEach((cell) => {
    const value = Number(cell.dataset.httpValue);
    const ratio = httpData.maxValue > 0 ? value / httpData.maxValue : 0;
    const lightness = 96 - ratio * 42;
    cell.style.background = `hsl(210 72% ${lightness}%)`;
  });
}

function renderHttpBarView(selectedRuns, httpData) {
  const groups = httpData.rows.map((row) => ({
    label: row.display_name,
    values: row.values,
  }));
  renderGroupedBarChart(dom.httpRequestBarChart, groups, selectedRuns, { xLabel: "Query", yLabel: "HTTP Requests (count)" });
}

function renderHttpRequestMatrix(selectedRuns, selectedRecords) {
  const mode = dom.httpDisplayMode.value || "matrix";
  const showBar = mode === "bar";
  dom.httpMatrixContainer.classList.toggle("hidden", showBar);
  dom.httpBarContainer.classList.toggle("hidden", !showBar);

  if (!selectedRuns.length) {
    dom.httpRequestMatrixMeta.textContent = "Select one or more experiments to view HTTP request data.";
    dom.httpRequestMatrix.innerHTML = "<div class='item-meta'>No experiments selected.</div>";
    renderGroupedBarChart(dom.httpRequestBarChart, [], [], { xLabel: "Query", yLabel: "HTTP Requests (count)" });
    return;
  }

  const httpData = buildHttpViewData(selectedRuns, selectedRecords);

  if (!httpData.rows.length) {
    dom.httpRequestMatrixMeta.textContent = "No HTTP request values match the current query filter.";
    dom.httpRequestMatrix.innerHTML = "<div class='item-meta'>No HTTP request data for the current filter.</div>";
    renderGroupedBarChart(dom.httpRequestBarChart, [], [], { xLabel: "Query", yLabel: "HTTP Requests (count)" });
    return;
  }

  renderHttpMatrixTable(selectedRuns, httpData);
  renderHttpBarView(selectedRuns, httpData);

  const aggLabel = httpData.aggregateMode === "mean"
    ? "mean"
    : httpData.aggregateMode === "max"
      ? "max"
      : "median";

  dom.httpRequestMatrixMeta.textContent = [
    `Queries shown: ${httpData.rows.length} (top ${httpData.topN})`,
    `Experiments: ${selectedRuns.length}`,
    `Cells with HTTP data: ${httpData.filledCells}`,
    `Max ${aggLabel} HTTP requests: ${formatNumber(httpData.maxValue, 0)}`,
    httpData.queryFilter ? `Filter: "${httpData.queryFilter}"` : "Filter: none",
  ].join(" · ");
}

function renderOptionalInsights(selectedRuns, selectedRecords) {
  if (!selectedRuns.length) {
    dom.successOnlyMeta.innerHTML = "<span class='stat-chip'>No experiments selected</span>";
    renderBarChart(dom.successOnlyResultsChart, [], (value) => formatNumber(value, 0), { xLabel: "Experiment Run", yLabel: "Total Results (count)" });
    renderBarChart(dom.successOnlyDurationChart, [], (value) => formatNumber(value, 1), { xLabel: "Experiment Run", yLabel: "Median Runtime (seconds)" });
    renderBarChart(dom.failureErrorChart, [], (value) => formatNumber(value, 0), { xLabel: "Error Group", yLabel: "Failed Queries (count)" });
    renderBarChart(dom.httpByRunChart, [], (value) => formatNumber(value, 0), { xLabel: "Experiment Run", yLabel: "Median HTTP Requests (count)" });
    return;
  }

  const successRecords = selectedRecords.filter((record) => hasPositiveResultSet(record));
  const failureRecords = selectedRecords.filter((record) => !hasPositiveResultSet(record));
  const knownHttpRecords = selectedRecords.filter(
    (record) => record.http_requests !== null && record.http_requests !== undefined,
  );

  const successDurations = successRecords
    .map((record) => record.duration_seconds)
    .filter((value) => value !== null && value !== undefined);
  const successResults = successRecords
    .map((record) => record.results_count || 0);
  const avgResults = successResults.length
    ? successResults.reduce((sum, value) => sum + value, 0) / successResults.length
    : null;

  dom.successOnlyMeta.innerHTML = [
    `<span class="stat-chip">${metricLabel("Successful records (&gt; 0 results)", "successfulRecords")}: ${formatNumber(successRecords.length, 0)}</span>`,
    `<span class="stat-chip">${metricLabel("Median successful runtime", "medianDuration")}: ${formatNullableNumber(median(successDurations))} s</span>`,
    `<span class="stat-chip">${metricLabel("Avg results on success", "avgResultsOnSuccess")}: ${formatNumber(avgResults)}</span>`,
    `<span class="stat-chip">${metricLabel("Known HTTP records", "knownHttpRecords")}: ${formatNumber(knownHttpRecords.length, 0)}</span>`,
  ].join("");

  const successResultsBars = selectedRuns.map((run) => {
    const runSuccesses = successRecords.filter((record) => record.run_id === run.run_id);
    const totalResults = runSuccesses.reduce((sum, record) => sum + (record.results_count || 0), 0);
    return {
      label: getRunDisplayLabel(run.run_id, run.run_label),
      run_id: run.run_id,
      service_mode: getRunServiceMode(run, runSuccesses),
      value: totalResults,
      color: getRunModeColor(run, runSuccesses),
    };
  });

  const successDurationBars = selectedRuns.map((run) => {
    const runDurations = successRecords
      .filter((record) => record.run_id === run.run_id)
      .map((record) => record.duration_seconds)
      .filter((value) => value !== null && value !== undefined);
    return {
      label: getRunDisplayLabel(run.run_id, run.run_label),
      run_id: run.run_id,
      service_mode: getRunServiceMode(run, successRecords.filter((record) => record.run_id === run.run_id)),
      value: median(runDurations) ?? null,
      color: getRunModeColor(run, successRecords.filter((record) => record.run_id === run.run_id)),
    };
  });

  const failureErrorCounts = new Map();
  for (const record of failureRecords) {
    if (!hasExplicitError(record)) {
      continue;
    }
    const category = getRecordErrorGroup(record);
    failureErrorCounts.set(category, (failureErrorCounts.get(category) || 0) + 1);
  }
  const failureErrorBars = [...failureErrorCounts.entries()]
    .map(([label, value]) => ({ label, value, color: CHART_COLORS.danger }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const httpByRunBars = selectedRuns.map((run) => {
    const runHttp = knownHttpRecords
      .filter((record) => record.run_id === run.run_id)
      .map((record) => record.http_requests);
    return {
      label: getRunDisplayLabel(run.run_id, run.run_label),
      run_id: run.run_id,
      service_mode: getRunServiceMode(run, knownHttpRecords.filter((record) => record.run_id === run.run_id)),
      value: median(runHttp) ?? null,
      color: getRunModeColor(run, knownHttpRecords.filter((record) => record.run_id === run.run_id)),
    };
  });

  renderBarChart(dom.successOnlyResultsChart, successResultsBars, (value) => formatNumber(value, 0), { xLabel: "Experiment Run", yLabel: "Total Results (count)" });
  renderBarChart(dom.successOnlyDurationChart, successDurationBars, (value) => formatNumber(value, 1), { xLabel: "Experiment Run", yLabel: "Median Runtime (seconds)" });
  renderBarChart(dom.failureErrorChart, failureErrorBars, (value) => formatNumber(value, 0), { xLabel: "Error Group", yLabel: "Failed Queries (count)" });
  renderBarChart(dom.httpByRunChart, httpByRunBars, (value) => formatNumber(value, 0), { xLabel: "Experiment Run", yLabel: "Median HTTP Requests (count)" });
}

function renderExperimentQueryTable(selectedRecords) {
  const map = new Map();

  for (const record of selectedRecords) {
    const stem = normalizeQueryStem(record.query_name);
    if (!stem) {
      continue;
    }
    if (!map.has(stem)) {
      map.set(stem, {
        stem,
        attempts: 0,
        successes: 0,
        durations: [],
        maxResults: 0,
      });
    }
    const item = map.get(stem);
    item.attempts += 1;
    if (hasPositiveResultSet(record)) {
      item.successes += 1;
    }
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      item.durations.push(record.duration_seconds);
    }
    if ((record.results_count || 0) > item.maxResults) {
      item.maxResults = record.results_count || 0;
    }
  }

  const rows = [...map.values()]
    .sort((a, b) => b.attempts - a.attempts || getQueryDisplayName(a.stem).localeCompare(getQueryDisplayName(b.stem)));

  dom.experimentQueryTableMeta.textContent = `Showing ${rows.length} aggregated query rows across selected experiments.`;

  dom.experimentQueryTableBody.innerHTML = rows.map((row) => {
    const successRate = row.attempts ? row.successes / row.attempts : null;
    const displayName = getQueryDisplayName(row.stem);
    return `
      <tr>
        <td data-label="Query"><code class="truncate-scroll" title="${escapeHtmlAttr(displayName)}">${escapeHtml(displayName)}</code></td>
        <td data-label="Attempts">${formatNumber(row.attempts, 0)}</td>
        <td data-label="Execution success rate">${formatPercent(successRate)}</td>
        <td data-label="Median duration (s)">${formatNullableNumber(median(row.durations))}</td>
        <td data-label="Max results">${formatNumber(row.maxResults, 0)}</td>
      </tr>
    `;
  }).join("");
}

function renderExplorerExperimentMode() {
  const activeRuns = getActiveRuns();
  syncExperimentSelection(activeRuns);
  const activeRunsChronological = sortRunsChronologically(activeRuns, getActiveRecords());
  renderExperimentList(activeRunsChronological);

  const selectedRuns = sortRunsChronologically(
    activeRuns.filter((run) => state.selectedExperimentIds.has(run.run_id)),
    getActiveRecords(),
  );
  const selectedRunIds = new Set(selectedRuns.map((run) => run.run_id));
  const selectedRecords = getActiveRecords().filter((record) => selectedRunIds.has(record.run_id));

  renderExperimentSelectionMeta(selectedRuns, selectedRecords);
  renderExperimentCharts(selectedRuns, selectedRecords);
  renderHttpRequestMatrix(selectedRuns, selectedRecords);
  renderOptionalInsights(selectedRuns, selectedRecords);
  renderExperimentQueryTable(selectedRecords);
}

function renderExplorerSection() {
  syncModeButtons();
  if (state.explorerMode === "query") {
    renderExplorerQueryMode();
  } else {
    renderExplorerExperimentMode();
  }
}

function renderAll() {
  const recordsBeforeMonthFocus = filterOverviewRecords({ applyMonthFocus: false });
  const records = state.monthFocus
    ? recordsBeforeMonthFocus.filter((record) => getRecordTemporalGroupKey(record) === state.monthFocus)
    : recordsBeforeMonthFocus;

  renderOverviewKpis(records);
  renderOverviewCharts(records);
  renderMonthlyViews(recordsBeforeMonthFocus);
  renderGeneralQueryStatistics();
  renderExplorerSection();
  renderNotesSection();
  ensureChartInfoCards();
  markExpandableSurfaces();
  hydrateMetricHelpAnchors();
  scheduleExplorerListHeightSync();
  syncUrlDashboardState();
  applyPendingFocusTarget();
}

function resetScopeAndFilters() {
  dom.runFilter.value = "";
  dom.outcomeFilter.value = "all";
  dom.errorFilter.value = "";
  dom.serviceFilter.value = "all";
  dom.minSourcesFilter.value = "";
  dom.maxDurationFilter.value = "";
  dom.startDateFilter.value = "";
  dom.endDateFilter.value = "";
  dom.searchFilter.value = "";
  state.monthFocus = null;

  updateRunOptions();
  updateErrorOptions();
  renderAll();
}

function bindEvents() {
  const overviewFilterElements = [
    dom.runFilter,
    dom.outcomeFilter,
    dom.errorFilter,
    dom.serviceFilter,
    dom.minSourcesFilter,
    dom.maxDurationFilter,
    dom.startDateFilter,
    dom.endDateFilter,
    dom.searchFilter,
  ];

  for (const element of overviewFilterElements) {
    const eventName = element === dom.searchFilter ? "input" : "change";
    element.addEventListener(eventName, () => {
      renderAll();
    });
  }

  dom.modeByQuery.addEventListener("click", () => {
    state.explorerMode = "query";
    renderExplorerSection();
  });

  dom.modeByExperiment.addEventListener("click", () => {
    state.explorerMode = "experiment";
    renderExplorerSection();
  });

  dom.queryListSearch.addEventListener("input", () => {
    if (state.explorerMode === "query") {
      renderExplorerQueryMode();
    }
  });

  dom.selectAllExperiments.addEventListener("click", () => {
    state.selectedExperimentIds = new Set(getActiveRuns().map((run) => run.run_id));
    state.experimentSelectionInitialized = true;
    if (state.explorerMode === "experiment") {
      renderExplorerExperimentMode();
    }
  });

  dom.clearExperiments.addEventListener("click", () => {
    state.selectedExperimentIds.clear();
    state.experimentSelectionInitialized = true;
    if (state.explorerMode === "experiment") {
      renderExplorerExperimentMode();
    }
  });

  [dom.httpDisplayMode, dom.httpAggregateMode].forEach((element) => {
    element.addEventListener("change", () => {
      if (state.explorerMode === "experiment") {
        renderExplorerExperimentMode();
      }
    });
  });

  dom.httpQueryFilter.addEventListener("input", () => {
    if (state.explorerMode === "experiment") {
      renderExplorerExperimentMode();
    }
  });

  ["input", "change"].forEach((eventName) => {
    dom.httpTopN.addEventListener(eventName, () => {
      if (state.explorerMode === "experiment") {
        renderExplorerExperimentMode();
      }
    });
  });

  if (dom.resetFilters) {
    dom.resetFilters.addEventListener("click", resetScopeAndFilters);
  }

  if (dom.endpointOutcomeToggleRow) {
    dom.endpointOutcomeToggleRow.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-endpoint-key]");
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const endpointKey = button.dataset.endpointKey;
      if (!endpointKey || endpointKey === state.selectedOverviewEndpoint) {
        return;
      }
      state.selectedOverviewEndpoint = endpointKey;
      renderAll();
    });
  }

  document.querySelectorAll(".table-collapsible").forEach((section) => {
    section.addEventListener("toggle", () => {
      scheduleExplorerListHeightSync();
    });
  });

  document.addEventListener("click", (event) => {
    const infoButton = event.target.closest(".chart-info-btn");
    if (!(infoButton instanceof HTMLButtonElement)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    toggleChartCaption(infoButton);
  });

  document.addEventListener("click", (event) => {
    const expandButton = event.target.closest(".figure-expand-btn");
    if (!(expandButton instanceof HTMLButtonElement)) {
      return;
    }
    const surface = expandButton.closest(".interactive-figure-wrap");
    if (!(surface instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openFocusView(surface);
  });

  dom.focusModalClose.addEventListener("click", closeFocusView);
  dom.focusModal.addEventListener("click", handleExpandableClick);
  document.addEventListener("click", handleExpandableClick);
  document.addEventListener("keydown", handleExpandableKeydown);
  document.addEventListener("pointermove", handleHeatmapPointerMove);
  document.addEventListener("pointerover", handleMetricHelpPointerOver);
  document.addEventListener("pointermove", handleMetricHelpPointerMove);
  document.addEventListener("pointerout", handleMetricHelpPointerOut);
  document.addEventListener("focusin", handleMetricHelpFocusIn);
  document.addEventListener("focusout", handleMetricHelpFocusOut);
  document.addEventListener("pointerleave", () => {
    hideHeatmapTooltip();
    clearHeatmapLegendHighlights();
    hideMetricTooltip();
  });
  document.addEventListener("scroll", () => {
    hideHeatmapTooltip();
    clearHeatmapLegendHighlights();
    hideMetricTooltip();
  }, true);
  window.addEventListener("resize", () => {
    hideHeatmapTooltip();
    clearHeatmapLegendHighlights();
    hideMetricTooltip();
    scheduleExplorerListHeightSync();
    resizeAllCharts();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideMetricTooltip();
    }
  });
}

async function loadData() {
  const [mainDataset, summary, queriesDataset, generalQueryStats, notesText] = await Promise.all([
    fetch(versionedPath("./data/main.json")).then((response) => response.json()),
    fetch(versionedPath("./data/summary.json")).then((response) => response.json()),
    fetch(versionedPath("./data/queries.json")).then((response) => response.json()),
    fetch(versionedPath("./data/general-query-statistics.json"))
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null),
    fetch(versionedPath("./data/experiment-outcomes-notes.txt")).then((response) => response.text()),
  ]);

  state.mainDataset = mainDataset;
  state.summary = summary;
  state.queriesDataset = queriesDataset;
  state.generalQueryStats = generalQueryStats;
  state.notesText = notesText;

  dom.dataMeta.textContent = [
    `Main runs: ${summary.run_count}`,
    `Main query records: ${summary.query_count}`,
    `Canonical queries: ${queriesDataset.query_summary_count}`,
  ].join(" | ");
}

async function bootstrap() {
  try {
    initializeVersionedAssets();
    await loadData();
    syncServiceModeLegendColors();
    const initialUrlState = parseUrlDashboardState();
    updateRunOptions();
    updateErrorOptions();
    applyUrlDashboardState(initialUrlState);
    updateRunOptions();
    updateErrorOptions();
    bindEvents();
    renderAll();
  } catch (error) {
    dom.dataMeta.textContent = `Failed to load dashboard data: ${error.message}`;
    console.error(error);
  }
}

bootstrap();
