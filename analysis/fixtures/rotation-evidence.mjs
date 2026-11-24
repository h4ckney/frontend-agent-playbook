import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { remoteFixture, g } from "./remote-witness-evidence.mjs";

export async function rotationFixture({ legacy = false } = {}) {
  const x = await remoteFixture({ legacy });
  try {
    await x.initialize();
    x.sourceAuthority = x.authority;
    x.sourceConfig = structuredClone(x.a);
    x.nextConfig = { ...structuredClone(x.a), approverEpoch: 1 };
    x.nextKeyFiles = new Map();
    x.nextConfig.approvers = x.nextConfig.approvers.map((row) => {
      const pair = crypto.generateKeyPairSync("ed25519");
      const file = path.join(x.keys, row.id + "-next.pem");
      fs.writeFileSync(
        file,
        pair.privateKey.export({ format: "pem", type: "pkcs8" }),
        { mode: 0o600 },
      );
      x.nextKeyFiles.set(row.id, file);
      return {
        ...row,
        publicKey: pair.publicKey.export({ format: "pem", type: "spki" }),
      };
    });
    x.nextAuthority = path.join(x.config, "next-authority.json");
    fs.writeFileSync(x.nextAuthority, JSON.stringify(x.nextConfig), {
      mode: 0o600,
    });
    x.sign = (b, side, id) => {
      const authority =
        side === "current" ? x.sourceAuthority : x.nextAuthority;
      const key =
        side === "current"
          ? path.join(x.keys, id + ".pem")
          : x.nextKeyFiles.get(id);
      return g.signRequest(authority, b, id, key, side);
    };
    x.plan = () => g.planRotation(x.root, x.sourceAuthority, x.nextAuthority);
    x.approval = async () => {
      const request = await x.plan();
      return g.combine(x.sourceAuthority, [
        ...x.sourceConfig.approvers.map(({ id }) =>
          x.sign(request, "current", id),
        ),
        ...x.nextConfig.approvers.map(({ id }) => x.sign(request, "next", id)),
      ]);
    };
    x.rotate = (b) => g.rotate(x.root, x.sourceAuthority, x.nextAuthority, b);
    x.selectNext = () => {
      x.authority = x.nextAuthority;
      x.a = x.nextConfig;
    };
    x.local = () => {
      const db = new DatabaseSync(path.join(x.root, "trust-store.sqlite"), {
        readOnly: true,
      });
      try {
        return {
          version: db.prepare("PRAGMA user_version").get().user_version,
          approvals: db
            .prepare("SELECT * FROM governance_receipts ORDER BY requestId")
            .all(),
          policy: db
            .prepare(
              "SELECT id,revision,digest,policy,generation FROM organizations",
            )
            .get(),
          domains: db.prepare("SELECT * FROM domains ORDER BY id").all(),
        };
      } finally {
        db.close();
      }
    };
    return x;
  } catch (error) {
    await x.cleanup();
    throw error;
  }
}
