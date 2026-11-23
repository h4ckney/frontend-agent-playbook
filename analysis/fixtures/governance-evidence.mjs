// Controlled rehearsal only. Generated approver private keys never leave a temporary directory.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { keylessFixture } from "./keyless-evidence.mjs";
import { tufFixture } from "./tuf-evidence.mjs";
const require = createRequire(import.meta.url),
  core = require("../../verification/organization-trust.cjs"),
  g = require("../../verification/organization-governance.cjs"),
  tuf = require("../../verification/sigstore-tuf.cjs");
export async function governanceFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-governance-"));
  const config = path.join(dir, "config"),
    keys = path.join(dir, "keys");
  fs.mkdirSync(config, { mode: 0o700 });
  fs.mkdirSync(keys, { mode: 0o700 });
  const approvers = ["owner", "security"].map((role) => {
    const pair = crypto.generateKeyPairSync("ed25519"),
      id = "synthetic-" + role;
    fs.writeFileSync(
      path.join(keys, id + ".pem"),
      pair.privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    return {
      id,
      role,
      publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
    };
  });
  const authority = path.join(config, "authority.json"),
    a = {
      schemaVersion: "1",
      storeId: crypto.randomUUID(),
      organizationId: "controlled-platform",
      witnessDirectory: path.join(dir, "independent-witness"),
      threshold: 2,
      approvers,
    };
  fs.writeFileSync(authority, JSON.stringify(a), { mode: 0o600 });
  const root = path.join(dir, "active-store"),
    s = core.openStore(root, true);
  s.close();
  const k = await keylessFixture(),
    f = tufFixture(k.root),
    trustPolicy = structuredClone(k.policy);
  delete trustPolicy.keyless[0].trustedRootDigest;
  trustPolicy.keyless[0].tufBootstrapRootDigest = f.pin;
  const policy = {
    schemaVersion: "1",
    organizationId: a.organizationId,
    revision: 1,
    trustDomains: [
      { id: "public", bootstrapRootDigest: f.pin, maxRefreshAgeSeconds: 3600 },
    ],
    profiles: [
      {
        id: "frontend-main",
        trustDomain: "public",
        repository: trustPolicy.keyless[0].repository,
        trustPolicy,
      },
    ],
  };
  const x = {
    dir,
    root,
    config,
    keys,
    authority,
    a,
    k,
    f,
    policy,
    compiled: await core.compilePolicy(policy),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  return x;
}
export function approve(x, b) {
  return g.combine(
    x.authority,
    x.a.approvers.map((r) =>
      g.signRequest(x.authority, b, r.id, path.join(x.keys, r.id + ".pem")),
    ),
  );
}
export function enroll(x) {
  return g.enroll(
    x.root,
    x.authority,
    approve(x, g.planEnroll(x.root, x.authority)),
  );
}
export function adopt(x) {
  const b = approve(x, g.planAdopt(x.root, x.authority, x.compiled)),
    s = g.open(x.root, x.authority);
  try {
    return core.adopt(s, x.compiled, x.a.organizationId, b);
  } finally {
    s.close();
  }
}
export function refresh(x, repository = x.f.make(), initialize = true) {
  const s = g.open(x.root, x.authority);
  try {
    const p = core.beginRefresh(
        s,
        x.compiled,
        x.a.organizationId,
        "public",
        initialize,
      ),
      v = tuf.verifyRepository(repository, x.f.pin, Date.now(), p.floor),
      previous = p.previous || { repository, floor: p.floor };
    return core.finishRefresh(
      s,
      x.compiled,
      x.a.organizationId,
      "public",
      p.lease,
      {
        schemaVersion: "1",
        bootstrapRootDigest: x.f.pin,
        ...tuf.applyProgress(previous, repository, v),
        lastAttempt: {
          status: v.status,
          reason: v.reason,
          checkedAt: new Date().toISOString(),
        },
      },
    );
  } finally {
    s.close();
  }
}
export function snapshot(x) {
  const s = g.open(x.root, x.authority);
  try {
    return core.snapshot(s, x.compiled, x.a.organizationId, "frontend-main");
  } finally {
    s.close();
  }
}
export function status(x) {
  const s = g.open(x.root, x.authority);
  try {
    return core.status(s, x.compiled, x.a.organizationId);
  } finally {
    s.close();
  }
}
export { core, g };
