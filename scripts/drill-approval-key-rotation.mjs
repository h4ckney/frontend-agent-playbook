#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { rotationFixture } from "../analysis/fixtures/rotation-evidence.mjs";
import { core, g } from "../analysis/fixtures/remote-witness-evidence.mjs";
const cli = fileURLToPath(
  new URL("../verification/organization-governance.mjs", import.meta.url),
);

export async function drill() {
  const x = await rotationFixture();
  const steps = [];
  const passed = (step, evidence = {}) =>
    steps.push({ step, status: "passed", ...evidence });
  try {
    await x.refresh(x.f.make({ version: 2 }));
    const token = await x.snapshot(),
      before = x.local(),
      parent = await x.inspect();
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
    const args = [
      "--store",
      x.root,
      "--destination-authority",
      x.nextAuthority,
    ];
    const request = path.join(x.dir, "rotation-request.json");
    await run("plan-rotation", x.sourceAuthority, [
      ...args,
      "--output",
      request,
    ]);
    const signatures = [];
    for (const side of ["current", "next"]) {
      for (const { id } of (side === "current" ? x.sourceConfig : x.nextConfig)
        .approvers) {
        const output = path.join(x.dir, side + "-" + id + ".json");
        await run(
          "sign",
          side === "current" ? x.sourceAuthority : x.nextAuthority,
          [
            "--request",
            request,
            "--rotation-side",
            side,
            "--approver",
            id,
            "--key",
            side === "current"
              ? path.join(x.keys, id + ".pem")
              : x.nextKeyFiles.get(id),
            "--output",
            output,
          ],
        );
        signatures.push("--approval", output);
      }
    }
    const approvalPath = path.join(x.dir, "rotation-approval.json");
    await run("combine", x.sourceAuthority, [
      ...signatures,
      "--output",
      approvalPath,
    ]);
    const approval = JSON.parse(fs.readFileSync(approvalPath));
    passed("old-and-new-quorums-prove-key-rotation");
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
        "rotate",
        "--authority",
        x.sourceAuthority,
        ...args,
        "--approval",
        approvalPath,
      ],
      { stdio: "ignore" },
    );
    assert.deepEqual(await once(child, "exit"), [null, "SIGKILL"]);
    x.intercept = null;
    assert.equal(x.local().version, 5);
    await assert.rejects(
      async () => core.read(token),
      /governance-rotation-pending/,
    );
    await assert.rejects(
      g.inspect(x.sourceAuthority),
      /remote-witness-response-missing/,
    );
    const published = await g.inspect(x.nextAuthority);
    assert.equal(published.sequence, parent.sequence + 1);
    passed("published-rotation-fences-old-authority-through-process-death", {
      remoteSequence: published.sequence,
    });
    await x.restart();
    const result = await run("resume-rotation", x.sourceAuthority, args);
    assert.equal(result.checkpointDigest, published.checkpointDigest);
    x.selectNext();
    const after = x.local();
    assert.equal(after.version, 3);
    assert.deepEqual(
      after.approvals.filter((r) => r.requestId !== approval.request.requestId),
      before.approvals,
    );
    assert.deepEqual(after.domains, before.domains);
    assert.deepEqual(
      { ...after.policy, generation: before.policy.generation },
      { ...before.policy },
    );
    assert.equal(after.policy.generation, before.policy.generation + 1);
    passed("exact-retry-preserves-approval-bytes-and-tuf-floor", {
      preservedApprovals: before.approvals.length,
      targetsFloor: 2,
    });
    const requestAfter = await g.planAdopt(x.root, x.nextAuthority, x.compiled);
    for (const { id } of x.sourceConfig.approvers)
      assert.throws(
        () =>
          g.signRequest(
            x.nextAuthority,
            requestAfter,
            id,
            path.join(x.keys, id + ".pem"),
          ),
        /approval-key-mismatch/,
      );
    await assert.rejects(
      async () => core.read(token),
      /governance-authority-mismatch/,
    );
    assert.ok(await x.snapshot());
    assert.equal((await x.rotate(approval)).status, "already-rotated");
    passed("revoked-private-keys-and-old-token-rejected");
    return {
      format: "controlled-approval-rotation-v1",
      node: process.version,
      finishedAt: new Date().toISOString(),
      steps,
      scope:
        "Temporary approvals, HTTPS witness and TUF state with an interrupted rotation process.",
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
      "Usage: drill-approval-key-rotation.mjs --output NEW_RECEIPT.json",
    );
  const result = await drill();
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({ status: "passed", steps: result.steps.length }) + "\n",
  );
}
