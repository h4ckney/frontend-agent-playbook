#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { remoteFixture } from "../analysis/fixtures/remote-witness-evidence.mjs";

function state(head) {
  return JSON.parse(head.logical);
}

function verifyPreserved(before, after) {
  assert.equal(
    state(after).organizations[0].digest,
    state(before).organizations[0].digest
  );
  assert.deepEqual(
    state(after).domains.map(({ id, checkpoint }) => ({ id, checkpoint })),
    state(before).domains.map(({ id, checkpoint }) => ({ id, checkpoint }))
  );
  for (const receipt of state(before).receipts)
    assert.deepEqual(
      state(after).receipts.find((row) => row.requestId === receipt.requestId),
      receipt
    );
}

export async function drillHostLoss() {
  const x = await remoteFixture({ subprocess: true });
  try {
    await x.initialize();
    assert.equal(
      (await x.refresh(x.f.make({ version: 2 }))).status,
      "verified"
    );
    const before = await x.sendCheckpoint();

    await x.stopService();
    await assert.rejects(x.snapshot(), /remote-witness-response-missing/);
    const began = performance.now();
    fs.rmSync(x.root, { recursive: true });
    fs.rmSync(x.a.witnessDirectory, { recursive: true });
    await x.startService();
    assert.deepEqual(await x.sendCheckpoint(), before);

    const target = path.join(x.dir, "restored-host");
    await x.restore(target);
    x.root = target;
    const restored = await x.sendCheckpoint();
    verifyPreserved(before, restored);
    await assert.rejects(x.snapshot(), /refresh-not-verified/);
    assert.equal((await x.status()).domains[0].versions.targets, 2);
    assert.equal((await x.refresh(x.f.make())).status, "rejected");
    assert.equal((await x.status()).domains[0].versions.targets, 2);
    assert.equal(
      (await x.refresh(x.f.make({ version: 3 }))).status,
      "verified"
    );
    await x.snapshot();

    return {
      witnessOutageBlocked: true,
      bothLocalDirectoriesRemoved: true,
      policyDigestPreserved: true,
      priorApprovalCount: state(before).receipts.length,
      restoredTargetsFloor: 2,
      finalTargetsFloor: 3,
      simulatedRecoveryMilliseconds: Math.round(performance.now() - began),
    };
  } finally {
    await x.cleanup();
  }
}

export async function drillWitnessRollback() {
  const x = await remoteFixture({ subprocess: true, anchored: true });
  const history = path.join(x.witnessOptions.directory, "history.sqlite");
  const checkpoint = path.join(
    x.witnessOptions.checkpointDirectory,
    "checkpoint.sqlite"
  );
  try {
    await x.initialize();
    const stale = fs.readFileSync(history);
    const staleLocal = x.capture();
    await x.refresh(x.f.make({ version: 2 }));
    const before = await x.sendCheckpoint();
    const matching = fs.readFileSync(history);

    await x.stopService();
    fs.writeFileSync(history, stale);
    x.rewind(staleLocal);
    await assert.rejects(
      x.startService(),
      /witness-checkpoint-history-mismatch/
    );
    await assert.rejects(
      x.startService({ repairCheckpoint: true }),
      /witness-checkpoint-history-mismatch/
    );
    fs.writeFileSync(history, matching);
    await x.startService();
    verifyPreserved(before, await x.sendCheckpoint());

    const target = path.join(x.dir, "restored-after-witness-recovery");
    await x.restore(target);
    x.root = target;
    await x.refresh(x.f.make({ version: 3 }));

    // Hold a reader lock on history so its COMMIT fails after the independent commit.
    const pending = await x.begin();
    const reader = new DatabaseSync(history, { readOnly: true });
    try {
      reader.exec("BEGIN");
      reader.prepare("SELECT sequence FROM history").all();
      await assert.rejects(
        x.finish(pending, x.f.make({ version: 4, remove: true })),
        /remote-witness-response-missing/
      );
    } finally {
      reader.close();
    }
    await assert.rejects(x.inspect(), /remote-witness-conflict/);
    await x.stopService();
    await assert.rejects(
      x.startService(),
      /witness-checkpoint-history-mismatch/
    );
    await x.startService({ repairCheckpoint: true });
    assert.equal((await x.reconcile()).status, "reconciled");
    assert.equal((await x.reconcile()).status, "already-synchronized");
    assert.equal((await x.status()).domains[0].versions.targets, 4);
    assert.equal(
      (await x.refresh(x.f.make({ version: 3 }))).status,
      "rejected"
    );
    assert.equal((await x.status()).domains[0].versions.targets, 4);

    await x.stopService();
    fs.renameSync(checkpoint, checkpoint + ".offline");
    await assert.rejects(x.startService(), /ENOENT/);
    await assert.rejects(
      x.startService({ bindCheckpoint: latestDigest(history) }),
      /witness-checkpoint-missing/
    );
    await assert.rejects(
      x.startService({ checkpointDirectory: undefined }),
      /witness-checkpoint-config-required/
    );
    fs.renameSync(checkpoint + ".offline", checkpoint);
    await x.startService();
    assert.equal((await x.status()).domains[0].versions.targets, 4);
    return {
      independentCheckpointRequired: true,
      coordinatedRollbackOfAnalysisAndWitnessBlocked: true,
      matchedBackupRestored: true,
      historyCommitInterruptionRepaired: true,
      olderTufRejectedAfterRetry: true,
      finalTargetsFloor: 4,
    };
  } finally {
    await x.cleanup();
  }
}

function latestDigest(history) {
  const db = new DatabaseSync(history, { readOnly: true });
  try {
    return JSON.parse(
      db
        .prepare("SELECT body FROM history ORDER BY sequence DESC LIMIT 1")
        .get().body
    ).checkpointDigest;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [flag, output, ...rest] = process.argv.slice(2);
  if (flag !== "--output" || !output || rest.length)
    throw Error("Usage: drill-witness-recovery.mjs --output NEW_RECEIPT.json");
  const evidence = {
    format: "controlled-witness-recovery-v1",
    scope:
      "One test host, separate TLS witness process and temporary directory boundaries. No external staging or physical host loss.",
    node: process.version,
    hostLoss: await drillHostLoss(),
    witnessRollback: await drillWitnessRollback(),
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write("Host loss and witness rollback drills passed.\n");
}
