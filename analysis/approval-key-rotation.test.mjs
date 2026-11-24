import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { rotationFixture } from "./fixtures/rotation-evidence.mjs";
import { core, g } from "./fixtures/remote-witness-evidence.mjs";
import { drill } from "../scripts/drill-approval-key-rotation.mjs";

const require = createRequire(import.meta.url);
const protocol = require("../verification/remote-witness.cjs");
async function fixture(t, options) {
  const x = await rotationFixture(options);
  t.after(() => x.cleanup());
  return x;
}

test("CLI rehearsal kills rotation after remote commit and resumes with unchanged history and TUF", async () => {
  assert.equal((await drill()).steps.length, 4);
});

test("both sides require role quorum and replaying old signatures as next acceptance fails", async (t) => {
  const x = await fixture(t);
  const b = await x.approval();
  await assert.rejects(
    x.rotate({ ...b, acceptances: [] }),
    /approval-threshold-not-met/,
  );
  await assert.rejects(
    x.rotate({ ...b, signatures: [b.signatures[0]] }),
    /approval-threshold-not-met/,
  );
  await assert.rejects(
    x.rotate({ ...b, acceptances: b.signatures }),
    /approval-signature-rejected/,
  );
  await assert.rejects(
    x.rotate({ ...b, review: { ...b.review, revoked: [] } }),
  );
  assert.equal(x.local().version, 3);
  assert.equal((await x.inspect()).sequence, 4);
});

test("an additional next approver must prove possession even after a next quorum is satisfied", async (t) => {
  const x = await fixture(t),
    pair = crypto.generateKeyPairSync("ed25519");
  x.nextConfig.approvers.push({
    id: "new-extra",
    role: "security",
    publicKey: pair.publicKey.export({ format: "pem", type: "spki" }),
  });
  fs.writeFileSync(x.nextAuthority, JSON.stringify(x.nextConfig));
  const request = await x.plan(),
    ids = x.sourceConfig.approvers.map((a) => a.id);
  const signatures = ids.map((id) => x.sign(request, "current", id));
  const acceptances = ids.map((id) => x.sign(request, "next", id));
  assert.throws(
    () => g.combine(x.sourceAuthority, [...signatures, ...acceptances]),
    /rotation-new-key-proof-required/,
  );
});

test("old approval signed before cutover and a fresh forgery using retired keys both fail after replacement", async (t) => {
  const x = await fixture(t);
  const prior = await g.planAdopt(x.root, x.sourceAuthority, x.compiled);
  const old = g.combine(
    x.sourceAuthority,
    x.sourceConfig.approvers.map(({ id }) =>
      g.signRequest(
        x.sourceAuthority,
        prior,
        id,
        path.join(x.keys, id + ".pem"),
      ),
    ),
  );
  await x.rotate(await x.approval());
  x.selectNext();
  await assert.rejects(
    x.withStore((s) => core.adopt(s, x.compiled, x.a.organizationId, old)),
    /approval-scope-or-time-rejected/,
  );
  const next = await g.planAdopt(x.root, x.nextAuthority, x.compiled);
  next.signatures = x.sourceConfig.approvers.map(({ id }) => ({
    approverId: id,
    signature: crypto
      .sign(
        null,
        Buffer.from(
          "frontend-organization-approval-v1\n" + core.canonical(next.request),
        ),
        fs.readFileSync(path.join(x.keys, id + ".pem")),
      )
      .toString("base64"),
  }));
  await assert.rejects(
    x.withStore((s) => core.adopt(s, x.compiled, x.a.organizationId, next)),
    /approval-signature-rejected/,
  );
});

test("revoked fingerprints cannot be reintroduced under new IDs in a later epoch", async (t) => {
  const x = await fixture(t);
  await x.rotate(await x.approval());
  x.selectNext();
  const restore = {
    ...x.a,
    approverEpoch: 2,
    approvers: x.sourceConfig.approvers.map((a) => ({
      ...a,
      id: a.id + "-alias",
    })),
  };
  const candidate = path.join(x.config, "reintroduce.json");
  fs.writeFileSync(candidate, JSON.stringify(restore), { mode: 0o600 });
  await assert.rejects(
    g.planRotation(x.root, x.nextAuthority, candidate),
    /rotation-revoked-key-reuse/,
  );
});

test("preflight or previous-state changes cannot freeze a store under a stale approved request", async (t) => {
  const x = await fixture(t),
    b = await x.approval();
  x.intercept = ({ stage, res }) => {
    if (stage !== "before") return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.rotate(b), /remote-witness-response-missing/);
  assert.equal(x.local().version, 3);
  x.intercept = null;
  await x.refresh(x.f.make({ version: 2 }));
  await assert.rejects(x.rotate(b), /rotation-source-or-approval-changed/);
  assert.equal(x.local().version, 3);
});

test("a retry after the freeze but before the first publish uses one entry and rejects replacement approval", async (t) => {
  const x = await fixture(t),
    b = await x.approval(),
    replacement = await x.approval();
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "before" || !request.rotation) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.rotate(b), /remote-witness-response-missing/);
  assert.equal(x.local().version, 5);
  x.intercept = null;
  await assert.rejects(
    x.rotate(replacement),
    /rotation-retry-approval-mismatch/,
  );
  assert.equal((await x.rotate()).status, "rotated");
  assert.equal((await g.inspect(x.nextAuthority)).sequence, 5);
});

test("remote append independently rejects forged dual quorum and altered domain floors", async (t) => {
  const x = await fixture(t),
    b = await x.approval();
  let captured;
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "before" || !request.rotation) return false;
    captured = request.next;
    res.destroy();
    return true;
  };
  await assert.rejects(x.rotate(b), /remote-witness-response-missing/);
  x.intercept = null;
  const c = {
    a: x.sourceConfig,
    digest: g.authorityInfo(x.sourceAuthority).authorityDigest,
  };
  const digest = (v) =>
    "sha256:" +
    crypto.createHash("sha256").update(core.canonical(v)).digest("hex");
  for (const change of [
    (logical) => {
      const receipt = logical.receipts.find(
        (row) => row.requestId === b.request.requestId,
      );
      const raw = JSON.parse(receipt.bundle);
      raw.acceptances = [];
      receipt.bundle = JSON.stringify(raw);
    },
    (logical) => {
      logical.domains[0].checkpoint = JSON.stringify({
        versions: {},
        signedDigests: {},
        snapshotMeta: {},
      });
    },
  ]) {
    const { logical, checkpointDigest, ...header } = captured,
      parsed = JSON.parse(logical);
    change(parsed);
    header.stateDigest = digest(parsed);
    await assert.rejects(
      protocol.call(
        c,
        (p) => p,
        {
          ...header,
          checkpointDigest: digest(header),
          logical: JSON.stringify(parsed),
        },
        { rotation: true },
      ),
    );
    assert.equal((await g.inspect(x.sourceAuthority)).sequence, 4);
  }
  assert.equal((await x.rotate()).status, "rotated");
});

test("v2 local rotation atomically replaces owner and security keys without changing TUF state", async (t) => {
  const x = await fixture(t, { legacy: true });
  const b = await x.approval(),
    before = x.local();
  const result = await x.rotate(b);
  assert.equal(result.status, "rotated");
  assert.equal(x.local().version, 2);
  assert.deepEqual(x.local().domains, before.domains);
  assert.throws(
    () => g.open(x.root, x.sourceAuthority),
    /governance-authority-mismatch/,
  );
  assert.equal((await x.rotate(b)).status, "already-rotated");
});

test("an exact already-published rotation can be finalized after the approval window expires", async (t) => {
  const x = await fixture(t),
    b = await x.approval();
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "after" || !request.rotation) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.rotate(b), /remote-witness-response-missing/);
  x.intercept = null;
  const published = await g.inspect(x.nextAuthority);
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse(b.request.expiresAt) + 1,
  });
  assert.equal((await x.rotate()).checkpointDigest, published.checkpointDigest);
});

test("revocation-only rotation can authorize with the remaining old quorum", async (t) => {
  const x = await fixture(t);
  const [owner, security] = x.sourceConfig.approvers;
  const standby = {
    ...x.nextConfig.approvers.find((k) => k.role === "owner"),
    id: "standby-owner",
  };
  const standbyFile = x.nextKeyFiles.get(owner.id);
  const expanded = {
    ...x.sourceConfig,
    approverEpoch: 1,
    approvers: [owner, security, standby],
  };
  fs.writeFileSync(x.nextAuthority, JSON.stringify(expanded));
  const first = await x.plan();
  const firstApprovals = [owner, security].flatMap(({ id }) =>
    ["current", "next"].map((side) =>
      g.signRequest(
        side === "current" ? x.sourceAuthority : x.nextAuthority,
        first,
        id,
        path.join(x.keys, id + ".pem"),
        side,
      ),
    ),
  );
  firstApprovals.push(
    g.signRequest(x.nextAuthority, first, standby.id, standbyFile, "next"),
  );
  assert.equal(
    (await x.rotate(g.combine(x.sourceAuthority, firstApprovals))).status,
    "rotated",
  );

  const reduced = {
    ...expanded,
    approverEpoch: 2,
    approvers: [security, standby],
  };
  const destination = path.join(x.config, "reduced.json");
  fs.writeFileSync(destination, JSON.stringify(reduced), { mode: 0o600 });
  const second = await g.planRotation(x.root, x.nextAuthority, destination);
  for (const { id } of second.review.revoked) assert.equal(id, owner.id);
  const files = {
    [security.id]: path.join(x.keys, security.id + ".pem"),
    [standby.id]: standbyFile,
  };
  const secondApprovals = [security, standby].flatMap(({ id }) =>
    ["current", "next"].map((side) =>
      g.signRequest(
        side === "current" ? x.nextAuthority : destination,
        second,
        id,
        files[id],
        side,
      ),
    ),
  );
  const result = await g.rotate(
    x.root,
    x.nextAuthority,
    destination,
    g.combine(x.nextAuthority, secondApprovals),
  );
  assert.equal(result.sequence, 6);
  const request = await g.planAdopt(x.root, destination, x.compiled);
  assert.throws(
    () =>
      g.signRequest(
        destination,
        request,
        owner.id,
        path.join(x.keys, owner.id + ".pem"),
      ),
    /unknown-approver/,
  );
});

test("an expired staged request that never reached the witness cannot cause a new remote cutover", async (t) => {
  const x = await fixture(t),
    b = await x.approval();
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "before" || !request.rotation) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.rotate(b), /remote-witness-response-missing/);
  x.intercept = null;
  const prior = await g.inspect(x.sourceAuthority);
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse(b.request.expiresAt) + 1,
  });
  await assert.rejects(x.rotate(), /remote-witness-response-missing/);
  assert.deepEqual(await g.inspect(x.sourceAuthority), prior);
  assert.equal(x.local().version, 5);
  assert.equal(
    (await x.restore(path.join(x.dir, "recover-old-quorum"))).status,
    "restored-needs-refresh",
  );
});

test("concurrent resumes cannot append twice or overwrite a newer remote checkpoint", async (t) => {
  const x = await fixture(t),
    b = await x.approval();
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "after" || !request.rotation) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.rotate(b), /remote-witness-response-missing/);
  x.intercept = null;
  const results = await Promise.allSettled([x.rotate(), x.rotate()]);
  assert.ok(
    results.some(
      (r) => r.status === "fulfilled" && r.value.status === "rotated",
    ),
  );
  assert.equal((await g.inspect(x.nextAuthority)).sequence, 5);
  assert.equal(
    x.local().approvals.filter((r) => r.requestId === b.request.requestId)
      .length,
    1,
  );
  assert.equal((await x.rotate()).status, "already-rotated");
});

test("a conflicting signed acknowledgment leaves the local freeze and retries the actual remote head", async (t) => {
  const x = await fixture(t),
    b = await x.approval();
  x.intercept = (event) => event.request.rotation && x.forkResponse(event);
  await assert.rejects(x.rotate(b), /remote-witness-conflict/);
  x.intercept = null;
  assert.equal(x.local().version, 5);
  const published = await g.inspect(x.nextAuthority);
  assert.equal((await x.rotate()).checkpointDigest, published.checkpointDigest);
});

test("tampered local pre-rotation state cannot replace the frozen checkpoint", async (t) => {
  const x = await fixture(t),
    b = await x.approval();
  x.intercept = ({ stage, request, res }) => {
    if (stage !== "after" || !request.rotation) return false;
    res.destroy();
    return true;
  };
  await assert.rejects(x.rotate(b), /remote-witness-response-missing/);
  x.intercept = null;
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(x.root, "trust-store.sqlite"));
  try {
    db.exec("UPDATE organizations SET generation=generation+1");
  } finally {
    db.close();
  }
  const published = await g.inspect(x.nextAuthority);
  await assert.rejects(x.rotate(), /rotation-fence-invalid/);
  assert.equal(x.local().version, 5);
  assert.deepEqual(await g.inspect(x.nextAuthority), published);
});
