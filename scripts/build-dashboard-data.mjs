#!/usr/bin/env node

/**
 * Build normalized dashboard datasets for GitHub Pages.
 *
 * Data policy:
 * - Reads real experimental outputs from experiments/.
 * - Uses existing summary.json when available.
 * - Reconstructs missing summaries from batch and log files using the same parsing logic
 *   as the upstream post-processing script in fed-sparql-survey-expts.
 * - Does not invent values: unknown values remain null.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const experimentsRoot = path.join(repoRoot, "experiments");
const docsDataDir = path.join(repoRoot, "docs", "data");

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?/g;
const URL_RE = /https?:\/\/[^\s']+/g;
const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const ERROR_PATTERNS = [
  "FATAL ERROR: Reached heap limit Allocation failed",
  "fetch failed",
  "DEBUG: Server reported client-side error",
  "DEBUG: Server-side error encountered",
  "Unknown SPARQL results content type",
];

const errorCategoryMatchers = [
  { pattern: /fetch failed/i, category: "Fetch Failure" },
  { pattern: /client-side error/i, category: "Client-Side HTTP Error" },
  { pattern: /server-side error/i, category: "Server-Side Error" },
  { pattern: /heap limit|allocation failed/i, category: "Out of Memory" },
  { pattern: /unknown sparql results content type/i, category: "Content-Type Error" },
  { pattern: /request failed/i, category: "Request Failed" },
  { pattern: /timeout/i, category: "Timeout" },
  { pattern: /forbidden|\b403\b/i, category: "HTTP 403 / Forbidden" },
  { pattern: /\b404\b|not found/i, category: "HTTP 404 / Not Found" },
];

function stripAnsi(text) {
  return text.replace(ANSI_ESCAPE_RE, "");
}

function parseIsoTimestamp(value) {
  if (!value || typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date;
}

function safeIso(value) {
  const date = parseIsoTimestamp(value);
  return date ? date.toISOString() : null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(lowered)) {
      return true;
    }
    if (["false", "0", "no"].includes(lowered)) {
      return false;
    }
  }
  return false;
}

function readTextMaybeZipped(filePath) {
  if (filePath.endsWith(".zip")) {
    try {
      return execFileSync("unzip", ["-p", filePath], { encoding: "utf8" });
    } catch (error) {
      throw new Error(`Failed to read zipped file ${filePath}: ${error.message}`);
    }
  }
  return fs.readFileSync(filePath, "utf8");
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function collectFilesRecursive(dirPath, predicate) {
  const found = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && predicate(entry.name, fullPath)) {
        found.push(fullPath);
      }
    }
  }

  return found;
}

function extractJsonObjectAfterOutput(sectionText) {
  const outputIndex = sectionText.indexOf("Output:");
  if (outputIndex < 0) {
    return null;
  }

  const afterOutput = sectionText.slice(outputIndex);
  const firstBrace = afterOutput.indexOf("{");
  if (firstBrace < 0) {
    return null;
  }

  const jsonStart = outputIndex + firstBrace + 1;
  const text = sectionText;

  let depth = 1;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const jsonText = text.slice(outputIndex + firstBrace, i + 1);
        try {
          return JSON.parse(jsonText);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function getLogDataFromFileOrZipped(filePath, hasError = true) {
  let text;
  try {
    text = readTextMaybeZipped(filePath);
  } catch {
    return { httpRequests: 0, errorText: hasError ? "Unknown Error" : null };
  }

  const lines = text.split(/\r?\n/);
  let infoCount = 0;
  let foundError = null;
  let lastLine = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (line.includes("INFO: Requesting")) {
      infoCount += 1;
    }

    if (hasError && !foundError) {
      for (const pattern of ERROR_PATTERNS) {
        if (line.includes(pattern)) {
          foundError = pattern;
          break;
        }
      }
    }

    if (line !== "") {
      lastLine = line;
    }
  }

  if (!hasError) {
    return { httpRequests: infoCount, errorText: null };
  }

  if (foundError) {
    return { httpRequests: infoCount, errorText: foundError };
  }

  const cleanedLastLine = stripAnsi(lastLine || "").trim();
  if (!cleanedLastLine) {
    return { httpRequests: infoCount, errorText: "Unknown Error" };
  }

  if (cleanedLastLine.includes("[")) {
    return { httpRequests: infoCount, errorText: "Unknown Error" };
  }

  return { httpRequests: infoCount, errorText: cleanedLastLine };
}

function parseBatchLog(batchFilePath) {
  const runDir = path.dirname(batchFilePath);
  const text = readTextMaybeZipped(batchFilePath);
  const sectionsByBlank = text.trim().split(/\n{2,}/);

  if (sectionsByBlank.length < 3) {
    throw new Error(`Unexpected batch-log structure in ${batchFilePath}`);
  }

  const firstMatches = sectionsByBlank[0].match(ISO_RE) || [];
  const lastMatches = sectionsByBlank.at(-1).match(ISO_RE) || [];

  if (!firstMatches.length || !lastMatches.length) {
    throw new Error(`Could not parse run timestamps in ${batchFilePath}`);
  }

  const runStart = parseIsoTimestamp(firstMatches[0]);
  const runEnd = parseIsoTimestamp(lastMatches.at(-1));

  if (!runStart || !runEnd) {
    throw new Error(`Invalid run timestamps in ${batchFilePath}`);
  }

  const entries = [];
  const querySections = text.trim().split(/\n(?=Executing: )/m);

  for (const section of querySections) {
    if (!section.startsWith("Executing: ")) {
      continue;
    }

    const queryFileMatch = section.match(/-f\s+([^\s]+)/);
    const queryName = queryFileMatch ? path.basename(queryFileMatch[1]) : null;

    const firstLine = section.split(/\r?\n/, 1)[0];
    const beforeF = firstLine.includes("-f") ? firstLine.split("-f")[0] : firstLine;

    const urls = [];
    const seen = new Set();
    for (const url of beforeF.match(URL_RE) || []) {
      const normalized = url.replace(/\/+$/, "");
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    }

    const startMatch = section.match(new RegExp(`Timestamp \\(start\\):\\s*(${ISO_RE.source})`));
    const endMatch = section.match(new RegExp(`Timestamp \\(end\\):\\s*(${ISO_RE.source})`));

    const startDate = startMatch ? parseIsoTimestamp(startMatch[1]) : null;
    const endDate = endMatch ? parseIsoTimestamp(endMatch[1]) : null;
    const durationSeconds = startDate && endDate ? (endDate.getTime() - startDate.getTime()) / 1000 : null;

    const startIndex = startMatch ? section.indexOf(startMatch[0]) + startMatch[0].length : 0;
    const endIndex = endMatch ? section.indexOf(endMatch[0]) : section.length;
    const middleSlice = section.slice(startIndex, endIndex);

    let producedResults = false;
    let resultsCount = 0;
    let errorText = "Unknown Error";
    let httpRequests = 0;

    const outputJson = extractJsonObjectAfterOutput(middleSlice);
    if (outputJson && Array.isArray(outputJson?.results?.bindings)) {
      producedResults = true;
      resultsCount = outputJson.results.bindings.length;
    }

    if (queryName) {
      const logFile = path.join(runDir, `${queryName}.log`);
      const zippedLogFile = path.join(runDir, `${queryName}.log.zip`);
      const logPath = fileExists(logFile) ? logFile : fileExists(zippedLogFile) ? zippedLogFile : null;

      if (logPath) {
        if (producedResults) {
          const parsed = getLogDataFromFileOrZipped(logPath, false);
          httpRequests = parsed.httpRequests;
          errorText = "None";
        } else {
          const parsed = getLogDataFromFileOrZipped(logPath, true);
          httpRequests = parsed.httpRequests;
          errorText = parsed.errorText || "Unknown Error";
        }
      } else if (producedResults) {
        errorText = "None";
      }
    }

    entries.push({
      query_name: queryName,
      sources: urls,
      start: startDate ? startDate.toISOString() : null,
      end: endDate ? endDate.toISOString() : null,
      duration_seconds: durationSeconds,
      http_requests: httpRequests,
      produced_results: producedResults,
      results_count: producedResults ? resultsCount : 0,
      error: producedResults ? "None" : errorText,
    });
  }

  return {
    run_start: runStart.toISOString(),
    run_end: runEnd.toISOString(),
    run_duration_seconds: (runEnd.getTime() - runStart.getTime()) / 1000,
    entries,
  };
}

function isBatchLogFilename(name) {
  const lowered = name.toLowerCase();
  const isTxt = lowered.endsWith(".txt") || lowered.endsWith(".txt.zip");
  return isTxt && lowered.includes("batch");
}

function buildSummaryFromBatches(runDir) {
  const batchFiles = collectFilesRecursive(runDir, (name) => isBatchLogFilename(name))
    .sort((a, b) => a.localeCompare(b));

  if (batchFiles.length === 0) {
    return null;
  }

  let earliest = null;
  let latest = null;
  let totalDuration = 0;
  const allEntries = [];

  for (const batchFile of batchFiles) {
    const parsed = parseBatchLog(batchFile);
    const start = parseIsoTimestamp(parsed.run_start);
    const end = parseIsoTimestamp(parsed.run_end);

    if (start && (!earliest || start < earliest)) {
      earliest = start;
    }
    if (end && (!latest || end > latest)) {
      latest = end;
    }

    totalDuration += toNumber(parsed.run_duration_seconds) || 0;
    allEntries.push(...parsed.entries);
  }

  if (!earliest || !latest) {
    return null;
  }

  return {
    general_stats: {
      run_start: earliest.toISOString(),
      run_end: latest.toISOString(),
      run_duration_seconds: totalDuration,
    },
    entries: allEntries,
  };
}

function buildGeneralRow(runLabel, summary) {
  const entries = Array.isArray(summary.entries) ? summary.entries : [];

  let producedResultsCount = 0;
  let nonZeroResultsCount = 0;
  let errorsCount = 0;

  for (const entry of entries) {
    const produced = toBool(entry.produced_results);
    if (produced) {
      producedResultsCount += 1;
    } else {
      errorsCount += 1;
    }
    if ((toNumber(entry.results_count) || 0) > 0) {
      nonZeroResultsCount += 1;
    }
  }

  return {
    query_name: runLabel,
    sources: "None",
    start: summary.general_stats?.run_start || null,
    end: summary.general_stats?.run_end || null,
    duration_seconds: toNumber(summary.general_stats?.run_duration_seconds),
    http_requests: null,
    produced_results: producedResultsCount,
    results_count: nonZeroResultsCount,
    error: errorsCount,
  };
}

function sanitizeSummary(runLabel, summary) {
  const safeSummary = {
    general_stats: {
      run_start: safeIso(summary?.general_stats?.run_start),
      run_end: safeIso(summary?.general_stats?.run_end),
      run_duration_seconds: toNumber(summary?.general_stats?.run_duration_seconds),
    },
    entries: Array.isArray(summary?.entries) ? [...summary.entries] : [],
  };

  const hasGeneralRow = safeSummary.entries.some((entry, index) => index === 0 && entry?.query_name === runLabel);
  if (!hasGeneralRow) {
    safeSummary.entries.unshift(buildGeneralRow(runLabel, safeSummary));
  }

  return safeSummary;
}

function parseSources(rawSources) {
  if (Array.isArray(rawSources)) {
    return rawSources.filter((value) => typeof value === "string" && value.trim() !== "");
  }
  if (typeof rawSources === "string") {
    const trimmed = rawSources.trim();
    if (!trimmed || trimmed.toLowerCase() === "none") {
      return [];
    }
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      // Try to parse Python-style list strings that may appear in CSV-derived data.
      const normalized = trimmed.replace(/'/g, '"');
      try {
        const parsed = JSON.parse(normalized);
        if (Array.isArray(parsed)) {
          return parsed.filter((value) => typeof value === "string");
        }
      } catch {
        // Fall back to a simple split.
      }
    }
    return trimmed.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

function classifyError(errorValue, producedResults) {
  if (producedResults) {
    return "None";
  }

  if (errorValue === null || errorValue === undefined || errorValue === "") {
    return "Unknown Error";
  }

  if (typeof errorValue === "number") {
    return `Error Code ${errorValue}`;
  }

  const text = String(errorValue);
  for (const matcher of errorCategoryMatchers) {
    if (matcher.pattern.test(text)) {
      return matcher.category;
    }
  }

  return "Other Error";
}

function detectServiceDescription(queryName) {
  if (!queryName || typeof queryName !== "string") {
    return null;
  }
  const lowered = queryName.toLowerCase();
  if (lowered.includes("_ns") || lowered.includes("no-service")) {
    return false;
  }
  if (lowered.includes("_ws") || lowered.includes("with-service")) {
    return true;
  }
  return null;
}

function summarizeRunRecords(runRecords) {
  const queryRecords = runRecords.filter((record) => !record.is_run_summary_row);
  const succeeded = queryRecords.filter((record) => record.produced_results).length;
  const nonZero = queryRecords.filter((record) => (record.results_count || 0) > 0).length;

  return {
    query_count: queryRecords.length,
    succeeded_queries: succeeded,
    failed_queries: queryRecords.length - succeeded,
    non_zero_result_queries: nonZero,
    success_rate: queryRecords.length > 0 ? succeeded / queryRecords.length : null,
  };
}

function normalizeRunSummary(runMeta, summary) {
  const records = [];

  for (const entry of summary.entries) {
    const queryName = typeof entry.query_name === "string" ? entry.query_name : null;
    const isRunSummaryRow = queryName === runMeta.run_label;

    const sources = parseSources(entry.sources);
    const producedResults = isRunSummaryRow
      ? false
      : toBool(entry.produced_results);

    const record = {
      run_id: runMeta.run_id,
      run_label: runMeta.run_label,
      run_path: runMeta.run_path,
      run_scope: runMeta.run_scope,
      summary_source: runMeta.summary_source,
      has_summary_file: runMeta.has_summary_file,

      is_run_summary_row: isRunSummaryRow,
      query_name: queryName,
      start: safeIso(entry.start),
      end: safeIso(entry.end),
      duration_seconds: toNumber(entry.duration_seconds),
      http_requests: toNumber(entry.http_requests),

      sources,
      source_count: sources.length,

      produced_results: producedResults,
      results_count: toNumber(entry.results_count) ?? 0,

      error_raw: entry.error === undefined ? null : entry.error,
      error_category: classifyError(entry.error, producedResults),

      has_service_description: isRunSummaryRow ? null : detectServiceDescription(queryName),
    };

    records.push(record);
  }

  return records;
}

function buildDataset(scopeName, runDirs, writeMissingSummaries = false) {
  const runs = [];
  const records = [];

  for (const runDir of runDirs) {
    const runLabel = path.basename(runDir);
    const runPath = path.relative(repoRoot, runDir).replaceAll(path.sep, "/");
    const summaryPath = path.join(runDir, "summary.json");

    let hasSummaryFile = fileExists(summaryPath);
    let summarySource = hasSummaryFile ? "summary.json" : "generated_from_logs";
    let summary;

    if (hasSummaryFile) {
      try {
        summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      } catch (error) {
        console.warn(`[WARN] Failed to parse ${summaryPath}: ${error.message}`);
        summary = null;
      }
    }

    if (!summary) {
      summary = buildSummaryFromBatches(runDir);

      if (!summary) {
        console.warn(`[WARN] Could not build summary for ${runPath}; skipping run.`);
        continue;
      }

      if (writeMissingSummaries) {
        // Persist generated summaries so future runs can rely on canonical run-level files.
        fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        hasSummaryFile = true;
      }
    }

    const sanitized = sanitizeSummary(runLabel, summary);

    if (writeMissingSummaries && summarySource === "generated_from_logs") {
      const csvPath = path.join(runDir, "summary.csv");
      const csv = toCsv(sanitized.entries);
      fs.writeFileSync(csvPath, csv, "utf8");
    }

    const runMeta = {
      run_id: runPath,
      run_label: runLabel,
      run_path: runPath,
      run_scope: scopeName,
      summary_source: summarySource,
      has_summary_file: hasSummaryFile,
    };

    const runRecords = normalizeRunSummary(runMeta, sanitized);
    const runStats = summarizeRunRecords(runRecords);

    runs.push({
      ...runMeta,
      run_start: safeIso(sanitized.general_stats.run_start),
      run_end: safeIso(sanitized.general_stats.run_end),
      run_duration_seconds: toNumber(sanitized.general_stats.run_duration_seconds),
      ...runStats,
    });

    records.push(...runRecords);
  }

  runs.sort((a, b) => {
    const aTime = a.run_start ? new Date(a.run_start).valueOf() : 0;
    const bTime = b.run_start ? new Date(b.run_start).valueOf() : 0;
    return aTime - bTime;
  });

  return {
    generated_at: new Date().toISOString(),
    scope: scopeName,
    run_count: runs.length,
    query_record_count: records.filter((record) => !record.is_run_summary_row).length,
    runs,
    records,
  };
}

function aggregateSummary(dataset) {
  const queryRecords = dataset.records.filter((record) => !record.is_run_summary_row);

  let earliest = null;
  let latest = null;
  const durations = [];
  let httpRequestsKnown = 0;

  const errorCounts = {};

  for (const record of queryRecords) {
    const start = parseIsoTimestamp(record.start);
    const end = parseIsoTimestamp(record.end);

    if (start && (!earliest || start < earliest)) {
      earliest = start;
    }
    if (end && (!latest || end > latest)) {
      latest = end;
    }

    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      durations.push(record.duration_seconds);
    }

    if (record.http_requests !== null && record.http_requests !== undefined) {
      httpRequestsKnown += record.http_requests;
    }

    const key = record.error_category || "Unknown Error";
    errorCounts[key] = (errorCounts[key] || 0) + 1;
  }

  durations.sort((a, b) => a - b);
  const medianDuration = durations.length === 0
    ? null
    : durations.length % 2 === 0
      ? (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
      : durations[Math.floor(durations.length / 2)];

  const succeeded = queryRecords.filter((record) => record.produced_results).length;
  const nonZero = queryRecords.filter((record) => (record.results_count || 0) > 0).length;

  return {
    generated_at: dataset.generated_at,
    scope: dataset.scope,
    run_count: dataset.runs.length,
    query_count: queryRecords.length,
    succeeded_queries: succeeded,
    failed_queries: queryRecords.length - succeeded,
    success_rate: queryRecords.length > 0 ? succeeded / queryRecords.length : null,
    non_zero_result_queries: nonZero,
    median_duration_seconds: medianDuration,
    known_http_requests_total: httpRequestsKnown,
    earliest_query_start: earliest ? earliest.toISOString() : null,
    latest_query_end: latest ? latest.toISOString() : null,
    error_counts: errorCounts,
  };
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const columns = [
    "query_name",
    "sources",
    "start",
    "end",
    "duration_seconds",
    "http_requests",
    "produced_results",
    "results_count",
    "error",
  ];

  const escaped = (value) => {
    if (value === null || value === undefined) {
      return "";
    }
    if (Array.isArray(value)) {
      value = JSON.stringify(value);
    }
    const text = String(value);
    if (text.includes('"') || text.includes(",") || text.includes("\n")) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  };

  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escaped(row[column])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function getMainRunDirs() {
  const entries = fs.readdirSync(experimentsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== "old-results")
    .map((entry) => path.join(experimentsRoot, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function getOldRunDirs() {
  const oldRoot = path.join(experimentsRoot, "old-results");
  if (!fs.existsSync(oldRoot)) {
    return [];
  }

  const candidates = new Set();

  const dirsToVisit = [oldRoot];
  while (dirsToVisit.length > 0) {
    const current = dirsToVisit.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    let hasSummary = false;
    let hasBatch = false;

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        dirsToVisit.push(fullPath);
      } else if (entry.isFile()) {
        if (entry.name === "summary.json") {
          hasSummary = true;
        }
        if (isBatchLogFilename(entry.name)) {
          hasBatch = true;
        }
      }
    }

    if (hasSummary || hasBatch) {
      candidates.add(current);
    }
  }

  return [...candidates].sort((a, b) => a.localeCompare(b));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const writeMissingSummaries = process.argv.includes("--write-missing-summaries");

  const mainRunDirs = getMainRunDirs();
  const oldRunDirs = getOldRunDirs();

  const mainDataset = buildDataset("main", mainRunDirs, writeMissingSummaries);
  const oldDataset = buildDataset("old-results", oldRunDirs, writeMissingSummaries);

  const mainSummary = aggregateSummary(mainDataset);
  const oldSummary = aggregateSummary(oldDataset);

  fs.mkdirSync(docsDataDir, { recursive: true });

  writeJson(path.join(docsDataDir, "main.json"), mainDataset);
  writeJson(path.join(docsDataDir, "old-results.json"), oldDataset);
  writeJson(path.join(docsDataDir, "summary.json"), mainSummary);
  writeJson(path.join(docsDataDir, "summary-old-results.json"), oldSummary);

  console.log(`[OK] Wrote dashboard datasets to ${path.relative(repoRoot, docsDataDir)}`);
  console.log(`[INFO] Main runs: ${mainDataset.run_count}, query records: ${mainSummary.query_count}`);
  console.log(`[INFO] Old-result runs: ${oldDataset.run_count}, query records: ${oldSummary.query_count}`);
}

main();
