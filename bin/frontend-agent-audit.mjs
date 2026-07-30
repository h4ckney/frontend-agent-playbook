#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const analyzer = require(path.join(repoRoot, "analysis", "analyzer.js"));
const contract = require(path.join(repoRoot, "analysis", "audit-contract.js"));

const commands = new Set(["scan", "baseline"]);
const valueOptions = new Set([
  "root", "profile", "baseline", "format", "output", "seo-scope", "from", "reason"
]);
const booleanOptions = new Set(["quiet", "allow-partial-baseline", "help"]);
const formats = new Set(["json", "markdown", "summary"]);
const seoScopes = new Set(["unknown", "public", "mixed", "internal"]);
const severityRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

main().catch((error) => {
  process.stderr.write("frontend-agent-audit: " + safeError(error) + "\n");
  process.exitCode = 2;
});

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(helpText());
    return;
  }
  if (parsed.command === "scan") {
    await scanCommand(parsed);
    return;
  }
  await baselineCommand(parsed);
}

function parseArguments(argv) {
  const command = argv[0];
  if (!commands.has(command)) {
    if (command === "--help" || command === "-h") return { command: "scan", help: true };
    throw new Error("expected command `scan` or `baseline`");
  }
  const result = { command };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error("unexpected argument");
    const key = token.slice(2);
    if (booleanOptions.has(key)) {
      result[toCamelCase(key)] = true;
      continue;
    }
    if (!valueOptions.has(key)) throw new Error("unknown option --" + key);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("missing value for --" + key);
    result[toCamelCase(key)] = value;
    index += 1;
  }
  return result;
}

async function scanCommand(options) {
  const root = await fs.realpath(path.resolve(options.root || "."));
  if (!(await fs.stat(root)).isDirectory()) throw new Error("scan root must be a directory");
  const profilePath = options.profile ? await resolveInsideRoot(root, options.profile, true) : null;
  const baselinePath = options.baseline ? await resolveInsideRoot(root, options.baseline, true) : null;
  const outputPath = options.output ? await resolveInsideRoot(root, options.output, false) : null;
  const format = options.format || "summary";
  if (!formats.has(format)) throw new Error("unsupported format");
  if (options.seoScope && !seoScopes.has(options.seoScope)) throw new Error("unsupported SEO scope");
  if (outputPath && baselinePath && outputPath === baselinePath) {
    throw new Error("output and baseline paths must differ");
  }

  const profile = profilePath
    ? await readJson(profilePath, "project profile", 5_000_000)
    : null;
  const profileErrors = contract.validateProjectProfile(profile);
  if (profileErrors.length) throw new Error("invalid project profile: " + profileErrors.join("; "));

  const excludedArtifacts = new Set(
    [profilePath, baselinePath, outputPath].filter(Boolean).map((value) => path.resolve(value))
  );
  const collection = await collectRecords(root, excludedArtifacts);
  const rootLabel = profile?.project?.id || path.basename(root);
  const profileDigest = profile ? digest(profile) : null;
  const scopePolicyDigest = digest({
    rootLabel,
    limits: analyzer.analysisLimits,
    exclusions: "analyzer-v1",
    seoScope: options.seoScope || profile?.project?.visibility || "unknown"
  });
  const bundle = contract.createAuditBundle({
    name: rootLabel,
    records: collection.records,
    meta: collection.scope.includedFiles + " text files inspected",
    scope: {
      selected: collection.scope.selectedFiles,
      analyzed: collection.scope.includedFiles,
      excluded: collection.scope.excludedFiles,
      analyzedBytes: collection.scope.includedBytes,
      excludedByReason: collection.scope.excludedByReason,
      partial: collection.scope.partial
    },
    context: { seoScope: options.seoScope },
    profile,
    profileSource: profilePath ? normalizeOutputPath(root, profilePath) : null,
    profileDigest,
    scopePolicyDigest,
    analysisMode: "static-lite",
    capabilities: ["route-path-inference", "text-patterns"]
  });

  let result = bundle.audit;
  if (baselinePath) {
    result = contract.compareWithBaseline(
      result,
      await readJson(baselinePath, "baseline", 5_000_000)
    );
  }
  const validationErrors = contract.validateAuditResult(result);
  if (validationErrors.length) throw new Error("invalid audit result: " + validationErrors.join("; "));

  const rendered = render(result, format);
  if (outputPath) {
    await assertSafeOutputTarget(outputPath, format === "json" ? "audit-json" : format);
    await writeOutput(outputPath, rendered);
    if (!options.quiet) {
      process.stdout.write(contract.buildAuditSummary(result) + "\n");
      process.stderr.write("wrote " + normalizeOutputPath(root, outputPath) + "\n");
    }
  } else {
    process.stdout.write(rendered);
  }

  const ci = profile?.ci || {};
  if (ci.requireComplete && result.scope.partial) {
    process.exitCode = 3;
    return;
  }
  if (ci.mode === "blocking" && hasBlockingFinding(result, ci.failOn || [])) {
    process.exitCode = 1;
  }
}

async function baselineCommand(options) {
  if (!options.from || !options.output) {
    throw new Error("baseline requires --from and --output");
  }
  const fromPath = path.resolve(options.from);
  const outputPath = path.resolve(options.output);
  if (fromPath === outputPath) throw new Error("baseline input and output paths must differ");
  const result = await readJson(fromPath, "audit result", 30_000_000);
  const baseline = contract.createBaseline(result, {
    allowPartial: Boolean(options.allowPartialBaseline),
    reason: options.reason
  });
  await assertSafeOutputTarget(outputPath, "baseline");
  await writeOutput(outputPath, stableJson(baseline) + "\n");
  if (!options.quiet) process.stderr.write("wrote " + outputPath + "\n");
}

async function collectRecords(root, excludedArtifacts) {
  const candidates = [];
  const excludedByReason = {};
  let symlinkCount = 0;
  let artifactCount = 0;

  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      increment(excludedByReason, "directory-read-failed");
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = normalizeOutputPath(root, absolute);
      let stat;
      try {
        stat = await fs.lstat(absolute);
      } catch {
        increment(excludedByReason, "stat-failed");
        continue;
      }
      if (stat.isSymbolicLink()) {
        symlinkCount += 1;
        increment(excludedByReason, "symlink");
        continue;
      }
      if (stat.isDirectory()) {
        const directoryReason = analyzer.fileExclusionReason({
          path: relative + "/placeholder.js",
          name: "placeholder.js",
          size: 0
        });
        if (directoryReason === "excluded-path") continue;
        await walk(absolute);
        continue;
      }
      if (!stat.isFile()) continue;
      if (excludedArtifacts.has(path.resolve(absolute)) || relative.startsWith(".frontend-audit/")) {
        increment(excludedByReason, "analyzer-artifact");
        artifactCount += 1;
        continue;
      }
      candidates.push({ absolute, path: relative, name: entry.name, size: stat.size });
    }
  }

  await walk(root);
  const selection = analyzer.selectFilesWithinBudget(candidates);
  mergeCounts(excludedByReason, selection.excludedByReason);
  const records = [];
  for (const file of selection.accepted) {
    try {
      const content = await fs.readFile(file.absolute, "utf8");
      const record = { path: file.path, content, size: file.size };
      if (analyzer.isGeneratedRecord(record)) {
        increment(excludedByReason, "generated-header");
      } else {
        records.push(record);
      }
    } catch {
      increment(excludedByReason, "read-failed");
    }
  }
  const selectedFiles = candidates.length + symlinkCount + artifactCount;
  const includedBytes = records.reduce((sum, record) => sum + record.size, 0);
  const excludedFiles = selectedFiles - records.length;
  const partialReasons = [
    "directory-read-failed", "input-budget", "oversized", "read-failed", "stat-failed", "symlink"
  ]
    .filter((reason) => excludedByReason[reason]);
  return {
    records,
    scope: {
      selectedFiles,
      includedFiles: records.length,
      excludedFiles,
      includedBytes,
      excludedByReason,
      partial: partialReasons.length > 0
    }
  };
}

async function resolveInsideRoot(root, input, mustExist) {
  const candidate = path.resolve(root, input);
  if (mustExist) {
    const resolved = await fs.realpath(candidate);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error("path must stay inside scan root");
    }
    return resolved;
  }
  let existingParent = path.dirname(candidate);
  let resolvedParent;
  while (true) {
    try {
      resolvedParent = await fs.realpath(existingParent);
      break;
    } catch {
      const next = path.dirname(existingParent);
      if (next === existingParent) throw new Error("output parent is unavailable");
      existingParent = next;
    }
  }
  const relativeTail = path.relative(existingParent, candidate);
  const resolved = path.resolve(resolvedParent, relativeTail);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("path must stay inside scan root");
  }
  return resolved;
}

async function readJson(filePath, label, maxBytes) {
  let content;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("size");
    content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    throw new Error("could not read valid " + label + " JSON");
  }
}

async function writeOutput(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + ".tmp-" + process.pid;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, filePath);
}

async function assertSafeOutputTarget(filePath, kind) {
  const expectedExtensions = {
    "audit-json": ".json",
    baseline: ".json",
    markdown: ".md",
    summary: ".txt"
  };
  if (path.extname(filePath).toLowerCase() !== expectedExtensions[kind]) {
    throw new Error("output extension does not match format");
  }

  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw new Error("could not inspect existing output");
  }

  let safe = false;
  if (kind === "audit-json" || kind === "baseline") {
    try {
      const parsed = JSON.parse(content);
      safe = kind === "audit-json"
        ? contract.validateAuditResult(parsed).length === 0
        : contract.validateBaseline(parsed).length === 0;
    } catch {
      safe = false;
    }
  } else if (kind === "markdown") {
    safe = content.startsWith("# Frontend Audit:");
  } else {
    safe = content.startsWith("Frontend audit:");
  }
  if (!safe) throw new Error("refusing to overwrite a non-analyzer output file");
}

function render(result, format) {
  if (format === "json") return stableJson(result) + "\n";
  if (format === "markdown") return contract.buildAuditMarkdown(result) + "\n";
  return contract.buildAuditSummary(result) + "\n";
}

function hasBlockingFinding(result, failOn) {
  if (!failOn.length) return false;
  return result.findings.some((finding) => {
    if (!["new", "worsened"].includes(finding.diffStatus)) return false;
    if (finding.priority.effectiveDecision === "suppressed") return false;
    return failOn.some((policy) => matchesPolicy(finding, policy));
  });
}

function matchesPolicy(finding, policy) {
  const [kind, ...rest] = String(policy).split(":");
  const value = rest.join(":");
  if (kind === "finding") return finding.id === value;
  if (kind === "severity") {
    return (severityRank[finding.severity] ?? -1) >= (severityRank[value] ?? Number.POSITIVE_INFINITY);
  }
  if (kind === "decision") return finding.priority.effectiveDecision === value;
  return finding.id === policy;
}

function stableJson(value) {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortValue(value[key])])
  );
}

function digest(value) {
  return "sha256:" + crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function normalizeOutputPath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function mergeCounts(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + value;
  }
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function safeError(error) {
  return error instanceof Error ? error.message.replace(/[\r\n]+/g, " ") : "unknown error";
}

function helpText() {
  return [
    "Usage:",
    "  frontend-agent-audit scan [--root .] [--profile file] [--baseline file]",
    "    [--format json|markdown|summary] [--output file] [--seo-scope scope]",
    "  frontend-agent-audit baseline --from result.json --output baseline.json",
    "    [--allow-partial-baseline --reason text]",
    "",
    "Exit codes: 0 success, 1 configured new/worsened finding, 2 usage/error, 3 incomplete required scan.",
    ""
  ].join("\n");
}
