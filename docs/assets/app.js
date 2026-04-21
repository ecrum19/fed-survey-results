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
  oldDataset: null,
  queriesDataset: null,
  summary: null,

  includeOldResults: false,
  monthFocus: null,

  explorerMode: "query",
  selectedQueryStem: null,
  selectedQueryVariantByStem: new Map(),
  selectedExperimentIds: new Set(),
  experimentSelectionInitialized: false,
};

const dom = {
  dataMeta: document.getElementById("dataMeta"),

  includeOldResults: document.getElementById("includeOldResults"),
  runFilter: document.getElementById("runFilter"),
  outcomeFilter: document.getElementById("outcomeFilter"),
  errorFilter: document.getElementById("errorFilter"),
  serviceFilter: document.getElementById("serviceFilter"),
  minSourcesFilter: document.getElementById("minSourcesFilter"),
  maxDurationFilter: document.getElementById("maxDurationFilter"),
  startDateFilter: document.getElementById("startDateFilter"),
  endDateFilter: document.getElementById("endDateFilter"),
  searchFilter: document.getElementById("searchFilter"),

  kpiGrid: document.getElementById("kpiGrid"),
  runSuccessChart: document.getElementById("runSuccessChart"),
  errorCategoryChart: document.getElementById("errorCategoryChart"),
  runMedianChart: document.getElementById("runMedianChart"),

  monthPills: document.getElementById("monthPills"),
  monthSuccessChart: document.getElementById("monthSuccessChart"),
  monthVolumeChart: document.getElementById("monthVolumeChart"),
  monthlyRunGrid: document.getElementById("monthlyRunGrid"),

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
};

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

function formatDateTime(value) {
  if (!value) {
    return "N/A";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "N/A";
  }
  return date.toISOString().replace("T", " ").replace(".000Z", "Z");
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

function normalizeQueryStem(rawName) {
  if (!rawName || typeof rawName !== "string") {
    return null;
  }
  let stem = rawName.trim();
  stem = stem.replace(/\.rq$/i, "");
  stem = stem.replace(/_ns$/i, "");
  stem = stem.replace(/_ws$/i, "");
  return stem || null;
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

const HTTP_BAR_PALETTE = [
  "#2d7dd2",
  "#45b39d",
  "#f39c12",
  "#8e44ad",
  "#e74c3c",
  "#1abc9c",
  "#6c5ce7",
  "#16a085",
  "#2980b9",
  "#d35400",
];

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
  return `${year}-${month}`;
}

function getRecordMonthKey(record) {
  return getMonthKey(record.start) || getMonthKey(record.end);
}

function clearSvg(svg) {
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
}

function appendSvgElement(svg, tagName, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  svg.appendChild(element);
  return element;
}

function renderBarChart(svg, data, valueLabelFormatter) {
  clearSvg(svg);

  const width = 640;
  const height = 300;
  const margin = { top: 16, right: 12, bottom: 90, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (!data.length) {
    appendSvgElement(svg, "text", {
      x: width / 2,
      y: height / 2,
      "text-anchor": "middle",
      fill: "#5a6b7d",
      "font-size": 14,
    }).textContent = "No data for current selection";
    return;
  }

  const maxValue = Math.max(...data.map((item) => item.value), 0);
  const yMax = maxValue === 0 ? 1 : maxValue;

  appendSvgElement(svg, "line", {
    x1: margin.left,
    y1: margin.top + innerHeight,
    x2: margin.left + innerWidth,
    y2: margin.top + innerHeight,
    stroke: "#adc4db",
  });

  appendSvgElement(svg, "line", {
    x1: margin.left,
    y1: margin.top,
    x2: margin.left,
    y2: margin.top + innerHeight,
    stroke: "#adc4db",
  });

  const tickCount = 4;
  for (let i = 0; i <= tickCount; i += 1) {
    const value = (yMax / tickCount) * i;
    const y = margin.top + innerHeight - (value / yMax) * innerHeight;

    appendSvgElement(svg, "line", {
      x1: margin.left,
      y1: y,
      x2: margin.left + innerWidth,
      y2: y,
      stroke: "#edf3fa",
    });

    appendSvgElement(svg, "text", {
      x: margin.left - 8,
      y: y + 4,
      "text-anchor": "end",
      fill: "#5a6b7d",
      "font-size": 11,
    }).textContent = formatNumber(value, 1);
  }

  const gap = 8;
  const barWidth = Math.max(8, (innerWidth - gap * (data.length - 1)) / data.length);

  data.forEach((item, index) => {
    const barHeight = (item.value / yMax) * innerHeight;
    const x = margin.left + index * (barWidth + gap);
    const y = margin.top + innerHeight - barHeight;

    appendSvgElement(svg, "rect", {
      x,
      y,
      width: barWidth,
      height: Math.max(0, barHeight),
      fill: item.color || "#0f5fa8",
      rx: 3,
    });

    appendSvgElement(svg, "text", {
      x: x + barWidth / 2,
      y: y - 4,
      "text-anchor": "middle",
      fill: "#1d2a37",
      "font-size": 11,
    }).textContent = valueLabelFormatter(item.value);

    const label = truncateLabel(item.label, 18);
    appendSvgElement(svg, "text", {
      x: x + barWidth / 2,
      y: margin.top + innerHeight + 12,
      transform: `rotate(35 ${x + barWidth / 2} ${margin.top + innerHeight + 12})`,
      "text-anchor": "start",
      fill: "#5a6b7d",
      "font-size": 11,
    }).textContent = label;
  });
}

function renderGroupedBarChart(svg, groups, series) {
  clearSvg(svg);

  const width = 640;
  const height = 300;
  const margin = { top: 40, right: 16, bottom: 104, left: 58 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (!groups.length || !series.length) {
    appendSvgElement(svg, "text", {
      x: width / 2,
      y: height / 2,
      "text-anchor": "middle",
      fill: "#5a6b7d",
      "font-size": 14,
    }).textContent = "No data for current selection";
    return;
  }

  const values = groups.flatMap((group) => series.map((run) => group.values.get(run.run_id) || 0));
  const maxValue = Math.max(...values, 0);
  const yMax = maxValue === 0 ? 1 : maxValue;

  appendSvgElement(svg, "line", {
    x1: margin.left,
    y1: margin.top + innerHeight,
    x2: margin.left + innerWidth,
    y2: margin.top + innerHeight,
    stroke: "#adc4db",
  });

  appendSvgElement(svg, "line", {
    x1: margin.left,
    y1: margin.top,
    x2: margin.left,
    y2: margin.top + innerHeight,
    stroke: "#adc4db",
  });

  const tickCount = 4;
  for (let i = 0; i <= tickCount; i += 1) {
    const value = (yMax / tickCount) * i;
    const y = margin.top + innerHeight - (value / yMax) * innerHeight;
    appendSvgElement(svg, "line", {
      x1: margin.left,
      y1: y,
      x2: margin.left + innerWidth,
      y2: y,
      stroke: "#edf3fa",
    });
    appendSvgElement(svg, "text", {
      x: margin.left - 8,
      y: y + 4,
      "text-anchor": "end",
      fill: "#5a6b7d",
      "font-size": 11,
    }).textContent = formatNumber(value, 1);
  }

  const seriesColors = new Map(series.map((run, index) => [run.run_id, HTTP_BAR_PALETTE[index % HTTP_BAR_PALETTE.length]]));
  const groupWidth = innerWidth / groups.length;
  const groupPadding = Math.min(14, Math.max(4, groupWidth * 0.16));
  const innerGroupWidth = Math.max(4, groupWidth - groupPadding * 2);
  const barGap = Math.min(4, Math.max(1, innerGroupWidth * 0.03));
  const availableBarWidth = innerGroupWidth - (series.length - 1) * barGap;
  const barWidth = Math.max(1, availableBarWidth / Math.max(1, series.length));

  groups.forEach((group, groupIndex) => {
    const groupStartX = margin.left + groupIndex * groupWidth + groupPadding;

    series.forEach((run, runIndex) => {
      const value = group.values.get(run.run_id);
      if (value === null || value === undefined) {
        return;
      }

      const barHeight = (value / yMax) * innerHeight;
      const x = groupStartX + runIndex * (barWidth + barGap);
      const y = margin.top + innerHeight - barHeight;
      const fill = seriesColors.get(run.run_id) || "#0f5fa8";

      const rect = appendSvgElement(svg, "rect", {
        x,
        y,
        width: Math.max(1, barWidth),
        height: Math.max(0, barHeight),
        fill,
        rx: 2,
      });
      const titleNode = document.createElementNS("http://www.w3.org/2000/svg", "title");
      titleNode.textContent = `${group.label} · ${run.run_label}: ${formatNumber(value, 0)}`;
      rect.appendChild(titleNode);
    });

    const labelX = margin.left + groupIndex * groupWidth + groupWidth / 2;
    appendSvgElement(svg, "text", {
      x: labelX,
      y: margin.top + innerHeight + 11,
      transform: `rotate(35 ${labelX} ${margin.top + innerHeight + 11})`,
      "text-anchor": "start",
      fill: "#5a6b7d",
      "font-size": 11,
    }).textContent = truncateLabel(group.label, 18);
  });

  // Compact legend so users can map run colors quickly.
  const legendY = 16;
  series.forEach((run, index) => {
    const x = margin.left + index * 108;
    if (x > width - 90) {
      return;
    }
    const fill = seriesColors.get(run.run_id) || "#0f5fa8";
    appendSvgElement(svg, "rect", {
      x,
      y: legendY - 8,
      width: 10,
      height: 10,
      fill,
      rx: 1,
    });
    appendSvgElement(svg, "text", {
      x: x + 14,
      y: legendY,
      fill: "#2d4a66",
      "font-size": 10,
    }).textContent = truncateLabel(run.run_label, 14);
  });

}

function getActiveRuns() {
  const mainRuns = state.mainDataset?.runs || [];
  const oldRuns = state.oldDataset?.runs || [];
  return state.includeOldResults ? [...mainRuns, ...oldRuns] : mainRuns;
}

function getActiveRecords() {
  const mainRecords = (state.mainDataset?.records || []).filter((record) => !record.is_run_summary_row);
  const oldRecords = (state.oldDataset?.records || []).filter((record) => !record.is_run_summary_row);
  return state.includeOldResults ? [...mainRecords, ...oldRecords] : mainRecords;
}

function getQuerySummaries() {
  return state.queriesDataset?.summaries || [];
}

function getQueryVariants() {
  return state.queriesDataset?.variants || [];
}

function updateRunOptions() {
  const previous = dom.runFilter.value;
  const runs = getActiveRuns();

  const options = ["<option value=''>All runs</option>"];
  for (const run of runs) {
    const modeLabel = formatServiceMode(run.service_description_mode);
    options.push(`<option value="${run.run_id}">${run.run_label} (${modeLabel})</option>`);
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
    categories.add(record.error_category || "Unknown Error");
  }

  const sorted = [...categories].sort((a, b) => a.localeCompare(b));
  const options = ["<option value=''>All categories</option>"];
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
    if (outcomeFilter === "success" && !record.produced_results) {
      return false;
    }
    if (outcomeFilter === "failure" && record.produced_results) {
      return false;
    }
    if (outcomeFilter === "nonzero" && !(record.results_count > 0)) {
      return false;
    }

    if (errorFilter && record.error_category !== errorFilter) {
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
      if (!queryName.includes(searchText)) {
        return false;
      }
    }

    if (applyMonthFocus && state.monthFocus) {
      return getRecordMonthKey(record) === state.monthFocus;
    }

    return true;
  });
}

function renderOverviewKpis(records) {
  const runIds = new Set(records.map((record) => record.run_id));
  const succeeded = records.filter((record) => record.produced_results).length;
  const nonZero = records.filter((record) => record.results_count > 0).length;
  const durations = records
    .map((record) => record.duration_seconds)
    .filter((value) => value !== null && value !== undefined);

  const kpis = [
    { label: "Runs in view", value: formatNumber(runIds.size, 0) },
    { label: "Query records", value: formatNumber(records.length, 0) },
    { label: "Produced results", value: formatNumber(succeeded, 0) },
    { label: "Success rate", value: formatPercent(records.length ? succeeded / records.length : null) },
    { label: "Non-zero results", value: formatNumber(nonZero, 0) },
    { label: "Median duration (s)", value: formatNumber(median(durations)) },
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
  for (const record of records) {
    if (!runMap.has(record.run_id)) {
      runMap.set(record.run_id, {
        label: record.run_label,
        total: 0,
        success: 0,
        durations: [],
      });
    }
    const run = runMap.get(record.run_id);
    run.total += 1;
    if (record.produced_results) {
      run.success += 1;
    }
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      run.durations.push(record.duration_seconds);
    }
  }

  const successBars = [...runMap.values()]
    .map((run) => ({
      label: run.label,
      value: run.total ? (run.success / run.total) * 100 : 0,
      color: "#0f5fa8",
    }))
    .sort((a, b) => b.value - a.value);

  renderBarChart(dom.runSuccessChart, successBars, (value) => `${value.toFixed(1)}%`);

  const errorCounts = new Map();
  for (const record of records) {
    const key = record.error_category || "Unknown Error";
    errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
  }
  const errorBars = [...errorCounts.entries()]
    .map(([label, value]) => ({ label, value, color: "#a03333" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  renderBarChart(dom.errorCategoryChart, errorBars, (value) => formatNumber(value, 0));

  const medianBars = [...runMap.values()]
    .map((run) => ({
      label: run.label,
      value: median(run.durations) || 0,
      color: "#1f7a4d",
    }))
    .sort((a, b) => b.value - a.value);

  renderBarChart(dom.runMedianChart, medianBars, (value) => formatNumber(value, 1));
}

function getMonthlyStats(records) {
  const map = new Map();

  for (const record of records) {
    const monthKey = getRecordMonthKey(record) || "Unknown";
    if (!map.has(monthKey)) {
      map.set(monthKey, {
        monthKey,
        label: monthLabel(monthKey),
        total: 0,
        success: 0,
        durations: [],
        runIds: new Set(),
      });
    }
    const month = map.get(monthKey);
    month.total += 1;
    if (record.produced_results) {
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
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function renderMonthlyViews(recordsBeforeMonthFocus) {
  const monthly = getMonthlyStats(recordsBeforeMonthFocus);

  if (state.monthFocus && !monthly.some((item) => item.monthKey === state.monthFocus)) {
    state.monthFocus = null;
  }

  const pills = [
    `<button type="button" class="month-pill ${state.monthFocus === null ? "active" : ""}" data-month="all">All months</button>`,
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

  const successBars = monthly.map((month) => ({
    label: month.label,
    value: month.successRate * 100,
    color: "#1f7a4d",
  }));
  const volumeBars = monthly.map((month) => ({
    label: month.label,
    value: month.total,
    color: "#0f5fa8",
  }));

  renderBarChart(dom.monthSuccessChart, successBars, (value) => `${value.toFixed(1)}%`);
  renderBarChart(dom.monthVolumeChart, volumeBars, (value) => formatNumber(value, 0));

  const runsById = new Map(getActiveRuns().map((run) => [run.run_id, run]));

  const visibleMonths = state.monthFocus
    ? monthly.filter((month) => month.monthKey === state.monthFocus)
    : monthly;

  if (!visibleMonths.length) {
    dom.monthlyRunGrid.innerHTML = "<article class='month-card'><h4>No monthly data</h4></article>";
    return;
  }

  dom.monthlyRunGrid.innerHTML = visibleMonths.map((month) => {
    const runItems = [...month.runIds]
      .map((runId) => runsById.get(runId))
      .filter(Boolean)
      .sort((a, b) => (b.query_count || 0) - (a.query_count || 0))
      .map((run) => `<li><code>${run.run_label}</code> · ${formatPercent(run.success_rate)} success · ${run.query_count} queries</li>`)
      .join("");

    return `
      <article class="month-card">
        <h4>${month.label}</h4>
        <div class="kpi-label">Queries: ${month.total} · Success: ${formatPercent(month.successRate)} · Median runtime: ${formatNumber(month.medianDuration)}</div>
        <ul class="month-card-list">${runItems}</ul>
      </article>
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
    if (record.produced_results) {
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
    .filter((summary) => summary.query_stem.toLowerCase().includes(search))
    .sort((a, b) => a.query_stem.localeCompare(b.query_stem));

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

    return `
      <div class="query-item ${state.selectedQueryStem === summary.query_stem ? "active" : ""}">
        <button type="button" data-query-stem="${escapeHtmlAttr(summary.query_stem)}">
          <div class="item-title"><code class="truncate-scroll" title="${escapeHtmlAttr(summary.query_stem)}">${escapeHtml(summary.query_stem)}</code></div>
          <div class="item-meta">Variants: ${summary.variant_count} · Main attempts: ${attempts} · Success: ${formatPercent(successRate)}</div>
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
    dom.querySibTableHead.innerHTML = "";
    dom.querySibTableBody.innerHTML = "";
    clearSvg(dom.queryDurationChart);
    clearSvg(dom.queryResultsChart);
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

  const succeeded = queryRecords.filter((record) => record.produced_results).length;
  const durations = queryRecords.map((record) => record.duration_seconds).filter((v) => v !== null && v !== undefined);
  const resultsMax = Math.max(0, ...queryRecords.map((record) => record.results_count || 0));

  dom.querySelectedTitle.textContent = `Query: ${state.selectedQueryStem}`;

  const chips = [];
  chips.push(`<span class="stat-chip">Attempts: ${queryRecords.length}</span>`);
  chips.push(`<span class="stat-chip">Success: ${formatPercent(queryRecords.length ? succeeded / queryRecords.length : null)}</span>`);
  chips.push(`<span class="stat-chip">Median duration: ${formatNumber(median(durations))} s</span>`);
  chips.push(`<span class="stat-chip">Max results: ${formatNumber(resultsMax, 0)}</span>`);

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

  dom.querySelectedMeta.innerHTML = chips.join("");

  const durationBars = queryRecords.map((record) => ({
    label: record.run_label,
    value: record.duration_seconds || 0,
    color: "#0f5fa8",
  }));
  const resultsBars = queryRecords.map((record) => ({
    label: record.run_label,
    value: record.results_count || 0,
    color: "#1f7a4d",
  }));

  renderBarChart(dom.queryDurationChart, durationBars, (value) => formatNumber(value, 1));
  renderBarChart(dom.queryResultsChart, resultsBars, (value) => formatNumber(value, 0));

  dom.queryRunTableMeta.textContent = `Showing ${queryRecords.length} run records for this query.`;
  dom.queryRunsTableBody.innerHTML = queryRecords.map((record) => {
    const badgeClass = record.produced_results ? "success" : "failure";
    const badgeText = record.produced_results ? "Produced" : "No results";

    return `
      <tr>
        <td data-label="Run"><code class="truncate-scroll" title="${escapeHtmlAttr(record.run_label)}">${escapeHtml(record.run_label)}</code></td>
        <td data-label="Start">${formatDateTime(record.start)}</td>
        <td data-label="Duration (s)">${formatNumber(record.duration_seconds)}</td>
        <td data-label="Outcome"><span class="badge ${badgeClass}">${badgeText}</span></td>
        <td data-label="Results">${formatNumber(record.results_count, 0)}</td>
        <td data-label="Error"><span class="tag error truncate-scroll" title="${escapeHtmlAttr(record.error_category || "N/A")}">${escapeHtml(record.error_category || "N/A")}</span></td>
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
        <td data-label="${escapeHtml(column)}">${escapeHtml(row[column] ?? "-")}</td>
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
    return `
      <label class="experiment-item">
        <input type="checkbox" data-run-id="${escapeHtmlAttr(run.run_id)}" ${checked} />
        <div class="item-title"><code class="truncate-scroll" title="${escapeHtmlAttr(run.run_label)}">${escapeHtml(run.run_label)}</code></div>
        <div class="item-meta">${formatDateTime(run.run_start)} · ${run.query_count} queries · ${formatPercent(run.success_rate)} success · ${modeLabel}</div>
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
  const successes = selectedRecords.filter((record) => record.produced_results).length;
  const successRate = selectedRecords.length ? successes / selectedRecords.length : null;
  const chips = [
    `<span class="stat-chip">Experiments: ${selectedRuns.length}</span>`,
    `<span class="stat-chip">Query records: ${selectedRecords.length}</span>`,
    `<span class="stat-chip">Success rate: ${formatPercent(successRate)}</span>`,
    `<span class="stat-chip">Median duration: ${formatNumber(median(selectedRecords.map((r) => r.duration_seconds).filter((v) => v !== null && v !== undefined)))} s</span>`,
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
    const successes = records.filter((record) => record.produced_results).length;
    return {
      label: run.run_label,
      value: records.length ? (successes / records.length) * 100 : 0,
      color: "#0f5fa8",
    };
  });

  const durationBars = selectedRuns.map((run) => {
    const durations = (runRecordMap.get(run.run_id) || [])
      .map((record) => record.duration_seconds)
      .filter((value) => value !== null && value !== undefined);
    return {
      label: run.run_label,
      value: median(durations) || 0,
      color: "#1f7a4d",
    };
  });

  const errorMap = new Map();
  for (const record of selectedRecords) {
    const key = record.error_category || "Unknown Error";
    errorMap.set(key, (errorMap.get(key) || 0) + 1);
  }
  const errorBars = [...errorMap.entries()]
    .map(([label, value]) => ({ label, value, color: "#a03333" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  renderBarChart(dom.selectedRunSuccessChart, successBars, (value) => `${value.toFixed(1)}%`);
  renderBarChart(dom.selectedRunDurationChart, durationBars, (value) => formatNumber(value, 1));
  renderBarChart(dom.selectedRunErrorChart, errorBars, (value) => formatNumber(value, 0));
}

function buildHttpViewData(selectedRuns, selectedRecords) {
  const aggregateMode = dom.httpAggregateMode.value || "median";
  const queryFilter = dom.httpQueryFilter.value.trim().toLowerCase();
  const requestedTopN = Number(dom.httpTopN.value);
  const topN = Number.isFinite(requestedTopN) && requestedTopN > 0 ? Math.min(200, requestedTopN) : 20;

  const byQueryRun = new Map();
  for (const record of selectedRecords) {
    const stem = normalizeQueryStem(record.query_name);
    if (!stem) {
      continue;
    }
    if (queryFilter && !stem.toLowerCase().includes(queryFilter)) {
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
    return { stem, total, values };
  })
    .sort((a, b) => b.total - a.total || a.stem.localeCompare(b.stem))
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
          <th title="${escapeHtmlAttr(run.run_id)}">
            <span class="truncate-text" title="${escapeHtmlAttr(run.run_label)}">${escapeHtml(truncateLabel(run.run_label, 16))}</span>
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
      const display = formatNumber(value, 0);
      return `<td data-http-value="${value}" title="${escapeHtmlAttr(`${httpData.aggregateMode} HTTP requests: ${display}`)}">${display}</td>`;
    }).join("");

    return `
      <tr>
        <th class="query-col">
          <code class="truncate-scroll" title="${escapeHtmlAttr(row.stem)}">${escapeHtml(row.stem)}</code>
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
    label: row.stem,
    values: row.values,
  }));
  renderGroupedBarChart(dom.httpRequestBarChart, groups, selectedRuns);
}

function renderHttpRequestMatrix(selectedRuns, selectedRecords) {
  const mode = dom.httpDisplayMode.value || "matrix";
  const showBar = mode === "bar";
  dom.httpMatrixContainer.classList.toggle("hidden", showBar);
  dom.httpBarContainer.classList.toggle("hidden", !showBar);

  if (!selectedRuns.length) {
    dom.httpRequestMatrixMeta.textContent = "Select one or more experiments to view HTTP request data.";
    dom.httpRequestMatrix.innerHTML = "<div class='item-meta'>No experiments selected.</div>";
    renderGroupedBarChart(dom.httpRequestBarChart, [], []);
    return;
  }

  const httpData = buildHttpViewData(selectedRuns, selectedRecords);

  if (!httpData.rows.length) {
    dom.httpRequestMatrixMeta.textContent = "No HTTP request values match the current query filter.";
    dom.httpRequestMatrix.innerHTML = "<div class='item-meta'>No HTTP request data for the current filter.</div>";
    renderGroupedBarChart(dom.httpRequestBarChart, [], []);
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
    renderBarChart(dom.successOnlyResultsChart, [], (value) => formatNumber(value, 0));
    renderBarChart(dom.successOnlyDurationChart, [], (value) => formatNumber(value, 1));
    renderBarChart(dom.failureErrorChart, [], (value) => formatNumber(value, 0));
    renderBarChart(dom.httpByRunChart, [], (value) => formatNumber(value, 0));
    return;
  }

  const successRecords = selectedRecords.filter((record) => record.produced_results);
  const failureRecords = selectedRecords.filter((record) => !record.produced_results);
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
    `<span class="stat-chip">Successful records: ${formatNumber(successRecords.length, 0)}</span>`,
    `<span class="stat-chip">Median successful runtime: ${formatNumber(median(successDurations))} s</span>`,
    `<span class="stat-chip">Avg results on success: ${formatNumber(avgResults)}</span>`,
    `<span class="stat-chip">Known HTTP records: ${formatNumber(knownHttpRecords.length, 0)}</span>`,
  ].join("");

  const successResultsBars = selectedRuns.map((run) => {
    const runSuccesses = successRecords.filter((record) => record.run_id === run.run_id);
    const totalResults = runSuccesses.reduce((sum, record) => sum + (record.results_count || 0), 0);
    return {
      label: run.run_label,
      value: totalResults,
      color: "#1f7a4d",
    };
  });

  const successDurationBars = selectedRuns.map((run) => {
    const runDurations = successRecords
      .filter((record) => record.run_id === run.run_id)
      .map((record) => record.duration_seconds)
      .filter((value) => value !== null && value !== undefined);
    return {
      label: run.run_label,
      value: median(runDurations) || 0,
      color: "#0f5fa8",
    };
  });

  const failureErrorCounts = new Map();
  for (const record of failureRecords) {
    const category = record.error_category || "Unknown Error";
    failureErrorCounts.set(category, (failureErrorCounts.get(category) || 0) + 1);
  }
  const failureErrorBars = [...failureErrorCounts.entries()]
    .map(([label, value]) => ({ label, value, color: "#a03333" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  const httpByRunBars = selectedRuns.map((run) => {
    const runHttp = knownHttpRecords
      .filter((record) => record.run_id === run.run_id)
      .map((record) => record.http_requests);
    return {
      label: run.run_label,
      value: median(runHttp) || 0,
      color: "#2a8a8d",
    };
  });

  renderBarChart(dom.successOnlyResultsChart, successResultsBars, (value) => formatNumber(value, 0));
  renderBarChart(dom.successOnlyDurationChart, successDurationBars, (value) => formatNumber(value, 1));
  renderBarChart(dom.failureErrorChart, failureErrorBars, (value) => formatNumber(value, 0));
  renderBarChart(dom.httpByRunChart, httpByRunBars, (value) => formatNumber(value, 0));
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
    if (record.produced_results) {
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
    .sort((a, b) => b.attempts - a.attempts || a.stem.localeCompare(b.stem));

  dom.experimentQueryTableMeta.textContent = `Showing ${rows.length} aggregated query rows across selected experiments.`;

  dom.experimentQueryTableBody.innerHTML = rows.map((row) => {
    const successRate = row.attempts ? row.successes / row.attempts : null;
    return `
      <tr>
        <td data-label="Query"><code class="truncate-scroll" title="${escapeHtmlAttr(row.stem)}">${escapeHtml(row.stem)}</code></td>
        <td data-label="Attempts">${formatNumber(row.attempts, 0)}</td>
        <td data-label="Success rate">${formatPercent(successRate)}</td>
        <td data-label="Median duration (s)">${formatNumber(median(row.durations))}</td>
        <td data-label="Max results">${formatNumber(row.maxResults, 0)}</td>
      </tr>
    `;
  }).join("");
}

function renderExplorerExperimentMode() {
  const activeRuns = getActiveRuns();
  syncExperimentSelection(activeRuns);
  renderExperimentList(activeRuns);

  const selectedRuns = activeRuns.filter((run) => state.selectedExperimentIds.has(run.run_id));
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
    ? recordsBeforeMonthFocus.filter((record) => getRecordMonthKey(record) === state.monthFocus)
    : recordsBeforeMonthFocus;

  renderOverviewKpis(records);
  renderOverviewCharts(records);
  renderMonthlyViews(recordsBeforeMonthFocus);
  renderExplorerSection();
}

function bindEvents() {
  const overviewFilterElements = [
    dom.includeOldResults,
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
      if (element === dom.includeOldResults) {
        state.includeOldResults = dom.includeOldResults.checked;
        updateRunOptions();
        updateErrorOptions();
      }
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
}

async function loadData() {
  const [mainDataset, oldDataset, summary, queriesDataset] = await Promise.all([
    fetch("./data/main.json").then((response) => response.json()),
    fetch("./data/old-results.json").then((response) => response.json()),
    fetch("./data/summary.json").then((response) => response.json()),
    fetch("./data/queries.json").then((response) => response.json()),
  ]);

  state.mainDataset = mainDataset;
  state.oldDataset = oldDataset;
  state.summary = summary;
  state.queriesDataset = queriesDataset;

  dom.dataMeta.textContent = [
    `Main runs: ${summary.run_count}`,
    `Main query records: ${summary.query_count}`,
    `Canonical queries: ${queriesDataset.query_summary_count}`,
    `Generated: ${formatDateTime(summary.generated_at)}`,
  ].join(" | ");
}

async function bootstrap() {
  try {
    await loadData();
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
