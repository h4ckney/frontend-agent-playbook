#!/usr/bin/env node
// Synthetic engine probes only. Never loads or executes the scanned app.
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--analyzer-root")) {
  throw new Error("usage: node scripts/reproduce-audit-gaps.mjs [--analyzer-root PATH_TO_TRUSTED_ENGINE]");
}
const engineRoot = args.length ? path.resolve(args[1]) : root;
const require = createRequire(import.meta.url);
const contract = require(path.join(engineRoot, "analysis", "audit-contract.js"));
const generatedAt = "2026-10-25T00:00:00.000Z";
const pkg = { path: "package.json", content: JSON.stringify({ dependencies: { next: "^15.0.0", react: "^19.0.0" }, scripts: { test: "node --test" } }) };
const scan = (records) => contract.createAuditBundle({ name: "synthetic-probe", records: [pkg, ...records], context: { seoScope: "internal" }, generatedAt }).audit;
const ids = (result) => [...new Set(result.findings.map((finding) => finding.id))].sort();
const inventory = scan([{ path: "e2e/README.md", content: "Documentation only, no executable tests." }]);
const storage = scan([{ path: "src/auth.ts", content: 'const KEY="access_token";localStorage.setItem(KEY, exampleToken);' }]);
const separate = scan([
  { path: "src/app/admin/page.tsx", content: "element.innerHTML = content;" },
  { path: "src/app/public/page.tsx", content: "element.innerHTML = content;" }
]);
const original = scan([{ path: "src/widget.tsx", content: "element.innerHTML = one;" }]);
const added = scan([{ path: "src/widget.tsx", content: "element.innerHTML = one;other.innerHTML = two;" }]);
const diff = contract.compareWithBaseline(added, contract.createBaseline(original, { createdAt: generatedAt }));
const multi = scan([
  { path: "apps/legacy/package.json", content: JSON.stringify({ dependencies: { next: "13.0.0", react: "18.0.0" } }) },
  { path: "apps/legacy/pages/index.tsx", content: "export default function Page(){return null}" }
]);
const layout = scan([{ path: "src/modal.css", content: ".modal{position:fixed;overflow:hidden;transform:translateZ(0);height:40px;width:1200px;z-index:99999}" }]);
const htmlFinding = diff.findings.find((finding) => finding.id === "security.html-sink-boundary");
const result = {
  fixtureDate: "2026-10-25",
  input: "synthetic fixtures; no production code, secrets or payloads",
  engineVersion: layout.toolVersion,
  detectorCatalogVersion: layout.engine.detectorCatalogVersion,
  observations: [
    { id: "e2e-readme", gapReported: ids(inventory).includes("testing.e2e-path-missing"), interpretation: "inventory only; never proves journey coverage" },
    { id: "auth-wrapper", authStorageReported: ids(storage).includes("security.browser-auth-storage"), interpretation: "retained static-lite gap" },
    { id: "separate-boundaries", canonicalHtmlClusterCount: separate.clusters.filter((cluster) => cluster.id === "security.html-rendering-boundary").length, interpretation: "canonical clusters unchanged; browser triage now separates by module directory" },
    { id: "same-file-extra-sink", diffStatus: htmlFinding.diffStatus, occurrenceCount: htmlFinding.occurrenceCount, interpretation: "canonical baseline gap retained; local source digest reopens a prior review" },
    { id: "multi-package", frameworkVersion: multi.project.frameworkVersion, routerMode: multi.project.routerMode, interpretation: "first-manifest context remains a limitation" },
    { id: "css-layout", stylingFindingIds: ids(layout).filter((id) => id.startsWith("styling.")), interpretation: "static risk candidates only; no browser rendering performed" }
  ]
};
process.stdout.write(JSON.stringify(result, null, 2) + "\n");
