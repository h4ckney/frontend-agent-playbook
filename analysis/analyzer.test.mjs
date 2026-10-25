import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  analyzeRecords,
  buildMarkdown,
  createRiskClusters,
  createAuditResult,
  fileExclusionReason,
  isAnalyzableFile,
  selectFilesWithinBudget,
  selectPriorityCandidates
} = require("./analyzer.js");

function record(path, content) {
  return { path, content };
}

const stylingFindings = (content, path = "src/overlays.css") => analyzeRecords([
  record(path, content)
]).filter((item) => item.area === "styling");

test("reports bounded stylesheet layout candidates without claiming rendered defects", () => {
  const findings = stylingFindings(`
    .modal { position: fixed; overflow: hidden; height: 40px; transform: translateZ(0); width: 900px; }
    .popover { position: sticky; overflow-y: clip; max-height: 30vh; }
  `);
  assert.equal(findings.length, 2);
  const clipped = findings.find((item) => item.id === "styling.overlay-clipping-context");
  assert.equal(clipped.occurrenceCount, 2);
  assert.deepEqual(clipped.allEvidence, ["src/overlays.css"]);
  assert.equal(clipped.severity, "medium");
  for (const item of findings) {
    assert.equal(item.evidenceLevel, "inferred");
    assert.equal(item.decision, "verify-first");
    assert.match(item.limitation, /DOM|media query|CSS-in-JS|top layer/);
    assert.doesNotMatch(item.title, /결함 확정|취약점|반드시 깨짐/);
  }
});

test("does not treat high z-index, intentional scrolling, or unrelated blocks as a layout defect", () => {
  assert.deepEqual(stylingFindings(`
    .modal { position: fixed; z-index: 999999; width: 900px; max-width: 95vw; }
    .dialog { position: fixed; overflow: auto; height: 40px; }
    .image-crop { overflow: hidden; height: 30px; transform: translateZ(0); }
    .popover { position: fixed; }
    .unrelated { overflow: hidden; height: 30px; }
  `), []);
});

test("keeps layout evidence within one declaration block and honors local overrides", () => {
  assert.deepEqual(stylingFindings(`
    .modal { position: fixed; overflow: hidden; }
    .modal { height: 40px; }
    .dialog { position: fixed; overflow: hidden; height: 40px; overflow: visible; }
    .popover { position: fixed; overflow: visible !important; height: 40px; overflow: hidden; }
  `), []);
});

test("ignores stylesheet comments, strings, malformed blocks, and JSX inline styles", () => {
  assert.deepEqual(stylingFindings(`
    /* .modal { position: fixed; overflow: hidden; height: 40px; width: 900px; } */
    .dialog::before { content: "}; .modal { position: fixed; overflow: hidden; height: 40px; width: 900px; }"; }
  `), []);
  assert.deepEqual(stylingFindings(".modal { position: fixed; overflow: hidden; height: 40px;"), []);
  assert.deepEqual(stylingFindings("const style = { position: 'fixed', width: '900px' };", "src/Modal.tsx"), []);
  assert.deepEqual(stylingFindings("// .modal { position: fixed; overflow: hidden; height: 40px; width: 900px; }", "src/overlay.scss"), []);
});

test("recognizes a simple desktop min-width guard without assuming complex media conditions", () => {
  assert.deepEqual(stylingFindings("@media (min-width: 900px) { .modal { width: 900px; } }"), []);
  for (const condition of ["(max-width: 900px)", "(min-width: 900px), (orientation: portrait)", "not (min-width: 900px)"]) {
    const findings = stylingFindings("@media " + condition + " { .modal { width: 900px; max-width: none; } }");
    assert.equal(findings[0]?.id, "styling.fixed-overlay-width", condition);
    assert.match(findings[0].mitigatingControls, /큰 화면 전용/);
    assert.match(findings[0].limitation, /media query/);
  }
});

test("requires E2E config or test-source paths rather than a named directory or document", () => {
  for (const path of ["e2e/README.md", "docs/playwright.md", "src/use2e.ts", "e2e/placeholder.ts"]) {
    assert.ok(analyzeRecords([record(path, "export {};")])
      .some((item) => item.id === "testing.e2e-path-missing"), path);
  }
  for (const path of ["playwright.config.ts", "cypress.config.mjs", "e2e/smoke.spec.ts", "tests/e2e/nested/checkout.test.tsx", "cypress/e2e/checkout.cy.ts"]) {
    assert.ok(!analyzeRecords([record(path, "export {};")])
      .some((item) => item.id === "testing.e2e-path-missing"), path);
  }
});

test("groups HTML sinks and reports missing sanitizer without claiming XSS", () => {
  const sinks = Array.from(
    { length: 17 },
    (_, index) => "<div dangerouslySetInnerHTML={{ __html: value" + index + " }} />"
  ).join("\n");
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "13.5.0", react: "18.2.0" },
      scripts: { test: "vitest" }
    })),
    record("pages/content.tsx", sinks),
    record("tests/content.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const htmlFinding = findings.find((finding) => finding.id === "security.html-sink-boundary");

  assert.ok(htmlFinding);
  assert.equal(htmlFinding.id, "security.html-sink-boundary");
  assert.equal(htmlFinding.occurrenceCount, 17);
  assert.equal(htmlFinding.evidenceLevel, "observed");
  assert.match(htmlFinding.title, /정제 라이브러리 의존성이나 import를 찾지 못함/);
  assert.doesNotMatch(htmlFinding.title, /XSS 취약점/);
});

test("does not lower sink severity from project-wide sanitizer evidence", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "13.5.0", react: "18.2.0", dompurify: "3.0.0" },
      scripts: { test: "vitest" }
    })),
    record("pages/content.tsx", [
      'import DOMPurify from "dompurify";',
      "<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }} />"
    ].join("\n")),
    record("tests/content.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const htmlFinding = findings.find((finding) => finding.id === "security.html-sink-boundary");

  assert.match(htmlFinding.title, /각 위치의 적용 여부는 확인되지 않음/);
  assert.equal(htmlFinding.severity, "high");
});

test("does not treat an unrelated sanitizer import as sink-level protection", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "13.5.0", react: "18.2.0", dompurify: "3.0.0" },
      scripts: { test: "vitest" }
    })),
    record("src/safe-preview.ts", 'import DOMPurify from "dompurify";'),
    record("pages/content.tsx", "<div dangerouslySetInnerHTML={{ __html: value }} />"),
    record("tests/content.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const htmlFinding = findings.find((finding) => finding.id === "security.html-sink-boundary");

  assert.equal(htmlFinding.severity, "high");
  assert.match(htmlFinding.title, /각 위치의 적용 여부는 확인되지 않음/);
});

test("excludes environment, generated, build, binary-like, and oversized files", () => {
  assert.equal(isAnalyzableFile({ name: ".env", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: ".env.production", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "api.generated.ts", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "app.ts", webkitRelativePath: "repo/.next/app.ts", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "image.png", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "large.ts", size: 500_001 }), false);
  assert.equal(isAnalyzableFile({ name: "app.ts", size: 10 }), true);
  assert.equal(fileExclusionReason({ name: ".env", size: 10 }), "environment");
  assert.equal(fileExclusionReason({ name: "image.png", size: 10 }), "unsupported-type");
});

test("caps file count before reading and marks the result partial", () => {
  const files = Array.from({ length: 4_001 }, (_, index) => ({
    name: "file-" + index + ".ts",
    size: 1
  }));
  const selection = selectFilesWithinBudget(files);

  assert.equal(selection.accepted.length, 4_000);
  assert.equal(selection.excludedByReason["input-budget"], 1);
  assert.equal(selection.budgetExceeded, true);
  assert.equal(selection.coverageIncomplete, true);
});

test("marks oversized source exclusion as incomplete coverage", () => {
  const selection = selectFilesWithinBudget([
    { name: "large.ts", size: 500_001 },
    { name: "small.ts", size: 10 }
  ]);

  assert.equal(selection.accepted.length, 1);
  assert.equal(selection.excludedByReason.oversized, 1);
  assert.equal(selection.coverageIncomplete, true);
});

test("does not treat metadata documentation as a Next.js metadata implementation", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "14.2.0", react: "18.2.0" },
      scripts: { test: "vitest" }
    })),
    record("README.md", "Use generateMetadata for public routes."),
    record("pages/index.tsx", "export default function Page() { return null; }"),
    record("tests/page.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ], { seoScope: "public" });

  assert.ok(findings.some((finding) => finding.id === "seo.next-metadata-missing"));
});

test("does not report search optimization gaps for an internal-only project", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "14.2.0", react: "18.2.0" },
      scripts: { test: "vitest" }
    })),
    record("pages/admin.tsx", "export default function Admin() { return null; }"),
    record("tests/admin.test.tsx", "export {};"),
    record("e2e/admin.spec.ts", "export {};")
  ], { seoScope: "internal" });

  assert.equal(findings.some((finding) => finding.area === "seo"), false);
});

test("reports only indexing intent when search exposure is unknown", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "14.2.0", react: "18.2.0" },
      scripts: { test: "vitest" }
    })),
    record("pages/index.tsx", "export default function Page() { return null; }"),
    record("tests/page.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const seoFindings = findings.filter((finding) => finding.area === "seo");

  assert.deepEqual(seoFindings.map((finding) => finding.id), ["seo.indexing-intent-unknown"]);
  assert.equal(seoFindings[0].evidenceLevel, "unknown");
  assert.equal(seoFindings[0].decision, "information-gap");
});

test("marks SEO as conditional for mixed public and internal scope", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "14.2.0", react: "18.2.0" },
      scripts: { test: "vitest" }
    })),
    record("pages/index.tsx", "export default function Page() { return null; }"),
    record("tests/page.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ], { seoScope: "mixed" });
  const metadata = findings.find((finding) => finding.id === "seo.next-metadata-missing");
  const result = createAuditResult("fixture", findings, 4, "test", {}, { seoScope: "mixed" });

  assert.equal(metadata.severity, "medium");
  assert.equal(result.areaCounts.find((row) => row.area === "seo").status, "conditional");
});

test("infers public SEO context when callers omit result context", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({
      dependencies: { next: "14.2.0", react: "18.2.0" },
      scripts: { test: "vitest" }
    })),
    record("pages/index.tsx", "export default function Page() { return null; }"),
    record("tests/page.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ], { seoScope: "public" });
  const result = createAuditResult("fixture", findings, 4, "test");

  assert.deepEqual(result.context, { seoScope: "public" });
});

test("marks dead code only as a removal candidate", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    record("src/legacy.ts", "// TODO remove after migration"),
    record("tests/legacy.test.ts", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const deadCode = findings.find((finding) => finding.area === "dead-code");

  assert.equal(deadCode.evidenceLevel, "candidate");
  assert.match(deadCode.recommendation, /이 결과만으로 삭제하면 안 됩니다/);
  assert.deepEqual(selectPriorityCandidates(findings), []);
});

test("uses stable grouped finding IDs across paths and occurrence counts", () => {
  const first = analyzeRecords([
    record("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    record("src/first.tsx", "<div dangerouslySetInnerHTML={{ __html: value }} />"),
    record("tests/first.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const second = analyzeRecords([
    record("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    record("features/a.tsx", "<div dangerouslySetInnerHTML={{ __html: a }} />"),
    record("features/b.tsx", "<div dangerouslySetInnerHTML={{ __html: b }} />"),
    record("tests/content.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);

  const firstIds = first.filter((finding) => finding.area === "security").map((finding) => finding.id);
  const secondIds = second.filter((finding) => finding.area === "security").map((finding) => finding.id);

  assert.deepEqual(firstIds, secondIds);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
});

test("groups related findings into one priority candidate with impact context", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    record("src/content.tsx", "<div dangerouslySetInnerHTML={{ __html: value }} />"),
    record("tests/content.test.tsx", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const clusters = createRiskClusters(findings);
  const htmlCluster = clusters.find((cluster) => cluster.id === "security.html-rendering-boundary");
  const candidates = selectPriorityCandidates(findings);

  assert.ok(htmlCluster);
  assert.deepEqual(htmlCluster.findingIds, [
    "security.html-sink-boundary",
    "security.html-trust-boundary-unknown"
  ]);
  assert.match(htmlCluster.whyRisky, /DOM/);
  assert.match(htmlCluster.possibleImpact, /사용자/);
  assert.match(htmlCluster.verification, /HTML 출력 지점/);
  assert.equal(candidates.filter((candidate) => candidate.id === htmlCluster.id).length, 1);
  assert.equal(selectPriorityCandidates(findings, "gap").some(
    (candidate) => candidate.id === htmlCluster.id
  ), true);
});

test("rejects duplicate finding IDs in one audit result", () => {
  const duplicate = {
    id: "testing.duplicate",
    severity: "medium",
    area: "testing",
    type: "gap",
    evidenceLevel: "inferred",
    title: "duplicate",
    evidence: ["tests/example.ts"],
    limitation: "fixture",
    recommendation: "review"
  };
  assert.throws(() => createAuditResult("fixture", [duplicate, duplicate], 1, "test"), /unique stable IDs/);
});

test("Markdown contains limitations and paths but no source contents", () => {
  const secret = "super-secret-value";
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    record("src/storage.ts", 'localStorage.setItem("token", "' + secret + '")'),
    record("tests/storage.test.ts", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const output = buildMarkdown(createAuditResult("fixture", findings, 4, "test", {
    selected: 7,
    analyzed: 4,
    excluded: 3
  }));

  assert.match(output, /No finding does not mean safe/);
  assert.match(output, /Files selected: 7/);
  assert.match(output, /Files inspected: 4/);
  assert.match(output, /Files excluded: 3/);
  assert.match(output, /Bytes inspected: 0/);
  assert.match(output, /Analysis completeness: within configured/);
  assert.match(output, /Search exposure scope: 미확인/);
  assert.match(output, /SEO applicability: undetermined/);
  assert.match(output, /Automated detection areas: framework version and router context/);
  assert.match(output, /## Priority Review Candidates/);
  assert.match(output, /Why it may matter:/);
  assert.match(output, /Possible impact:/);
  assert.match(output, /Cheapest next verification:/);
  assert.match(output, /## Project Context Findings/);
  assert.match(output, /Manual review remains required: accessibility/);
  assert.match(output, /src\/storage.ts/);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /Score:/);
  assert.match(output, /## Security Or Privacy Risks/);
  assert.match(output, /Evidence level: 위험 가능성/);
  assert.match(output, /Finding ID: `security\.browser-auth-storage`/);
  assert.match(output, /## Audit Handoff/);
  assert.match(output, /Source finding IDs/);
  assert.match(output, /결함이 확인된 것은 아님/);
});

test("defaults audit scope to inspected files for existing callers", () => {
  const result = createAuditResult("fixture", [], 4, "test");

  assert.deepEqual(result.scope, {
    selected: 4,
    analyzed: 4,
    excluded: 0,
    analyzedBytes: 0,
    excludedByReason: {},
    partial: false
  });
  assert.equal(result.fileCount, 4);
  assert.deepEqual(result.context, { seoScope: "unknown" });
});

test("documents internal SEO exclusion in Markdown", () => {
  const state = createAuditResult("internal-tool", [], 0, "test", {}, { seoScope: "internal" });
  const output = buildMarkdown(state);

  assert.match(output, /Search exposure scope: 내부 전용/);
  assert.match(output, /SEO applicability: not applicable/);
  assert.match(output, /Not assessed: this project was classified as internal\/private only/);
});

test("escapes paths before placing them in the Markdown handoff table", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    record("src/weird|name.ts", 'localStorage.setItem("token", value)'),
    record("tests/storage.test.ts", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const output = buildMarkdown(createAuditResult("fixture", findings, 4, "test"));
  const handoff = output.slice(output.indexOf("## Audit Handoff"));

  assert.match(handoff, /src\/weird\\\|name\.ts/);
});

test("prevents project names and evidence paths from injecting Markdown sections", () => {
  const findings = analyzeRecords([
    record("package.json", JSON.stringify({ scripts: { test: "vitest" } })),
    record("src/\n## Injected/file.ts", 'localStorage.setItem("token", value)'),
    record("tests/storage.test.ts", "export {};"),
    record("e2e/smoke.spec.ts", "export {};")
  ]);
  const output = buildMarkdown(createAuditResult("fixture\n## Injected", findings, 4, "test"));

  assert.doesNotMatch(output, /\n## Injected/);
  assert.match(output, /fixture ## Injected/);
  assert.match(output, /src\/ ## Injected\/file\.ts/);
});
