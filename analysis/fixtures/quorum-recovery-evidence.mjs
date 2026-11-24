import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { rotationFixture } from "./rotation-evidence.mjs";
import { g } from "./remote-witness-evidence.mjs";

export const reason =
  "Controlled incident: current owner and security quorum unavailable";

export async function quorumFixture({ legacy = false, register = true } = {}) {
  const x = await rotationFixture({ legacy });
  try {
    x.initialAuthority = x.sourceAuthority;
    x.initialConfig = structuredClone(x.sourceConfig);
    const custodyFiles = new Map();
    const custodians = ["owner", "security"].map((role) => {
      const id = "recovery-" + role;
      const pair = crypto.generateKeyPairSync("ed25519");
      const key = path.join(x.keys, id + ".pem");
      fs.writeFileSync(
        key,
        pair.privateKey.export({ format: "pem", type: "pkcs8" }),
        { mode: 0o600 },
      );
      custodyFiles.set(id, key);
      return {
        id,
        role,
        publicKey: pair.publicKey.export({ format: "pem", type: "spki" }),
      };
    });
    x.custodyFiles = custodyFiles;
    x.registeredAuthority = path.join(x.config, "registered-authority.json");
    x.registeredConfig = {
      ...x.initialConfig,
      approverEpoch: 1,
      recovery: { threshold: 2, approvers: custodians },
    };
    fs.writeFileSync(
      x.registeredAuthority,
      JSON.stringify(x.registeredConfig),
      { mode: 0o600 },
    );
    x.registrationPlan = () =>
      g.planRotation(x.root, x.initialAuthority, x.registeredAuthority);
    x.registrationSignatures = (b) => [
      ...x.initialConfig.approvers.flatMap(({ id }) =>
        ["current", "next"].map((side) =>
          g.signRequest(
            side === "current" ? x.initialAuthority : x.registeredAuthority,
            b,
            id,
            path.join(x.keys, id + ".pem"),
            side,
          ),
        ),
      ),
      ...custodians.map(({ id }) =>
        g.signRequest(
          x.registeredAuthority,
          b,
          id,
          custodyFiles.get(id),
          "recovery-setup",
        ),
      ),
    ];
    x.register = async () => {
      const b = await x.registrationPlan();
      const signed = g.combine(x.initialAuthority, x.registrationSignatures(b));
      const result = await g.rotate(
        x.root,
        x.initialAuthority,
        x.registeredAuthority,
        signed,
      );
      x.authority = x.registeredAuthority;
      x.a = x.registeredConfig;
      return result;
    };
    if (register) await x.register();
    x.emergencyAuthority = path.join(x.config, "emergency-authority.json");
    x.emergencyConfig = {
      ...x.registeredConfig,
      approverEpoch: 2,
      approvers: x.nextConfig.approvers,
    };
    fs.writeFileSync(x.emergencyAuthority, JSON.stringify(x.emergencyConfig), {
      mode: 0o600,
    });
    x.recoveryPlan = () =>
      g.planRotation(
        x.root,
        x.registeredAuthority,
        x.emergencyAuthority,
        reason,
      );
    x.recoverySignatures = (b) => [
      ...custodians.map(({ id }) =>
        g.signRequest(
          x.registeredAuthority,
          b,
          id,
          custodyFiles.get(id),
          "recovery",
        ),
      ),
      ...x.emergencyConfig.approvers.map(({ id }) =>
        g.signRequest(
          x.emergencyAuthority,
          b,
          id,
          x.nextKeyFiles.get(id),
          "next",
        ),
      ),
    ];
    x.recoveryApproval = async () =>
      g.combine(
        x.registeredAuthority,
        x.recoverySignatures(await x.recoveryPlan()),
      );
    x.recover = (b) =>
      g.recoverQuorum(x.root, x.registeredAuthority, x.emergencyAuthority, b);
    x.selectRecovered = () => {
      x.authority = x.emergencyAuthority;
      x.a = x.emergencyConfig;
    };
    return x;
  } catch (error) {
    await x.cleanup();
    throw error;
  }
}
