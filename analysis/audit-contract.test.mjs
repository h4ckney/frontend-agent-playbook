import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildAuditMarkdown,
  compareWithBaseline,
  createAuditBundle,
  createBaseline,
  validateAuditResult,
  validateBaseline,
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

test("normalizes stylesheet candidates with rule links and conditional evidence", () => {
  const result = createAuditBundle({
    name: "layout",
    records: [
      { path: "src/modal.css", content: ".modal { position: fixed; overflow: hidden; height: 40px; width: 900px; }" },
      { path: "src/drawer.css", content: ".drawer { width: 900px; }" }
    ],
    context: { seoScope: "internal" }
  }).audit;
  const styling = result.findings.filter((item) => item.area === "styling");
  assert.equal(styling.length, 3);
  assert.deepEqual(validateAuditResult(result), []);
  assert.equal(new Set(styling.map((item) => item.fingerprint)).size, 3);
  const clipped = styling.find((item) => item.id === "styling.overlay-clipping-context");
  assert.deepEqual(clipped.ruleRefs, ["design-system-styling.layer-boundaries"]);
  assert.equal(clipped.applicability.status, "conditional");
  assert.equal(clipped.evidenceLevel, "inferred");
  assert.equal(clipped.priority.effectiveDecision, "verify-first");
  const output = buildAuditMarkdown(result);
  assert.match(output, /styling\.overlay-clipping-context/);
  assert.doesNotMatch(output, /position: fixed|width: 900px/);
});

test("does not reuse the old E2E detector decision after its inventory semantics change", () => {
  const result = audit();
  const baseline = createBaseline(result);
  const entry = baseline.findings.find((item) => item.detectorId === "testing.critical-journeys");
  entry.detectorVersion = "1";
  const compared = compareWithBaseline(result, baseline);
  assert.ok(compared.diff.unverified.includes(entry.fingerprint));
  assert.equal(result.engine.detectorCatalogVersion, "3");
});

test("renders a Korean browser report while preserving stable identifiers", () => {
  const output = buildAuditMarkdown(audit(), { locale: "ko" });

  assert.match(output, /# 프론트엔드 코드베이스 점검: fixture/);
  assert.match(output, /## 우선 검토 항목/);
  assert.match(output, /항목 ID: `security\.html-sink-boundary`/);
  assert.match(output, /영향받는 중요 사용자 여정: checkout/);
  assert.doesNotMatch(
    output,
    /Priority Review Candidates|Finding ID|Missing findings|static-lite|text-patterns/
  );
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

test("retains new occurrences without rename proof and leaves ambiguous removals unverified", () => {
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
  assert.ok(!compared.diff.unverified.includes("security.html-sink-boundary:pages/payment.tsx"));
  assert.ok(!compared.diff.resolved.includes("security.html-sink-boundary:pages/checkout.tsx"));
  assert.ok(compared.diff.new.includes("security.html-sink-boundary:pages/payment.tsx"));
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

test("validates every reachable required field against the published artifact schemas", () => {
  const result = audit();
  const baseline = createBaseline(result, { createdAt: generatedAt });
  // Include optional structures so their nested contracts get exercised too.
  result.engine.externalTools = [{ name: 'fixture', version: '1', rulesetDigest: 'hash' }];
  baseline.externalTools = result.engine.externalTools;
  function probe(root, schema, validate) {
    let checked = 0;
    function visit(value, node, trail = []) {
      if (node.$ref) node = schema.$defs[node.$ref.slice('#/$defs/'.length)];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const key of node.required || []) {
          const copy = structuredClone(root);
          const owner = trail.reduce((target, segment) => target[segment], copy);
          delete owner[key];
          assert.ok(validate(copy).length, [...trail, key].join('.') + ' must be rejected');
          checked += 1;
        }
        for (const [key, child] of Object.entries(value)) if (node.properties?.[key]) visit(child, node.properties[key], [...trail, key]);
      } else if (Array.isArray(value) && node.items) value.forEach((child, index) => visit(child, node.items, [...trail, index]));
    }
    visit(root, schema);
    return checked;
  }
  assert.ok(probe(result, schemas.result, validateAuditResult) > 100);
  assert.ok(probe(baseline, schemas.baseline, validateBaseline) > 30);
});

test("rejects malformed nested artifact values, unknown fields, dates, and baseline metadata", () => {
  const mutations = [
    (value) => { value.findings[0].title = 123; },
    (value) => { value.findings[0].diffStatus = 'safe'; },
    (value) => { value.engine.externalTools = [{ name: 123 }]; },
    (value) => { value.findings[0].evidence[0].extra = true; },
    (value) => { value.extraUnsupported = true; },
    (value) => { value.scope.excludedByReason.bad = -1; },
    (value) => { value.generatedAt = '2026-02-30T00:00:00Z'; },
    (value) => { value.generatedAt = '2026-10-30'; }
  ];
  for (const mutate of mutations) {
    const result = audit();
    mutate(result);
    assert.ok(validateAuditResult(result).length);
  }
  const baseline = createBaseline(audit(), { createdAt: generatedAt });
  delete baseline.profileDigest;
  assert.ok(validateBaseline(baseline).length);
});

test("direct/browser bundle excludes explicit generated headers with incomplete coverage", () => {
  const before = audit();
  const baseline = createBaseline(before, { createdAt: generatedAt });
  const changed = records.map((record) => record.path === 'pages/checkout.tsx'
    ? { ...record, content: '// @generated\n' + record.content } : record);
  const result = audit({ records: changed });
  assert.equal(result.scope.partial, true);
  assert.equal(result.scope.includedFiles, changed.length - 1);
  assert.ok(result.scope.partialReasons.includes('generated-header:1'));
  const compared = compareWithBaseline(result, baseline);
  assert.ok(compared.diff.unverified.includes('security.html-sink-boundary:pages/checkout.tsx'));
  assert.ok(!compared.diff.resolved.includes('security.html-sink-boundary:pages/checkout.tsx'));
});

test("security advisories retain module children, phases, source identity and remain CI candidates", () => {
  const fixtures = [
    { path: 'Dockerfile', content: 'FROM node:24.22.0 AS builder\nFROM php:8.4.26-fpm\n' },
    { path: 'package-lock.json', content: JSON.stringify({ lockfileVersion: 3, packages: {
      '': {},
      'node_modules/react-server-dom-webpack': { version: '19.3.0' },
      'node_modules/next': { version: '16.4.0' },
      'node_modules/tools/node_modules/react-server-dom-webpack': { version: '19.3.0', dev: true }
    } }) }
  ];
  const result = createAuditBundle({ name: 'security-fixture', records: fixtures, generatedAt: '2026-10-30T00:00:00Z' }).audit;
  assert.deepEqual(validateAuditResult(result), []);
  assert.equal(result.securityContext.coverage.complete, false);
  assert.equal(result.securityContext.snapshot.liveLookup, false);
  const rsc = result.findings.filter((item) => item.id === 'security.rsc-typed-array-rce');
  assert.equal(rsc.length, 3);
  assert.equal(new Set(rsc.map((item) => item.fingerprint)).size, 3);
  assert.ok(rsc.every((item) => item.scope.boundaryIds.includes(item.id)));
  assert.ok(rsc.every((item) => item.evidenceLevel === 'inferred' && item.priority.decision === 'verify-first'));
  assert.equal(new Set(rsc.map((item) => item.clusterId)).size, 1);
  assert.match(rsc.map((item) => item.observedFact).join(' '), /development/);
  assert.match(buildAuditMarkdown(result), /Phase evidence/);
  assert.match(buildAuditMarkdown(result, { locale: 'ko' }), /실제 설치·배포·공격 경로는 미확인/);
  const baseline = createBaseline(result);
  const fixed = fixtures.map((item) => ({ ...item, content: item.content.replaceAll('19.3.0', '19.3.1').replace('16.4.0', '16.4.1') }));
  const current = createAuditBundle({ name: 'security-fixture', records: fixed, generatedAt: '2026-10-30T00:00:00Z' }).audit;
  const compared = compareWithBaseline(current, baseline);
  assert.ok(rsc.every((item) => compared.diff.resolved.includes(item.fingerprint)));
});

test("missing findings from a different detector revision remain unverified", () => {
  const baseline = createBaseline(audit());
  const previous = baseline.findings.find((item) => item.detectorId === 'security.html-boundary');
  previous.detectorVersion = 'older-revision';
  const result = audit({ records: records.filter((item) => item.path !== 'pages/checkout.tsx') });
  const compared = compareWithBaseline(result, baseline);
  assert.ok(compared.diff.unverified.includes(previous.fingerprint));
  assert.ok(!compared.diff.resolved.includes(previous.fingerprint));
});

test("lost or unsupported security version evidence cannot resolve a prior critical advisory", () => {
  const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/next': { version: '16.4.0' } } };
  const fixture = [
    { path: 'package.json', content: JSON.stringify({ dependencies: { next: '^16.4.0' } }) },
    { path: 'package-lock.json', content: JSON.stringify(lock) }
  ];
  const bundle = (value, date = '2026-10-30T00:00:00Z') => createAuditBundle({ records: value, generatedAt: date }).audit;
  const before = bundle(fixture);
  const baseline = createBaseline(before);
  const fingerprint = before.findings.find((item) => item.id === 'security.rsc-typed-array-rce').fingerprint;
  for (const changed of [fixture.slice(0, 1), [fixture[0], { path: 'package-lock.json', content: JSON.stringify({ ...lock, lockfileVersion: 1 }) }]]) {
    const compared = compareWithBaseline(bundle(changed), baseline);
    assert.ok(compared.diff.unverified.includes(fingerprint));
    assert.ok(!compared.diff.resolved.includes(fingerprint));
  }
  const fixed = fixture.map((item) => ({ ...item, content: item.content.replaceAll('16.4.0', '16.4.1') }));
  assert.ok(compareWithBaseline(bundle(fixed), baseline).diff.resolved.includes(fingerprint));
  const stale = compareWithBaseline(bundle(fixed, '2027-01-01T00:00:00Z'), baseline);
  assert.ok(stale.diff.unverified.includes(fingerprint));
});

test("invalid falsy CI modes cannot silently turn a requested gate into report-only", () => {
  for (const mode of [false, 0, '', null]) {
    assert.ok(validateProjectProfile({ schemaVersion: '1', project: { id: 'x' }, ci: { mode, failOn: ['severity:high'] } }).length);
  }
});
