import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createDocument, validateDocument, setDecision, getDecision, groupFindings, mergeDocuments,
  readStoredDocument, saveStoredDocument, STORAGE_PREFIX, journalPrefix
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
  assert.ok(validateDocument({ ...document, schemaVersion: "3" }).length);
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

function memoryStorage(initial = []) {
  const values = new Map(initial);
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
}

test("independent stale tabs append decisions without overwriting another tab's writes", () => {
  const storage = memoryStorage();
  const first = fixture("src/public/first.tsx");
  const second = fixture("src/admin/second.tsx");
  const emptyA = readStoredDocument(storage, projectKey);
  const emptyB = readStoredDocument(storage, projectKey);
  const a = close(emptyA, first);
  const b = setDecision(emptyB, second, { action: "request-verification" }, now);
  saveStoredDocument(storage, a, emptyA, "tab-a-1");
  const mergedB = saveStoredDocument(storage, b, emptyB, "tab-b-1");
  assert.equal(storage.length, 2);
  assert.deepEqual(Object.keys(mergedB.decisions).sort(), [first.fingerprint, second.fingerprint].sort());
  assert.equal(getDecision(mergedB, first, now).state, "closed");
  assert.equal(getDecision(readStoredDocument(storage, projectKey), second, now).state, "verification-requested");
  assert.equal(Object.keys(JSON.parse(storage.getItem(journalPrefix(projectKey) + "tab-b-1")).decisions).length, 1);
  assert.throws(() => saveStoredDocument(storage, b, emptyB, "tab-b-1"), /already exists/);
});

test("same-fingerprint conflicts converge by review timestamp and exact-time ties keep findings visible", () => {
  const finding = fixture();
  const empty = createDocument(projectKey);
  const older = close(empty, finding);
  const newer = setDecision(empty, finding, { action: "reopen" }, "2026-10-25T13:00:00.000Z");
  for (const [a, b] of [[older, newer], [newer, older]]) {
    const merged = mergeDocuments(a, b);
    assert.equal(getDecision(merged, finding, now).statusReason, "reopened");
  }
  const requested = setDecision(empty, finding, { action: "request-verification" }, now);
  assert.deepEqual(mergeDocuments(requested, older), mergeDocuments(older, requested));
  assert.equal(getDecision(mergeDocuments(older, requested), finding, now).state, "verification-requested");
  const storage = memoryStorage();
  saveStoredDocument(storage, newer, empty, "newer");
  saveStoredDocument(storage, older, empty, "older-arrives-later");
  assert.equal(getDecision(readStoredDocument(storage, projectKey), finding, now).state, "open");
});

test("imports merge additively, preserve newer decisions and read existing v1 browser snapshots", () => {
  const finding = fixture();
  const current = setDecision(createDocument(projectKey), finding, { action: "reopen" }, "2026-10-25T13:00:00.000Z");
  const oldBackup = close(createDocument(projectKey), finding);
  assert.deepEqual(mergeDocuments(current, createDocument(projectKey)), current);
  assert.deepEqual(mergeDocuments(current, oldBackup), current);
  const storage = memoryStorage([[STORAGE_PREFIX + projectKey, JSON.stringify(current)]]);
  const next = setDecision(current, fixture("src/admin/new.tsx"), { action: "request-verification" }, now);
  saveStoredDocument(storage, next, current, "migration-update");
  assert.equal(Object.keys(readStoredDocument(storage, projectKey).decisions).length, 2);
  assert.equal(storage.getItem(STORAGE_PREFIX + projectKey), JSON.stringify(current));
  assert.throws(() => mergeDocuments(current, createDocument("another-project")), /does not match/);
});

test("failed persistence leaves caller documents available for export and rejects malformed stored journals", () => {
  const empty = createDocument(projectKey);
  const current = close(empty, fixture());
  const before = structuredClone(current);
  const denied = memoryStorage();
  denied.setItem = () => { throw new Error("quota denied"); };
  assert.throws(() => saveStoredDocument(denied, current, empty, "failed-write"), /quota denied/);
  assert.deepEqual(current, before);
  assert.equal(getDecision(current, fixture(), now).state, "closed");
  const damaged = memoryStorage([[journalPrefix(projectKey) + "broken", "{}"]]);
  assert.throws(() => readStoredDocument(damaged, projectKey));
});


test("explicit local actions supersede future-clock backups without changing real expiry validation", () => {
  const finding = fixture();
  const empty = createDocument(projectKey);
  const future = setDecision(empty, finding, { action: "close", reason: "clock skew", disposition: "accepted-risk", expires: "2028-01-01" }, "2027-01-01T00:00:00Z");
  const storage = memoryStorage();
  saveStoredDocument(storage, future, empty, "future-backup");
  const reopened = setDecision(future, finding, { action: "reopen" }, now);
  const saved = saveStoredDocument(storage, reopened, future, "explicit-reopen");
  assert.equal(getDecision(saved, finding, now).state, "open");
  const closedNow = close(saved, finding, now);
  assert.equal(getDecision(saveStoredDocument(storage, closedNow, saved, "explicit-close"), finding, now).state, "closed");
  assert.equal(closedNow.decisions[finding.fingerprint].expires, expires);
  assert.equal(closedNow.decisions[finding.fingerprint].updatedAt, now);
  const legacy = structuredClone(future);
  legacy.schemaVersion = "1";
  delete legacy.decisions[finding.fingerprint].revision;
  assert.equal(validateDocument(legacy).length, 0);
  assert.equal(mergeDocuments(legacy, reopened).schemaVersion, "2");
  assert.equal(getDecision(mergeDocuments(legacy, reopened), finding, now).state, "open");
});
