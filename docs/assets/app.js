/**
 * Front-end controller for the experiment dashboard.
 *
 * This file intentionally keeps logic in plain JavaScript to make
 * long-term maintenance straightforward for static GitHub Pages hosting.
 */

const PAGE_SIZE = 30;

const state = {
  mainDataset: null,
  oldDataset: null,
  mainSummary: null,
  includeOldResults: false,
  monthFocus: null,
  filteredRecords: [],
  currentPage: 1,
  sortKey: "start",
  sortDirection: "desc",
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

  recordsTable: document.getElementById("recordsTable"),
  tableMeta: document.getElementById("tableMeta"),
  recordsTableBody: document.getElementById("recordsTableBody"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageStatus: document.getElementById("pageStatus"),

  recordDetail: document.getElementById("recordDetail"),
};

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
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

function getMonthKey(isoValue) {
  if (!isoValue) {
    return null;
  }
  const date = new Date(isoValue);
  if (Number.isNaN(date.valueOf())) {
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

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function updateRunOptions() {
  const previous = dom.runFilter.value;
  const runs = getActiveRuns();

  const options = ["<option value=''>All runs</option>"];
  for (const run of runs) {
    options.push(`<option value="${run.run_id}">${run.run_label}</option>`);
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

function filterRecords({ applyMonthFocus = true } = {}) {
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
      const recordStart = record.start ? new Date(record.start) : null;
      if (!recordStart || recordStart < startDate) {
        return false;
      }
    }

    if (endDate) {
      const recordEnd = record.end ? new Date(record.end) : null;
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
      if (getRecordMonthKey(record) !== state.monthFocus) {
        return false;
      }
    }

    return true;
  });
}

function renderKpis(records) {
  const runIds = new Set(records.map((record) => record.run_id));
  const succeeded = records.filter((record) => record.produced_results).length;
  const nonZero = records.filter((record) => record.results_count > 0).length;
  const durations = records
    .map((record) => record.duration_seconds)
    .filter((value) => value !== null && value !== undefined);
  const medianDuration = median(durations);

  const kpis = [
    { label: "Runs in view", value: formatNumber(runIds.size, 0) },
    { label: "Query records", value: formatNumber(records.length, 0) },
    { label: "Produced results", value: formatNumber(succeeded, 0) },
    { label: "Success rate", value: formatPercent(records.length > 0 ? succeeded / records.length : null) },
    { label: "Non-zero results", value: formatNumber(nonZero, 0) },
    { label: "Median duration (s)", value: formatNumber(medianDuration) },
  ];

  dom.kpiGrid.innerHTML = kpis.map((kpi) => `
    <article class="kpi-card">
      <div class="kpi-label">${kpi.label}</div>
      <div class="kpi-value">${kpi.value}</div>
    </article>
  `).join("");
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
    }).textContent = "No data for current filters";
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

    const label = item.label.length > 18 ? `${item.label.slice(0, 16)}..` : item.label;
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

function renderCharts(records) {
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

    const runStats = runMap.get(record.run_id);
    runStats.total += 1;
    if (record.produced_results) {
      runStats.success += 1;
    }
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      runStats.durations.push(record.duration_seconds);
    }
  }

  const successByRun = [...runMap.values()]
    .map((run) => ({
      label: run.label,
      value: run.total > 0 ? (run.success / run.total) * 100 : 0,
      color: "#0f5fa8",
    }))
    .sort((a, b) => b.value - a.value);

  renderBarChart(dom.runSuccessChart, successByRun, (value) => `${value.toFixed(1)}%`);

  const errors = new Map();
  for (const record of records) {
    const key = record.error_category || "Unknown Error";
    errors.set(key, (errors.get(key) || 0) + 1);
  }

  const errorBars = [...errors.entries()]
    .map(([label, value]) => ({ label, value, color: "#a03333" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

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
  const monthlyMap = new Map();

  for (const record of records) {
    const monthKey = getRecordMonthKey(record) || "Unknown";
    if (!monthlyMap.has(monthKey)) {
      monthlyMap.set(monthKey, {
        monthKey,
        label: monthLabel(monthKey),
        total: 0,
        success: 0,
        nonZero: 0,
        durations: [],
        runs: new Set(),
      });
    }

    const month = monthlyMap.get(monthKey);
    month.total += 1;
    if (record.produced_results) {
      month.success += 1;
    }
    if (record.results_count > 0) {
      month.nonZero += 1;
    }
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      month.durations.push(record.duration_seconds);
    }
    month.runs.add(record.run_id);
  }

  return [...monthlyMap.values()]
    .map((month) => ({
      ...month,
      successRate: month.total > 0 ? month.success / month.total : 0,
      medianDuration: median(month.durations),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

function renderMonthlyViews(allMonthEligibleRecords) {
  const monthlyStats = getMonthlyStats(allMonthEligibleRecords);

  if (state.monthFocus && !monthlyStats.some((month) => month.monthKey === state.monthFocus)) {
    state.monthFocus = null;
  }

  const pills = [
    `<button type="button" class="month-pill ${state.monthFocus === null ? "active" : ""}" data-month="all">All months</button>`,
    ...monthlyStats.map((month) => `
      <button
        type="button"
        class="month-pill ${state.monthFocus === month.monthKey ? "active" : ""}"
        data-month="${month.monthKey}"
      >
        ${month.label} · ${month.total} q · ${formatPercent(month.successRate)}
      </button>
    `),
  ];
  dom.monthPills.innerHTML = pills.join("");

  dom.monthPills.querySelectorAll(".month-pill").forEach((button) => {
    button.addEventListener("click", () => {
      const month = button.dataset.month;
      state.monthFocus = month === "all" ? null : month;
      handleFilterChange();
    });
  });

  const successBars = monthlyStats.map((month) => ({
    label: month.label,
    value: month.successRate * 100,
    color: "#1f7a4d",
  }));

  const volumeBars = monthlyStats.map((month) => ({
    label: month.label,
    value: month.total,
    color: "#0f5fa8",
  }));

  renderBarChart(dom.monthSuccessChart, successBars, (value) => `${value.toFixed(1)}%`);
  renderBarChart(dom.monthVolumeChart, volumeBars, (value) => formatNumber(value, 0));

  const runStatsById = new Map();
  for (const record of allMonthEligibleRecords) {
    if (!runStatsById.has(record.run_id)) {
      runStatsById.set(record.run_id, {
        runLabel: record.run_label,
        total: 0,
        success: 0,
      });
    }

    const runStats = runStatsById.get(record.run_id);
    runStats.total += 1;
    if (record.produced_results) {
      runStats.success += 1;
    }
  }

  const visibleMonths = state.monthFocus
    ? monthlyStats.filter((month) => month.monthKey === state.monthFocus)
    : monthlyStats;

  if (!visibleMonths.length) {
    dom.monthlyRunGrid.innerHTML = "<article class='month-card'><h4>No monthly data</h4></article>";
    return;
  }

  dom.monthlyRunGrid.innerHTML = visibleMonths.map((month) => {
    const runList = [...month.runs]
      .map((runId) => ({ runId, ...runStatsById.get(runId) }))
      .sort((a, b) => b.total - a.total);

    const runItems = runList
      .map((run) => `<li><code>${run.runLabel}</code> · ${run.success}/${run.total} produced results</li>`)
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

function sortRecords(records) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  const key = state.sortKey;

  const normalizeValue = (record) => {
    const value = record[key];

    if (key === "start") {
      return value ? new Date(value).valueOf() : -Infinity;
    }
    if (key === "produced_results") {
      return record.produced_results ? 1 : 0;
    }
    if (["duration_seconds", "source_count", "http_requests", "results_count"].includes(key)) {
      return value === null || value === undefined ? -Infinity : Number(value);
    }
    return (value || "").toString().toLowerCase();
  };

  return [...records].sort((a, b) => {
    const left = normalizeValue(a);
    const right = normalizeValue(b);

    if (left < right) {
      return -1 * direction;
    }
    if (left > right) {
      return 1 * direction;
    }

    const tieLeft = a.start ? new Date(a.start).valueOf() : 0;
    const tieRight = b.start ? new Date(b.start).valueOf() : 0;
    return tieRight - tieLeft;
  });
}

function updateSortIndicators() {
  dom.recordsTable.querySelectorAll(".sort-btn").forEach((button) => {
    const key = button.dataset.sortKey;
    const isActive = key === state.sortKey;
    button.classList.toggle("active", isActive);
    if (isActive) {
      button.textContent = `${button.textContent.replace(/ [↑↓]$/, "")} ${state.sortDirection === "asc" ? "↑" : "↓"}`;
    } else {
      button.textContent = button.textContent.replace(/ [↑↓]$/, "");
    }
  });
}

function metricBarCell(value, max, fillClass, formatter = (v) => formatNumber(v)) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return `<div class="metric-cell"><div class="metric-value">N/A</div><div class="metric-bar"></div></div>`;
  }
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return `
    <div class="metric-cell">
      <div class="metric-value">${formatter(value)}</div>
      <div class="metric-bar"><div class="metric-fill ${fillClass}" style="width:${percent}%"></div></div>
    </div>
  `;
}

function renderTable(records) {
  const sorted = sortRecords(records);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (state.currentPage > totalPages) {
    state.currentPage = totalPages;
  }

  const maxDuration = Math.max(0, ...sorted.map((record) => Number(record.duration_seconds || 0)));
  const maxSources = Math.max(0, ...sorted.map((record) => Number(record.source_count || 0)));
  const maxHttp = Math.max(0, ...sorted.map((record) => Number(record.http_requests || 0)));
  const maxResults = Math.max(0, ...sorted.map((record) => Number(record.results_count || 0)));

  const startIndex = (state.currentPage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(startIndex, startIndex + PAGE_SIZE);

  dom.recordsTableBody.innerHTML = pageRows.map((record, index) => {
    const badgeClass = record.produced_results ? "success" : "failure";
    const badgeText = record.produced_results ? "Produced results" : "No results";
    const sourcesPreview = record.sources?.slice(0, 2).join("\n") || "No source URLs";

    return `
      <tr data-index="${startIndex + index}">
        <td><code>${record.run_label}</code></td>
        <td><code>${record.query_name || "N/A"}</code></td>
        <td>${formatDateTime(record.start)}</td>
        <td>${metricBarCell(record.duration_seconds, maxDuration, "duration")}</td>
        <td title="${sourcesPreview}">${metricBarCell(record.source_count, maxSources, "sources", (v) => `${formatNumber(v, 0)} sources`)}</td>
        <td>${metricBarCell(record.http_requests, maxHttp, "http", (v) => formatNumber(v, 0))}</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
        <td>${metricBarCell(record.results_count, maxResults, "results", (v) => formatNumber(v, 0))}</td>
        <td><span class="tag error">${record.error_category || "N/A"}</span></td>
      </tr>
    `;
  }).join("");

  const monthNote = state.monthFocus ? ` Month: ${state.monthFocus}.` : "";
  dom.tableMeta.textContent = `Showing ${pageRows.length} of ${sorted.length} filtered records.${monthNote}`;
  dom.pageStatus.textContent = `Page ${state.currentPage} / ${totalPages}`;
  dom.prevPageBtn.disabled = state.currentPage <= 1;
  dom.nextPageBtn.disabled = state.currentPage >= totalPages;

  const rows = dom.recordsTableBody.querySelectorAll("tr");
  rows.forEach((rowElement) => {
    rowElement.addEventListener("click", () => {
      const absoluteIndex = Number(rowElement.dataset.index);
      const selected = sorted[absoluteIndex];
      dom.recordDetail.textContent = JSON.stringify(selected, null, 2);
    });
  });

  updateSortIndicators();
}

function renderAll() {
  // Compute records with all active filters except month-focus so monthly view remains navigable.
  const recordsBeforeMonthFocus = filterRecords({ applyMonthFocus: false });
  const records = state.monthFocus
    ? recordsBeforeMonthFocus.filter((record) => getRecordMonthKey(record) === state.monthFocus)
    : recordsBeforeMonthFocus;

  state.filteredRecords = records;

  renderKpis(records);
  renderCharts(records);
  renderMonthlyViews(recordsBeforeMonthFocus);
  renderTable(records);
}

function handleFilterChange() {
  state.currentPage = 1;
  renderAll();
}

function bindEvents() {
  const filterElements = [
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

  for (const element of filterElements) {
    const eventName = element === dom.searchFilter ? "input" : "change";
    element.addEventListener(eventName, () => {
      if (element === dom.includeOldResults) {
        state.includeOldResults = dom.includeOldResults.checked;
        updateRunOptions();
        updateErrorOptions();
      }
      handleFilterChange();
    });
  }

  dom.recordsTable.querySelectorAll(".sort-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sortKey;
      if (state.sortKey === key) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDirection = "desc";
      }
      state.currentPage = 1;
      renderTable(state.filteredRecords);
    });
  });

  dom.prevPageBtn.addEventListener("click", () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      renderTable(state.filteredRecords);
    }
  });

  dom.nextPageBtn.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(state.filteredRecords.length / PAGE_SIZE));
    if (state.currentPage < totalPages) {
      state.currentPage += 1;
      renderTable(state.filteredRecords);
    }
  });
}

async function loadData() {
  const [mainDataset, oldDataset, mainSummary] = await Promise.all([
    fetch("./data/main.json").then((response) => response.json()),
    fetch("./data/old-results.json").then((response) => response.json()),
    fetch("./data/summary.json").then((response) => response.json()),
  ]);

  state.mainDataset = mainDataset;
  state.oldDataset = oldDataset;
  state.mainSummary = mainSummary;

  dom.dataMeta.textContent = [
    `Main runs: ${mainSummary.run_count}`,
    `Main query records: ${mainSummary.query_count}`,
    `Generated: ${formatDateTime(mainSummary.generated_at)}`,
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
