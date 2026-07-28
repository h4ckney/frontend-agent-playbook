import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  analyzeRecords,
  buildMarkdown,
  createAuditResult,
  isAnalyzableFile,
  selectUrgentFindings
} = require("./analyzer.js");

function record(path, content) {
  return { path, content };
}

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
  const htmlFinding = findings.find((finding) => finding.title.includes("HTML 삽입 지점"));

  assert.ok(htmlFinding);
  assert.equal(htmlFinding.id, "security.html-sink-boundary");
  assert.equal(htmlFinding.occurrenceCount, 17);
  assert.equal(htmlFinding.evidenceLevel, "observed");
  assert.match(htmlFinding.title, /sanitizer 의존성·import 미발견/);
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
  const htmlFinding = findings.find((finding) => finding.title.includes("HTML 삽입 지점"));

  assert.match(htmlFinding.title, /지점별 적용 미확인/);
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
  const htmlFinding = findings.find((finding) => finding.title.includes("HTML 삽입 지점"));

  assert.equal(htmlFinding.severity, "high");
  assert.match(htmlFinding.title, /지점별 적용 미확인/);
});

test("excludes environment, generated, build, binary-like, and oversized files", () => {
  assert.equal(isAnalyzableFile({ name: ".env", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: ".env.production", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "api.generated.ts", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "app.ts", webkitRelativePath: "repo/.next/app.ts", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "image.png", size: 10 }), false);
  assert.equal(isAnalyzableFile({ name: "large.ts", size: 500_001 }), false);
  assert.equal(isAnalyzableFile({ name: "app.ts", size: 10 }), true);
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
  ]);

  assert.ok(findings.some((finding) => finding.id === "seo.next-metadata-missing"));
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
  assert.match(deadCode.recommendation, /삭제 승인이 아닙니다/);
  assert.deepEqual(selectUrgentFindings(findings), []);
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
  const output = buildMarkdown(createAuditResult("fixture", findings, 4, "test"));

  assert.match(output, /No finding does not mean safe/);
  assert.match(output, /src\/storage.ts/);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /Score:/);
  assert.match(output, /## Security Or Privacy Risks/);
  assert.match(output, /Evidence level: 위험 추론/);
  assert.match(output, /Finding ID: `security\.browser-auth-storage`/);
  assert.match(output, /## Audit Handoff/);
  assert.match(output, /Source finding IDs/);
  assert.match(output, /결함 확정이 아님/);
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
