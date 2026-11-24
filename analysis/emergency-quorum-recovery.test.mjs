import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { quorumFixture, reason } from "./fixtures/quorum-recovery-evidence.mjs";
import { core, g } from "./fixtures/remote-witness-evidence.mjs";
import { drill } from "../scripts/drill-emergency-quorum-recovery.mjs";

const require = createRequire(import.meta.url);
const protocol = require("../verification/remote-witness.cjs");
async function fixture(t, options) {
  const x = await quorumFixture(options);
  t.after(() => x.cleanup());
  return x;
}

test("real CLI recovery without old keys survives post-append process death and preserves TUF and prior receipts", async () => {
  assert.equal((await drill()).steps.length, 4);
});

test("a missing registration cannot be replaced by self-appointed custodians", async (t) => {
  const x = await fixture(t, { register: false });
  assert.throws(
    () =>
      g.planRotation(x.root, x.initialAuthority, x.emergencyAuthority, reason),
    /rotation-authority-fields-changed|recovery-quorum-not-registered/,
  );
  assert.throws(
    () => g.planEnroll(x.root, x.registeredAuthority),
    /register-recovery-by-approved-rotation/,
  );
  const request = await x.registrationPlan();
  const pieces = x.registrationSignatures(request);
  assert.throws(
    () =>
      g.combine(
        x.initialAuthority,
        pieces.filter((b) => b.recoveryProofs.length === 0),
      ),
    /recovery-new-key-proof-required/,
  );
  assert.equal((await x.inspect()).sequence, 4);
});

test("recovery trustees must be cryptographically disjoint from active approvers", async (t) => {
  const x = await fixture(t, { register: false }),
    config = structuredClone(x.registeredConfig);
  config.recovery.approvers[0].publicKey = config.approvers[0].publicKey;
  const alias = path.join(x.config, "duplicate.json");
  fs.writeFileSync(alias, JSON.stringify(config), { mode: 0o600 });
  assert.throws(
    () => g.planRotation(x.root, x.initialAuthority, alias),
    /recovery-authority-must-be-independent/,
  );
});

test("emergency approval cannot alter recovery policy or substitute the next quorum", async (t) => {
  const x = await fixture(t),
    b = await x.recoveryApproval();
  const altered = {
    ...x.emergencyConfig,
    recovery: {
      ...x.emergencyConfig.recovery,
      threshold: 3,
      approvers: [
        ...x.emergencyConfig.recovery.approvers,
        { ...x.emergencyConfig.approvers[0] },
      ],
    },
  };
  const file = path.join(x.config, "altered.json");
  fs.writeFileSync(file, JSON.stringify(altered), { mode: 0o600 });
  assert.throws(
    () => g.planRotation(x.root, x.registeredAuthority, file, reason),
    /recovery-authority-must-be-independent/,
  );
  delete altered.recovery;
  fs.writeFileSync(file, JSON.stringify(altered));
  assert.throws(
    () => g.planRotation(x.root, x.registeredAuthority, file, reason),
    /emergency-recovery-authority-change-rejected/,
  );
  await assert.rejects(
    x.recover({ ...b, acceptances: [] }),
    /approval-threshold-not-met/,
  );
  await assert.rejects(
    x.recover({ ...b, signatures: b.signatures.slice(0, 1) }),
    /approval-threshold-not-met/,
  );
  await assert.rejects(
    g.rotate(x.root, x.registeredAuthority, x.emergencyAuthority, b),
    /rotation-action-mismatch/,
  );
});

test("custody keys cannot authorize routine adoption, and old signatures cannot approve emergency recovery", async (t) => {
  const x = await fixture(t);
  const adoption = await g.planAdopt(x.root, x.registeredAuthority, x.compiled);
  const [custodian] = x.registeredConfig.recovery.approvers;
  assert.throws(
    () =>
      g.signRequest(
        x.registeredAuthority,
        adoption,
        custodian.id,
        x.custodyFiles.get(custodian.id),
      ),
    /unknown-approver/,
  );
  const b = await x.recoveryApproval();
  b.signatures = x.initialConfig.approvers.map(({ id }) => ({
    approverId: id,
    signature: crypto
      .sign(
        null,
        Buffer.from(
          "frontend-organization-emergency-quorum-v1\n" +
            core.canonical(b.request),
        ),
        fs.readFileSync(path.join(x.keys, id + ".pem")),
      )
      .toString("base64"),
  }));
  await assert.rejects(x.recover(b), /approval-signature-rejected/);
});

test("response lost before remote append leaves old state usable and retry applies one successor", async (t) => {
  const x = await fixture(t),
    approval = await x.recoveryApproval(),
    prior = await x.inspect();
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "before" || !request.rotation) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.recover(approval), /remote-witness-response-missing/);
  x.intercept = null;
  assert.deepEqual(await x.inspect(), prior);
  await assert.rejects(x.recover(), /remote-witness-response-missing/);
  assert.ok(await x.snapshot());
  assert.equal((await x.recover(approval)).sequence, prior.sequence + 1);
  assert.equal((await x.recover()).status, "already-recovered");
});

test("already published emergency transition resumes even after its approval expires", async (t) => {
  const x = await fixture(t),
    approval = await x.recoveryApproval();
  x.intercept = x.dropAppend;
  await assert.rejects(x.recover(approval), /remote-witness-response-missing/);
  x.intercept = null;
  const remote = await g.inspect(x.emergencyAuthority);
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse(approval.request.expiresAt) + 1,
  });
  await assert.rejects(x.recover(approval), /approval-scope-or-time-rejected/);
  assert.equal((await x.recover()).checkpointDigest, remote.checkpointDigest);
});

test("an unregistered local authority fails closed after quorum loss", async (t) => {
  const x = await fixture(t, { legacy: true, register: false });
  const next = {
    ...x.initialConfig,
    approverEpoch: 1,
    approvers: x.nextConfig.approvers,
  };
  fs.writeFileSync(x.emergencyAuthority, JSON.stringify(next));
  assert.throws(
    () =>
      g.planRotation(x.root, x.initialAuthority, x.emergencyAuthority, reason),
    /recovery-quorum-not-registered/,
  );
});

test("v2 emergency recovery uses the registered custodians and preserves the exact TUF state", async (t) => {
  const x = await fixture(t, { legacy: true });
  const prior = x.local();
  const approved = await x.recoveryApproval();
  assert.equal((await x.recover(approved)).status, "quorum-recovered");
  assert.equal(x.local().version, 2);
  assert.deepEqual(x.local().domains, prior.domains);
  assert.throws(
    () => g.open(x.root, x.registeredAuthority),
    /governance-authority-mismatch/,
  );
  assert.equal((await x.recover()).status, "already-recovered");
});

test("the witness independently rejects forged recovery approval and a recovery that lowers TUF floors", async (t) => {
  const x = await fixture(t),
    b = await x.recoveryApproval();
  let captured;
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "before" || !request.rotation) return false;
    captured = request.next;
    res.destroy();
    return true;
  };
  await assert.rejects(x.recover(b), /remote-witness-response-missing/);
  x.intercept = null;
  const c = {
    a: x.registeredConfig,
    digest: g.authorityInfo(x.registeredAuthority).authorityDigest,
  };
  const hash = (v) =>
    "sha256:" +
    crypto.createHash("sha256").update(core.canonical(v)).digest("hex");
  for (const change of [
    (logical) => {
      const receipt = logical.receipts.find(
        (row) => row.requestId === b.request.requestId,
      );
      const body = JSON.parse(receipt.bundle);
      body.signatures = [];
      receipt.bundle = JSON.stringify(body);
    },
    (logical) => {
      logical.domains[0].checkpoint = JSON.stringify({
        versions: {},
        signedDigests: {},
        snapshotMeta: {},
      });
    },
  ]) {
    const { logical, checkpointDigest, ...header } = captured;
    const state = JSON.parse(logical);
    change(state);
    header.stateDigest = hash(state);
    await assert.rejects(
      protocol.call(
        c,
        (p) => p,
        {
          ...header,
          checkpointDigest: hash(header),
          logical: JSON.stringify(state),
        },
        { rotation: true },
      ),
    );
  }
  assert.equal((await x.recover(b)).status, "quorum-recovered");
});

test("a still-unpublished regular rotation can be superseded without the old quorum", async (t) => {
  const x = await fixture(t);
  const regularCandidate = { ...x.emergencyConfig };
  const normal = path.join(x.config, "normal-rotation.json");
  fs.writeFileSync(normal, JSON.stringify(regularCandidate), { mode: 0o600 });
  const request = await g.planRotation(x.root, x.registeredAuthority, normal);
  const regular = g.combine(
    x.registeredAuthority,
    x.initialConfig.approvers.flatMap(({ id }) => [
      g.signRequest(
        x.registeredAuthority,
        request,
        id,
        path.join(x.keys, id + ".pem"),
        "current",
      ),
      g.signRequest(normal, request, id, x.nextKeyFiles.get(id), "next"),
    ]),
  );
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "before" || !request.rotation) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(
    g.rotate(x.root, x.registeredAuthority, normal, regular),
    /remote-witness-response-missing/,
  );
  assert.equal(x.local().version, 5);
  x.intercept = null;
  for (const { id } of x.initialConfig.approvers)
    fs.unlinkSync(path.join(x.keys, id + ".pem"));
  const emergency = await x.recoveryApproval();
  const result = await x.recover(emergency);
  assert.equal(result.status, "quorum-recovered");
  assert.equal(x.local().version, 3);
  assert.equal(
    x
      .local()
      .approvals.some((row) => row.requestId === regular.request.requestId),
    false,
  );
  assert.equal(
    x
      .local()
      .approvals.some((row) => row.requestId === emergency.request.requestId),
    true,
  );
});

test("a concurrent second resume does not append or issue another approval", async (t) => {
  const x = await fixture(t),
    b = await x.recoveryApproval();
  x.intercept = x.dropAppend;
  await assert.rejects(x.recover(b), /remote-witness-response-missing/);
  x.intercept = null;
  const published = await g.inspect(x.emergencyAuthority);
  const results = await Promise.allSettled([x.recover(), x.recover()]);
  assert.ok(
    results.some(
      (r) => r.status === "fulfilled" && r.value.status === "quorum-recovered",
    ),
  );
  assert.equal((await x.recover()).status, "already-recovered");
  assert.deepEqual(await g.inspect(x.emergencyAuthority), published);
});

test("private or appended key material is rejected before entering a plan or the witness", async (t) => {
  const x = await fixture(t, { register: false });
  const altered = structuredClone(x.registeredConfig);
  const owner = altered.recovery.approvers[0];
  const key = fs.readFileSync(x.custodyFiles.get(owner.id), "utf8");
  const original = owner.publicKey;
  const file = path.join(x.config, "invalid-public-key.json");
  for (const value of [key, original + key]) {
    owner.publicKey = value;
    fs.writeFileSync(file, JSON.stringify(altered), { mode: 0o600 });
    assert.throws(
      () => g.planRotation(x.root, x.initialAuthority, file),
      /invalid-governance-key/,
    );
  }
  altered.recovery.approvers[0].publicKey = original;
  altered.remoteWitness.publicKey = key;
  fs.writeFileSync(file, JSON.stringify(altered));
  assert.throws(
    () => g.planRotation(x.root, x.initialAuthority, file),
    /invalid-remote-witness-config/,
  );
});

test("a recovery approval bound to an older checkpoint does not replace a newer TUF snapshot", async (t) => {
  const x = await fixture(t),
    old = await x.recoveryApproval();
  assert.equal((await x.refresh(x.f.make({ version: 2 }))).status, "verified");
  await assert.rejects(x.recover(old), /rotation-source-or-approval-changed/);
  assert.equal((await x.status()).domains[0].versions.targets, 2);
  await assert.rejects(
    g.inspect(x.emergencyAuthority),
    /remote-witness-response-missing/,
  );
});

test("a revoked ordinary key cannot be registered as a recovery custodian", async (t) => {
  const x = await fixture(t);
  await x.recover(await x.recoveryApproval());
  x.selectRecovered();
  const next = {
    ...x.emergencyConfig,
    approverEpoch: 3,
    recovery: {
      threshold: 2,
      approvers: [
        { ...x.initialConfig.approvers[0], id: "custody-alias" },
        x.registeredConfig.recovery.approvers[1],
      ],
    },
  };
  const file = path.join(x.config, "retired-as-custodian.json");
  fs.writeFileSync(file, JSON.stringify(next), { mode: 0o600 });
  await assert.rejects(
    g.planRotation(x.root, x.emergencyAuthority, file),
    /rotation-revoked-key-reuse/,
  );
});
