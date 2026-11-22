#!/usr/bin/env node
// Operator-only commands. Scans cannot adopt policy, initialize, fetch or recover.
import fs from "node:fs";
import { createRequire } from "node:module";
import { fetchRepository } from "./tuf-source.mjs";
const require = createRequire(import.meta.url),
  org = require("./organization-trust.cjs"),
  tuf = require("./sigstore-tuf.cjs"),
  { sha256 } = require("../analysis/execution-evidence.js");
const usage =
  "Usage: node verification/organization-trust.mjs init --store PATH\n  adopt|status --store PATH --organization ID --policy PATH\n  refresh --store PATH --organization ID --policy PATH --trust-domain ID [--repository PATH] [--initialize --bootstrap PATH]\n  recover --store PATH --organization ID --policy PATH --trust-domain ID\n";
async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === "--help") {
    process.stdout.write(usage);
    return;
  }
  const allowed = {
    init: ["--store"],
    adopt: ["--store", "--organization", "--policy"],
    status: ["--store", "--organization", "--policy"],
    refresh: [
      "--store",
      "--organization",
      "--policy",
      "--trust-domain",
      "--repository",
      "--initialize",
      "--bootstrap",
    ],
    recover: ["--store", "--organization", "--policy", "--trust-domain"],
  }[command];
  if (!allowed) throw Error("invalid-command");
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!allowed.includes(name) || args[name] !== undefined)
      throw Error("invalid-arguments");
    if (name === "--initialize") args[name] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw Error("missing-argument");
      args[name] = argv[++i];
    }
  }
  for (const name of [
    "--store",
    ...(command === "init" ? [] : ["--organization", "--policy"]),
    ...(["refresh", "recover"].includes(command) ? ["--trust-domain"] : []),
  ])
    if (!args[name]) throw Error("missing-argument");
  if (command === "init") {
    const store = org.openStore(args["--store"], true);
    store.close();
    return { status: "initialized" };
  }
  const compiled = await org.compilePolicy(org.readJSON(args["--policy"])),
    organization = args["--organization"];
  const store = org.openStore(args["--store"]);
  try {
    if (command === "adopt") return org.adopt(store, compiled, organization);
    if (command === "status") return org.status(store, compiled, organization);
    if (command === "recover")
      return org.recover(store, compiled, organization, args["--trust-domain"]);
    const domainId = args["--trust-domain"],
      domain = compiled.domains.get(domainId);
    if (!domain) throw Error("unknown-trust-domain");
    if (Boolean(args["--initialize"]) !== Boolean(args["--bootstrap"]))
      throw Error("explicit-bootstrap-initialization-required");
    if (!args["--repository"] && !domain.mirror)
      throw Error("approved-mirror-or-repository-required");
    // Validate the explicit initialization anchor before creating any state.
    let bootstrap;
    if (args["--bootstrap"]) {
      const fd = fs.openSync(
        args["--bootstrap"],
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const s = fs.fstatSync(fd);
        if (!s.isFile() || s.size > 500000) throw Error("invalid-bootstrap");
        bootstrap = new TextDecoder("utf-8", { fatal: true }).decode(
          fs.readFileSync(fd),
        );
      } finally {
        fs.closeSync(fd);
      }
      if (sha256(bootstrap) !== domain.bootstrapRootDigest)
        throw Error("bootstrap-pin-mismatch");
    }
    const pending = org.beginRefresh(
      store,
      compiled,
      organization,
      domainId,
      Boolean(args["--initialize"]),
    );
    bootstrap ??= pending.previous.repository.bootstrapRoot;
    const previous = pending.previous
      ? { ...pending.previous, floor: pending.floor }
      : {
          repository: { bootstrapRoot: bootstrap, roots: [] },
          floor: pending.floor,
        };
    let state;
    try {
      // A selected repository read/parse failure is a failed refresh, too.
      const repository = args["--repository"]
        ? org.readJSON(args["--repository"], 4000000)
        : await fetchRepository(
            domain.mirror,
            previous,
            bootstrap,
            domain.bootstrapRootDigest,
          );
      if (repository.bootstrapRoot !== bootstrap)
        throw Error("bootstrap-changed");
      const verified = tuf.verifyRepository(
        repository,
        domain.bootstrapRootDigest,
        Date.now(),
        pending.floor,
      );
      state = {
        schemaVersion: "1",
        bootstrapRootDigest: domain.bootstrapRootDigest,
        ...tuf.applyProgress(previous, repository, verified),
        lastAttempt: {
          status: verified.status,
          reason: verified.reason,
          checkedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      const partial = error.repository
        ? tuf.applyProgress(
            previous,
            error.repository,
            tuf.verifyRepository(
              { ...error.repository, target: null },
              domain.bootstrapRootDigest,
              Date.now(),
              pending.floor,
            ),
          )
        : previous;
      state = {
        schemaVersion: "1",
        bootstrapRootDigest: domain.bootstrapRootDigest,
        repository: partial.repository,
        floor: partial.floor,
        lastAttempt: {
          status: "rejected",
          reason: "organization-trust-refresh-failed",
          checkedAt: new Date().toISOString(),
        },
      };
    }
    const result = org.finishRefresh(
      store,
      compiled,
      organization,
      domainId,
      pending.lease,
      state,
    );
    if (result.status !== "verified") process.exitCode = 2;
    return result;
  } finally {
    store.close();
  }
}
main()
  .then((result) => {
    if (result) process.stdout.write(JSON.stringify(result) + "\n");
  })
  .catch((error) => {
    process.stderr.write(
      "Organization trust rejected: " +
        (/^[a-z][a-z0-9-]+$/.test(error.message)
          ? error.message
          : "store-or-input-unavailable") +
        ". No cached success fallback.\n",
    );
    process.exitCode = 2;
  });
