#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  quorumFixture,
  reason,
} from "../analysis/fixtures/quorum-recovery-evidence.mjs";
import { core, g } from "../analysis/fixtures/remote-witness-evidence.mjs";

const cli = fileURLToPath(
  new URL("../verification/organization-governance.mjs", import.meta.url),
);
export async function drill() {
  const x = await quorumFixture(),
    steps = [];
  const pass = (step, details = {}) =>
    steps.push({ step, status: "passed", ...details });
  const run = async (command, authority, args) =>
    JSON.parse(
      (
        await promisify(execFile)(process.execPath, [
          cli,
          command,
          "--authority",
          authority,
          ...args,
        ])
      ).stdout,
    );
  try {
    await x.refresh(x.f.make({ version: 2, remove: true }));
    const prior = x.local(),
      oldHead = await x.inspect();
    for (const { id } of x.initialConfig.approvers)
      fs.unlinkSync(path.join(x.keys, id + ".pem"));
    const args = [
      "--store",
      x.root,
      "--destination-authority",
      x.emergencyAuthority,
    ];
    const request = path.join(x.dir, "request.json"),
      approval = path.join(x.dir, "approval.json");
    await run("plan-quorum-recovery", x.registeredAuthority, [
      ...args,
      "--reason",
      reason,
      "--output",
      request,
    ]);
    const pieces = [];
    for (const [side, c, roster, keys] of [
      [
        "recovery",
        x.registeredAuthority,
        x.registeredConfig.recovery.approvers,
        x.custodyFiles,
      ],
      [
        "next",
        x.emergencyAuthority,
        x.emergencyConfig.approvers,
        x.nextKeyFiles,
      ],
    ]) {
      for (const { id } of roster) {
        const out = path.join(x.dir, side + "-" + id + ".json");
        await run("sign", c, [
          "--request",
          request,
          "--rotation-side",
          side,
          "--approver",
          id,
          "--key",
          keys.get(id),
          "--output",
          out,
        ]);
        pieces.push("--approval", out);
      }
    }
    await run("combine", x.registeredAuthority, [
      ...pieces,
      "--output",
      approval,
    ]);
    pass("independent-custodians-authorize-without-old-owner-security-keys", {
      priorApprovals: prior.approvals.length,
    });

    let child;
    x.intercept = ({ stage, request, res }) => {
      if (stage !== "after" || !request.rotation) return false;
      child.kill("SIGKILL");
      res.destroy();
      return true;
    };
    child = spawn(
      process.execPath,
      [
        cli,
        "recover-quorum",
        "--authority",
        x.registeredAuthority,
        ...args,
        "--approval",
        approval,
      ],
      { stdio: "ignore" },
    );
    assert.deepEqual(await once(child, "exit"), [null, "SIGKILL"]);
    x.intercept = null;
    assert.deepEqual(x.local(), prior);
    await assert.rejects(x.status(), /remote-witness-response-missing/);
    const remote = await g.inspect(x.emergencyAuthority);
    assert.equal(remote.sequence, oldHead.sequence + 1);
    pass("remote-first-cutover-fences-old-authority-after-cli-death", {
      remoteSequence: remote.sequence,
    });

    await x.restart();
    const applied = await run(
      "resume-quorum-recovery",
      x.registeredAuthority,
      args,
    );
    assert.equal(applied.checkpointDigest, remote.checkpointDigest);
    const now = x.local();
    assert.deepEqual(
      now.approvals.filter((r) =>
        prior.approvals.some((p) => p.requestId === r.requestId),
      ),
      prior.approvals,
    );
    assert.deepEqual(now.domains, prior.domains);
    assert.deepEqual(
      { ...now.policy, generation: prior.policy.generation },
      { ...prior.policy },
    );
    assert.equal(now.policy.generation, prior.policy.generation + 1);
    pass("exact-resume-preserves-approval-bytes-policy-and-partial-tuf-floor", {
      targetsFloor: 2,
    });

    x.selectRecovered();
    assert.equal((await x.refresh(x.f.make())).status, "rejected");
    assert.equal((await x.status()).domains[0].versions.targets, 2);
    assert.equal(
      (await x.refresh(x.f.make({ version: 3 }))).status,
      "verified",
    );
    assert.ok(await core.read(await x.snapshot()));
    const previous = {
      ...x.emergencyConfig,
      approverEpoch: 3,
      approvers: x.initialConfig.approvers,
    };
    const reuse = path.join(x.config, "reuse.json");
    fs.writeFileSync(reuse, JSON.stringify(previous), { mode: 0o600 });
    await assert.rejects(
      g.planRotation(x.root, x.emergencyAuthority, reuse, reason),
      /rotation-revoked-key-reuse/,
    );
    assert.equal((await x.recover()).status, "already-recovered");
    pass("tuf-rollback-and-retired-keys-rejected", { finalTargetsFloor: 3 });
    return {
      format: "controlled-emergency-quorum-recovery-v1",
      node: process.version,
      finishedAt: new Date().toISOString(),
      steps,
      scope:
        "Temporary keys, SQLite and an independent HTTPS witness. Old test private keys deleted before recovery.",
    };
  } finally {
    await x.cleanup();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [flag, out, ...extra] = process.argv.slice(2);
  if (flag !== "--output" || !out || extra.length)
    throw Error(
      "Usage: drill-emergency-quorum-recovery.mjs --output NEW_RECEIPT.json",
    );
  const receipt = await drill();
  fs.writeFileSync(out, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({ status: "passed", steps: receipt.steps.length }) + "\n",
  );
}
