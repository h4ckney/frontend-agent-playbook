#!/usr/bin/env node
// Opt-in metadata-only lookup. Never imported or called by the offline scanner.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const { validateAuditResult } = createRequire(import.meta.url)("../analysis/audit-contract.js");

const API = "https://api.osv.dev/v1/";
const MAX_INPUT_BYTES = 25_000_000;
const MAX_RESPONSE_BYTES = 4_000_000;
const MAX_PACKAGES = 200;
const MAX_DETAILS = 200;
const MAX_PAGES = 3;
const MAX_IDS = 1000;
const VALID_ID = /^[a-zA-Z0-9:_.-]{1,200}$/;
const EXACT = /^v?(\d+)\.(\d+)\.(\d+)$/;
const occurrence = (item) => Object.fromEntries(["manifest", "path", "phase", "phaseEvidence", "versionKind", "direct", "provenance"].map((key) => [key, item[key] ?? null]));
const keyOf = (item) => JSON.stringify([item.ecosystem, item.name, item.version]);

async function jsonRequest(fetchImpl, endpoint, body) {
  const response = await fetchImpl(API + endpoint, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) throw new Error("OSV HTTP " + response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OSV response body unavailable");
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("OSV response exceeds size limit");
    }
    chunks.push(value);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid OSV response");
  return data;
}

/** Returns review evidence, never an exploitability verdict or CI suppression. */
export async function queryInventory(scan, { fetchImpl = globalThis.fetch, now = new Date().toISOString(), maxPackages = MAX_PACKAGES, maxDetails = MAX_DETAILS, maxPages = MAX_PAGES } = {}) {
  if (!Array.isArray(scan?.securityContext?.inventory)) throw new Error("scan.securityContext.inventory is required");
  for (const [name, value, max] of [["maxPackages", maxPackages, MAX_PACKAGES], ["maxDetails", maxDetails, MAX_DETAILS], ["maxPages", maxPages, MAX_PAGES]]) {
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(name + " is outside supported limits");
  }
  const report = {
    schemaVersion: "1", source: "OSV API", queriedAt: now,
    privacy: { endpoint: API, transmitted: ["ecosystem", "package name", "locked exact version", "OSV advisory IDs/page tokens"], note: "Source code, project names, local paths and phase metadata are not transmitted. Package names can reveal private dependencies." },
    coverage: { status: "not-run", inventoryEntries: scan.securityContext.inventory.length, uniqueLockedPackages: 0, queriedPackages: 0,
      limits: { maxPackages, maxDetails, maxPages }, errors: [], note: "Results cover returned OSV records for queried locked versions only. No result proves safety or runtime reachability." },
    packages: [], advisories: [], declarations: [], skipped: [], limitations: ["Runtime Node/PHP versions are not npm/Packagist packages and are not queried here.", "Declared versions, ranges, unsupported lock formats and absent inventory remain unverified.", "Lockfile phase describes a declared installation role; production installation, actual runtime version, vulnerable call path and vendor backports require verification."]
  };
  const grouped = new Map();
  for (const item of scan.securityContext.inventory) {
    const ecosystem = item?.ecosystem === "npm" ? "npm" : item?.ecosystem === "composer" ? "Packagist" : null;
    const version = typeof item?.version === "string" ? EXACT.exec(item.version)?.slice(1).map(Number).join(".") : null;
    const nameValid = typeof item?.name === "string" && item.name.length <= 214 && (ecosystem === "npm"
      ? /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(item.name)
      : /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(item.name));
    let reason = !ecosystem ? "unsupported-ecosystem" : item.versionKind !== "locked-exact" ? "not-a-locked-exact-version" : !version || !nameValid ? "invalid-package-or-version" : null;
    if (reason) { report.skipped.push({ name: item?.name ?? null, version: item?.version ?? null, ecosystem: item?.ecosystem ?? null, ...occurrence(item || {}), reason }); continue; }
    const query = { ecosystem, name: item.name, version };
    const key = keyOf(query);
    if (!grouped.has(key)) grouped.set(key, { key, ...query, occurrences: [], advisoryIds: [], status: "not-queried", notes: [] });
    grouped.get(key).occurrences.push(occurrence(item));
  }
  report.coverage.uniqueLockedPackages = grouped.size;
  report.packages = [...grouped.values()];
  // A manifest declaration is useful provenance, but it is not a second
  // unresolved version when this directory already supplies a locked version.
  // This is identity evidence only: no declared-range compatibility is solved.
  report.skipped = report.skipped.filter((entry) => {
    if (entry.reason !== "not-a-locked-exact-version" || entry.provenance !== "manifest-declaration"
      || !["declared-exact", "declared-range"].includes(entry.versionKind)) return true;
    const ecosystem = entry.ecosystem === "composer" ? "Packagist" : entry.ecosystem;
    const matches = report.packages.filter((item) => item.ecosystem === ecosystem && item.name === entry.name
      && item.occurrences.some((source) => typeof source.manifest === "string" && typeof entry.manifest === "string"
        && path.posix.dirname(source.manifest) === path.posix.dirname(entry.manifest)));
    if (!matches.length) return true;
    const { reason, ...declaration } = entry;
    report.declarations.push({ ...declaration, status: "covered-by-lock", lockedPackageKeys: matches.map((item) => item.key),
      note: "Same-directory lock evidence retained; manifest constraint compatibility and installation are not verified." });
    return false;
  });
  const selected = report.packages.slice(0, maxPackages);
  for (const item of report.packages.slice(maxPackages)) { item.notes.push("package query limit reached"); }
  const idsByPackage = new Map(selected.map((item) => [item.key, new Set()]));
  for (let offset = 0; offset < selected.length; offset += 100) {
    let pending = selected.slice(offset, offset + 100).map((item) => ({ item }));
    for (let page = 0; pending.length && page < maxPages; page += 1) {
      let data;
      try {
        data = await jsonRequest(fetchImpl, "querybatch", { queries: pending.map(({ item, token }) => ({ package: { ecosystem: item.ecosystem, name: item.name }, version: item.version, ...(token ? { page_token: token } : {}) })) });
        if (!Array.isArray(data.results) || data.results.length !== pending.length) throw new Error("OSV batch result count does not match queries");
      } catch (error) {
        for (const { item } of pending) { item.status = "incomplete"; item.notes.push(String(error.message)); }
        report.coverage.errors.push(String(error.message));
        break;
      }
      const next = [];
      data.results.forEach((result, index) => {
        const { item } = pending[index];
        const ids = idsByPackage.get(item.key);
        if (!result || typeof result !== "object" || Array.isArray(result) || (result.vulns !== undefined && !Array.isArray(result.vulns))
          || (result.next_page_token !== undefined && (typeof result.next_page_token !== "string" || result.next_page_token.length > 8192))) {
          item.status = "incomplete"; item.notes.push("invalid OSV batch item"); return;
        }
        let invalid = false;
        for (const vulnerability of result.vulns || []) {
          if (!VALID_ID.test(vulnerability?.id || "") || ids.size >= MAX_IDS) { invalid = true; continue; }
          ids.add(vulnerability.id);
        }
        if (invalid) { item.status = "incomplete"; item.notes.push("advisory ID invalid or result limit reached"); }
        else if (result.next_page_token) {
          if (page + 1 < maxPages) next.push({ item, token: result.next_page_token });
          else { item.status = "incomplete"; item.notes.push("pagination limit reached"); }
        } else item.status = "queried";
      });
      pending = next;
    }
  }
  report.coverage.queriedPackages = selected.filter((item) => item.status !== "not-queried").length;
  const ids = [...new Set([...idsByPackage.values()].flatMap((set) => [...set]))];
  const details = new Map();
  let nextDetail = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length, maxDetails) }, async () => {
    while (nextDetail < Math.min(ids.length, maxDetails)) {
      const id = ids[nextDetail++];
      try {
        const record = await jsonRequest(fetchImpl, "vulns/" + encodeURIComponent(id));
        if (record.id !== id || !Array.isArray(record.affected)) throw new Error("OSV advisory detail identity or affected packages invalid");
        details.set(id, record);
      } catch (error) { details.set(id, { id, error: String(error.message) }); }
    }
  }));
  const raw = new Map();
  for (const item of selected) {
    const packageIds = [...idsByPackage.get(item.key)];
    for (const id of packageIds) {
      const record = details.get(id);
      const matching = record?.affected?.filter((entry) => entry?.package?.ecosystem === item.ecosystem && entry?.package?.name === item.name) || [];
      if (!record || record.error || !matching.length) {
        item.status = "incomplete";
        item.notes.push(!record ? "detail query limit reached: " + id : record.error || "OSV detail package mismatch: " + id);
      }
      if (!raw.has(id)) raw.set(id, { id, aliases: (Array.isArray(record?.aliases) ? record.aliases : []).filter((alias) => typeof alias === "string" && VALID_ID.test(alias)),
        summary: typeof record?.summary === "string" ? record.summary : "Detail unavailable; review required",
        modified: record?.modified || null, published: record?.published || null, withdrawn: record?.withdrawn || null,
        severity: Array.isArray(record?.severity) ? record.severity : [],
        references: (Array.isArray(record?.references) ? record.references : []).filter((reference) => typeof reference?.url === "string" && /^https?:\/\//.test(reference.url)),
        affected: [], packageKeys: [], detailStatus: record && !record.error ? "retrieved" : "unavailable" });
      const entry = raw.get(id);
      entry.packageKeys.push(item.key);
      for (const match of matching) if (!entry.affected.some((known) => JSON.stringify(known) === JSON.stringify(match))) entry.affected.push(match);
      item.advisoryIds.push(id);
    }
    if (item.status === "queried") item.status = packageIds.length ? "advisories-reported" : "none-reported";
  }
  // OSV aliases explicitly identify the same vulnerability; collapse connected
  // records into one parent issue while keeping records and affected modules.
  const groups = [];
  for (const record of raw.values()) {
    const names = new Set([record.id, ...record.aliases]);
    const related = groups.filter((group) => [...names].some((name) => group.names.has(name)));
    const group = { names, records: [record] };
    for (const previous of related) {
      for (const name of previous.names) group.names.add(name);
      group.records.push(...previous.records);
      groups.splice(groups.indexOf(previous), 1);
    }
    groups.push(group);
  }
  const canonical = new Map();
  report.advisories = groups.map((group) => {
    const names = [...group.names].sort();
    const returnedIds = group.records.map((record) => record.id).sort();
    const id = returnedIds.find((name) => name.startsWith("GHSA-")) || returnedIds.find((name) => name.startsWith("CVE-")) || returnedIds[0];
    for (const record of group.records) canonical.set(record.id, id);
    return { id, aliases: names.filter((name) => name !== id), packageKeys: [...new Set(group.records.flatMap((record) => record.packageKeys))],
      reviewStatus: "OSV version-query association; deployment and vulnerable call path require verification", records: group.records };
  }).sort((a, b) => a.id.localeCompare(b.id));
  for (const item of report.packages) item.advisoryIds = [...new Set(item.advisoryIds.map((id) => canonical.get(id) || id))];
  const partial = report.skipped.length || report.packages.some((item) => ["not-queried", "incomplete"].includes(item.status))
    || scan.scope?.partial || scan.securityContext.coverage?.gaps?.length;
  report.coverage.status = !selected.length ? "not-run" : partial ? "partial" : "complete";
  return report;
}

export function buildMarkdown(report) {
  const cell = (value) => String(value ?? "").replace(/[\\|`<>\[\]()!]/g, " ").replace(/[\r\n]+/g, " ");
  let text = "# Dependency advisory review\n\n" + "Queried at: " + cell(report.queriedAt) + "\n\nCoverage: **" + report.coverage.status + "**. Complete means only the submitted locked inventory was queried; it does not establish safety.\n\n";
  text += "Only ecosystem, package name and locked exact version were sent to OSV (plus advisory IDs/page tokens). Project paths, source code and phase evidence stay local. Package names can identify private modules.\n\n";
  text += "| Module | Version | Result | Declared phase / local evidence |\n| --- | --- | --- | --- |\n";
  for (const item of report.packages) text += "| " + [item.ecosystem + ":" + item.name, item.version, item.status,
    item.occurrences.map((entry) => entry.phase + " @ " + entry.manifest + ":" + entry.path).join("; ")].map(cell).join(" | ") + " |\n";
  for (const advisory of report.advisories) {
    text += "\n## " + cell(advisory.id) + "\n\n";
    text += "Aliases: " + advisory.aliases.map(cell).join(", ") + "\n\n";
    text += cell(advisory.records.find((record) => record.detailStatus === "retrieved")?.summary || "Details unavailable") + "\n\n";
    text += "[OSV record](https://osv.dev/vulnerability/" + encodeURIComponent(advisory.id) + ") — " + advisory.reviewStatus + ".\n\n";
    for (const key of advisory.packageKeys) { const item = report.packages.find((entry) => entry.key === key); text += "- " + cell(item.ecosystem + ":" + item.name + "@" + item.version) + " — " + item.occurrences.map((entry) => cell(entry.phase + " / " + entry.manifest + ":" + entry.path)).join("; ") + "\n"; }
    if (advisory.records.some((record) => record.withdrawn)) text += "\nWithdrawn record present; check record history before acting.\n";
  }
  if (report.declarations?.length) {
    text += "\n## Manifest provenance covered by lock entries\n\n";
    for (const item of report.declarations) text += "- " + cell(item.name + " declared " + item.version + " / " + item.manifest + ":" + item.path + " — " + item.note) + "\n";
  }
  text += "\n## Coverage gaps\n\n";
  for (const item of report.skipped) text += "- " + cell(item.name + "@" + item.version + ": " + item.reason + " / " + item.manifest) + "\n";
  for (const item of report.packages) for (const note of item.notes) text += "- " + cell(item.name + ": " + note) + "\n";
  for (const limitation of report.limitations) text += "- " + cell(limitation) + "\n";
  return text;
}

export async function main(args = process.argv.slice(2)) {
  const usage = "Usage: node scripts/query-osv.mjs --scan audit.json --output report-directory\nOpt-in network: sends locked npm/Packagist names and exact versions to api.osv.dev; no source, paths, installs or project commands. Private package names may be disclosed.\n";
  if (args.length === 1 && args[0] === "--help") { process.stdout.write(usage); return 0; }
  if (args.length !== 4 || args[0] !== "--scan" || args[2] !== "--output") throw new Error(usage);
  const input = path.resolve(args[1]);
  const output = path.resolve(args[3]);
  await fs.mkdir(output, { recursive: true });
  for (const name of ["dependency-advisories.json", "dependency-advisories.md"]) {
    try {
      await fs.lstat(path.join(output, name));
      throw new Error("output report already exists; choose a new output directory");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if ((await fs.stat(input)).size > MAX_INPUT_BYTES) throw new Error("scan JSON exceeds input limit");
  const bytes = await fs.readFile(input);
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new Error("scan JSON exceeds input limit");
  const parsed = JSON.parse(bytes.toString("utf8"));
  const errors = validateAuditResult(parsed);
  if (errors.length) throw new Error("invalid canonical audit result: " + errors.join("; "));
  process.stderr.write("OSV opt-in lookup: sending locked package names/versions only. Private names can be disclosed; source code and project paths stay local.\n");
  const report = await queryInventory(parsed);
  report.sourceScan = { sha256: createHash("sha256").update(bytes).digest("hex") };
  await fs.writeFile(path.join(output, "dependency-advisories.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await fs.writeFile(path.join(output, "dependency-advisories.md"), buildMarkdown(report), { flag: "wx" });
  process.stdout.write(JSON.stringify({ coverage: report.coverage.status, queriedPackages: report.coverage.queriedPackages, advisoryGroups: report.advisories.length, skipped: report.skipped.length, output }) + "\n");
  return report.coverage.status === "complete" ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(error.message + "\n"); process.exitCode = 2; });
}
