import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { remoteFixture, core, g } from "./fixtures/remote-witness-evidence.mjs";
import { drill } from "../scripts/drill-remote-witness.mjs";

const require = createRequire(import.meta.url);
const contract = require("./audit-contract.js");

async function fixture(t) {
  const x = await remoteFixture();
  t.after(() => x.cleanup());
  await x.initialize();
  return x;
}

test("HTTPS recovery drill blocks full local rollback, missing responses and signed forks, and retains partial TUF progress", async () => {
  assert.equal((await drill()).steps.length, 6);
});

test("remote organization reports are bound to a fresh response and a replayed signed reply fails", async (t) => {
  const x = await fixture(t);
  const token = await x.snapshot();
  const { audit } = await contract.createAuditBundleAsync({
    records: x.k.records,
    organizationVerification: token,
  });
  assert.deepEqual(contract.validateAuditResult(audit), []);
  assert.equal(audit.trustContext.governance.mode, "remote-witness");
  assert.equal(
    audit.securityContext.executionEvidence.subjects[0].authentication.status,
    "verified",
  );
  x.intercept = ({ stage, res, lastResponse }) => {
    if (stage !== "before") return false;
    res.writeHead(200).end(lastResponse);
    return true;
  };
  await assert.rejects(core.read(token), /remote-witness-response-invalid/);
});

test("a write blocked before remote append leaves the prior remote floor and no local-only success", async (t) => {
  const x = await fixture(t);
  const pending = await x.begin();
  const before = await x.inspect();
  x.intercept = ({ request, stage, res }) => {
    if (stage !== "before" || !request.next) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(
    x.finish(pending, x.f.make({ version: 2 })),
    /remote-witness-response-missing/,
  );
  x.intercept = null;
  assert.deepEqual(await x.inspect(), before);
  await assert.rejects(x.snapshot(), /trust-refresh-in-progress/);
  assert.equal(
    (await x.finish(pending, x.f.make({ version: 2 }))).status,
    "verified",
  );
  assert.equal((await x.status()).domains[0].versions.targets, 2);
});

test("reconcile retains exact remote lease when a begin-refresh acknowledgment is missing", async (t) => {
  const x = await fixture(t);
  x.intercept = x.dropAppend;
  await assert.rejects(x.begin(), /remote-witness-response-missing/);
  x.intercept = null;
  await assert.rejects(x.snapshot(), /remote-witness-local-behind/);
  assert.equal((await x.reconcile()).status, "reconciled");
  assert.equal((await x.status()).domains[0].status, "refreshing");
  assert.equal((await x.reconcile()).status, "already-synchronized");
});

test("a deliberately empty remote response cannot authorize use of the locally valid head", async (t) => {
  const x = await fixture(t);
  x.intercept = ({ stage, res }) => {
    if (stage !== "before") return false;
    res.writeHead(200).end();
    return true;
  };
  await assert.rejects(x.snapshot(), /remote-witness-response-missing/);
});

test("read-only authority transport works without the write-token file and cannot publish", async (t) => {
  const x = await fixture(t);
  fs.unlinkSync(x.a.remoteWitness.writeTokenFile);
  await x.snapshot();
  const before = await x.inspect();
  await assert.rejects(x.begin());
  assert.deepEqual(await x.inspect(), before);
  assert.equal((await x.status()).domains[0].versions.targets, 1);
});

test("approved new-root recovery works when both local databases have been lost", async (t) => {
  const x = await fixture(t);
  await x.refresh(x.f.make({ version: 2 }));
  for (const [file] of x.capture()) fs.unlinkSync(file);
  const target = path.join(x.dir, "restored");
  assert.equal((await x.restore(target)).status, "restored-needs-refresh");
  x.root = target;
  assert.equal((await x.status()).domains[0].versions.targets, 2);
  await assert.rejects(x.snapshot(), /refresh-not-verified/);
});

test("stale approval or forked remote checkpoint cannot write an approved restore", async (t) => {
  const x = await fixture(t);
  const target = path.join(x.dir, "restore");
  const planned = await g.planRestore(x.authority, target);
  const { approve } = await import("./fixtures/governance-evidence.mjs");
  const approval = approve(x, planned);
  await x.refresh(x.f.make({ version: 2 }));
  await assert.rejects(
    g.restore(x.authority, target, approval),
    /restore-approval-state-changed/,
  );
  assert.ok(!fs.existsSync(target));
});

test("witness service refuses competing successors and refuses a successor that lowers TUF floors", async (t) => {
  const x = await fixture(t);
  await x.refresh(x.f.make({ version: 2 }));
  const p = require("../verification/remote-witness.cjs");
  const { createHash } = await import("node:crypto");
  const digest = (value) =>
    "sha256:" +
    createHash("sha256").update(core.canonical(value)).digest("hex");
  const c = { a: x.a, digest: g.authorityInfo(x.authority).authorityDigest };
  const head = await p.call(c, (p) => p);
  function seal(h, state) {
    const { logical, checkpointDigest, ...header } = h;
    header.stateDigest = digest(state);
    return {
      ...header,
      checkpointDigest: digest(header),
      logical: JSON.stringify(state),
    };
  }
  const state = JSON.parse(head.logical);
  const fork = seal({ ...head, activeRoot: head.activeRoot + "-fork" }, state);
  await assert.rejects(
    p.call(c, (p) => p, fork),
    /remote-witness-conflict/,
  );
  const previous = x.f.make();
  state.domains[0].checkpoint = JSON.stringify(
    require("../verification/sigstore-tuf.cjs").verifyRepository(
      previous,
      x.f.pin,
      Date.now(),
    ).checkpoint,
  );
  const lower = seal(
    {
      ...head,
      sequence: head.sequence + 1,
      previousCheckpoint: head.checkpointDigest,
    },
    state,
  );
  await assert.rejects(
    p.call(c, (p) => p, lower),
    /remote-witness-conflict/,
  );
  assert.equal(
    (await p.call(c, (p) => p)).checkpointDigest,
    head.checkpointDigest,
  );
});

test("normal scanner and refresh CLI use the HTTPS witness and produce no report after a missing response", async (t) => {
  const x = await fixture(t);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { fileURLToPath } = await import("node:url");
  const run = (file, args) =>
    promisify(execFile)(process.execPath, [
      fileURLToPath(new URL(file, import.meta.url)),
      ...args,
    ]);
  const project = path.join(x.dir, "project");
  fs.mkdirSync(project);
  for (const r of x.k.records) {
    const file = path.join(project, r.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, r.content);
  }
  const policy = path.join(x.dir, "policy.json"),
    repository = path.join(x.dir, "repository.json");
  fs.writeFileSync(policy, JSON.stringify(x.policy));
  fs.writeFileSync(repository, JSON.stringify(x.f.make({ version: 2 })));
  const operation = await run("../verification/organization-trust.mjs", [
    "refresh",
    "--store",
    x.root,
    "--organization",
    x.a.organizationId,
    "--policy",
    policy,
    "--trust-domain",
    "public",
    "--repository",
    repository,
    "--governance",
    x.authority,
  ]);
  assert.equal(JSON.parse(operation.stdout).status, "verified");
  const auditArgs = [
    "scan",
    "--root",
    project,
    "--trust-store",
    x.root,
    "--organization",
    x.a.organizationId,
    "--organization-policy",
    policy,
    "--trust-profile",
    "frontend-main",
    "--organization-governance",
    x.authority,
    "--format",
    "json",
  ];
  const scan = await run("../bin/frontend-agent-audit.mjs", auditArgs);
  assert.equal(
    JSON.parse(scan.stdout).trustContext.governance.mode,
    "remote-witness",
  );
  x.intercept = ({ stage, res }) => {
    if (stage !== "before") return false;
    res.destroy();
    return true;
  };
  await assert.rejects(
    run("../bin/frontend-agent-audit.mjs", auditArgs),
    (e) =>
      e.code === 2 &&
      e.stdout === "" &&
      /remote-witness-response-missing/.test(e.stderr),
  );
});

test("ordinary policy adoption requires the approved policy, the old policy and a fresh quorum at the witness", async (t) => {
  const x = await fixture(t);
  const { approve } = await import("./fixtures/governance-evidence.mjs");
  const compiled = await core.compilePolicy({ ...x.policy, revision: 2 });
  const approved = approve(x, await g.planAdopt(x.root, x.authority, compiled));
  let candidate;
  x.intercept = ({ request, stage, res }) => {
    if (stage !== "before" || !request.next) return false;
    candidate = request.next;
    res.destroy();
    return true;
  };
  await assert.rejects(
    x.withStore((s) => core.adopt(s, compiled, x.a.organizationId, approved))
  );
  x.intercept = null;
  const before = await x.sendCheckpoint();
  for (const update of [
    (state) => {
      state.receipts = JSON.parse(before.logical).receipts;
    },
    (state) => {
      const receipt = state.receipts.find(
        (row) => row.requestId === approved.request.requestId
      );
      receipt.bundle = JSON.stringify({ ...approved, signatures: [] });
    },
    (state) => {
      const receipt = state.receipts.find(
        (row) => row.requestId === approved.request.requestId
      );
      receipt.bundle = JSON.stringify({
        ...approved,
        signatures: [approved.signatures[0]],
      });
    },
    (state) => {
      state.organizations[0].policy = JSON.stringify(x.compiled.policy);
    },
  ]) {
    const logical = JSON.parse(candidate.logical);
    update(logical);
    await assert.rejects(
      x.sendCheckpoint(await reseal(candidate, logical)),
      /remote-witness/
    );
  }
  assert.deepEqual(await x.sendCheckpoint(), before);
  assert.equal(
    (
      await x.withStore((s) =>
        core.adopt(s, compiled, x.a.organizationId, approved)
      )
    ).status,
    "adopted"
  );
  const applied = await x.sendCheckpoint();
  assert.deepEqual(await x.sendCheckpoint(candidate), applied);
  const replay = await reseal(
    {
      ...applied,
      sequence: applied.sequence + 1,
      previousCheckpoint: applied.checkpointDigest,
      activeRoot: applied.activeRoot + "-other",
    },
    JSON.parse(applied.logical)
  );
  await assert.rejects(x.sendCheckpoint(replay), /remote-witness/);
  assert.deepEqual(await x.sendCheckpoint(), applied);
});

test("witness restore requires approval of the current checkpoint and exact target", async (t) => {
  const x = await fixture(t);
  const before = await x.sendCheckpoint();
  const target = path.join(x.dir, "new-host");
  let candidate;
  x.intercept = ({ request, stage, res }) => {
    if (stage !== "before" || !request.next) return false;
    candidate = request.next;
    res.destroy();
    return true;
  };
  await assert.rejects(x.restore(target));
  x.intercept = null;
  const state = JSON.parse(candidate.logical);
  await assert.rejects(
    x.sendCheckpoint(
      await reseal({ ...candidate, activeRoot: target + "-different" }, state)
    ),
    /remote-witness/
  );
  await assert.rejects(
    x.sendCheckpoint(await reseal(candidate, JSON.parse(before.logical))),
    /remote-witness/
  );
  assert.deepEqual(await x.sendCheckpoint(), before);
  await x.refresh(x.f.make({ version: 2 }));
  const live = await x.sendCheckpoint();
  const stale = await reseal(
    {
      ...candidate,
      sequence: live.sequence + 1,
      previousCheckpoint: live.checkpointDigest,
    },
    { ...JSON.parse(live.logical), receipts: state.receipts }
  );
  await assert.rejects(x.sendCheckpoint(stale), /remote-witness/);
  assert.deepEqual(await x.sendCheckpoint(), live);
  assert.equal(
    (await x.restore(target + "-approved")).status,
    "restored-needs-refresh"
  );
});

async function reseal(head, logical) {
  const { createHash } = await import("node:crypto");
  const digest = (value) =>
    "sha256:" +
    createHash("sha256").update(core.canonical(value)).digest("hex");
  const { checkpointDigest, logical: prior, ...header } = head;
  header.stateDigest = digest(logical);
  return {
    ...header,
    checkpointDigest: digest(header),
    logical: JSON.stringify(logical),
  };
}

test("host loss and independent witness checkpoint drills retain policy, past approvals and TUF floors", async () => {
  const { drillHostLoss, drillWitnessRollback } = await import(
    "../scripts/drill-witness-recovery.mjs"
  );
  const host = await drillHostLoss();
  assert.equal(host.priorApprovalCount, 2);
  assert.equal(host.restoredTargetsFloor, 2);
  const witness = await drillWitnessRollback();
  assert.equal(witness.coordinatedRollbackOfAnalysisAndWitnessBlocked, true);
  assert.equal(witness.historyCommitInterruptionRepaired, true);
  assert.equal(witness.finalTargetsFloor, 4);
});

test("an existing witness binds only to the independently recorded head and rejects a same-sequence fork on restart", async (t) => {
  const x = await fixture(t);
  const { DatabaseSync } = await import("node:sqlite");
  const head = await x.sendCheckpoint();
  const checkpointDirectory = path.join(x.dir, "checkpoint");
  await x.stopService();
  await assert.rejects(
    x.startService({
      checkpointDirectory,
      bindCheckpoint: "sha256:" + "0".repeat(64),
    }),
    /witness-checkpoint-bind-head-mismatch/
  );
  assert.ok(!fs.existsSync(checkpointDirectory));
  const bind = { checkpointDirectory, bindCheckpoint: head.checkpointDigest };
  await x.startService(bind);
  assert.deepEqual(await x.sendCheckpoint(), head);
  await x.stopService();
  await x.startService(bind);
  assert.deepEqual(await x.sendCheckpoint(), head);
  await x.stopService();
  const db = new DatabaseSync(
    path.join(x.witnessOptions.directory, "history.sqlite")
  );
  try {
    const fork = await reseal(
      { ...head, activeRoot: head.activeRoot + "-fork" },
      JSON.parse(head.logical)
    );
    db.prepare("UPDATE history SET body=? WHERE sequence=?").run(
      JSON.stringify(fork),
      head.sequence
    );
  } finally {
    db.close();
  }
  await assert.rejects(
    x.startService({ checkpointDirectory, repairCheckpoint: true }),
    /witness-checkpoint-history-mismatch/
  );
});
