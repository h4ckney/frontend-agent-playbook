#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { migrationFixture } from "../analysis/fixtures/migration-evidence.mjs";
import { g } from "../analysis/fixtures/remote-witness-evidence.mjs";

const cli = fileURLToPath(
  new URL("../verification/organization-governance.mjs", import.meta.url),
);
export async function drill() {
  const x = await migrationFixture();
  const steps = [];
  const passed = (step, details = {}) =>
    steps.push({ step, status: "passed", ...details });
  try {
    const removal = x.f.make({ version: 2, remove: true });
    assert.equal((await x.refresh(removal)).status, "rejected");
    const before = x.local();
    const source = await x.inspect();
    const run = async (command, args) =>
      JSON.parse(
        (
          await promisify(execFile)(process.execPath, [
            cli,
            command,
            "--authority",
            x.sourceAuthority,
            ...args,
          ])
        ).stdout,
      );
    const migrationArgs = [
      "--destination-authority",
      x.remoteAuthority,
      "--store",
      x.root,
    ];
    const requestPath = path.join(x.dir, "request.json");
    await run("plan-migrate", [...migrationArgs, "--output", requestPath]);
    const signatures = [];
    for (const { id } of x.a.approvers) {
      const output = path.join(x.dir, id + ".json");
      await run("sign", [
        "--request",
        requestPath,
        "--approver",
        id,
        "--key",
        path.join(x.keys, id + ".pem"),
        "--output",
        output,
      ]);
      signatures.push("--approval", output);
    }
    const approvalPath = path.join(x.dir, "approval.json");
    await run("combine", [...signatures, "--output", approvalPath]);
    const approval = JSON.parse(fs.readFileSync(approvalPath));
    passed("approved-v2-checkpoint-with-partially-advanced-tuf-floor", {
      sourceSequence: source.sequence,
      priorApprovals: before.approval.length,
    });

    // End the migration process after the server's durable append and before it can commit locally.
    let child;
    x.intercept = ({ request, stage, res }) => {
      if (stage !== "after" || !request.next) return false;
      child.kill("SIGKILL");
      res.destroy();
      return true;
    };
    child = spawn(
      process.execPath,
      [
        cli,
        "migrate",
        "--authority",
        x.sourceAuthority,
        "--destination-authority",
        x.remoteAuthority,
        "--store",
        x.root,
        "--approval",
        approvalPath,
      ],
      { stdio: "ignore" },
    );
    assert.deepEqual(await once(child, "exit"), [null, "SIGKILL"]);
    x.intercept = null;
    assert.equal(x.local().version, 4);
    assert.throws(
      () => g.open(x.root, x.sourceAuthority),
      /governance-migration-pending/,
    );
    assert.throws(
      () => g.planRestore(x.sourceAuthority, path.join(x.dir, "old-restore")),
      /invalid-witness-head/,
    );
    const published = await g.inspect(x.remoteAuthority);
    passed("remote-append-survives-process-kill-and-v2-is-fenced", {
      remoteSequence: published.sequence,
    });

    await x.restart();
    const result = await run("resume-migration", migrationArgs);
    assert.equal(result.status, "migrated-needs-refresh");
    assert.equal(result.checkpointDigest, published.checkpointDigest);
    assert.equal(result.sourceCheckpoint, source.checkpointDigest);
    x.selectRemote();
    const after = x.local();
    assert.equal(after.version, 3);
    assert.deepEqual(after.policy, before.policy);
    assert.deepEqual(
      after.approval.filter(
        (row) => row.requestId !== approval.request.requestId,
      ),
      before.approval,
    );
    const prior = before.domains[0],
      current = after.domains[0];
    assert.equal(current.checkpoint, prior.checkpoint);
    const { lastAttempt, ...state } = JSON.parse(current.state);
    const { lastAttempt: previousAttempt, ...priorState } = JSON.parse(
      prior.state,
    );
    assert.deepEqual(state, priorState);
    assert.equal(lastAttempt.reason, "organization-migration-needs-refresh");
    passed("retry-keeps-approval-bytes-policy-tuf-floor-and-remote-head", {
      preservedApprovals: before.approval.length,
      targetsFloor: 2,
    });

    await assert.rejects(x.snapshot(), /refresh-not-verified|target-removed/);
    assert.equal((await x.refresh(x.f.make())).status, "rejected");
    assert.equal((await x.status()).domains[0].versions.targets, 2);
    assert.equal(
      (await x.refresh(x.f.make({ version: 3 }))).status,
      "verified",
    );
    await x.snapshot();
    assert.equal((await x.apply(approval)).status, "already-migrated");
    passed("older-tuf-rejected-fresh-refresh-required-and-retry-idempotent", {
      finalTargetsFloor: 3,
    });
    return {
      format: "controlled-v2-remote-witness-migration-v1",
      node: process.version,
      finishedAt: new Date().toISOString(),
      scope:
        "Synthetic approvals and TUF, temporary v2/v3 databases, independent HTTPS service and a killed migration subprocess.",
      steps,
    };
  } finally {
    await x.cleanup();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [flag, output, ...extra] = process.argv.slice(2);
  if (flag !== "--output" || !output || extra.length)
    throw Error(
      "Usage: drill-remote-witness-migration.mjs --output NEW_RECEIPT.json",
    );
  const data = await drill();
  fs.writeFileSync(output, JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({ status: "passed", steps: data.steps.length }) + "\n",
  );
}
