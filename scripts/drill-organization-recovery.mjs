#!/usr/bin/env node
// A controlled local rehearsal. Never enrolls a real organization or generates production keys.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {
  governanceFixture,
  approve,
  enroll,
  adopt,
  refresh,
  status,
  snapshot,
  core,
  g,
} from "../analysis/fixtures/governance-evidence.mjs";
export async function drill() {
  const x = await governanceFixture(),
    startedAt = new Date().toISOString(),
    steps = [];
  try {
    enroll(x);
    adopt(x);
    refresh(x);
    steps.push({ step: "two-role-enrollment-and-adoption", status: "passed" });
    const past = fs.readFileSync(path.join(x.root, "trust-store.sqlite")),
      backup = path.join(x.dir, "backup.json");
    g.backup(x.root, x.authority, backup);
    steps.push({ step: "quiescent-consistent-backup", status: "passed" });
    refresh(x, x.f.make({ version: 2 }), false);
    const h = g.inspect(x.authority);
    assert.throws(
      () =>
        g.planRestore(x.authority, path.join(x.dir, "stale-target"), backup),
      /backup-stale-or-forked/,
    );
    steps.push({ step: "stale-backup-rejected", status: "passed" });
    fs.writeFileSync(path.join(x.root, "trust-store.sqlite"), past);
    assert.throws(
      () => g.open(x.root, x.authority),
      /whole-store-rollback-or-tampering/,
    );
    assert.deepEqual(g.inspect(x.authority), h);
    steps.push({
      step: "entire-main-db-rewind-detected",
      status: "passed",
      witnessSequence: h.sequence,
    });
    const oldRoot = x.root,
      target = path.join(x.dir, "recovered-store"),
      approval = approve(x, g.planRestore(x.authority, target));
    const restored = g.restore(x.authority, target, approval);
    assert.equal(restored.status, "restored-needs-refresh");
    assert.throws(() => g.open(oldRoot, x.authority), /active-store-mismatch/);
    x.root = target;
    assert.equal(status(x).domains[0].versions.targets, 2);
    assert.throws(() => snapshot(x), /refresh-not-verified/);
    steps.push({
      step: "approved-latest-witness-restore-and-old-path-fencing",
      status: "passed",
      sequence: restored.sequence,
    });
    refresh(x, x.f.make({ version: 3 }), false);
    assert.equal(status(x).domains[0].status, "ready");
    assert.ok(core.read(snapshot(x)).context.governance);
    steps.push({
      step: "fresh-tuf-required-before-authorization",
      status: "passed",
      versions: status(x).domains[0].versions,
    });
    const latest = path.join(x.dir, "latest.json");
    g.backup(x.root, x.authority, latest);
    const finalTarget = path.join(x.dir, "backup-restored"),
      b = approve(x, g.planRestore(x.authority, finalTarget, latest));
    g.restore(x.authority, finalTarget, b, latest);
    x.root = finalTarget;
    assert.equal(status(x).domains[0].status, "rejected");
    assert.equal(status(x).domains[0].versions.targets, 3);
    steps.push({
      step: "approved-current-backup-restore-preserves-floor",
      status: "passed",
    });
    return {
      format: "controlled-organization-recovery-drill-v1",
      startedAt,
      finishedAt: new Date().toISOString(),
      node: process.version,
      scope:
        "Synthetic approver keys, controlled TUF signatures, temporary local POSIX databases. No production approval, real host power failure, remote witness, OIDC issuance, Rekor publication or deployment.",
      steps,
      passed: steps.length,
      failed: 0,
    };
  } finally {
    x.cleanup();
  }
}
if (
  process.argv[1] &&
  new URL(import.meta.url).pathname === path.resolve(process.argv[1])
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--output")
      throw Error(
        "Usage: node scripts/drill-organization-recovery.mjs --output NEW_RECEIPT.json",
      );
    const result = await drill(),
      fd = fs.openSync(
        args[1],
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
    try {
      fs.writeFileSync(fd, JSON.stringify(result, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    process.stdout.write(
      JSON.stringify({ status: "passed", steps: result.passed }) + "\n",
    );
  } catch (error) {
    process.stderr.write(
      "Recovery rehearsal failed: " +
        String(error.message).replace(/[\r\n]/g, " ") +
        "\n",
    );
    process.exitCode = 2;
  }
}
