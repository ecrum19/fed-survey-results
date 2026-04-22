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
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const experimentsRoot = path.join(repoRoot, "experiments");
const queriesRoot = path.join(repoRoot, "queries");
const docsDataDir = path.join(repoRoot, "docs", "data");
const sibQueriesCsvPath = path.join(queriesRoot, "SIB_queries.csv");
const manualServiceControlSourceCsvPrimary = path.join(experimentsRoot, "query_trouble-shooting.csv");
const manualServiceControlSourceCsvMetadata = path.join(experimentsRoot, "comunica-troubleshooting.csv");
const manualServiceControlEndpointRunDir = path.join(experimentsRoot, "service-control-31-03-25-endpoint");
const manualServiceControlComunicaRunDir = path.join(experimentsRoot, "service-control-31-03-25-comunica");
const nonRunExperimentDirs = new Set([
  // Intermediate split artifacts from troubleshooting parsing.
  "service-control-06-03-25",
  // Source artifacts for manual control parsing (not a single runtime experiment).
  "service-control-31-03-25",
]);
const promotedLegacyRuns = [
  // Keep this legacy run visible in the primary dashboard flow.
  // It contains default-service (SERVICE-enabled) experiment data.
  path.join("old-results", "default-service-test-1"),
];
const forceServiceDescriptionRuns = new Set([
  // This run is a service-description control run.
  "experiments/service-control-20-4-26",
  // Hand-curated positive controls (split into endpoint and Comunica views).
  "experiments/service-control-31-03-25-endpoint",
  "experiments/service-control-31-03-25-comunica",
  // Promoted legacy default-service run.
  "experiments/old-results/default-service-test-1",
]);
const runDateOverrides = new Map([
  // Ensure month-bucketing aligns with the March 2025 manual service-control period.
  ["experiments/service-control-31-03-25", {
    run_start: "2025-03-31T00:00:00.000Z",
    run_end: null,
    fill_missing_record_timestamps_from_run: true,
  }],
  ["experiments/service-control-31-03-25-endpoint", {
    run_start: "2025-03-31T00:00:00.000Z",
    run_end: null,
    fill_missing_record_timestamps_from_run: true,
  }],
  ["experiments/service-control-31-03-25-comunica", {
    run_start: "2025-03-31T00:00:00.000Z",
    run_end: null,
    fill_missing_record_timestamps_from_run: true,
  }],
  // Legacy default-service run was part of the same testing window for monthly display.
  ["experiments/old-results/default-service-test-1", {
    run_start: "2025-03-31T00:00:00.000Z",
    run_end: null,
    fill_missing_record_timestamps_from_run: true,
  }],
]);
const legacyDefaultServiceQueryAliasMap = new Map([
  ["Q00000004", "117_biosodafrontend_glioblastoma_orthologs_rat"],
  ["Q00000005", "118_biosodafrontend_rat_brain_human_cancer"],
  ["Q00000007", "027-biosodafrontend"],
  ["Q00000008", "028-biosodafrontend"],
  ["Q00000010", "116_biosodafrontend_rabit_mouse_orthologs"],
  ["Q00000011", "15-rat-TP53-biosodafrontend"],
]);
const runIdsWithKnown18Vs18aIssue = new Set([
  "experiments/EX1-17-9-25",
  "experiments/EX2-13-10-25",
  "experiments/EX3-16-10-25",
  "experiments/EX4-24-10-25",
]);
const queryStemAliasOverrides = new Map([
  ["15-rat-TP53-biosodafrontend", "15-rat-TP53"],
  ["19_draft_human_metabolome", "19-metabolome-draft"],
  ["20_search_chemical_names_in_japanese", "20-japanese-chem-search"],
  ["67_draft_human_metabolome", "67-metabolome-draft"],
  ["70_enzymes_interacting_with_molecules_similar_to_dopamine", "70-dopamine-sim-enzymes"],
  ["71_enzymes_interacting_with_molecules_similar_to_dopamine_with_variants_related_to_disease", "71-dopamine-disease-variants"],
  ["90_uniprot_affected_by_metabolic_diseases_using_MeSH", "90-metabolic-disease-mesh"],
  ["92_uniprot_bioregistry_iri_translation", "92-bioregistry-xref"],
  ["99_uniprot_identifiers_org_translation", "99-identifiers-xref"],
  ["109_uniprot_transporter_in_liver", "109-transporter-liver"],
  ["116_biosodafrontend_rabit_mouse_orthologs", "116-rabbit-mouse-orthologs"],
  ["117_biosodafrontend_glioblastoma_orthologs_rat", "117-glioblastoma-rat"],
  ["118_biosodafrontend_rat_brain_human_cancer", "118-rat-brain-cancer"],
]);

function normalizeSourceUrl(url) {
  if (typeof url !== "string") {
    return null;
  }
  let trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  // Some legacy summaries store Python-list-like quoted values ('https://...').
  trimmed = trimmed.replace(/^['"]+/, "").replace(/['"]+$/, "");
  return trimmed.replace(/\/+$/, "");
}

function applyKnownQueryCorrections(runId, queryName, sources) {
  if (!queryName) {
    return queryName;
  }

  if (runIdsWithKnown18Vs18aIssue.has(runId) && queryName === "18_ns.rq") {
    const normalizedSources = new Set(
      sources
        .map((source) => normalizeSourceUrl(source))
        .filter(Boolean),
    );
    if (
      normalizedSources.has("https://sparql.rhea-db.org/sparql")
      && normalizedSources.has("https://idsm.elixir-czech.cz/sparql/endpoint/chebi")
    ) {
      return "18a_ns.rq";
    }
  }

  return queryName;
}

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
  { pattern: /no comunica results/i, category: "No Comunica Results" },
  { pattern: /no results/i, category: "No Results" },
  { pattern: /long time to run|takes a long time to run/i, category: "Long Runtime" },
  { pattern: /continues to run after results/i, category: "Long Runtime" },
  { pattern: /timeout/i, category: "Timeout" },
  { pattern: /fetch failed/i, category: "Fetch Failure" },
  { pattern: /could not dereference/i, category: "Dereference Failure" },
  { pattern: /invalid sparql endpoint response/i, category: "Invalid Endpoint Response" },
  { pattern: /client-side error/i, category: "Client-Side HTTP Error" },
  { pattern: /server-side error/i, category: "Server-Side Error" },
  { pattern: /heap limit|allocation failed/i, category: "Out of Memory" },
  { pattern: /unknown sparql results content type/i, category: "Content-Type Error" },
  { pattern: /rate limit exceeded/i, category: "HTTP 429 / Rate Limited" },
  { pattern: /order by/i, category: "Query Semantics / ORDER BY" },
  { pattern: /query is broken|broken query/i, category: "Broken Query" },
  { pattern: /request failed/i, category: "Request Failed" },
  { pattern: /forbidden/i, category: "HTTP 403 / Forbidden" },
  { pattern: /not found/i, category: "HTTP 404 / Not Found" },
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
      return execFileSync("unzip", ["-p", filePath], {
        encoding: "utf8",
        // Old query-times archives can be very large.
        maxBuffer: 512 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(`Failed to read zipped file ${filePath}: ${error.message}`);
    }
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseDelimitedLine(line, delimiter = ",") {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseDelimitedCsv(text, delimiter = ",") {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return [];
  }

  const headers = parseDelimitedLine(lines[0], delimiter);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseDelimitedLine(lines[i], delimiter);
    const row = {};

    for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
      const key = headers[colIndex];
      row[key] = values[colIndex] ?? "";
    }

    rows.push(row);
  }

  return rows;
}

const manualBiosodaQueryIdMap = new Map([
  ["Q00000004", "117_biosodafrontend_glioblastoma_orthologs_rat"],
  ["Q00000005", "118_biosodafrontend_rat_brain_human_cancer"],
  ["Q00000007", "027-biosodafrontend"],
  ["Q00000008", "028-biosodafrontend"],
  ["Q00000010", "116_biosodafrontend_rabit_mouse_orthologs"],
  ["Q00000011", "15-rat-TP53-biosodafrontend"],
]);

function splitLooseCsvLine(line) {
  return line.split(",").map((value) => value.trim());
}

function normalizeManualControlQueryName(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return null;
  }
  let value = rawValue.trim();
  if (!value) {
    return null;
  }

  value = value.replace(/^\*+/, "").trim();
  value = value.replace(/\.(?:rq|sparql)$/i, "");

  // comunica-troubleshooting.csv records "*a.sparql" where the matching query
  // in query_trouble-shooting.csv is "*18a.rq".
  if (value.toLowerCase() === "a") {
    value = "18a";
  }

  if (manualBiosodaQueryIdMap.has(value)) {
    return manualBiosodaQueryIdMap.get(value);
  }

  // Ignore non-query note rows such as endpoint legend lines.
  if (!/\d/.test(value)) {
    return null;
  }

  return value;
}

function parseManualResultToken(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return {
      hasValue: false,
      positive: false,
      numeric: null,
      lowerBound: null,
      zero: false,
    };
  }

  const text = String(rawValue).trim();
  if (!text || text === "-") {
    return {
      hasValue: false,
      positive: false,
      numeric: null,
      lowerBound: null,
      zero: false,
    };
  }

  const gtMatch = text.match(/^>\s*(\d+)$/);
  if (gtMatch) {
    const base = Number(gtMatch[1]);
    return {
      hasValue: true,
      positive: true,
      numeric: null,
      lowerBound: Number.isFinite(base) ? base + 1 : 2,
      zero: false,
    };
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return {
      hasValue: true,
      positive: numeric > 0,
      numeric,
      lowerBound: null,
      zero: numeric === 0,
    };
  }

  return {
    hasValue: true,
    positive: false,
    numeric: null,
    lowerBound: null,
    zero: false,
  };
}

function parseManualSources(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return [];
  }
  return rawValue
    .split(/[+,]/)
    .map((value) => value.trim())
    .filter((value) => value && value !== "-");
}

function asIsoForDay(dayText) {
  const match = dayText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }
  const [, dd, mm, yyyy] = match;
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function parseManualControlCsv(sourcePath) {
  const text = fs.readFileSync(sourcePath, "utf8");
  const lines = text.split(/\r?\n/);

  const firstNonEmpty = lines.find((line) => line.trim() !== "") || "";
  const dateMatch = firstNonEmpty.match(/(\d{2}\/\d{2}\/\d{4})/);
  const dateText = dateMatch ? dateMatch[1] : null;

  const headerIndex = lines.findIndex((line) => line.trim().toLowerCase().startsWith("query-name,"));
  if (headerIndex === -1) {
    return { dateText, records: [] };
  }

  const rawHeader = splitLooseCsvLine(lines[headerIndex]);
  const headers = [...rawHeader];
  if (!headers.includes("problem?")) {
    const maybeProblem = lines.slice(headerIndex + 1).find((line) => line.trim() !== "") || "";
    if (maybeProblem.trim().toLowerCase() === "problem?") {
      headers.push("problem?");
    }
  }
  if (!headers.includes("changed-source-url")) {
    headers.push("changed-source-url");
  }

  const records = [];
  let currentSection = null;
  let currentRecord = null;

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      currentRecord = null;
      continue;
    }
    if (trimmed.toLowerCase() === "problem?") {
      continue;
    }
    if (trimmed.toLowerCase().startsWith("query-name,")) {
      continue;
    }

    if (/^\s+/.test(rawLine) && currentRecord) {
      currentRecord.notes.push(trimmed);
      continue;
    }

    if (trimmed.endsWith(":")) {
      currentSection = trimmed.slice(0, -1).trim();
      currentRecord = null;
      continue;
    }

    if (!trimmed.includes(",")) {
      continue;
    }

    const values = splitLooseCsvLine(trimmed);
    while (values.length < headers.length) {
      values.push("-");
    }
    if (values.length > headers.length) {
      const keep = values.slice(0, headers.length - 1);
      keep.push(values.slice(headers.length - 1).join(", ").trim());
      values.length = 0;
      values.push(...keep);
    }

    const row = {};
    for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
      row[headers[colIndex]] = values[colIndex] ?? "-";
    }

    const queryName = normalizeManualControlQueryName(row["query-name"]);
    if (!queryName) {
      continue;
    }

    const record = {
      query_name: queryName,
      section: currentSection,
      sources: parseManualSources(row.sources || row["sib-location"] || ""),
      comunica_result_raw: row["comunica-results"] || "-",
      endpoint_result_raw: row["sparql-endpoint-results"] || "-",
      problem_raw: row["problem?"] || "-",
      changed_source_url_raw: row["changed-source-url"] || "-",
      notes: [],
      source_file: path.basename(sourcePath),
    };

    records.push(record);
    currentRecord = record;
  }

  return { dateText, records };
}

function summarizeManualResultTokens(rawTokens) {
  const tokens = rawTokens
    .map((token) => String(token || "").trim())
    .filter((token) => token !== "");
  const parsed = tokens.map((token) => parseManualResultToken(token));

  const numeric = parsed
    .map((token) => token.numeric)
    .filter((value) => value !== null && value !== undefined);
  const lowerBounds = parsed
    .map((token) => token.lowerBound)
    .filter((value) => value !== null && value !== undefined);

  let resultsCount = null;
  if (numeric.length > 0) {
    resultsCount = Math.max(...numeric);
  } else if (lowerBounds.length > 0) {
    // Keep lower-bound semantics from tokens such as ">1" without inventing exact counts.
    resultsCount = Math.max(...lowerBounds);
  } else if (parsed.some((token) => token.zero)) {
    resultsCount = 0;
  }

  return {
    tokens,
    producedResults: parsed.some((token) => token.positive),
    resultsCount,
  };
}

function collectManualNotes(rawValues) {
  const notes = [];
  for (const value of rawValues) {
    const text = String(value || "").trim();
    if (!text || text === "-") {
      continue;
    }
    notes.push(text);
  }
  return [...new Set(notes)];
}

function buildManualServiceControlSummaries() {
  if (!fs.existsSync(manualServiceControlSourceCsvPrimary)) {
    return [];
  }

  const primaryParsed = parseManualControlCsv(manualServiceControlSourceCsvPrimary);
  const metadataParsed = fs.existsSync(manualServiceControlSourceCsvMetadata)
    ? parseManualControlCsv(manualServiceControlSourceCsvMetadata)
    : { dateText: null, records: [] };

  if (!primaryParsed.records.length) {
    return [];
  }

  const metadataByQuery = new Map();
  for (const record of metadataParsed.records) {
    if (!metadataByQuery.has(record.query_name)) {
      metadataByQuery.set(record.query_name, {
        sections: new Set(),
        issues: new Set(),
        notes: new Set(),
        changes: new Set(),
      });
    }
    const item = metadataByQuery.get(record.query_name);
    if (record.section) {
      item.sections.add(record.section);
    }
    const issue = String(record.problem_raw || "").trim();
    if (issue && issue !== "-") {
      item.issues.add(issue);
    }
    const change = String(record.changed_source_url_raw || "").trim();
    if (change && change !== "-") {
      item.changes.add(change);
    }
    record.notes.forEach((note) => {
      const text = String(note || "").trim();
      if (text) {
        item.notes.add(text);
      }
    });
  }

  const byQuery = new Map();
  for (const record of primaryParsed.records) {
    if (!byQuery.has(record.query_name)) {
      byQuery.set(record.query_name, {
        query_name: record.query_name,
        sources: new Set(),
        sections: new Set(),
        primary_comunica_tokens: [],
        primary_endpoint_tokens: [],
        primary_issues: new Set(),
        primary_changes: new Set(),
      });
    }
    const item = byQuery.get(record.query_name);
    record.sources.forEach((source) => item.sources.add(source));
    if (record.section) {
      item.sections.add(record.section);
    }
    item.primary_comunica_tokens.push(record.comunica_result_raw);
    item.primary_endpoint_tokens.push(record.endpoint_result_raw);

    const issue = String(record.problem_raw || "").trim();
    if (issue && issue !== "-") {
      item.primary_issues.add(issue);
    }
    const change = String(record.changed_source_url_raw || "").trim();
    if (change && change !== "-") {
      item.primary_changes.add(change);
    }
  }

  const runStart = asIsoForDay(primaryParsed.dateText || metadataParsed.dateText || "31/03/2025");

  const makeEntries = (resultStream) => [...byQuery.values()]
    .map((item) => {
      const metadata = metadataByQuery.get(item.query_name);
      const tokenSummary = summarizeManualResultTokens(
        resultStream === "comunica"
          ? item.primary_comunica_tokens
          : item.primary_endpoint_tokens,
      );

      // Core run status comes from query_trouble-shooting.csv.
      // Comunica troubleshooting content is attached as supplemental error metadata.
      const mergedErrorNotes = collectManualNotes([
        ...item.primary_issues,
        ...item.primary_changes,
        ...(metadata ? [...metadata.issues, ...metadata.changes, ...metadata.notes] : []),
      ]);

      const errorText = tokenSummary.producedResults
        ? "None"
        : (mergedErrorNotes.length > 0 ? mergedErrorNotes.join(" | ") : "Unknown Error");

      return {
        query_name: item.query_name,
        sources: [...item.sources].sort().join(", ") || "None",
        start: null,
        end: null,
        duration_seconds: null,
        http_requests: null,
        produced_results: tokenSummary.producedResults,
        results_count: tokenSummary.resultsCount,
        error: errorText,
        control_result_stream: resultStream,
        control_core_source_file: path.basename(manualServiceControlSourceCsvPrimary),
        control_error_metadata_source_file: path.basename(manualServiceControlSourceCsvMetadata),
        control_sections_primary: [...item.sections].sort(),
        control_sections_metadata: metadata ? [...metadata.sections].sort() : [],
        control_primary_comunica_results: summarizeManualResultTokens(item.primary_comunica_tokens).tokens,
        control_primary_endpoint_results: summarizeManualResultTokens(item.primary_endpoint_tokens).tokens,
        control_comunica_error_metadata: metadata
          ? collectManualNotes([...metadata.issues, ...metadata.changes, ...metadata.notes])
          : [],
      };
    })
    .sort((a, b) => a.query_name.localeCompare(b.query_name));

  const buildSummary = (resultStream) => ({
    general_stats: {
      run_start: runStart,
      // Manual control sheets only record the day, not an end timestamp.
      run_end: null,
      run_duration_seconds: null,
    },
    entries: makeEntries(resultStream),
  });

  return [
    { runDir: manualServiceControlEndpointRunDir, summary: buildSummary("endpoint") },
    { runDir: manualServiceControlComunicaRunDir, summary: buildSummary("comunica") },
  ];
}

function ensureManualServiceControlSummaries() {
  const generated = buildManualServiceControlSummaries();
  for (const item of generated) {
    fs.mkdirSync(item.runDir, { recursive: true });
    const summaryPath = path.join(item.runDir, "summary.json");
    fs.writeFileSync(summaryPath, `${JSON.stringify(item.summary, null, 2)}\n`, "utf8");
  }
}

function parseDelimitedLineSelected(line, delimiter, selectedIndices) {
  const values = {};
  let fieldIndex = 0;
  let inQuotes = false;
  let current = "";
  let captureCurrent = selectedIndices.has(fieldIndex);

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        if (captureCurrent) {
          current += '"';
        }
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      if (captureCurrent) {
        values[fieldIndex] = current;
      }
      fieldIndex += 1;
      captureCurrent = selectedIndices.has(fieldIndex);
      current = "";
      continue;
    }

    if (captureCurrent) {
      current += char;
    }
  }

  if (captureCurrent) {
    values[fieldIndex] = current;
  }

  return values;
}

function parseLegacyQueryTimesRows(text) {
  let cursor = 0;
  const firstBreak = text.indexOf("\n");
  if (firstBreak < 0) {
    return [];
  }

  const headerLine = text
    .slice(0, firstBreak)
    .replace(/\r$/, "");
  const headers = parseDelimitedLine(headerLine, ";");

  const wantedColumns = [
    "name",
    "error",
    "errorDescription",
    "httpRequests",
    "results",
    "time",
  ];

  const headerIndexByName = new Map();
  headers.forEach((header, index) => headerIndexByName.set(header, index));

  const selectedIndices = new Set(
    wantedColumns
      .map((name) => headerIndexByName.get(name))
      .filter((index) => index !== undefined),
  );

  cursor = firstBreak + 1;
  const rows = [];

  while (cursor < text.length) {
    const nextBreak = text.indexOf("\n", cursor);
    const line = text
      .slice(cursor, nextBreak === -1 ? text.length : nextBreak)
      .replace(/\r$/, "");
    cursor = nextBreak === -1 ? text.length : nextBreak + 1;

    if (line.trim() === "") {
      continue;
    }

    const parsed = parseDelimitedLineSelected(line, ";", selectedIndices);
    const row = {};
    for (const column of wantedColumns) {
      const index = headerIndexByName.get(column);
      row[column] = index === undefined ? "" : (parsed[index] ?? "");
    }
    rows.push(row);
  }

  return rows;
}

function extractLogTimeBoundsFromRun(runDir) {
  const logFiles = collectFilesRecursive(
    runDir,
    (name) => name.toLowerCase().endsWith(".txt") || name.toLowerCase().endsWith(".txt.zip"),
  );

  let earliest = null;
  let latest = null;

  for (const logFile of logFiles) {
    let text;
    try {
      text = readTextMaybeZipped(logFile);
    } catch {
      continue;
    }

    const matches = stripAnsi(text).match(ISO_RE) || [];
    for (const match of matches) {
      const stamp = parseIsoTimestamp(match);
      if (!stamp) {
        continue;
      }
      if (!earliest || stamp < earliest) {
        earliest = stamp;
      }
      if (!latest || stamp > latest) {
        latest = stamp;
      }
    }
  }

  return {
    run_start: earliest ? earliest.toISOString() : null,
    run_end: latest ? latest.toISOString() : null,
    run_duration_seconds: earliest && latest
      ? (latest.getTime() - earliest.getTime()) / 1000
      : null,
  };
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

function findLegacyQueryTimesFile(runDir) {
  const candidates = collectFilesRecursive(runDir, (name) => {
    const lowered = name.toLowerCase();
    return lowered === "query-times.csv" || lowered === "query-times.csv.zip";
  }).sort((a, b) => a.localeCompare(b));

  if (!candidates.length) {
    return null;
  }

  // Prefer zipped files because old runs often store the authoritative query-times in zip form.
  const preferred = candidates.find((filePath) => filePath.toLowerCase().endsWith(".zip"));
  return preferred || candidates[0];
}

function buildSummaryFromLegacyQueryTimes(runDir) {
  const queryTimesPath = findLegacyQueryTimesFile(runDir);
  if (!queryTimesPath) {
    return null;
  }

  let text;
  try {
    text = readTextMaybeZipped(queryTimesPath);
  } catch (error) {
    console.warn(`[WARN] Could not read ${path.relative(repoRoot, queryTimesPath)}: ${error.message}`);
    return null;
  }

  const rows = parseLegacyQueryTimesRows(text);
  if (!rows.length || !Object.hasOwn(rows[0], "name")) {
    return null;
  }

  const logBounds = extractLogTimeBoundsFromRun(runDir);
  const runPath = path.relative(repoRoot, runDir).replaceAll(path.sep, "/");
  const shouldApplyLegacyAliases = runPath === "experiments/old-results/default-service-test-1";

  const entries = rows.map((row) => {
    const rawQueryName = row.name && String(row.name).trim() !== "" ? String(row.name).trim() : null;
    const queryName = shouldApplyLegacyAliases && rawQueryName
      ? (legacyDefaultServiceQueryAliasMap.get(rawQueryName) || rawQueryName)
      : rawQueryName;
    const isError = toBool(row.error);
    const rawTimeMs = toNumber(row.time);

    return {
      query_name: queryName,
      sources: [],
      // Legacy query-times artifacts do not expose per-query absolute timestamps.
      start: null,
      end: null,
      duration_seconds: rawTimeMs !== null ? rawTimeMs / 1000 : null,
      http_requests: toNumber(row.httpRequests),
      produced_results: !isError,
      results_count: toNumber(row.results) ?? 0,
      error: isError
        ? (row.errorDescription && String(row.errorDescription).trim() !== ""
          ? String(row.errorDescription).trim()
          : "Unknown Error")
        : "None",
    };
  });

  return {
    general_stats: {
      run_start: logBounds.run_start,
      run_end: logBounds.run_end,
      run_duration_seconds: logBounds.run_duration_seconds,
    },
    entries,
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

function applyRunDateOverride(runPath, summary) {
  const override = runDateOverrides.get(runPath);
  if (!override) {
    return { summary, override: null };
  }

  const next = {
    ...summary,
    general_stats: {
      ...summary.general_stats,
    },
  };

  if (Object.prototype.hasOwnProperty.call(override, "run_start")) {
    next.general_stats.run_start = safeIso(override.run_start);
  }
  if (Object.prototype.hasOwnProperty.call(override, "run_end")) {
    next.general_stats.run_end = safeIso(override.run_end);
  }
  if (Object.prototype.hasOwnProperty.call(override, "run_duration_seconds")) {
    next.general_stats.run_duration_seconds = toNumber(override.run_duration_seconds);
  }

  return { summary: next, override };
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

function extractHttpStatusCode(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const patterns = [
    /\bhttp status\s*(\d{3})\b/i,
    /\berror\s*(\d{3})\b/i,
    /\(HTTP status\s*(\d{3})\)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const code = Number(match[1]);
      if (Number.isFinite(code) && code >= 100 && code <= 599) {
        return code;
      }
    }
  }

  return null;
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

  const text = String(errorValue).trim();
  const statusCode = extractHttpStatusCode(text);
  if (statusCode !== null) {
    if (statusCode === 400) {
      return "HTTP 400 / Bad Request";
    }
    if (statusCode === 403) {
      return "HTTP 403 / Forbidden";
    }
    if (statusCode === 404) {
      return "HTTP 404 / Not Found";
    }
    if (statusCode === 406) {
      return "HTTP 406 / Not Acceptable";
    }
    if (statusCode === 429) {
      return "HTTP 429 / Rate Limited";
    }
    if (statusCode === 500) {
      return "HTTP 500 / Server Error";
    }
    if (statusCode >= 500) {
      return "HTTP 5xx Server Error";
    }
    if (statusCode >= 400) {
      return "HTTP 4xx Client Error";
    }
    return `HTTP ${statusCode}`;
  }

  for (const matcher of errorCategoryMatchers) {
    if (matcher.pattern.test(text)) {
      return matcher.category;
    }
  }

  return text || "Other Error";
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

function parseQueryStatMap() {
  const statPath = path.join(queriesRoot, "stat.json");
  if (!fileExists(statPath)) {
    return new Map();
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statPath, "utf8"));
  } catch (error) {
    console.warn(`[WARN] Failed to parse ${path.relative(repoRoot, statPath)}: ${error.message}`);
    return new Map();
  }

  const data = parsed?.data;
  if (!data || typeof data !== "object") {
    return new Map();
  }

  const map = new Map();
  for (const [rawKey, stats] of Object.entries(data)) {
    let tail = rawKey;
    try {
      // Handle URL-like keys.
      tail = decodeURIComponent(new URL(rawKey).pathname.split("/").at(-1) || rawKey);
    } catch {
      // Handle non-URL keys.
      tail = rawKey.split("/").at(-1) || rawKey;
    }

    const stem = normalizeQueryStem(tail);
    if (!stem) {
      continue;
    }

    // Prefer the first discovered stats entry for a stem.
    if (!map.has(stem)) {
      map.set(stem, stats);
    }
  }

  return map;
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

function summarizeObservedQueryStats(dataset) {
  const map = new Map();
  const records = dataset.records.filter((record) => !record.is_run_summary_row);

  for (const record of records) {
    const stem = normalizeQueryStem(record.query_name);
    if (!stem) {
      continue;
    }

    if (!map.has(stem)) {
      map.set(stem, {
        query_stem: stem,
        run_ids: new Set(),
        attempts: 0,
        successes: 0,
        non_zero_results: 0,
        durations: [],
        max_results_count: 0,
        last_seen_start: null,
      });
    }

    const item = map.get(stem);
    item.run_ids.add(record.run_id);
    item.attempts += 1;
    if (record.produced_results) {
      item.successes += 1;
    }
    if ((record.results_count || 0) > 0) {
      item.non_zero_results += 1;
      if (record.results_count > item.max_results_count) {
        item.max_results_count = record.results_count;
      }
    }
    if (record.duration_seconds !== null && record.duration_seconds !== undefined) {
      item.durations.push(record.duration_seconds);
    }

    const start = parseIsoTimestamp(record.start);
    if (start && (!item.last_seen_start || start > item.last_seen_start)) {
      item.last_seen_start = start;
    }
  }

  const summarized = new Map();
  for (const [stem, item] of map.entries()) {
    summarized.set(stem, {
      query_stem: stem,
      attempts: item.attempts,
      run_count: item.run_ids.size,
      successes: item.successes,
      success_rate: item.attempts > 0 ? item.successes / item.attempts : null,
      non_zero_results: item.non_zero_results,
      max_results_count: item.max_results_count,
      median_duration_seconds: median(item.durations),
      last_seen_start: item.last_seen_start ? item.last_seen_start.toISOString() : null,
    });
  }

  return summarized;
}

function extractQueryTextStats(queryText) {
  const lines = queryText.split(/\r?\n/);
  const trimmedLines = lines.map((line) => line.trim());
  const nonEmpty = trimmedLines.filter((line) => line.length > 0);

  const withoutComments = lines
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  const count = (pattern) => (withoutComments.match(pattern) || []).length;

  const selectMatch = withoutComments.match(/\bSELECT\b([\s\S]*?)\bWHERE\b/i);
  let selectVarCount = null;
  if (selectMatch) {
    const body = selectMatch[1];
    if (/\*/.test(body)) {
      selectVarCount = null;
    } else {
      const vars = new Set((body.match(/\?[A-Za-z_][A-Za-z0-9_]*/g) || []).map((v) => v.toLowerCase()));
      selectVarCount = vars.size;
    }
  }

  const limitMatch = withoutComments.match(/\bLIMIT\s+(\d+)/i);
  const serviceIris = new Set();
  const servicePattern = /\bSERVICE\b\s*<([^>]+)>/ig;
  let serviceMatch = servicePattern.exec(withoutComments);
  while (serviceMatch) {
    serviceIris.add(serviceMatch[1].trim());
    serviceMatch = servicePattern.exec(withoutComments);
  }

  return {
    line_count: lines.length,
    non_empty_line_count: nonEmpty.length,
    character_count: queryText.length,
    prefix_count: count(/\bPREFIX\b/gi),
    optional_count: count(/\bOPTIONAL\b/gi),
    union_count: count(/\bUNION\b/gi),
    filter_count: count(/\bFILTER\b/gi),
    bind_count: count(/\bBIND\b/gi),
    service_clause_count: count(/\bSERVICE\b/gi),
    service_iri_count: serviceIris.size,
    service_iris: [...serviceIris].sort(),
    has_service_clause: /\bSERVICE\b/i.test(withoutComments),
    distinct: /\bSELECT\b[\s\S]*?\bDISTINCT\b/i.test(withoutComments),
    limit_value: limitMatch ? Number(limitMatch[1]) : null,
    select_var_count: selectVarCount,
  };
}

function classifyQueryVariant(relativePathFromQueries) {
  const normalized = relativePathFromQueries.replaceAll(path.sep, "/");
  if (normalized.startsWith("original/")) {
    return "original";
  }
  if (normalized.startsWith("no-service/broken/")) {
    return "no-service-broken";
  }
  if (normalized.startsWith("no-service/")) {
    return "no-service";
  }
  return "other";
}

function extractQueryTailFromReference(rawReference) {
  if (!rawReference || typeof rawReference !== "string") {
    return null;
  }

  const trimmed = rawReference.trim();
  if (!trimmed || trimmed === "-") {
    return null;
  }

  let tail = trimmed;
  try {
    const parsed = new URL(trimmed);
    const pathTail = decodeURIComponent(parsed.pathname.split("/").at(-1) || "").trim();
    const hash = decodeURIComponent((parsed.hash || "").trim());
    // Preserve fragment-based identifiers, e.g. https://purl.org/emi#examples011a -> emi#examples011a
    tail = hash ? `${pathTail}${hash}` : (pathTail || trimmed);
  } catch {
    tail = trimmed.split("/").at(-1) || trimmed;
  }

  const stem = normalizeQueryStem(tail);
  return stem || null;
}

function mapSibReferenceToQueryStem(referenceStem, canonicalStems) {
  if (!referenceStem) {
    return null;
  }

  if (canonicalStems.has(referenceStem)) {
    return referenceStem;
  }

  const suffixMatches = [...canonicalStems].filter((stem) => stem.endsWith(`_${referenceStem}`));
  if (suffixMatches.length === 1) {
    return suffixMatches[0];
  }

  const containsMatches = [...canonicalStems].filter((stem) => stem.includes(referenceStem));
  if (containsMatches.length === 1) {
    return containsMatches[0];
  }

  return null;
}

function disambiguateSibReferenceStem(referenceStem, row) {
  if (referenceStem !== "18") {
    return referenceStem;
  }

  const queryRef = (row?.Query || row?.query || "").toLowerCase();
  const targetEndpoint = (row?.["Target endpoint"] || row?.target_endpoint || "").toLowerCase();
  const federatedEndpoints = (row?.["Federated endpoints"] || row?.federated_endpoints || "").toLowerCase();
  const combined = `${queryRef} ${targetEndpoint} ${federatedEndpoints}`;

  // SIB "example/18" appears in two ecosystems:
  // - OrthoDB + NextProt => local query stem "18"
  // - Rhea + IDSM/ChEBI => local query stem "18a"
  if (combined.includes("sparql.rhea-db.org") && combined.includes("idsm.elixir-czech.cz")) {
    return "18a";
  }
  if (combined.includes("sparql.orthodb.org") && combined.includes("sparql.nextprot.org")) {
    return "18";
  }

  return referenceStem;
}

function normalizeSibAlias(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text || text === "-") {
    return null;
  }
  return text;
}

function buildQueryAliasMap(canonicalStems, parsedRows) {
  const aliases = new Map();

  // First pass: consume explicit aliases curated in SIB_queries.csv.
  for (const row of parsedRows) {
    const rawReferenceStem = extractQueryTailFromReference(row.Query || row.query || null);
    const referenceStem = disambiguateSibReferenceStem(rawReferenceStem, row);
    const mappedStem = mapSibReferenceToQueryStem(referenceStem, canonicalStems);
    if (!mappedStem) {
      continue;
    }
    const explicitAlias = normalizeSibAlias(row["Query alias"] || row.query_alias || null);
    if (explicitAlias && !aliases.has(mappedStem)) {
      aliases.set(mappedStem, explicitAlias);
    }
  }

  // Second pass: use maintained overrides so long query names stay concise even
  // if a row is not present in SIB_queries.csv.
  for (const stem of canonicalStems) {
    if (aliases.has(stem)) {
      continue;
    }
    const override = queryStemAliasOverrides.get(stem) || null;
    if (override) {
      aliases.set(stem, override);
    }
  }

  return aliases;
}

function parseSibQueryRows() {
  if (!fileExists(sibQueriesCsvPath)) {
    return { columns: [], rows: [] };
  }

  const text = fs.readFileSync(sibQueriesCsvPath, "utf8");
  const rows = parseDelimitedCsv(text, ",");
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  const normalizedRows = rows.map((row) => {
    const normalized = {};
    for (const column of columns) {
      const value = row[column];
      const textValue = value === null || value === undefined ? "" : String(value).trim();
      normalized[column] = textValue === "" ? "-" : textValue;
    }
    return normalized;
  });

  return { columns, rows: normalizedRows };
}

function attachSibQueryContext(summaries) {
  const canonicalStems = new Set(summaries.map((summary) => summary.query_stem));
  const parsed = parseSibQueryRows();
  const queryAliases = buildQueryAliasMap(canonicalStems, parsed.rows);
  const rowsByStem = new Map();
  const unmatchedRows = [];
  let matchedRows = 0;

  for (const row of parsed.rows) {
    const rawReferenceStem = extractQueryTailFromReference(row.Query || row.query || null);
    const referenceStem = disambiguateSibReferenceStem(rawReferenceStem, row);
    const mappedStem = mapSibReferenceToQueryStem(referenceStem, canonicalStems);

    if (!mappedStem) {
      unmatchedRows.push(row);
      continue;
    }

    if (!rowsByStem.has(mappedStem)) {
      rowsByStem.set(mappedStem, []);
    }
    rowsByStem.get(mappedStem).push(row);
    matchedRows += 1;
  }

  const enriched = summaries.map((summary) => {
    const sibRows = rowsByStem.get(summary.query_stem) || [];
    return {
      ...summary,
      sib_row_count: sibRows.length,
      sib_rows: sibRows,
    };
  });

  return {
    summaries: enriched,
    query_aliases: Object.fromEntries(
      [...queryAliases.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    ),
    sib_columns: parsed.columns,
    sib_query_row_count: parsed.rows.length,
    sib_matched_row_count: matchedRows,
    sib_unmatched_row_count: unmatchedRows.length,
    sib_unmatched_rows: unmatchedRows,
  };
}

function buildQueriesDataset(mainDataset, oldDataset) {
  if (!fs.existsSync(queriesRoot)) {
    return {
      generated_at: new Date().toISOString(),
      query_file_count: 0,
      query_summary_count: 0,
      variants: [],
      summaries: [],
    };
  }

  const statMap = parseQueryStatMap();
  const observedMain = summarizeObservedQueryStats(mainDataset);
  const observedOld = summarizeObservedQueryStats(oldDataset);

  const queryFiles = collectFilesRecursive(
    queriesRoot,
    (name, fullPath) => name.toLowerCase().endsWith(".rq")
      && fullPath.includes(`${path.sep}queries${path.sep}`),
  ).sort((a, b) => a.localeCompare(b));

  const variants = [];
  const summaryMap = new Map();

  for (const fullPath of queryFiles) {
    const relativeToRoot = path.relative(repoRoot, fullPath).replaceAll(path.sep, "/");
    const relativeToQueries = path.relative(queriesRoot, fullPath).replaceAll(path.sep, "/");
    const variantType = classifyQueryVariant(relativeToQueries);
    const fileName = path.basename(fullPath);
    const stem = normalizeQueryStem(fileName);
    if (!stem) {
      continue;
    }

    const queryText = fs.readFileSync(fullPath, "utf8");
    const parsedStats = extractQueryTextStats(queryText);
    const complexityStats = statMap.get(stem) || null;
    const observedStatsMain = observedMain.get(stem) || null;
    const observedStatsOld = observedOld.get(stem) || null;

    const variantRecord = {
      query_stem: stem,
      file_name: fileName,
      file_path: relativeToRoot,
      query_variant: variantType,
      content_hash: createHash("sha256").update(queryText).digest("hex"),
      query_text: queryText,
      parsed_stats: parsedStats,
      complexity_stats: complexityStats,
      observed_main: observedStatsMain,
      observed_old_results: observedStatsOld,
    };

    variants.push(variantRecord);

    if (!summaryMap.has(stem)) {
      summaryMap.set(stem, {
        query_stem: stem,
        variants: [],
        parsed_stats: parsedStats,
        complexity_stats: complexityStats,
        observed_main: observedStatsMain,
        observed_old_results: observedStatsOld,
      });
    }

    const summary = summaryMap.get(stem);
    summary.variants.push({
      query_variant: variantType,
      file_path: relativeToRoot,
      file_name: fileName,
      has_service_clause: parsedStats.has_service_clause,
      service_iri_count: parsedStats.service_iri_count,
      line_count: parsedStats.line_count,
    });

    // Prefer original variant for canonical parsed stats.
    if (variantType === "original") {
      summary.parsed_stats = parsedStats;
    }
    if (!summary.complexity_stats && complexityStats) {
      summary.complexity_stats = complexityStats;
    }
    if (!summary.observed_main && observedStatsMain) {
      summary.observed_main = observedStatsMain;
    }
    if (!summary.observed_old_results && observedStatsOld) {
      summary.observed_old_results = observedStatsOld;
    }
  }

  const summaries = [...summaryMap.values()]
    .map((summary) => {
      const variantKinds = new Set(summary.variants.map((v) => v.query_variant));
      return {
        ...summary,
        variant_count: summary.variants.length,
        has_original: variantKinds.has("original"),
        has_no_service: variantKinds.has("no-service"),
        has_broken_variant: variantKinds.has("no-service-broken"),
      };
    })
    .sort((a, b) => a.query_stem.localeCompare(b.query_stem));

  const sibContext = attachSibQueryContext(summaries);
  const queryAliases = sibContext.query_aliases || {};

  const summariesWithAliases = sibContext.summaries.map((summary) => {
    const queryAlias = queryAliases[summary.query_stem] || null;
    return {
      ...summary,
      query_alias: queryAlias,
      query_display_name: queryAlias || summary.query_stem,
    };
  });

  const variantsWithAliases = variants.map((variant) => {
    const queryAlias = queryAliases[variant.query_stem] || null;
    return {
      ...variant,
      query_alias: queryAlias,
      query_display_name: queryAlias || variant.query_stem,
    };
  });

  return {
    generated_at: new Date().toISOString(),
    query_file_count: variantsWithAliases.length,
    query_summary_count: summariesWithAliases.length,
    stat_json_entry_count: statMap.size,
    query_aliases: queryAliases,
    sib_columns: sibContext.sib_columns,
    sib_query_row_count: sibContext.sib_query_row_count,
    sib_matched_row_count: sibContext.sib_matched_row_count,
    sib_unmatched_row_count: sibContext.sib_unmatched_row_count,
    sib_unmatched_rows: sibContext.sib_unmatched_rows,
    variants: variantsWithAliases,
    summaries: summariesWithAliases,
  };
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

function inferRunServiceDescriptionMode(runRecords) {
  const queryRecords = runRecords.filter((record) => !record.is_run_summary_row);
  const values = queryRecords
    .map((record) => record.has_service_description)
    .filter((value) => value === true || value === false);

  if (values.length === 0) {
    return {
      service_description_mode: "unknown",
      with_service_query_count: 0,
      no_service_query_count: 0,
      unknown_service_query_count: queryRecords.length,
    };
  }

  const withService = values.filter((value) => value === true).length;
  const noService = values.filter((value) => value === false).length;
  const unknown = queryRecords.length - (withService + noService);

  let mode = "mixed";
  if (withService > 0 && noService === 0) {
    mode = "with-service";
  } else if (noService > 0 && withService === 0) {
    mode = "no-service";
  }

  return {
    service_description_mode: mode,
    with_service_query_count: withService,
    no_service_query_count: noService,
    unknown_service_query_count: unknown,
  };
}

function normalizeRunSummary(runMeta, summary) {
  const records = [];
  const runStartFallback = safeIso(summary?.general_stats?.run_start);
  const runEndFallback = safeIso(summary?.general_stats?.run_end);
  const shouldApplyLegacyAliases = runMeta.run_id === "experiments/old-results/default-service-test-1";

  for (const entry of summary.entries) {
    const rawQueryName = typeof entry.query_name === "string" ? entry.query_name : null;
    let queryName = shouldApplyLegacyAliases && rawQueryName
      ? (legacyDefaultServiceQueryAliasMap.get(rawQueryName) || rawQueryName)
      : rawQueryName;
    const sources = parseSources(entry.sources);
    queryName = applyKnownQueryCorrections(runMeta.run_id, queryName, sources);
    const isRunSummaryRow = queryName === runMeta.run_label;
    const producedResults = isRunSummaryRow
      ? false
      : toBool(entry.produced_results);

    const forcedServiceDescription = runMeta.force_has_service_description;

    const startIso = safeIso(entry.start);
    const endIso = safeIso(entry.end);

    const record = {
      run_id: runMeta.run_id,
      run_label: runMeta.run_label,
      run_path: runMeta.run_path,
      run_scope: runMeta.run_scope,
      summary_source: runMeta.summary_source,
      has_summary_file: runMeta.has_summary_file,

      is_run_summary_row: isRunSummaryRow,
      query_name: queryName,
      start: startIso ?? (
        !isRunSummaryRow && runMeta.fill_missing_record_timestamps_from_run
          ? runStartFallback
          : null
      ),
      end: endIso ?? (
        !isRunSummaryRow && runMeta.fill_missing_record_timestamps_from_run
          ? runEndFallback
          : null
      ),
      duration_seconds: toNumber(entry.duration_seconds),
      http_requests: toNumber(entry.http_requests),

      sources,
      source_count: sources.length,

      produced_results: producedResults,
      results_count: toNumber(entry.results_count) ?? 0,

      error_raw: entry.error === undefined ? null : entry.error,
      error_category: classifyError(entry.error, producedResults),

      has_service_description: isRunSummaryRow
        ? null
        : (typeof forcedServiceDescription === "boolean"
          ? forcedServiceDescription
          : detectServiceDescription(queryName)),
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

      if (summary) {
        summarySource = "generated_from_logs";
      } else {
        summary = buildSummaryFromLegacyQueryTimes(runDir);
        if (summary) {
          summarySource = "generated_from_query_times_csv";
        } else {
          console.warn(`[WARN] Could not build summary for ${runPath}; skipping run.`);
          continue;
        }
      }

      if (writeMissingSummaries) {
        // Persist generated summaries so future runs can rely on canonical run-level files.
        fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        hasSummaryFile = true;
      }
    }

    const sanitizedInitial = sanitizeSummary(runLabel, summary);
    const { summary: sanitized, override: appliedDateOverride } = applyRunDateOverride(runPath, sanitizedInitial);

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
      // Force service-description classification for known service-enabled control runs.
      force_has_service_description: forceServiceDescriptionRuns.has(runPath),
      // Legacy query-times summaries only have run-level timestamps; propagate those to records.
      fill_missing_record_timestamps_from_run: summarySource === "generated_from_query_times_csv"
        || Boolean(appliedDateOverride?.fill_missing_record_timestamps_from_run),
    };

    const runRecords = normalizeRunSummary(runMeta, sanitized);
    const runStats = summarizeRunRecords(runRecords);
    const serviceModeStats = inferRunServiceDescriptionMode(runRecords);

    runs.push({
      ...runMeta,
      run_start: safeIso(sanitized.general_stats.run_start),
      run_end: safeIso(sanitized.general_stats.run_end),
      run_duration_seconds: toNumber(sanitized.general_stats.run_duration_seconds),
      ...runStats,
      ...serviceModeStats,
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
  const defaultRunDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== "old-results" && !nonRunExperimentDirs.has(entry.name))
    .map((entry) => path.join(experimentsRoot, entry.name))
    .sort((a, b) => a.localeCompare(b));

  const promoted = promotedLegacyRuns
    .map((relativePath) => path.join(experimentsRoot, relativePath))
    .filter((fullPath) => fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory());

  const deduped = new Map();
  for (const runDir of [...defaultRunDirs, ...promoted]) {
    deduped.set(path.resolve(runDir), runDir);
  }

  return [...deduped.values()].sort((a, b) => a.localeCompare(b));
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

  const promotedAbs = new Set(
    promotedLegacyRuns.map((relativePath) => path.resolve(path.join(experimentsRoot, relativePath))),
  );

  return [...candidates]
    .filter((candidate) => !promotedAbs.has(path.resolve(candidate)))
    .sort((a, b) => a.localeCompare(b));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function main() {
  const writeMissingSummaries = process.argv.includes("--write-missing-summaries");

  // Rebuild hand-curated positive-control runs from troubleshooting sheets.
  ensureManualServiceControlSummaries();

  const mainRunDirs = getMainRunDirs();
  const oldRunDirs = getOldRunDirs();

  const mainDataset = buildDataset("main", mainRunDirs, writeMissingSummaries);
  const oldDataset = buildDataset("old-results", oldRunDirs, writeMissingSummaries);
  const queriesDataset = buildQueriesDataset(mainDataset, oldDataset);

  const mainSummary = aggregateSummary(mainDataset);
  const oldSummary = aggregateSummary(oldDataset);

  fs.mkdirSync(docsDataDir, { recursive: true });

  writeJson(path.join(docsDataDir, "main.json"), mainDataset);
  writeJson(path.join(docsDataDir, "old-results.json"), oldDataset);
  writeJson(path.join(docsDataDir, "summary.json"), mainSummary);
  writeJson(path.join(docsDataDir, "summary-old-results.json"), oldSummary);
  writeJson(path.join(docsDataDir, "queries.json"), queriesDataset);

  console.log(`[OK] Wrote dashboard datasets to ${path.relative(repoRoot, docsDataDir)}`);
  console.log(`[INFO] Main runs: ${mainDataset.run_count}, query records: ${mainSummary.query_count}`);
  console.log(`[INFO] Old-result runs: ${oldDataset.run_count}, query records: ${oldSummary.query_count}`);
  console.log(`[INFO] Query files: ${queriesDataset.query_file_count}, canonical queries: ${queriesDataset.query_summary_count}`);
}

main();
