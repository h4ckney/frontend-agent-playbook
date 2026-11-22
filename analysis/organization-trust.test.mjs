import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { tufFixture } from "./fixtures/tuf-evidence.mjs";
import { keylessFixture } from "./fixtures/keyless-evidence.mjs";
const require = createRequire(import.meta.url),
  org = require("../verification/organization-trust.cjs"),
  tuf = require("../verification/sigstore-tuf.cjs"),
  contract = require("./audit-contract.js");
const run = (args) =>
  spawnSync(
    process.execPath,
    [
      new URL("../verification/organization-trust.mjs", import.meta.url)
        .pathname,
      ...args,
    ],
    { encoding: "utf8" },
  );
function policy(k, f, organizationId = "example-platform") {
  const trustPolicy = structuredClone(k.policy);
  delete trustPolicy.keyless[0].trustedRootDigest;
  trustPolicy.keyless[0].tufBootstrapRootDigest = f.pin;
  return {
    schemaVersion: "1",
    organizationId,
    revision: 1,
    trustDomains: [
      { id: "public", bootstrapRootDigest: f.pin, maxRefreshAgeSeconds: 3600 },
    ],
    profiles: [
      {
        id: "frontend-main",
        trustDomain: "public",
        repository: trustPolicy.keyless[0].repository,
        trustPolicy,
      },
    ],
  };
}
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-org-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const k = await keylessFixture(),
    f = tufFixture(k.root),
    p = policy(k, f),
    compiled = await org.compilePolicy(p),
    root = path.join(dir, "store"),
    store = org.openStore(root, true);
  t.after(() => store.close());
  org.adopt(store, compiled, p.organizationId);
  return { dir, k, f, p, compiled, root, store };
}
function refresh(x, repository = x.f.make(), initialize = true) {
  const pending = org.beginRefresh(
      x.store,
      x.compiled,
      x.p.organizationId,
      "public",
      initialize,
    ),
    verified = tuf.verifyRepository(
      repository,
      x.f.pin,
      Date.now(),
      pending.floor,
    ),
    previous = pending.previous || { floor: pending.floor, repository };
  const state = {
    schemaVersion: "1",
    bootstrapRootDigest: x.f.pin,
    ...tuf.applyProgress(previous, repository, verified),
    lastAttempt: {
      status: verified.status,
      reason: verified.reason,
      checkedAt: new Date().toISOString(),
    },
  };
  return org.finishRefresh(
    x.store,
    x.compiled,
    x.p.organizationId,
    "public",
    pending.lease,
    state,
  );
}
const snapshot = (x) =>
  org.snapshot(x.store, x.compiled, x.p.organizationId, "frontend-main");
test("adopted organization profile authenticates controlled keyless evidence and exposes bounded context", async (t) => {
  const x = await fixture(t);
  assert.equal(refresh(x).status, "verified");
  const token = snapshot(x),
    { audit } = await contract.createAuditBundleAsync({
      records: x.k.records,
      organizationVerification: token,
    });
  assert.equal(
    audit.securityContext.executionEvidence.subjects[0].authentication.status,
    "verified",
  );
  assert.equal(audit.trustContext.organizationId, x.p.organizationId);
  assert.equal(audit.trustContext.policyRevision, 1);
  assert.deepEqual(contract.validateAuditResult(audit), []);
  assert.match(
    contract.buildAuditMarkdown(audit),
    /Organization trust: example-platform/,
  );
  assert.ok(!JSON.stringify(audit.trustContext).includes(x.root));
});
test("policy revisions reject rollback and same-revision changes; profile removal revokes old tokens", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const token = snapshot(x);
  assert.equal(
    org.adopt(x.store, x.compiled, x.p.organizationId).status,
    "unchanged",
  );
  const changed = structuredClone(x.p);
  changed.trustDomains[0].maxRefreshAgeSeconds = 20;
  await assert.rejects(
    async () =>
      org.adopt(x.store, await org.compilePolicy(changed), x.p.organizationId),
    /policy-rollback/,
  );
  changed.revision = 2;
  changed.profiles[0].id = "replacement";
  const next = await org.compilePolicy(changed);
  org.adopt(x.store, next, x.p.organizationId);
  assert.throws(() => org.read(token), /state-changed/);
  assert.throws(() => snapshot(x), /not-adopted/);
  assert.throws(
    () => org.snapshot(x.store, next, x.p.organizationId, "frontend-main"),
    /unknown-trust-profile/,
  );
  assert.throws(
    () => org.adopt(x.store, x.compiled, x.p.organizationId),
    /policy-rollback/,
  );
});
test("organizations remain isolated and selection is explicit", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const second = await org.compilePolicy(policy(x.k, x.f, "other-team"));
  org.adopt(x.store, second, "other-team");
  assert.throws(
    () => org.snapshot(x.store, second, "other-team", "frontend-main"),
    /not-initialized/,
  );
  assert.throws(
    () => org.snapshot(x.store, x.compiled, "other-team", "frontend-main"),
    /selection-mismatch/,
  );
  assert.throws(
    () => org.snapshot(x.store, x.compiled, x.p.organizationId, "missing"),
    /unknown-trust-profile/,
  );
  assert.equal(
    org.read(snapshot(x)).context.organizationId,
    "example-platform",
  );
});
test("policy rejects malformed, ambiguous or cross-repository rules atomically", async (t) => {
  const x = await fixture(t);
  for (const mutate of [
    (p) => (p.profiles[0].repository += "wrong"),
    (p) =>
      (p.profiles[0].trustPolicy.keyless[0].tufBootstrapRootDigest =
        "sha256:" + "a".repeat(64)),
    (p) => (p.profiles[0].trustPolicy.keyless[0].unknown = true),
    (p) => p.profiles.push(p.profiles[0]),
    (p) => (p.trustDomains[0].mirror = "http://localhost"),
    (p) => (p.trustDomains[0].mirror = "https://user:pass@example.com"),
    (p) => (p.extra = true),
    (p) => (p.trustDomains[0].maxRefreshAgeSeconds = 0),
  ]) {
    const p = structuredClone(x.p);
    mutate(p);
    await assert.rejects(org.compilePolicy(p));
  }
});
test("stored checkpoint defeats state-only rollback and rejected refresh never uses cached success", async (t) => {
  const x = await fixture(t),
    oldRepo = x.f.make();
  refresh(x, oldRepo);
  const old = x.store.db.prepare("SELECT state FROM domains").get().state;
  refresh(x, x.f.make({ version: 2 }), false);
  x.store.db.prepare("UPDATE domains SET state=?").run(old);
  assert.throws(() => snapshot(x), /checkpoint-rejected/);
  assert.equal(
    org.status(x.store, x.compiled, x.p.organizationId).domains[0].status,
    "rejected",
  );
  assert.equal(refresh(x, oldRepo, false).status, "rejected");
  assert.equal(
    JSON.parse(
      x.store.db.prepare("SELECT checkpoint FROM domains").get().checkpoint,
    ).versions.targets,
    2,
  );
  assert.throws(() => snapshot(x));
  assert.equal(refresh(x, x.f.make({ version: 3 }), false).status, "verified");
});
test("verified partial metadata advances persistent floors after target failure", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const bad = x.f.make({ version: 2 });
  bad.target = "tampered";
  assert.equal(refresh(x, bad, false).status, "rejected");
  assert.equal(
    JSON.parse(
      x.store.db.prepare("SELECT checkpoint FROM domains").get().checkpoint,
    ).versions.targets,
    2,
  );
  assert.equal(refresh(x, x.f.make(), false).status, "rejected");
  assert.equal(refresh(x, x.f.make({ version: 3 }), false).status, "verified");
});
test("refresh lease invalidates snapshots and blocks adoption and concurrent refresh", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const token = snapshot(x);
  org.beginRefresh(x.store, x.compiled, x.p.organizationId, "public", false);
  assert.throws(() => snapshot(x), /in-progress/);
  assert.throws(() => org.read(token), /state-changed/);
  assert.throws(
    () =>
      org.beginRefresh(
        x.store,
        x.compiled,
        x.p.organizationId,
        "public",
        false,
      ),
    /in-progress/,
  );
  assert.throws(
    () => org.adopt(x.store, x.compiled, x.p.organizationId),
    /in-progress/,
  );
  assert.throws(
    () => org.recover(x.store, x.compiled, x.p.organizationId, "public"),
    /still-running/,
  );
});
test("dead process lease requires explicit recovery and another successful refresh", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(child.status, 0);
  const lease = {
    id: "dead",
    pid: child.pid,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
  };
  x.store.db.prepare("UPDATE domains SET lease=?").run(JSON.stringify(lease));
  assert.equal(
    org.recover(x.store, x.compiled, x.p.organizationId, "public").status,
    "recovered-needs-refresh",
  );
  assert.throws(() => snapshot(x), /refresh-not-verified/);
  assert.equal(refresh(x, x.f.make({ version: 2 }), false).status, "verified");
});
test("foreign host lease cannot be guessed away", async (t) => {
  const x = await fixture(t);
  refresh(x);
  x.store.db
    .prepare("UPDATE domains SET lease=?")
    .run(JSON.stringify({ pid: 99999999, host: "other-machine" }));
  assert.throws(
    () => org.recover(x.store, x.compiled, x.p.organizationId, "public"),
    /owner-unverifiable/,
  );
});
test("stale/future/expired trust and expired or backwards-clock tokens fail closed", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const token = snapshot(x),
    date = Date.now(),
    row = x.store.db.prepare("SELECT state FROM domains").get(),
    s = JSON.parse(row.state);
  for (const checkedAt of [
    new Date(date - 3600001).toISOString(),
    new Date(date + 60000).toISOString(),
    "invalid",
  ]) {
    s.lastAttempt.checkedAt = checkedAt;
    x.store.db.prepare("UPDATE domains SET state=?").run(JSON.stringify(s));
    assert.throws(() => snapshot(x), /refresh-stale/);
    assert.equal(
      org.status(x.store, x.compiled, x.p.organizationId).domains[0].status,
      "stale",
    );
  }
  x.store.db.prepare("UPDATE domains SET state=?").run(row.state);
  t.mock.timers.enable({ apis: ["Date"], now: date + 300001 });
  assert.throws(() => org.read(token), /token-invalid/);
  t.mock.timers.setTime(date - 60000);
  assert.throws(() => org.read(token), /token-invalid/);
});
test("opaque token forgery, mixed trust modes and historical verification cannot mint org authority", async (t) => {
  const x = await fixture(t);
  refresh(x);
  await assert.rejects(
    contract.createAuditBundleAsync({
      organizationVerification: {},
      records: x.k.records,
    }),
    /token-invalid/,
  );
  for (const extra of [
    { trustPolicy: x.k.policy },
    { sigstoreTufState: {} },
    { sigstoreTrustedRoot: {} },
    { generatedAt: "2020-01-01T00:00:00Z" },
  ])
    await assert.rejects(
      contract.createAuditBundleAsync({
        organizationVerification: snapshot(x),
        records: x.k.records,
        ...extra,
      }),
      /selection-invalid/,
    );
});
test("adoption during asynchronous verification rejects the scan rather than returning old authority", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const p = structuredClone(x.p);
  p.revision = 2;
  p.profiles[0].id = "revoked";
  const next = await org.compilePolicy(p);
  const pending = contract.createAuditBundleAsync({
    records: x.k.records,
    organizationVerification: snapshot(x),
  });
  org.adopt(x.store, next, x.p.organizationId);
  await assert.rejects(pending, /state-changed/);
});
test("domain identifiers retain anchors after removal and minimum floor cannot decrease", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const p = structuredClone(x.p);
  p.revision = 2;
  p.trustDomains[0].minimumFloor = tuf.verifyRepository(
    x.f.make(),
    x.f.pin,
  ).checkpoint;
  org.adopt(x.store, await org.compilePolicy(p), x.p.organizationId);
  p.revision = 3;
  delete p.trustDomains[0].minimumFloor;
  const rollback = await org.compilePolicy(p);
  assert.throws(
    () => org.adopt(x.store, rollback, x.p.organizationId),
    /floor-rollback/,
  );
  const other = tufFixture(x.k.root),
    moved = policy(x.k, other);
  moved.revision = 3;
  await assert.rejects(
    async () =>
      org.adopt(x.store, await org.compilePolicy(moved), x.p.organizationId),
    /anchor-reassignment/,
  );
});
test("private store rejects missing, public, symlink and hardlink files without implicit reset", async (t) => {
  const x = await fixture(t);
  assert.throws(() => org.openStore(path.join(x.dir, "missing")));
  assert.throws(() => org.openStore(x.root, true), /already-exists/);
  fs.chmodSync(x.root, 0o755);
  assert.throws(() => org.openStore(x.root), /directory-permissions/);
  fs.chmodSync(x.root, 0o700);
  fs.chmodSync(path.join(x.root, "trust-store.sqlite"), 0o644);
  assert.throws(() => org.openStore(x.root), /file-permissions/);
  fs.chmodSync(path.join(x.root, "trust-store.sqlite"), 0o600);
  fs.symlinkSync(x.root, path.join(x.dir, "linked"));
  assert.throws(
    () => org.openStore(path.join(x.dir, "linked")),
    /directory-permissions/,
  );
  fs.linkSync(
    path.join(x.root, "trust-store.sqlite"),
    path.join(x.dir, "db-link"),
  );
  assert.throws(() => org.openStore(x.root), /file-permissions/);
});
test("separate CLI processes preserve adoption, high water and interrupted transaction rollback", async (t) => {
  const x = await fixture(t),
    policyFile = path.join(x.dir, "policy.json"),
    repoFile = path.join(x.dir, "repo.json"),
    boot = path.join(x.dir, "root.json");
  fs.writeFileSync(policyFile, JSON.stringify(x.p));
  const first = x.f.make();
  fs.writeFileSync(repoFile, JSON.stringify(first));
  fs.writeFileSync(boot, first.bootstrapRoot);
  const args = [
    "--store",
    x.root,
    "--organization",
    x.p.organizationId,
    "--policy",
    policyFile,
  ];
  let r = run([
    "refresh",
    ...args,
    "--trust-domain",
    "public",
    "--repository",
    repoFile,
    "--initialize",
    "--bootstrap",
    boot,
  ]);
  assert.equal(r.status, 0, r.stderr);
  r = run(["status", ...args]);
  assert.equal(JSON.parse(r.stdout).domains[0].status, "ready");
  fs.writeFileSync(repoFile, JSON.stringify(x.f.make({ version: 2 })));
  assert.equal(
    run([
      "refresh",
      ...args,
      "--trust-domain",
      "public",
      "--repository",
      repoFile,
    ]).status,
    0,
  );
  fs.writeFileSync(repoFile, JSON.stringify(first));
  assert.equal(
    run([
      "refresh",
      ...args,
      "--trust-domain",
      "public",
      "--repository",
      repoFile,
    ]).status,
    2,
  );
  assert.equal(
    JSON.parse(run(["status", ...args]).stdout).domains[0].versions.targets,
    2,
  );
  const child = spawnSync(process.execPath, [
    "-e",
    `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec("BEGIN IMMEDIATE; UPDATE organizations SET revision=999;");process.kill(process.pid,'SIGKILL');`,
    path.join(x.root, "trust-store.sqlite"),
  ]);
  assert.equal(child.signal, "SIGKILL");
  assert.equal(run(["status", ...args]).status, 0);
  assert.equal(JSON.parse(run(["status", ...args]).stdout).policyRevision, 1);
});
test("CLI scan selects only adopted organization policy, preserves auth, and rejects mixed or inside-project stores", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const project = path.join(x.dir, "project");
  fs.mkdirSync(project);
  for (const r of x.k.records) {
    const file = path.join(project, r.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.content);
  }
  const p = path.join(x.dir, "policy.json");
  fs.writeFileSync(p, JSON.stringify(x.p));
  const args = [
    new URL("../bin/frontend-agent-audit.mjs", import.meta.url).pathname,
    "scan",
    "--root",
    project,
    "--organization-policy",
    p,
    "--organization",
    x.p.organizationId,
    "--trust-profile",
    "frontend-main",
    "--trust-store",
    x.root,
    "--format",
    "json",
  ];
  let r = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const audit = JSON.parse(r.stdout);
  assert.equal(audit.trustContext.organizationId, x.p.organizationId);
  assert.deepEqual(contract.validateAuditResult(audit), []);
  assert.equal(
    audit.securityContext.executionEvidence.subjects[0].authentication.status,
    "verified",
  );
  r = spawnSync(process.execPath, [...args, "--trust-policy", p], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  r = spawnSync(process.execPath, [...args, "--root", x.dir], {
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /outside scan root/);
});
test("a successful refresh changes evidence context without churning baseline policy scope", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const before = await contract.createAuditBundleAsync({
    records: x.k.records,
    organizationVerification: snapshot(x),
  });
  refresh(x, x.f.make({ version: 2 }), false);
  const after = await contract.createAuditBundleAsync({
    records: x.k.records,
    organizationVerification: snapshot(x),
  });
  assert.equal(before.audit.scopePolicyDigest, after.audit.scopePolicyDigest);
  assert.notEqual(
    before.audit.trustContext.storeGeneration,
    after.audit.trustContext.storeGeneration,
  );
});

test("empty profiles revoke every profile without erasing domain history", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const token = snapshot(x),
    p = structuredClone(x.p);
  p.revision = 2;
  p.profiles = [];
  const next = await org.compilePolicy(p);
  org.adopt(x.store, next, x.p.organizationId);
  assert.throws(() => org.read(token), /state-changed/);
  assert.throws(
    () => org.snapshot(x.store, next, x.p.organizationId, "frontend-main"),
    /unknown-trust-profile/,
  );
  assert.equal(
    org.status(x.store, next, x.p.organizationId).domains[0].versions.targets,
    1,
  );
});
test("removed domain tombstone prevents reusing its name for another trust anchor", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const p = structuredClone(x.p);
  p.revision = 2;
  p.trustDomains[0].id = "replacement";
  p.profiles[0].trustDomain = "replacement";
  org.adopt(x.store, await org.compilePolicy(p), x.p.organizationId);
  const other = tufFixture(x.k.root),
    next = policy(x.k, other);
  next.revision = 3;
  const compiled = await org.compilePolicy(next);
  assert.throws(
    () => org.adopt(x.store, compiled, x.p.organizationId),
    /anchor-reassignment/,
  );
  assert.equal(
    x.store.db
      .prepare("SELECT count(*) AS n FROM domains WHERE org=?")
      .get(x.p.organizationId).n,
    2,
  );
});
test("unrelated profile revisions do not churn the selected profile baseline scope", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const before = org.read(snapshot(x)).scopeDigest,
    p = structuredClone(x.p);
  p.revision = 2;
  p.profiles.push({ ...structuredClone(p.profiles[0]), id: "other-product" });
  x.compiled = await org.compilePolicy(p);
  org.adopt(x.store, x.compiled, x.p.organizationId);
  assert.equal(org.read(snapshot(x)).scopeDigest, before);
  p.revision = 3;
  p.trustDomains[0].maxRefreshAgeSeconds = 1800;
  x.compiled = await org.compilePolicy(p);
  org.adopt(x.store, x.compiled, x.p.organizationId);
  assert.notEqual(org.read(snapshot(x)).scopeDigest, before);
});
test("CLI init/adopt reject duplicates, unknown selectors, invalid anchor and reinitialization", async (t) => {
  const x = await fixture(t),
    root = path.join(x.dir, "other-store"),
    p = path.join(x.dir, "policy.json");
  fs.writeFileSync(p, JSON.stringify(x.p));
  assert.equal(run(["init", "--store", root]).status, 0);
  assert.equal(run(["init", "--store", root]).status, 2);
  const args = [
    "--store",
    root,
    "--organization",
    x.p.organizationId,
    "--policy",
    p,
  ];
  assert.equal(run(["adopt", ...args]).status, 0);
  assert.equal(run(["adopt", ...args, "--policy", p]).status, 2);
  assert.equal(run(["adopt", ...args, "--unexpected", "value"]).status, 2);
  assert.equal(run(["status", ...args, "--organization", "other"]).status, 2);
  const boot = path.join(x.dir, "bad-root");
  fs.writeFileSync(boot, "invalid");
  assert.equal(
    run([
      "refresh",
      ...args,
      "--trust-domain",
      "public",
      "--initialize",
      "--bootstrap",
      boot,
      "--repository",
      p,
    ]).status,
    2,
  );
  assert.equal(
    JSON.parse(run(["status", ...args]).stdout).domains[0].status,
    "not-initialized",
  );
});
test("crashed first refresh can recover without inventing initialized state", async (t) => {
  const x = await fixture(t);
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  x.store.db
    .prepare("UPDATE domains SET lease=?")
    .run(JSON.stringify({ host: os.hostname(), pid: child.pid }));
  org.recover(x.store, x.compiled, x.p.organizationId, "public");
  assert.throws(() => snapshot(x), /not-initialized/);
  assert.equal(refresh(x).status, "verified");
});

test("compiled policy descriptions and plain objects cannot mutate or forge organization authority", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const original = org.read(snapshot(x));
  x.compiled.profiles.get("frontend-main").trustPolicy.keyless[0].repository =
    "git+https://github.com/evil/repo@refs/heads/main";
  x.compiled.policy.profiles = [];
  assert.deepEqual(org.read(snapshot(x)).trustPolicy, original.trustPolicy);
  assert.throws(
    () =>
      org.snapshot(
        x.store,
        { ...x.compiled },
        x.p.organizationId,
        "frontend-main",
      ),
    /policy-token-invalid/,
  );
});
test("actual metadata expiry invalidates organization tokens before refresh age elapses", async (t) => {
  const x = await fixture(t),
    expiry = Date.now() + 30000;
  refresh(
    x,
    x.f.make({ expiry: { timestamp: new Date(expiry).toISOString() } }),
  );
  const token = snapshot(x);
  t.mock.timers.enable({ apis: ["Date"], now: expiry });
  assert.throws(() => org.read(token), /token-invalid/);
  assert.throws(() => snapshot(x));
  assert.equal(
    org.status(x.store, x.compiled, x.p.organizationId).domains[0].status,
    "rejected",
  );
});
test("first network failure persists a blocked state and later offline refresh recovers without reset", async (t) => {
  const x = await fixture(t),
    p = structuredClone(x.p);
  p.trustDomains[0].mirror = "https://approved.example";
  p.revision = 2;
  x.compiled = await org.compilePolicy(p);
  org.adopt(x.store, x.compiled, p.organizationId);
  const policyFile = path.join(x.dir, "policy.json"),
    boot = path.join(x.dir, "root.json"),
    repo = path.join(x.dir, "repo.json");
  fs.writeFileSync(policyFile, JSON.stringify(p));
  fs.writeFileSync(boot, x.f.make().bootstrapRoot);
  const cli = new URL("../verification/organization-trust.mjs", import.meta.url)
      .pathname,
    args = [
      "--store",
      x.root,
      "--organization",
      p.organizationId,
      "--policy",
      policyFile,
      "--trust-domain",
      "public",
    ];
  const code = `process.argv=[process.execPath,${JSON.stringify(cli)},'refresh',...${JSON.stringify([...args, "--initialize", "--bootstrap", boot])}];globalThis.fetch=async()=>({status:404});import(${JSON.stringify("file://" + cli)});`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 2, child.stderr);
  assert.equal(
    org.status(x.store, x.compiled, p.organizationId).domains[0].status,
    "rejected",
  );
  assert.throws(() => snapshot(x));
  fs.writeFileSync(repo, JSON.stringify(x.f.make()));
  assert.equal(run(["refresh", ...args, "--repository", repo]).status, 0);
  assert.equal(
    org.status(x.store, x.compiled, p.organizationId).domains[0].status,
    "ready",
  );
});

test("refresh age is expired at the exact boundary and malformed explicit floors are rejected", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const s = JSON.parse(
    x.store.db.prepare("SELECT state FROM domains").get().state,
  );
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse(s.lastAttempt.checkedAt) + 3600000,
  });
  assert.throws(() => snapshot(x), /refresh-stale/);
  assert.equal(
    org.status(x.store, x.compiled, x.p.organizationId).domains[0].status,
    "stale",
  );
  const p = structuredClone(x.p);
  p.trustDomains[0].minimumFloor = null;
  await assert.rejects(org.compilePolicy(p), /invalid-trust-floor/);
});

test("selected local repository read or parse failure blocks the previous successful state", async (t) => {
  const x = await fixture(t);
  refresh(x);
  const p = path.join(x.dir, "policy.json"),
    repo = path.join(x.dir, "selected.json");
  fs.writeFileSync(p, JSON.stringify(x.p));
  const args = [
    "refresh",
    "--store",
    x.root,
    "--organization",
    x.p.organizationId,
    "--policy",
    p,
    "--trust-domain",
    "public",
    "--repository",
    repo,
  ];
  for (const content of [null, "{invalid"]) {
    if (content !== null) fs.writeFileSync(repo, content);
    const r = run(args);
    assert.equal(r.status, 2);
    assert.equal(
      org.status(x.store, x.compiled, x.p.organizationId).domains[0].status,
      "rejected",
    );
    assert.throws(() => snapshot(x));
    assert.equal(
      refresh(x, x.f.make({ version: 2 }), false).status,
      "verified",
    );
  }
  assert.equal(
    JSON.parse(
      x.store.db.prepare("SELECT checkpoint FROM domains").get().checkpoint,
    ).versions.targets,
    2,
  );
});
