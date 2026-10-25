import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createDocument, validateDocument, setDecision, getDecision, groupFindings
} = require("./triage-state.js");
const { createAuditBundle } = require("./audit-contract.js");
const now = "2026-10-25T12:00:00.000Z";
const expires = "2026-11-25";
const projectKey = "repository-a:static-lite-default-v1";

function fixture(path = "src/public/article.tsx") {
  return createAuditBundle({
    name: "triage-fixture",
    records: [{ path, content: "element.innerHTML = payload;" }],
    context: { seoScope: "internal" }
  }).audit.findings.find((finding) => finding.id === "security.html-sink-boundary");
}

function close(document, finding, at = now) {
  return setDecision(document, finding, {
    action: "close", disposition: "false-positive", reason: "Verified a safe literal in this reviewed scope", expires
  }, at);
}

test("keeps one local decision across scans without mutating scanner findings or inputs", () => {
  const finding = fixture();
  const beforeFinding = structuredClone(finding);
  const initial = createDocument(projectKey);
  Object.freeze(initial.decisions);
  Object.freeze(initial);
  const document = close(initial, finding);
  const rerun = close(document, fixture());
  assert.equal(Object.keys(rerun.decisions).length, 1);
  assert.deepEqual(initial, createDocument(projectKey));
  assert.deepEqual(finding, beforeFinding);
  assert.equal(getDecision(rerun, finding, now).state, "closed");
  assert.equal(finding.priority.effectiveDecision, beforeFinding.priority.effectiveDecision);
});

test("expires a close decision and refuses missing reasons, disposition, past or invalid dates", () => {
  const finding = fixture();
  const document = close(createDocument(projectKey), finding);
  assert.equal(getDecision(document, finding, "2026-11-24T23:59:59Z").state, "closed");
  assert.deepEqual(getDecision(document, finding, "2026-11-25T00:00:00Z").statusReason, "expired");
  for (const override of [
    { reason: "  " }, { disposition: "completed" }, { expires: "2026-10-24" },
    { expires: "2026-02-31" }, { expires: "tomorrow" }, { expires: "2026-10-25T12:00:00Z" }
  ]) {
    assert.throws(() => setDecision(createDocument(projectKey), finding, {
      action: "close", reason: "checked", disposition: "accepted-risk", expires, ...override
    }, now));
  }
});

test("resurfaces changed evidence scope, detector, impact, occurrence or controls but ignores prose and line movement", () => {
  const finding = fixture();
  const document = close(createDocument(projectKey), finding);
  const movedLine = structuredClone(finding);
  movedLine.title = "Translated report title";
  movedLine.evidence[0].line = 100;
  movedLine.diffStatus = "unchanged";
  assert.equal(getDecision(document, movedLine, now).state, "closed");
  const modifications = [
    (f) => { f.scope.paths.push("src/public/new.tsx"); },
    (f) => { f.detectorVersion = "2"; },
    (f) => { f.severity = "critical"; },
    (f) => { f.occurrenceCount += 1; },
    (f) => { f.controlState = "missing"; },
    (f) => { f.evidence.push({ kind: "path", path: "src/public/new.tsx" }); }
  ];
  for (const modify of modifications) {
    const changed = structuredClone(finding);
    modify(changed);
    const current = getDecision(document, changed, now);
    assert.equal(current.state, "open");
    assert.equal(current.statusReason, "changed");
  }
  const withDigest = { ...finding, reviewContextDigest: "sha256:first-reviewed-input" };
  const digestDecision = close(createDocument(projectKey), withDigest);
  const changedSource = { ...withDigest, reviewContextDigest: "sha256:changed-source-same-pattern" };
  assert.equal(getDecision(digestDecision, changedSource, now).statusReason, "changed");
  assert.equal(getDecision(digestDecision, finding, now).statusReason, "changed");
});

test("keeps verification requests visible and permits explicit reopening without claiming resolved", () => {
  const finding = fixture();
  const closed = close(createDocument(projectKey), finding);
  const requested = setDecision(closed, finding, { action: "request-verification" }, now);
  assert.equal(getDecision(requested, finding, now).state, "verification-requested");
  const reopened = setDecision(requested, finding, { action: "reopen" }, now);
  assert.equal(getDecision(reopened, finding, now).state, "open");
  assert.equal(getDecision(reopened, finding, now).statusReason, "reopened");
  assert.throws(() => setDecision(closed, finding, { action: "resolved" }, now));
  assert.throws(() => setDecision(closed, finding, { action: "reopen", expires }, now));
  assert.equal(getDecision(createDocument(projectKey), finding, now).statusReason, "none");
});

test("rejects cross-project, malformed, oversized and prototype-key imports", () => {
  const document = close(createDocument(projectKey), fixture());
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document)), projectKey), []);
  assert.ok(validateDocument(document, "repository-b:static-lite-default-v1").length);
  assert.ok(validateDocument({ ...document, schemaVersion: "2" }).length);
  assert.ok(validateDocument({ ...document, source: "unapproved" }).length);
  assert.ok(validateDocument({ ...document, decisions: [] }).length);
  const malformed = structuredClone(document);
  Object.values(malformed.decisions)[0].updatedAt = "not-a-date";
  assert.ok(validateDocument(malformed).length);
  const reserved = JSON.parse('{"schemaVersion":"1","projectKey":"a","decisions":{"__proto__":{}}}');
  assert.ok(validateDocument(reserved).length);
  const tooMany = createDocument(projectKey);
  const entry = Object.values(document.decisions)[0];
  for (let index = 0; index < 2001; index += 1) tooMany.decisions["detector:" + index] = entry;
  assert.ok(validateDocument(tooMany).some((error) => error.includes("too many")));
  const oversized = createDocument(projectKey);
  for (let index = 0; index < 1000; index += 1) {
    oversized.decisions["detector:" + index] = { ...entry, reason: "한".repeat(1000) };
  }
  assert.ok(validateDocument(oversized).some((error) => error.includes("size limit")));
  assert.throws(() => setDecision(createDocument(projectKey), { fingerprint: "__proto__" }, { action: "reopen" }, now));
});

test("persists only decisions and metadata hashes, excluding raw finding/source content", () => {
  const finding = fixture();
  finding.source = "raw-secret-never-persist";
  finding.evidence[0].snippet = "raw-payload-never-persist";
  const serialized = JSON.stringify(close(createDocument(projectKey), finding));
  assert.doesNotMatch(serialized, /raw-secret|raw-payload|innerHTML|payload/);
  assert.match(serialized, /metadata-v1:/);
});

test("groups related observations in one module while preserving independent admin and public groups", () => {
  const first = fixture("src/public/article.tsx");
  const related = structuredClone(first);
  related.id = "security.html-trust-boundary-unknown";
  related.fingerprint = related.id + ":src/public/article.tsx";
  const otherConsumer = fixture("src/public/card.tsx");
  const admin = fixture("src/admin/article.tsx");
  const input = [admin, otherConsumer, first, related, first];
  const groups = groupFindings(input);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.findings.includes(first)).findings.length, 3);
  assert.equal(groups.find((g) => g.findings.includes(admin)).findings.length, 1);
  assert.deepEqual(groupFindings(input.toReversed()).map((g) => g.id), groups.map((g) => g.id));
  assert.equal(input.length, 5);
  assert.equal(groups.flatMap((g) => g.findings).length, 4);
});

test("does not merge unrelated detectors by severity and supports explicit approved boundary grouping", () => {
  const first = fixture();
  const unrelated = structuredClone(first);
  unrelated.id = "other.rule";
  unrelated.clusterId = "other.cluster";
  unrelated.fingerprint = "other.rule:src/public/article.tsx";
  assert.equal(groupFindings([first, unrelated]).length, 2);
  const admin = fixture("src/admin/article.tsx");
  first.scope.boundaryIds = ["approved-editor-content"];
  admin.scope.boundaryIds = ["approved-editor-content"];
  assert.equal(groupFindings([first, admin]).length, 1);
});

test("exports the same API as an isolated browser script without Node dependencies", () => {
  const context = vm.createContext({});
  const source = fs.readFileSync(new URL("./triage-state.js", import.meta.url), "utf8");
  vm.runInContext(source, context);
  assert.equal(typeof context.FrontendTriage.setDecision, "function");
  assert.equal(vm.runInContext('FrontendTriage.createDocument("browser").projectKey', context), "browser");
});
