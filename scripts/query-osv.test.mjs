import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { queryInventory, buildMarkdown, main } from "./query-osv.mjs";

const item = (overrides = {}) => ({ ecosystem: "npm", name: "example", version: "1.2.3", versionKind: "locked-exact", manifest: "package-lock.json", path: "node_modules/example", phase: "runtime", phaseEvidence: "lockfile declared installation role", provenance: "lockfile", direct: true, ...overrides });
const scan = (inventory, overrides = {}) => ({ securityContext: { inventory, coverage: { gaps: [] } }, ...overrides });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const detail = (id, ecosystem = "npm", name = "example", more = {}) => ({ id, modified: "2026-10-30T00:00:00Z", summary: "Synthetic advisory", affected: [{ package: { ecosystem, name }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "1.2.4" }] }] }], references: [{ type: "ADVISORY", url: "https://example.com/advisory" }], ...more });

test("sends only unique locked package coordinates and retains local phase/path evidence", async () => {
  const requests = [];
  const report = await queryInventory(scan([
    item(), item({ manifest: "apps/build/package-lock.json", phase: "build", direct: false }),
    item({ ecosystem: "composer", name: "vendor/module", version: "v2.3.4", manifest: "composer.lock", path: "packages/vendor/module" }),
    item({ version: "^1.2.3", versionKind: "declared-range" }),
    item({ ecosystem: "runtime", name: "node", version: "22.0.0", versionKind: "runtime-pin" })
  ]), { fetchImpl: async (url, options) => { requests.push({ url, options }); return json({ results: [{}, {}] }); } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.osv.dev/v1/querybatch");
  assert.deepEqual(JSON.parse(requests[0].options.body), { queries: [
    { package: { ecosystem: "npm", name: "example" }, version: "1.2.3" },
    { package: { ecosystem: "Packagist", name: "vendor/module" }, version: "2.3.4" }
  ] });
  assert.doesNotMatch(requests[0].options.body, /apps\/build|package-lock|phase|runtime|build|direct/);
  assert.equal(report.packages[0].occurrences.length, 2);
  assert.deepEqual(report.packages[0].occurrences.map((entry) => entry.phase), ["runtime", "build"]);
  assert.equal(report.packages[0].status, "none-reported");
  assert.equal(report.skipped.length, 2);
  assert.equal(report.coverage.status, "partial");
});

test("batch pagination preserves query association, details and aliases collapse one issue with child modules", async () => {
  const requests = [];
  const report = await queryInventory(scan([item(), item({ name: "another", path: "node_modules/another", phase: "development" })]), {
    fetchImpl: async (url, options) => {
      requests.push({ url, body: options.body && JSON.parse(options.body) });
      if (url.endsWith("querybatch")) {
        return requests.length === 1 ? json({ results: [
          { vulns: [{ id: "GHSA-aaaa-bbbb-cccc" }], next_page_token: "next-example" },
          { vulns: [{ id: "CVE-2026-12345" }] }
        ] }) : json({ results: [{}] });
      }
      const id = decodeURIComponent(url.split("/").at(-1));
      return json(id.startsWith("GHSA") ? detail(id, "npm", "example", { aliases: ["CVE-2026-12345"] })
        : detail(id, "npm", "another", { aliases: ["GHSA-aaaa-bbbb-cccc"] }));
    }
  });
  assert.deepEqual(requests[1].body.queries, [{ package: { ecosystem: "npm", name: "example" }, version: "1.2.3", page_token: "next-example" }]);
  assert.equal(report.coverage.status, "complete");
  assert.equal(report.advisories.length, 1);
  assert.equal(report.advisories[0].records.length, 2);
  assert.equal(report.advisories[0].packageKeys.length, 2);
  assert.deepEqual(report.packages.map((entry) => entry.advisoryIds), [["GHSA-aaaa-bbbb-cccc"], ["GHSA-aaaa-bbbb-cccc"]]);
  const markdown = buildMarkdown(report);
  assert.equal(markdown.match(/## GHSA-aaaa-bbbb-cccc/g).length, 1);
  assert.match(markdown, /development \/ package-lock/);
  assert.match(markdown, /vulnerable call path require verification/);
});

test("network errors, malformed batch counts and unresolved pagination never produce complete coverage", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("offline"); },
    async () => json({ results: [] }),
    async () => json({ results: [{ next_page_token: "more" }] }),
    async () => json({ results: [{ vulns: "invalid" }] }),
    async () => json({ results: [[]] })
  ]) {
    const report = await queryInventory(scan([item()]), { fetchImpl, maxPages: 1 });
    assert.equal(report.coverage.status, "partial");
    assert.equal(report.packages[0].status, "incomplete");
    assert.notEqual(report.packages[0].status, "none-reported");
  }
});

test("detail query caps, HTTP errors and package identity mismatch remain explicit incomplete evidence", async () => {
  const capped = await queryInventory(scan([item()]), { maxDetails: 1, fetchImpl: async (url) => url.endsWith("querybatch")
    ? json({ results: [{ vulns: [{ id: "GHSA-one" }, { id: "GHSA-two" }] }] }) : json(detail("GHSA-one")) });
  assert.equal(capped.coverage.status, "partial");
  assert.equal(capped.advisories.length, 2);
  assert.match(capped.packages[0].notes.join(" "), /detail query limit/);
  for (const response of [json({}, 503), json(detail("GHSA-one", "npm", "wrong-package"))]) {
    const report = await queryInventory(scan([item()]), { fetchImpl: async (url) => url.endsWith("querybatch")
      ? json({ results: [{ vulns: [{ id: "GHSA-one" }] }] }) : response });
    assert.equal(report.coverage.status, "partial");
    assert.equal(report.packages[0].status, "incomplete");
  }
});

test("package query limits, unsupported versions and partial source scans disclose their gaps", async () => {
  let requests = 0;
  const report = await queryInventory(scan([item(), item({ name: "later" })], { scope: { partial: true } }), {
    maxPackages: 1, fetchImpl: async () => { requests += 1; return json({ results: [{}] }); }
  });
  assert.equal(requests, 1);
  assert.equal(report.coverage.status, "partial");
  assert.equal(report.packages[1].status, "not-queried");
  const none = await queryInventory(scan([item({ version: "workspace:*", versionKind: "declared-range" })]), { fetchImpl: async () => { throw Error("must not run"); } });
  assert.equal(none.coverage.status, "not-run");
  assert.equal(none.skipped[0].reason, "not-a-locked-exact-version");
  await assert.rejects(queryInventory({}, { fetchImpl: async () => {} }), /inventory is required/);
});

test("reported advisory text is inert Markdown and withdrawn history remains visible", async () => {
  const report = await queryInventory(scan([item()]), { fetchImpl: async (url) => url.endsWith("querybatch")
    ? json({ results: [{ vulns: [{ id: "GHSA-test" }] }] })
    : json(detail("GHSA-test", "npm", "example", { summary: "<script>alert(1)</script> [unsafe](https://invalid)", withdrawn: "2026-10-30T01:00:00Z", aliases: "invalid-string" })) });
  assert.equal(report.coverage.status, "complete");
  const text = buildMarkdown(report);
  assert.doesNotMatch(text, /<script>|\[unsafe\]/);
  assert.match(text, /Withdrawn record present/);
});


test("explicit CLI refuses to overwrite an existing report before making any network request", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osv-report-protection-"));
  const input = path.join(directory, "audit.json");
  const existing = path.join(directory, "dependency-advisories.json");
  const previousFetch = globalThis.fetch;
  try {
    await fs.writeFile(input, JSON.stringify(scan([item()])));
    await fs.writeFile(existing, "user-owned content");
    globalThis.fetch = async () => { throw Error("network must not be reached"); };
    await assert.rejects(main(["--scan", input, "--output", directory]), /already exists/);
    assert.equal(await fs.readFile(existing, "utf8"), "user-owned content");
  } finally {
    globalThis.fetch = previousFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});


test("CLI rejects non-canonical scan input before disclosing package metadata", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "osv-input-contract-"));
  const input = path.join(directory, "audit.json");
  const previousFetch = globalThis.fetch;
  let called = false;
  try {
    await fs.writeFile(input, JSON.stringify(scan([item()])));
    globalThis.fetch = async () => { called = true; throw Error("network must not be reached"); };
    await assert.rejects(main(["--scan", input, "--output", path.join(directory, "report")]), /invalid canonical audit result/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});


test("same-directory manifest declarations are provenance without duplicating lock coverage gaps", async () => {
  const covered = await queryInventory(scan([
    item({ manifest: "apps/web/package-lock.json" }),
    item({ version: "^9.0.0", versionKind: "declared-range", manifest: "apps/web/package.json", path: "dependencies/example", provenance: "manifest-declaration" }),
    item({ ecosystem: "composer", name: "vendor/module", manifest: "php/composer.lock" }),
    item({ ecosystem: "composer", name: "vendor/module", version: "^2.0", versionKind: "declared-range", manifest: "php/composer.json", path: "require/vendor/module", provenance: "manifest-declaration" })
  ]), { fetchImpl: async () => json({ results: [{}, {}] }) });
  assert.equal(covered.coverage.status, "complete");
  assert.equal(covered.packages.length, 2);
  assert.equal(covered.skipped.length, 0);
  assert.equal(covered.declarations.length, 2);
  assert.equal(covered.declarations[0].status, "covered-by-lock");
  assert.equal(covered.declarations[0].version, "^9.0.0");
  assert.equal(covered.declarations[0].provenance, "manifest-declaration");
  assert.match(covered.declarations[0].note, /constraint compatibility.*not verified/);
  assert.match(buildMarkdown(covered), /declared \^9.0.0/);
  const unbacked = await queryInventory(scan([
    item({ manifest: "apps/web/package-lock.json" }),
    item({ version: "^1.0.0", versionKind: "declared-range", manifest: "apps/other/package.json", path: "dependencies/example", provenance: "manifest-declaration" }),
    item({ name: "missing", version: "^2.0.0", versionKind: "declared-range", manifest: "apps/web/package.json", path: "dependencies/missing", provenance: "manifest-declaration" })
  ]), { fetchImpl: async () => json({ results: [{}] }) });
  assert.equal(unbacked.coverage.status, "partial");
  assert.equal(unbacked.declarations.length, 0);
  assert.equal(unbacked.skipped.length, 2);
});
