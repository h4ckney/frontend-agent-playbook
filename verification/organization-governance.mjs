#!/usr/bin/env node
// Sign only an explicitly supplied request; no production approver keys are generated.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  g = require("./organization-governance.cjs"),
  core = require("./organization-trust.cjs");
const usage = `Usage: node verification/organization-governance.mjs COMMAND --authority PATH
  plan-enroll --store PATH --output REQUEST.json
  plan-adopt --store PATH --policy PATH --output REQUEST.json
  plan-migrate --store PATH --destination-authority PATH --output REQUEST.json
  migrate --store PATH --destination-authority PATH --approval PATH
  resume-migration --store PATH --destination-authority PATH
  plan-rotation --store PATH --destination-authority PATH --output REQUEST.json
  rotate --store PATH --destination-authority PATH --approval PATH
  resume-rotation --store PATH --destination-authority PATH
  plan-restore --target NEW_PATH [--backup PATH] --output REQUEST.json
  sign --request PATH --approver ID --key PATH --output SIGNED.json [--rotation-side current|next]
  combine --approval PATH --approval PATH --output APPROVAL.json
  enroll --store PATH --approval PATH
  backup --store PATH --output BACKUP.json
  restore --target NEW_PATH --approval PATH [--backup PATH]
  witness
  authority-info
  reconcile --store PATH
Omitting --backup during restore explicitly selects the current independent witness snapshot.
`;
async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === "--help") {
    process.stdout.write(usage);
    return;
  }
  const choices = {
    "plan-enroll": ["store", "output"],
    "plan-migrate": ["store", "destination-authority", "output"],
    migrate: ["store", "destination-authority", "approval"],
    "resume-migration": ["store", "destination-authority"],
    "plan-rotation": ["store", "destination-authority", "output"],
    rotate: ["store", "destination-authority", "approval"],
    "resume-rotation": ["store", "destination-authority"],
    "plan-adopt": ["store", "policy", "output"],
    "plan-restore": ["target", "backup", "output"],
    sign: ["request", "approver", "key", "output", "rotation-side"],
    combine: ["approval", "output"],
    enroll: ["store", "approval"],
    backup: ["store", "output"],
    restore: ["target", "approval", "backup"],
    witness: [],
    "authority-info": [],
    reconcile: ["store"],
  };
  if (!Object.hasOwn(choices, command))
    throw Error("invalid-governance-command");
  const allowed = ["authority", ...choices[command]],
    args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].slice(2);
    if (
      !argv[i].startsWith("--") ||
      !allowed.includes(key) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith("--") ||
      (args[key] !== undefined &&
        !(command === "combine" && key === "approval"))
    )
      throw Error("invalid-governance-arguments");
    const value = argv[++i];
    if (command === "combine" && key === "approval")
      (args.approval ??= []).push(value);
    else args[key] = value;
  }
  for (const key of allowed.filter(
    (k) => k !== "backup" && k !== "rotation-side",
  ))
    if (!args[key]) throw Error("missing-governance-argument");
  const read = (file) => core.readJSON(file, 16_000_000);
  let result;
  if (command === "plan-rotation")
    return g.writeJSON(
      args.output,
      await g.planRotation(
        args.store,
        args.authority,
        args["destination-authority"],
      ),
    );
  if (command === "rotate" || command === "resume-rotation")
    return g.rotate(
      args.store,
      args.authority,
      args["destination-authority"],
      args.approval ? read(args.approval) : undefined,
    );
  if (command === "plan-migrate")
    return g.writeJSON(
      args.output,
      g.planMigration(
        args.store,
        args.authority,
        args["destination-authority"],
      ),
    );
  if (command === "migrate" || command === "resume-migration")
    return g.migrate(
      args.store,
      args.authority,
      args["destination-authority"],
      args.approval ? read(args.approval) : undefined,
    );
  if (command === "plan-enroll")
    result = g.planEnroll(args.store, args.authority);
  if (command === "plan-adopt")
    result = await g.planAdopt(
      args.store,
      args.authority,
      await core.compilePolicy(read(args.policy)),
    );
  if (command === "plan-restore")
    result = await g.planRestore(args.authority, args.target, args.backup);
  if (command === "sign")
    result = g.signRequest(
      args.authority,
      read(args.request),
      args.approver,
      args.key,
      args["rotation-side"],
    );
  if (command === "combine")
    result = g.combine(args.authority, args.approval.map(read));
  if (
    ["plan-enroll", "plan-adopt", "plan-restore", "sign", "combine"].includes(
      command,
    )
  )
    return g.writeJSON(args.output, result);
  if (command === "enroll")
    return g.enroll(args.store, args.authority, read(args.approval));
  if (command === "backup")
    return g.backup(args.store, args.authority, args.output);
  if (command === "restore")
    return g.restore(
      args.authority,
      args.target,
      read(args.approval),
      args.backup,
    );
  if (command === "authority-info") return g.authorityInfo(args.authority);
  if (command === "reconcile") return g.reconcile(args.store, args.authority);
  return g.inspect(args.authority);
}
main()
  .then((result) => {
    if (result) process.stdout.write(JSON.stringify(result) + "\n");
  })
  .catch((error) => {
    process.stderr.write(
      "Organization governance rejected: " +
        (/^[a-z][a-z0-9-]+$/.test(error.message)
          ? error.message
          : "input-or-storage-unavailable") +
        ". No approval, reset or restore fallback.\n",
    );
    process.exitCode = 2;
  });
