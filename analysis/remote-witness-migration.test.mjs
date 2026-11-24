import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drill } from "../scripts/drill-remote-witness-migration.mjs";
import { migrationFixture } from "./fixtures/migration-evidence.mjs";
import { approve } from "./fixtures/governance-evidence.mjs";
import { core, g } from "./fixtures/remote-witness-evidence.mjs";

async function fixture(t) {
  const x = await migrationFixture();
  t.after(() => x.cleanup());
  return x;
}
test("approved HTTPS migration survives process death after remote append and retains partial TUF progress and signed history", async () => {
  assert.equal((await drill()).steps.length, 4);
});

test("a failed preflight leaves v2 available and retry before remote append stays frozen until published", async (t) => {
  const x = await fixture(t),
    approval = x.approve(),
    before = x.local();
  x.intercept = ({ stage, res }) => {
    if (stage !== "before") return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.apply(approval), /remote-witness-response-missing/);
  assert.equal(x.local().version, 2);
  const token = await (async () => {
    x.intercept = null;
    return x.snapshot();
  })();
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "before" || !request.next) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.apply(approval), /remote-witness-response-missing/);
  assert.equal(x.local().version, 4);
  assert.throws(() => core.read(token), /governance-migration-pending/);
  await assert.rejects(
    g.inspect(x.remoteAuthority),
    /remote-witness-checkpoint-missing/,
  );
  x.intercept = null;
  assert.equal((await x.apply()).status, "migrated-needs-refresh");
  assert.equal(x.local().domains[0].checkpoint, before.domains[0].checkpoint);
});

test("initial apply rejects missing quorum, wrong source and stale approvals before write or freeze", async (t) => {
  const x = await fixture(t),
    approval = x.approve(),
    unsigned = x.plan();
  await assert.rejects(x.apply(), /migration-approved-request-required/);
  await assert.rejects(x.apply(unsigned), /approval-threshold-not-met/);
  await assert.rejects(
    g.migrate(x.root, x.remoteAuthority, x.remoteAuthority, approval),
    /migration-authority-mismatch/,
  );
  await x.refresh(x.f.make({ version: 2 }));
  await assert.rejects(
    x.apply(approval),
    /migration-source-or-approval-changed/,
  );
  assert.equal(x.local().version, 2);
  await assert.rejects(
    g.inspect(x.remoteAuthority),
    /remote-witness-checkpoint-missing/,
  );
});
test("migration requires a quiescent v2 source and cannot replace the owner or security keys", async (t) => {
  const x = await fixture(t),
    approval = x.approve(),
    incompatible = path.join(x.config, "incompatible.json");
  const changed = JSON.parse(fs.readFileSync(x.remoteAuthority));
  changed.approvers.reverse();
  fs.writeFileSync(incompatible, JSON.stringify(changed), { mode: 0o600 });
  assert.throws(
    () => g.planMigration(x.root, x.sourceAuthority, incompatible),
    /migration-authority-mismatch/,
  );
  await x.begin();
  assert.throws(x.plan, /governance-refresh-in-progress/);
  await assert.rejects(x.apply(approval), /governance-refresh-in-progress/);
  assert.equal(x.local().version, 2);
});
test("new valid approval cannot replace a staged operation after remote commit", async (t) => {
  const x = await fixture(t),
    first = x.approve(),
    second = x.approve();
  x.intercept = x.dropAppend;
  await assert.rejects(x.apply(first), /remote-witness-response-missing/);
  x.intercept = null;
  await assert.rejects(x.apply(second), /migration-retry-approval-mismatch/);
  assert.equal(x.local().version, 4);
  await x.apply(first);
  assert.equal(
    x
      .local()
      .approval.filter((row) => row.requestId === first.request.requestId)
      .length,
    1,
  );
  assert.equal(
    x
      .local()
      .approval.filter((row) => row.requestId === second.request.requestId)
      .length,
    0,
  );
});

test("locally changed source rows are rejected after the migration fence", async (t) => {
  const x = await fixture(t),
    approval = x.approve();
  x.intercept = x.dropAppend;
  await assert.rejects(x.apply(approval), /remote-witness-response-missing/);
  x.intercept = null;
  const original = await g.inspect(x.remoteAuthority);
  const db = new DatabaseSync(path.join(x.root, "trust-store.sqlite"));
  try {
    db.exec("UPDATE organizations SET generation=generation+1");
  } finally {
    db.close();
  }
  await assert.rejects(x.apply(), /migration-source-or-approval-changed/);
  assert.deepEqual(await g.inspect(x.remoteAuthority), original);
  assert.equal(x.local().version, 4);
});

test("retries can finalize the exact persisted approval after expiry and never create another remote entry", async (t) => {
  const x = await fixture(t),
    approval = x.approve();
  x.intercept = x.dropAppend;
  await assert.rejects(x.apply(approval), /remote-witness-response-missing/);
  x.intercept = null;
  const original = await g.inspect(x.remoteAuthority);
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse(approval.request.expiresAt) + 1,
  });
  assert.equal((await x.apply()).checkpointDigest, original.checkpointDigest);
  assert.deepEqual(await g.inspect(x.remoteAuthority), original);
});

test("a second v2 source cannot overwrite an already populated remote witness", async (t) => {
  const x = await fixture(t),
    preserved = x.capture(),
    approval = x.approve();
  await x.apply(approval);
  const original = await g.inspect(x.remoteAuthority);
  x.rewind(preserved);
  await assert.rejects(
    x.apply(approval),
    /migration-remote-already-initialized/,
  );
  assert.equal(x.local().version, 2);
  assert.deepEqual(await g.inspect(x.remoteAuthority), original);
});

test("migration preserves policy revocations and removed domain tombstones", async (t) => {
  const x = await fixture(t);
  const alt = { ...x.policy.trustDomains[0], id: "secondary" };
  const revision = structuredClone(x.policy);
  revision.revision = 2;
  revision.profiles = [];
  revision.trustDomains = [alt];
  const next = await core.compilePolicy(revision);
  const approval = approve(x, g.planAdopt(x.root, x.sourceAuthority, next));
  await x.withStore((s) => core.adopt(s, next, x.a.organizationId, approval));
  const prior = x.local();
  await x.apply(x.approve());
  assert.deepEqual(x.local().policy, prior.policy);
  assert.deepEqual(
    x.local().domains.map((d) => [d.id, d.anchor, d.checkpoint]),
    prior.domains.map((d) => [d.id, d.anchor, d.checkpoint]),
  );
  assert.equal(JSON.parse(x.local().policy.policy).profiles.length, 0);
});

test("a read-only credential supplied for migration does not freeze v2", async (t) => {
  const x = await fixture(t);
  const remote = JSON.parse(fs.readFileSync(x.remoteAuthority)).remoteWitness;
  fs.copyFileSync(remote.readTokenFile, remote.writeTokenFile);
  await assert.rejects(x.apply(x.approve()), /remote-witness-response-missing/);
  assert.equal(x.local().version, 2);
  await x.snapshot();
  await assert.rejects(
    g.inspect(x.remoteAuthority),
    /remote-witness-checkpoint-missing/,
  );
});

test("a conflicting signed remote checkpoint cannot finish a staged migration", async (t) => {
  const x = await fixture(t),
    approval = x.approve();
  x.intercept = x.dropAppend;
  await assert.rejects(x.apply(approval), /remote-witness-response-missing/);
  x.intercept = x.forkResponse;
  await assert.rejects(x.apply(), /remote-witness-sequence-conflict/);
  assert.equal(x.local().version, 4);
  x.intercept = null;
  const original = await g.inspect(x.remoteAuthority);
  assert.equal((await x.apply()).checkpointDigest, original.checkpointDigest);
});

test("concurrent retries leave a single remote entry and the exact original history", async (t) => {
  const x = await fixture(t),
    approval = x.approve();
  const before = x.local();
  x.intercept = x.dropAppend;
  await assert.rejects(x.apply(approval), /remote-witness-response-missing/);
  x.intercept = null;
  const results = await Promise.allSettled([x.apply(), x.apply()]);
  assert.ok(
    results.some(
      (r) =>
        r.status === "fulfilled" && r.value.status === "migrated-needs-refresh",
    ),
  );
  const observed = await g.inspect(x.remoteAuthority);
  assert.equal(observed.sequence, 1);
  assert.deepEqual(
    x
      .local()
      .approval.filter((row) => row.requestId !== approval.request.requestId),
    before.approval,
  );
  assert.equal((await x.apply()).status, "already-migrated");
});

test("an unapproved destination is rejected before any request can send its credentials", async (t) => {
  const x = await fixture(t),
    approval = x.approve();
  const modified = JSON.parse(fs.readFileSync(x.remoteAuthority));
  modified.remoteWitness.writeTokenFile = modified.remoteWitness.readTokenFile;
  const path2 = path.join(x.config, "unapproved.json");
  fs.writeFileSync(path2, JSON.stringify(modified), { mode: 0o600 });
  let requests = 0;
  x.intercept = ({ stage }) => {
    if (stage === "before") requests++;
    return false;
  };
  await assert.rejects(
    g.migrate(x.root, x.sourceAuthority, path2, approval),
    /migration-source-or-approval-changed/,
  );
  assert.equal(requests, 0);
  assert.equal(x.local().version, 2);
});
