import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = new URL("./frontend-agent-audit.mjs", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { createAuditBundle } = require("../analysis/audit-contract.js");

async function fixture(profileOverrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-audit-"));
  await fs.mkdir(path.join(root, "pages"), { recursive: true });
  await fs.mkdir(path.join(root, ".frontend-audit"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    dependencies: { next: "13.5.0", react: "18.2.0" },
    scripts: { test: "vitest" }
  }));
  await fs.writeFile(path.join(root, "pages", "index.tsx"), "export default function Page() { return <main>Home</main>; }");
  await fs.writeFile(path.join(root, ".env"), "SECRET_TOKEN=must-not-appear");
  const profile = {
    schemaVersion: "1",
    project: { id: "fixture", visibility: "internal" },
    suppressions: [],
    ci: { mode: "report-only", failOn: [], requireComplete: false },
    ...profileOverrides
  };
  await fs.writeFile(path.join(root, ".frontend-agent-playbook.json"), JSON.stringify(profile));
  return root;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8"
  });
}

test("emits clean JSON without source or environment values", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json", "--format", "json"
  ], root);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.project.rootLabel, "fixture");
  assert.equal(parsed.engine.analysisMode, "static-lite");
  assert.doesNotMatch(result.stdout, /must-not-appear|SECRET_TOKEN/);
  assert.equal(parsed.scope.excludedByReason.environment, 1);

  const directRecords = await Promise.all(["package.json", "pages/index.tsx"].map(async (relative) => {
    const content = await fs.readFile(path.join(root, relative), "utf8");
    return { path: relative, content, size: Buffer.byteLength(content) };
  }));
  const profile = JSON.parse(await fs.readFile(path.join(root, ".frontend-agent-playbook.json"), "utf8"));
  const direct = createAuditBundle({
    name: "fixture",
    records: directRecords,
    scope: { selected: 4, analyzed: 2, excluded: 2, analyzedBytes: 1 },
    profile,
    profileDigest: parsed.engine.profileDigest,
    scopePolicyDigest: parsed.scopePolicyDigest,
    capabilities: parsed.engine.capabilities,
    generatedAt: parsed.generatedAt
  }).audit;
  assert.deepEqual(
    parsed.findings.map(({ id, fingerprint, detectorId }) => ({ id, fingerprint, detectorId })),
    direct.findings.map(({ id, fingerprint, detectorId }) => ({ id, fingerprint, detectorId }))
  );
});

test("creates a baseline and blocks only configured new findings", async (t) => {
  const root = await fixture({
    ci: {
      mode: "blocking",
      failOn: ["finding:security.html-sink-boundary"],
      requireComplete: false
    }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, ".frontend-audit", "result.json");
  const baselinePath = path.join(root, ".frontend-audit", "baseline.json");

  const first = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--format", "json", "--output", resultPath, "--quiet"
  ], root);
  assert.equal(first.status, 0, first.stderr);

  const baseline = run([
    "baseline", "--from", resultPath, "--output", baselinePath, "--quiet"
  ], root);
  assert.equal(baseline.status, 0, baseline.stderr);

  await fs.writeFile(
    path.join(root, "pages", "unsafe.tsx"),
    "export default function Unsafe({ html }) { return <div dangerouslySetInnerHTML={{ __html: html }} />; }"
  );
  const changed = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--baseline", ".frontend-audit/baseline.json", "--format", "json"
  ], root);

  assert.equal(changed.status, 1, changed.stderr);
  const parsed = JSON.parse(changed.stdout);
  assert.ok(parsed.diff.new.includes("security.html-sink-boundary:pages/unsafe.tsx"));
  assert.ok(parsed.diff.unchanged.includes("security.html-sink-boundary:pages/index.tsx") === false);
});

test("uses exit 2 for invalid profile input", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, ".frontend-agent-playbook.json"), "{\"schemaVersion\":\"1\"}");

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json", "--format", "summary"
  ], root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid project profile/);
});

test("uses exit 3 when complete coverage is required but a symlink is excluded", async (t) => {
  const root = await fixture({
    ci: { mode: "report-only", failOn: [], requireComplete: true }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.symlink(path.join(root, "pages", "index.tsx"), path.join(root, "pages", "linked.tsx"));

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json", "--format", "json"
  ], root);

  assert.equal(result.status, 3, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.scope.partial, true);
  assert.deepEqual(parsed.scope.partialReasons, ["symlink:1"]);
});

test("refuses to overwrite an existing non-analyzer file", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageBefore = await fs.readFile(path.join(root, "package.json"), "utf8");

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--format", "json", "--output", "package.json", "--quiet"
  ], root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /refusing to overwrite/);
  assert.equal(await fs.readFile(path.join(root, "package.json"), "utf8"), packageBefore);
});

test("refuses to replace an audit result with its derived baseline", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, ".frontend-audit", "result.json");
  assert.equal(run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--format", "json", "--output", resultPath, "--quiet"
  ], root).status, 0);

  const result = run([
    "baseline", "--from", resultPath, "--output", resultPath, "--quiet"
  ], root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /must differ/);
});
