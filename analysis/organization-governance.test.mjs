import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  governanceFixture,
  approve,
  enroll,
  adopt,
  refresh,
  snapshot,
  status,
  core,
  g,
} from "./fixtures/governance-evidence.mjs";
const require = createRequire(import.meta.url),
  contract = require("./audit-contract.js"),
  { DatabaseSync } = require("node:sqlite");
async function fixture(t, ready = true) {
  const x = await governanceFixture();
  t.after(() => x.cleanup());
  if (ready) {
    enroll(x);
    adopt(x);
    refresh(x);
  }
  return x;
}
function raw(x) {
  return path.join(x.root, "trust-store.sqlite");
}
function editAuthority(x, fn) {
  const a = JSON.parse(fs.readFileSync(x.authority));
  fn(a);
  fs.writeFileSync(x.authority, JSON.stringify(a));
}
function run(args) {
  return spawnSync(
    process.execPath,
    [
      new URL("../verification/organization-governance.mjs", import.meta.url)
        .pathname,
      ...args,
    ],
    { encoding: "utf8" },
  );
}
test("two-role approval enrolls and adopts, and offline scan proves witness context", async (t) => {
  const x = await fixture(t);
  const { audit } = await contract.createAuditBundleAsync({
    records: x.k.records,
    organizationVerification: snapshot(x),
  });
  assert.equal(audit.trustContext.governance.mode, "external-witness");
  assert.equal(
    audit.securityContext.executionEvidence.subjects[0].authentication.status,
    "verified",
  );
  assert.deepEqual(contract.validateAuditResult(audit), []);
  assert.equal(status(x).governance.witnessSequence, 4);
  assert.throws(() => core.openStore(x.root), /governance-required/);
});
test("missing approvals, single role, duplicate signatures and unknown signers cannot enroll", async (t) => {
  const x = await fixture(t, false),
    request = g.planEnroll(x.root, x.authority),
    one = g.signRequest(
      x.authority,
      request,
      x.a.approvers[0].id,
      path.join(x.keys, x.a.approvers[0].id + ".pem"),
    );
  for (const b of [
    request,
    one,
    { ...one, signatures: [...one.signatures, ...one.signatures] },
    { ...one, signatures: [{ ...one.signatures[0], approverId: "unknown" }] },
  ])
    assert.throws(() => g.enroll(x.root, x.authority, b));
  assert.ok(!fs.existsSync(x.a.witnessDirectory));
});
test("same public key under two identities and missing role separation are rejected", async (t) => {
  const x = await fixture(t, false);
  editAuthority(
    x,
    (a) => (a.approvers[1].publicKey = a.approvers[0].publicKey),
  );
  assert.throws(
    () => g.planEnroll(x.root, x.authority),
    /duplicate-governance-key/,
  );
  editAuthority(x, (a) => (a.approvers[1].role = "owner"));
  assert.throws(() => g.planEnroll(x.root, x.authority));
});
test("approval signatures bind store, organization, action, authority, reviewed policy and time", async (t) => {
  const x = await fixture(t);
  const adopted = x.compiled;
  x.policy.revision = 2;
  x.compiled = await core.compilePolicy(x.policy);
  const b = approve(x, g.planAdopt(x.root, x.authority, x.compiled));
  for (const mutate of [
    (r) => (r.request.organizationId = "other"),
    (r) => (r.request.storeId = "00000000-0000-0000-0000-000000000000"),
    (r) => (r.request.action = "restore"),
    (r) => (r.request.authorityDigest = "sha256:" + "a".repeat(64)),
    (r) => (r.review.policy.profiles = []),
    (r) => (r.request.expiresAt = "2000-01-01T00:00:00.000Z"),
    (r) => (r.signatures[0].signature = "A".repeat(86) + "=="),
  ]) {
    const bad = structuredClone(b);
    mutate(bad);
    const s = g.open(x.root, x.authority);
    try {
      assert.throws(() => core.adopt(s, x.compiled, x.a.organizationId, bad));
    } finally {
      s.close();
    }
  }
  x.compiled = adopted;
  assert.equal(status(x).policyRevision, 1);
});
test("policy transitions reject unsigned mutation, stale approval and approvals for another digest", async (t) => {
  const x = await fixture(t);
  const old = approve(x, g.planAdopt(x.root, x.authority, x.compiled));
  x.policy.revision = 2;
  x.compiled = await core.compilePolicy(x.policy);
  let s = g.open(x.root, x.authority);
  try {
    assert.throws(() => core.adopt(s, x.compiled, x.a.organizationId));
    assert.throws(
      () => core.adopt(s, x.compiled, x.a.organizationId, old),
      /transition-mismatch/,
    );
  } finally {
    s.close();
  }
  adopt(x);
  x.policy.revision = 3;
  x.compiled = await core.compilePolicy(x.policy);
  s = g.open(x.root, x.authority);
  try {
    assert.throws(
      () => core.adopt(s, x.compiled, x.a.organizationId, old),
      /transition-mismatch/,
    );
  } finally {
    s.close();
  }
});
test("whole physical DB rewind is detected even with intact signatures, floors and matching old policy", async (t) => {
  const x = await fixture(t),
    past = fs.readFileSync(raw(x)),
    oldPolicy = x.compiled;
  refresh(x, x.f.make({ version: 2 }), false);
  const current = g.inspect(x.authority);
  fs.writeFileSync(raw(x), past);
  assert.throws(
    () => g.open(x.root, x.authority),
    /whole-store-rollback-or-tampering/,
  );
  x.compiled = oldPolicy;
  assert.throws(() => snapshot(x), /whole-store-rollback-or-tampering/);
  assert.deepEqual(g.inspect(x.authority), current);
});
test("rollback to a pre-enrollment database cannot bypass an explicit governance requirement", async (t) => {
  const x = await fixture(t, false),
    before = fs.readFileSync(raw(x));
  enroll(x);
  adopt(x);
  fs.writeFileSync(raw(x), before);
  assert.throws(() => g.open(x.root, x.authority), /enrollment-required/);
});
test("same generation with different logical content cannot impersonate witness state", async (t) => {
  const x = await fixture(t),
    db = new DatabaseSync(raw(x));
  db.prepare("UPDATE organizations SET policy=?").run("{}");
  db.close();
  assert.throws(
    () => g.open(x.root, x.authority),
    /whole-store-rollback-or-tampering/,
  );
});
test("fresh backup restores to a new active store, blocks old store and requires refresh", async (t) => {
  const x = await fixture(t),
    oldRoot = x.root,
    backup = path.join(x.dir, "backup.json");
  g.backup(x.root, x.authority, backup);
  const target = path.join(x.dir, "restored"),
    approval = approve(x, g.planRestore(x.authority, target, backup));
  assert.equal(
    g.restore(x.authority, target, approval, backup).status,
    "restored-needs-refresh",
  );
  assert.throws(() => g.open(oldRoot, x.authority), /active-store-mismatch/);
  x.root = target;
  assert.equal(status(x).domains[0].status, "rejected");
  assert.throws(() => snapshot(x), /refresh-not-verified/);
  refresh(x, x.f.make({ version: 2 }), false);
  assert.equal(status(x).domains[0].status, "ready");
  assert.ok(core.read(snapshot(x)).context.governance.witnessSequence > 4);
});
test("stale backup and tampered backup cannot lower independent policy or TUF knowledge", async (t) => {
  const x = await fixture(t),
    backup = path.join(x.dir, "backup.json");
  g.backup(x.root, x.authority, backup);
  refresh(x, x.f.make({ version: 2 }), false);
  assert.throws(
    () => g.planRestore(x.authority, path.join(x.dir, "restored"), backup),
    /backup-stale-or-forked/,
  );
  const b = JSON.parse(fs.readFileSync(backup));
  b.logical.domains[0].checkpoint = "{}";
  fs.writeFileSync(backup, JSON.stringify(b));
  assert.throws(
    () => g.planRestore(x.authority, path.join(x.dir, "restored"), backup),
    /backup-integrity-rejected/,
  );
});
test("lost active DB recovers from latest witness under exact approved target without witness reset", async (t) => {
  const x = await fixture(t),
    old = g.inspect(x.authority);
  refresh(x, x.f.make({ version: 2 }), false);
  fs.unlinkSync(raw(x));
  const target = path.join(x.dir, "restored"),
    b = approve(x, g.planRestore(x.authority, target));
  assert.equal(
    g.restore(x.authority, target, b).status,
    "restored-needs-refresh",
  );
  x.root = target;
  assert.equal(status(x).domains[0].versions.targets, 2);
  assert.ok(g.inspect(x.authority).sequence > old.sequence);
});
test("restore approval is invalidated by intervening refresh and never overwrites an existing target", async (t) => {
  const x = await fixture(t),
    target = path.join(x.dir, "restored"),
    b = approve(x, g.planRestore(x.authority, target));
  refresh(x, x.f.make({ version: 2 }), false);
  assert.throws(
    () => g.restore(x.authority, target, b),
    /restore-approval-state-changed|approval-restore-review-mismatch/,
  );
  const another = path.join(x.dir, "already-created");
  const fresh = approve(x, g.planRestore(x.authority, another));
  fs.mkdirSync(another, { mode: 0o700 });
  assert.throws(
    () => g.restore(x.authority, another, fresh),
    /restore-target-mismatch/,
  );
  assert.equal(status(x).domains[0].status, "ready");
});
test("backup refuses pending network leases and restoring approved witness safely invalidates the old writer", async (t) => {
  const x = await fixture(t),
    s = g.open(x.root, x.authority);
  let pending;
  try {
    pending = core.beginRefresh(
      s,
      x.compiled,
      x.a.organizationId,
      "public",
      false,
    );
  } finally {
    s.close();
  }
  assert.throws(
    () => g.backup(x.root, x.authority, path.join(x.dir, "backup.json")),
    /refresh-in-progress/,
  );
  const target = path.join(x.dir, "restored"),
    b = approve(x, g.planRestore(x.authority, target));
  g.restore(x.authority, target, b);
  assert.throws(() => g.open(x.root, x.authority), /active-store-mismatch/);
  x.root = target;
  assert.equal(status(x).domains[0].status, "rejected");
  refresh(x, x.f.make({ version: 2 }), false);
  assert.equal(status(x).domains[0].status, "ready");
});
test("witness absence, authority replacement, public permissions and nested witness directories fail closed", async (t) => {
  const x = await fixture(t);
  fs.chmodSync(x.authority, 0o644);
  assert.throws(() => g.open(x.root, x.authority), /permissions/);
  fs.chmodSync(x.authority, 0o600);
  const witness = path.join(x.a.witnessDirectory, "witness.sqlite");
  fs.renameSync(witness, witness + ".saved");
  assert.throws(() => g.open(x.root, x.authority));
  fs.renameSync(witness + ".saved", witness);
  editAuthority(x, (a) => (a.threshold = 3));
  assert.throws(() => g.open(x.root, x.authority));
});
test("WAL is rejected and a killed attached transaction leaves both main and witness unchanged", async (t) => {
  const x = await fixture(t),
    head = g.inspect(x.authority);
  const child = spawnSync(process.execPath, [
    "-e",
    `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.prepare('ATTACH DATABASE ? AS witness').run(process.argv[2]);db.exec("BEGIN IMMEDIATE;UPDATE organizations SET revision=999;UPDATE witness.head SET sequence=999;");process.kill(process.pid,'SIGKILL');`,
    raw(x),
    path.join(x.a.witnessDirectory, "witness.sqlite"),
  ]);
  assert.equal(child.signal, "SIGKILL");
  assert.deepEqual(g.inspect(x.authority), head);
  assert.equal(status(x).policyRevision, 1);
  const db = new DatabaseSync(raw(x));
  db.exec("PRAGMA journal_mode=WAL");
  db.close();
  assert.throws(() => g.open(x.root, x.authority), /rollback-journal-required/);
});
test("private approver keys are required and combining approvals for different requests is rejected", async (t) => {
  const x = await fixture(t, false),
    b = g.planEnroll(x.root, x.authority),
    owner = x.a.approvers[0];
  const wrong = path.join(x.keys, x.a.approvers[1].id + ".pem");
  assert.throws(
    () => g.signRequest(x.authority, b, owner.id, wrong),
    /key-mismatch/,
  );
  const one = g.signRequest(
      x.authority,
      b,
      owner.id,
      path.join(x.keys, owner.id + ".pem"),
    ),
    other = g.signRequest(
      x.authority,
      g.planEnroll(x.root, x.authority),
      x.a.approvers[1].id,
      wrong,
    );
  assert.throws(() => g.combine(x.authority, [one, other]), /request-mismatch/);
});
test("governed CLI enrollment, policy approval, backup and scanner selection work across processes", async (t) => {
  const x = await fixture(t, false),
    request = path.join(x.dir, "request.json"),
    approval = path.join(x.dir, "approval.json");
  assert.equal(
    run([
      "plan-enroll",
      "--store",
      x.root,
      "--authority",
      x.authority,
      "--output",
      request,
    ]).status,
    0,
  );
  g.writeJSON(approval, approve(x, core.readJSON(request)));
  let r = run([
    "enroll",
    "--store",
    x.root,
    "--authority",
    x.authority,
    "--approval",
    approval,
  ]);
  assert.equal(r.status, 0, r.stderr);
  adopt(x);
  refresh(x);
  const backup = path.join(x.dir, "backup.json");
  r = run([
    "backup",
    "--store",
    x.root,
    "--authority",
    x.authority,
    "--output",
    backup,
  ]);
  assert.equal(r.status, 0, r.stderr);
  const project = path.join(x.dir, "project");
  fs.mkdirSync(project);
  for (const rec of x.k.records) {
    const file = path.join(project, rec.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rec.content);
  }
  const policy = path.join(x.dir, "policy.json");
  fs.writeFileSync(policy, JSON.stringify(x.policy));
  const args = [
    new URL("../bin/frontend-agent-audit.mjs", import.meta.url).pathname,
    "scan",
    "--root",
    project,
    "--organization-policy",
    policy,
    "--organization",
    x.a.organizationId,
    "--trust-profile",
    "frontend-main",
    "--trust-store",
    x.root,
    "--organization-governance",
    x.authority,
    "--format",
    "json",
  ];
  r = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    JSON.parse(r.stdout).trustContext.governance.mode,
    "external-witness",
  );
  r = spawnSync(
    process.execPath,
    args.slice(0, -4).concat(["--format", "json"]),
    { encoding: "utf8" },
  );
  assert.equal(r.status, 2);
});

test("reusable recovery rehearsal covers physical rewind, stale and current backup restoration", async () => {
  const { drill } = await import("../scripts/drill-organization-recovery.mjs");
  const result = await drill();
  assert.equal(result.passed, 7);
  assert.equal(result.failed, 0);
  assert.ok(!JSON.stringify(result).includes("PRIVATE KEY"));
});
test("review text and prior policy cannot drift from the signed transition", async (t) => {
  const x = await fixture(t);
  x.policy.revision = 2;
  x.compiled = await core.compilePolicy(x.policy);
  const planned = g.planAdopt(x.root, x.authority, x.compiled);
  planned.review.previousPolicy.profiles = [];
  assert.throws(
    () => approve(x, planned),
    /scope-or-time-rejected|review-mismatch/,
  );
  const target = path.join(x.dir, "restore");
  const p = g.planRestore(x.authority, target);
  p.review.requiresRefresh = false;
  assert.throws(() => approve(x, p));
});
test("owner-only quorum is rejected even when two different keys sign", async (t) => {
  const x = await fixture(t, false),
    crypto = await import("node:crypto"),
    pair = crypto.generateKeyPairSync("ed25519"),
    second = {
      id: "second-owner",
      role: "owner",
      publicKey: pair.publicKey.export({ format: "pem", type: "spki" }),
    };
  editAuthority(x, (a) => a.approvers.push(second));
  x.a.approvers.push(second);
  fs.writeFileSync(
    path.join(x.keys, "second-owner.pem"),
    pair.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  const b = g.planEnroll(x.root, x.authority),
    signed = [x.a.approvers[0], second].map((a) =>
      g.signRequest(x.authority, b, a.id, path.join(x.keys, a.id + ".pem")),
    );
  assert.throws(() => g.combine(x.authority, signed), /threshold-not-met/);
});
test("witness and store cannot be nested and backup cannot be written into either", async (t) => {
  const x = await fixture(t, false);
  editAuthority(x, (a) => (a.witnessDirectory = path.join(x.root, "witness")));
  const b = approve(x, g.planEnroll(x.root, x.authority));
  assert.throws(() => g.enroll(x.root, x.authority, b), /must-be-independent/);
  const y = await fixture(t);
  assert.throws(
    () => g.backup(y.root, y.authority, path.join(y.root, "backup.json")),
    /must-be-independent/,
  );
  assert.throws(
    () =>
      g.backup(
        y.root,
        y.authority,
        path.join(y.a.witnessDirectory, "backup.json"),
      ),
    /must-be-independent/,
  );
});
test("missing witness is never recreated and a witness copied to a different active path is rejected", async (t) => {
  const x = await fixture(t),
    file = path.join(x.a.witnessDirectory, "witness.sqlite");
  fs.unlinkSync(file);
  assert.throws(() => g.open(x.root, x.authority));
  assert.ok(!fs.existsSync(file));
});
test("protected opaque tokens revalidate the independent head after a physical DB rollback", async (t) => {
  const x = await fixture(t),
    old = fs.readFileSync(raw(x));
  refresh(x, x.f.make({ version: 2 }), false);
  const token = snapshot(x);
  fs.writeFileSync(raw(x), old);
  await assert.rejects(
    contract.createAuditBundleAsync({
      records: x.k.records,
      organizationVerification: token,
    }),
    /whole-store-rollback-or-tampering/,
  );
});

test("a whole DB containing a previously approved policy cannot undo a later signed revocation", async (t) => {
  const x = await fixture(t),
    oldDB = fs.readFileSync(raw(x)),
    token = snapshot(x);
  x.policy.revision = 2;
  x.policy.profiles = [];
  x.compiled = await core.compilePolicy(x.policy);
  adopt(x);
  const h = g.inspect(x.authority);
  fs.writeFileSync(raw(x), oldDB);
  assert.throws(
    () => g.open(x.root, x.authority),
    /whole-store-rollback-or-tampering/,
  );
  assert.throws(() => core.read(token), /whole-store-rollback-or-tampering/);
  assert.deepEqual(g.inspect(x.authority), h);
});
test("CLI creates and signs reviewed requests, adopts only with quorum, then performs an approved restore", async (t) => {
  const x = await fixture(t, false);
  let n = 0;
  function ok(args) {
    const r = run([...args, "--authority", x.authority]);
    assert.equal(r.status, 0, r.stderr);
    return r;
  }
  function signed(request) {
    const approval = path.join(x.dir, "approval-" + ++n + ".json"),
      files = x.a.approvers.map((a) => {
        const out = path.join(x.dir, a.id + "-" + n + ".json");
        ok([
          "sign",
          "--request",
          request,
          "--approver",
          a.id,
          "--key",
          path.join(x.keys, a.id + ".pem"),
          "--output",
          out,
        ]);
        return out;
      });
    ok([
      "combine",
      "--approval",
      files[0],
      "--approval",
      files[1],
      "--output",
      approval,
    ]);
    return approval;
  }
  const initial = path.join(x.dir, "enrollment.json");
  ok(["plan-enroll", "--store", x.root, "--output", initial]);
  ok(["enroll", "--store", x.root, "--approval", signed(initial)]);
  const p = path.join(x.dir, "policy.json"),
    r = path.join(x.dir, "adopt-request.json");
  fs.writeFileSync(p, JSON.stringify(x.policy));
  ok(["plan-adopt", "--store", x.root, "--policy", p, "--output", r]);
  const approval = signed(r),
    operator = new URL(
      "../verification/organization-trust.mjs",
      import.meta.url,
    ).pathname,
    args = [
      operator,
      "adopt",
      "--store",
      x.root,
      "--organization",
      x.a.organizationId,
      "--policy",
      p,
      "--governance",
      x.authority,
    ];
  let result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 2);
  result = spawnSync(process.execPath, [...args, "--approval", approval], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  refresh(x);
  const backup = path.join(x.dir, "backup.json");
  ok(["backup", "--store", x.root, "--output", backup]);
  const target = path.join(x.dir, "restored"),
    request = path.join(x.dir, "restore-request.json");
  ok([
    "plan-restore",
    "--target",
    target,
    "--backup",
    backup,
    "--output",
    request,
  ]);
  ok([
    "restore",
    "--target",
    target,
    "--backup",
    backup,
    "--approval",
    signed(request),
  ]);
  x.root = target;
  assert.equal(status(x).domains[0].status, "rejected");
  assert.equal(status(x).domains[0].versions.targets, 1);
});

test("scanner refuses a project-controlled witness even with an external authority and main store", async (t) => {
  const x = await fixture(t, false),
    project = path.join(x.dir, "project");
  fs.mkdirSync(project, { mode: 0o700 });
  editAuthority(x, (a) => (a.witnessDirectory = path.join(project, "witness")));
  enroll(x);
  adopt(x);
  refresh(x);
  const policy = path.join(x.dir, "policy.json");
  fs.writeFileSync(policy, JSON.stringify(x.policy));
  const result = spawnSync(
    process.execPath,
    [
      new URL("../bin/frontend-agent-audit.mjs", import.meta.url).pathname,
      "scan",
      "--root",
      project,
      "--organization-policy",
      policy,
      "--organization",
      x.a.organizationId,
      "--trust-profile",
      "frontend-main",
      "--trust-store",
      x.root,
      "--organization-governance",
      x.authority,
      "--format",
      "json",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /witness must be outside scan root/);
});

test("enrollment marks format v2 so legacy v1 readers reject and schema rewind cannot hide", async (t) => {
  const x = await fixture(t),
    db = new DatabaseSync(raw(x));
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 2);
  db.exec("PRAGMA user_version=1");
  db.close();
  assert.throws(
    () => g.open(x.root, x.authority),
    /whole-store-rollback-or-tampering/,
  );
});
