#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remoteFixture } from "../analysis/fixtures/remote-witness-evidence.mjs";

export async function drill() {
  const x = await remoteFixture();
  const steps = [];
  const passed = (step, evidence = {}) =>
    steps.push({ step, status: "passed", ...evidence });
  try {
    await x.initialize();
    const copy = x.capture();
    passed("published-initial-checkpoint");
    const pending = await x.begin();
    x.intercept = x.dropAppend;
    // A valid metadata advance with invalid target bytes still advances the TUF floor.
    const rejected = x.f.make({ version: 2, remove: true });
    await assert.rejects(
      x.finish(pending, rejected),
      /remote-witness-response-missing/,
    );
    x.intercept = null;
    await assert.rejects(x.snapshot(), /remote-witness-local-behind/);
    const remotelyCommitted = await x.inspect();
    await x.restart();
    const recovered = await x.reconcile();
    assert.equal(recovered.sequence, remotelyCommitted.sequence);
    assert.equal((await x.status()).domains[0].versions.targets, 2);
    await assert.rejects(x.snapshot());
    const older = await x.refresh(x.f.make());
    assert.equal(older.status, "rejected");
    assert.equal((await x.status()).domains[0].versions.targets, 2);
    passed("lost-commit-reply-retry-preserves-rejected-metadata-floor", {
      targetsFloor: 2,
    });
    assert.equal(
      (await x.refresh(x.f.make({ version: 3 }))).status,
      "verified",
    );

    x.intercept = ({ stage, res }) => {
      if (stage !== "before") return false;
      res.destroy();
      return true;
    };
    await assert.rejects(x.snapshot(), /remote-witness-response-missing/);
    passed("missing-response-blocked");
    x.intercept = x.forkResponse;
    await assert.rejects(x.snapshot(), /remote-witness-sequence-conflict/);
    passed("same-sequence-signed-conflict-blocked");

    x.intercept = null;
    x.rewind(copy);
    await assert.rejects(x.snapshot(), /remote-witness-local-behind/);
    await assert.rejects(
      x.reconcile(),
      /remote-witness-recovery-approval-required/,
    );
    passed("host-database-pair-rollback-blocked");
    const target = path.join(x.dir, "approved-recovery");
    await x.restore(target);
    x.root = target;
    assert.equal((await x.status()).domains[0].versions.targets, 3);
    await assert.rejects(x.snapshot(), /refresh-not-verified/);
    assert.equal(
      (await x.refresh(x.f.make({ version: 2 }))).status,
      "rejected",
    );
    assert.equal((await x.status()).domains[0].versions.targets, 3);
    assert.equal(
      (await x.refresh(x.f.make({ version: 4 }))).status,
      "verified",
    );
    await x.snapshot();
    passed("approved-restore-keeps-remote-floor-and-requires-fresh-tuf", {
      restoredTargetsFloor: 3,
      finalTargetsFloor: 4,
    });
    return {
      format: "controlled-remote-witness-recovery-v1",
      scope:
        "Independent HTTPS service and temporary databases on one test host. No production rollout or physical host restore.",
      node: process.version,
      finishedAt: new Date().toISOString(),
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
  const [flag, output, ...rest] = process.argv.slice(2);
  if (flag !== "--output" || !output || rest.length)
    throw Error("Usage: drill-remote-witness.mjs --output NEW_RECEIPT.json");
  const receipt = await drill();
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    JSON.stringify({ status: "passed", steps: receipt.steps.length }) + "\n",
  );
}
