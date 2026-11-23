#!/usr/bin/env node
// Sign only an explicitly supplied request; no production approver keys are generated.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  g = require("./organization-governance.cjs"),
  core = require("./organization-trust.cjs");
const usage = `Usage: node verification/organization-governance.mjs COMMAND --authority PATH
  plan-enroll --store PATH --output REQUEST.json
  plan-adopt --store PATH --policy PATH --output REQUEST.json
  plan-restore --target NEW_PATH [--backup PATH] --output REQUEST.json
  sign --request PATH --approver ID --key PATH --output SIGNED.json
  combine --approval PATH --approval PATH --output APPROVAL.json
  enroll --store PATH --approval PATH
  backup --store PATH --output BACKUP.json
  restore --target NEW_PATH --approval PATH [--backup PATH]
  witness
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
    "plan-adopt": ["store", "policy", "output"],
    "plan-restore": ["target", "backup", "output"],
    sign: ["request", "approver", "key", "output"],
    combine: ["approval", "output"],
    enroll: ["store", "approval"],
    backup: ["store", "output"],
    restore: ["target", "approval", "backup"],
    witness: [],
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
  for (const key of allowed.filter((k) => k !== "backup"))
    if (!args[key]) throw Error("missing-governance-argument");
  const read = (file) => core.readJSON(file, 16_000_000);
  let result;
  if (command === "plan-enroll")
    result = g.planEnroll(args.store, args.authority);
  if (command === "plan-adopt")
    result = g.planAdopt(
      args.store,
      args.authority,
      await core.compilePolicy(read(args.policy)),
    );
  if (command === "plan-restore")
    result = g.planRestore(args.authority, args.target, args.backup);
  if (command === "sign")
    result = g.signRequest(
      args.authority,
      read(args.request),
      args.approver,
      args.key,
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
