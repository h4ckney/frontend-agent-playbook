import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  compareWithBaseline,
  createAuditBundle,
  createBaseline,
  validateAuditResult,
  validateProjectProfile
} = require("./audit-contract.js");

const schemas = {
  result: JSON.parse(fs.readFileSync(new URL("../schemas/audit-result.schema.json", import.meta.url))),
  baseline: JSON.parse(fs.readFileSync(new URL("../schemas/audit-baseline.schema.json", import.meta.url))),
  profile: JSON.parse(fs.readFileSync(new URL("../schemas/project-profile.schema.json", import.meta.url)))
};

const generatedAt = "2026-07-30T00:00:00.000Z";
const records = [
  {
    path: "package.json",
    content: JSON.stringify({
      dependencies: { next: "13.5.0", react: "18.2.0", typescript: "4.9.5" },
      scripts: { test: "vitest" }
    })
  },
  {
    path: "pages/checkout.tsx",
    content: "export default function Page({ html }) { return <div dangerouslySetInnerHTML={{ __html: html }} />; }"
  },
  { path: "tests/checkout.test.tsx", content: "export {};" }
];
const scope = {
  selected: records.length,
  analyzed: records.length,
  excluded: 0,
  analyzedBytes: records.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0)
};
const profile = {
  schemaVersion: "1",
  project: { id: "fixture", visibility: "public" },
  criticalJourneys: [
    { id: "checkout", routes: ["/checkout/**", "/checkout"], impact: "high", owners: ["web"] }
  ],
  routePolicies: [
    { pattern: "/checkout", visibility: "public", indexing: "required" }
  ],
  trustBoundaries: [
    {
      id: "external-html",
      source: "external-content",
      paths: ["pages/checkout.tsx"],
      requiredControls: ["approved-html-sanitizer"]
    }
  ],
  controls: [
    {
      id: "approved-html-sanitizer",
      area: "security",
      appliesTo: ["pages/checkout.tsx"],
      verification: "security fixture"
    }
  ],
  suppressions: [],
  ci: { mode: "report-only", failOn: [], requireComplete: false }
};

function audit(overrides = {}) {
  return createAuditBundle({
    name: "fixture",
    records,
    scope,
    profile,
    profileDigest: "sha256:fixture",
    scopePolicyDigest: "sha256:scope",
    generatedAt,
    now: generatedAt,
    ...overrides
  }).audit;
}

test("normalizes findings with rule links and approved project context", () => {
  const result = audit();
  const finding = result.findings.find((item) => item.id === "security.html-sink-boundary");

  assert.deepEqual(validateAuditResult(result), []);
  assert.deepEqual(finding.ruleRefs, ["security-privacy.html-injection"]);
  assert.deepEqual(finding.scope.routes, ["/checkout"]);
  assert.deepEqual(finding.scope.journeys, ["checkout"]);
  assert.deepEqual(finding.flow.sources, ["external-content"]);
  assert.deepEqual(finding.flow.controls, ["approved-html-sanitizer"]);
  assert.equal(finding.controlState, "partial");
  assert.equal(finding.priority.affectedJourney, "checkout");
  assert.match(finding.priority.reasons.join(" "), /approved journey context: checkout \(high\)/);
});

test("keeps runtime fixtures aligned with published schema entry points", () => {
  const result = audit();
  const baseline = createBaseline(result, { createdAt: generatedAt });

  for (const key of schemas.result.required) assert.ok(Object.hasOwn(result, key), "result." + key);
  for (const key of schemas.baseline.required) assert.ok(Object.hasOwn(baseline, key), "baseline." + key);
  for (const key of schemas.profile.required) assert.ok(Object.hasOwn(profile, key), "profile." + key);
  assert.deepEqual(validateAuditResult(result), []);
});

test("keeps the base decision visible when applying an active suppression", () => {
  const result = audit({
    profile: {
      ...profile,
      suppressions: [{
        fingerprint: "security.html-sink-boundary:pages/checkout.tsx",
        owner: "security",
        reason: "temporary accepted boundary",
        expires: "2026-12-31"
      }]
    }
  });
  const finding = result.findings.find((item) => item.id === "security.html-sink-boundary");

  assert.equal(finding.priority.decision, "verify-first");
  assert.equal(finding.priority.effectiveDecision, "suppressed");
  assert.equal(finding.suppression.owner, "security");
});

test("does not apply expired suppressions", () => {
  const result = audit({
    profile: {
      ...profile,
      suppressions: [{
        fingerprint: "security.html-sink-boundary:pages/checkout.tsx",
        owner: "security",
        reason: "expired",
        expires: "2026-01-01"
      }]
    }
  });
  const finding = result.findings.find((item) => item.id === "security.html-sink-boundary");

  assert.equal(finding.priority.effectiveDecision, "verify-first");
  assert.equal(finding.suppression, null);
  assert.ok(result.diagnostics.some((item) => item.id.startsWith("suppression.expired.")));
});

test("classifies new, worsened, unchanged, resolved, and unverified baseline states", () => {
  const result = audit();
  const baseline = createBaseline(result, { createdAt: generatedAt });
  const unchanged = compareWithBaseline(result, baseline);
  assert.equal(unchanged.diff.unchanged.length, result.findings.length);

  const emptyBaseline = { ...baseline, findings: [] };
  const allNew = compareWithBaseline(result, emptyBaseline);
  assert.equal(allNew.diff.new.length, result.findings.length);
  assert.equal(allNew.clusters[0].priority.sortKeys[0], "new");
  assert.match(allNew.clusters[0].priority.reasons[0], /Baseline status: new/);

  const worsenedBaseline = structuredClone(baseline);
  const target = worsenedBaseline.findings.find((item) => item.detectorId === "security.html-boundary");
  target.severity = "low";
  assert.ok(compareWithBaseline(result, worsenedBaseline).diff.worsened.includes(target.fingerprint));

  const resolvedBaseline = structuredClone(baseline);
  resolvedBaseline.findings.push({
    fingerprint: "dead-code.marked-removal-candidate:src/legacy.ts",
    detectorId: "dead-code.markers",
    detectorVersion: "1",
    severity: "low",
    evidenceLevel: "candidate",
    applicability: "conditional",
    exposure: "limited",
    controlState: "unverified",
    journeyIds: [],
    decision: "observe",
    effectiveDecision: "observe"
  });
  assert.ok(compareWithBaseline(result, resolvedBaseline).diff.resolved.includes(
    "dead-code.marked-removal-candidate:src/legacy.ts"
  ));

  const partial = audit({
    scope: {
      ...scope,
      excluded: 1,
      excludedByReason: { symlink: 1 },
      partial: true
    }
  });
  assert.ok(compareWithBaseline(partial, resolvedBaseline).diff.unverified.includes(
    "dead-code.marked-removal-candidate:src/legacy.ts"
  ));
});

test("does not treat action-label changes alone as worsening", () => {
  const result = audit();
  const baseline = createBaseline(result, { createdAt: generatedAt });
  baseline.findings[0].decision = "observe";
  baseline.findings[0].effectiveDecision = "observe";

  const compared = compareWithBaseline(result, baseline);
  assert.ok(compared.diff.unchanged.includes(baseline.findings[0].fingerprint));
});

test("treats a same-detector path move as unverified instead of resolved plus new", () => {
  const result = audit();
  const baseline = createBaseline(result, { createdAt: generatedAt });
  const movedRecords = records.map((record) =>
    record.path === "pages/checkout.tsx"
      ? { ...record, path: "pages/payment.tsx" }
      : record
  );
  const moved = audit({
    records: movedRecords,
    scope: { ...scope }
  });

  const compared = compareWithBaseline(moved, baseline);
  assert.ok(compared.diff.unverified.includes("security.html-sink-boundary:pages/checkout.tsx"));
  assert.ok(compared.diff.unverified.includes("security.html-sink-boundary:pages/payment.tsx"));
  assert.ok(!compared.diff.resolved.includes("security.html-sink-boundary:pages/checkout.tsx"));
  assert.ok(!compared.diff.new.includes("security.html-sink-boundary:pages/payment.tsx"));
});

test("rejects partial baselines unless an explicit reason is supplied", () => {
  const result = audit({
    scope: {
      ...scope,
      excluded: 1,
      excludedByReason: { oversized: 1 },
      partial: true
    }
  });

  assert.throws(() => createBaseline(result), /partial audit result/);
  assert.throws(
    () => createBaseline(result, { allowPartial: true }),
    /non-empty reason/
  );
  assert.equal(
    createBaseline(result, { allowPartial: true, reason: "known fixture limit" }).partialReason,
    "known fixture limit"
  );
});

test("rejects malformed or ambiguous project profiles", () => {
  assert.ok(validateProjectProfile({ schemaVersion: "1", project: {} }).length > 0);
  assert.ok(validateProjectProfile({
    schemaVersion: "1",
    project: { id: "fixture" },
    suppressions: [{
      fingerprint: "one",
      ruleId: "two",
      detectorIds: ["three"],
      pathScope: ["**"],
      owner: "owner",
      reason: "ambiguous",
      expires: "2026-12-31"
    }]
  }).some((error) => /fingerprint or scoped rule/.test(error)));
  assert.ok(validateProjectProfile({
    schemaVersion: "1",
    project: { id: "fixture" },
    routePolicies: [
      { pattern: "/docs/*", visibility: "public", indexing: "required" },
      { pattern: "/docs/**", visibility: "internal", indexing: "not-applicable" }
    ]
  }).some((error) => /overlapping route policies/.test(error)));
});

test("does not apply an HTML trust boundary to unrelated findings in the same file", () => {
  const result = audit({
    records: records.map((record) =>
      record.path === "pages/checkout.tsx"
        ? { ...record, content: record.content + "\n// TODO remove after migration" }
        : record
    )
  });
  const deadCode = result.findings.find((item) => item.id === "dead-code.marked-removal-candidate");

  assert.equal(deadCode.applicability.status, "conditional");
  assert.ok(!deadCode.priority.reasons.some((reason) => /trust boundary/.test(reason)));
});

test("omits detector output when the surface lacks a required capability", () => {
  const result = audit({ capabilities: ["text-patterns"] });

  assert.ok(!result.findings.some((item) => item.id.startsWith("seo.")));
  assert.ok(result.diagnostics.some((item) => item.id === "capability.detectors-omitted"));
});

test("does not classify Pages Router special files as the root route", () => {
  const special = audit({
    records: [
      records[0],
      {
        path: "pages/_app.tsx",
        content: "export default function App({ html }) { return <div dangerouslySetInnerHTML={{ __html: html }} />; }"
      }
    ],
    profile: {
      ...profile,
      criticalJourneys: [
        { id: "home", routes: ["/"], impact: "high", owners: ["web"] }
      ],
      trustBoundaries: []
    }
  });
  const finding = special.findings.find((item) => item.id === "security.html-sink-boundary");

  assert.deepEqual(finding.scope.routes, []);
  assert.deepEqual(finding.scope.journeys, []);
});
