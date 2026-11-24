#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { openCheckpoint, sameCheckpoint } from "./witness-checkpoint.mjs";

const require = createRequire(import.meta.url);
const protocol = require("./remote-witness.cjs");
const core = require("./organization-trust.cjs");
const {
  verifyWitnessRotation,
  verifyWitnessWrite,
} = require("./organization-governance.cjs");

// An instance serves one preconfigured store and never resets its append history.
export function createWitness({
  directory,
  scope,
  readToken,
  writeToken,
  signingKey,
  tls,
  initialize = false,
  checkpointDirectory,
  bindCheckpoint,
  repairCheckpoint = false,
}) {
  if (
    !protocol.uuid(scope.storeId) ||
    !protocol.digest(scope.authorityDigest) ||
    !protocol.credential(readToken) ||
    !protocol.credential(writeToken) ||
    readToken === writeToken ||
    (checkpointDirectory !== undefined &&
      (typeof checkpointDirectory !== "string" ||
        !path.isAbsolute(checkpointDirectory))) ||
    ((bindCheckpoint !== undefined || repairCheckpoint) &&
      (!checkpointDirectory || initialize)) ||
    (bindCheckpoint !== undefined &&
      (!protocol.digest(bindCheckpoint) || repairCheckpoint)) ||
    crypto.createPrivateKey(signingKey).asymmetricKeyType !== "ed25519"
  )
    throw Error("invalid-witness-service-config");
  const root = core.protectedPath(directory, initialize);
  const file = path.join(root, "history.sqlite");
  if (initialize) fs.closeSync(fs.openSync(file, "wx", 0o600));
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077 ||
    stat.nlink !== 1
  )
    throw Error("invalid-witness-service-storage");
  const db = new DatabaseSync(file, { allowExtension: false });
  let checkpoint;
  try {
    db.exec(
      "PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;",
    );
    if (initialize) {
      db.exec(
        "BEGIN IMMEDIATE; CREATE TABLE identity(storeId TEXT, authorityDigest TEXT); CREATE TABLE history(sequence INTEGER PRIMARY KEY, body TEXT NOT NULL);",
      );
      db.prepare("INSERT INTO identity VALUES(?,?)").run(
        scope.storeId,
        scope.authorityDigest,
      );
      db.exec("COMMIT;");
    }
    const id = db.prepare("SELECT * FROM identity").get();
    if (
      id?.storeId !== scope.storeId ||
      id.authorityDigest !== scope.authorityDigest
    )
      throw Error("witness-service-scope-mismatch");
    const latest = db.prepare(
      "SELECT sequence, body FROM history ORDER BY sequence DESC LIMIT 1"
    );
    const insert = db.prepare("INSERT INTO history VALUES(?,?)");
    const local = () => {
      const row = latest.get();
      if (!row) return null;
      const head = JSON.parse(row.body);
      if (head?.sequence !== row.sequence)
        throw Error("witness-history-sequence-mismatch");
      return head;
    };
    const checkpointRequired = () =>
      !!db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='independent_checkpoint'"
        )
        .get();
    if (checkpointRequired() && !checkpointDirectory)
      throw Error("witness-checkpoint-config-required");
    if (checkpointDirectory) {
      db.exec("BEGIN IMMEDIATE");
      const previous = local();
      if (
        bindCheckpoint !== undefined &&
        previous?.checkpointDigest !== bindCheckpoint
      )
        throw Error("witness-checkpoint-bind-head-mismatch");
      if (previous)
        protocol.validateHead(previous, {
          storeId: scope.storeId,
          authorityDigest: previous.authorityDigest,
        });
      if (bindCheckpoint !== undefined) {
        // An interrupted bind can resume against the existing, already initialized anchor.
        const missing = !fs.existsSync(
          path.join(checkpointDirectory, "checkpoint.sqlite")
        );
        if (missing && checkpointRequired())
          throw Error("witness-checkpoint-missing");
        checkpoint = openCheckpoint(checkpointDirectory, root, scope, {
          initialize: missing,
          seed: previous,
        });
      } else {
        checkpoint = openCheckpoint(checkpointDirectory, root, scope, {
          initialize,
        });
      }
      const pinned = checkpoint.current();
      if (!sameCheckpoint(previous, pinned)) {
        if (
          !repairCheckpoint ||
          !pinned ||
          pinned.sequence !== (previous?.sequence ?? 0) + 1 ||
          pinned.previousCheckpoint !== (previous?.checkpointDigest ?? null)
        )
          throw Error("witness-checkpoint-history-mismatch");
        insert.run(pinned.sequence, JSON.stringify(pinned));
      }
      db.exec(
        "CREATE TABLE IF NOT EXISTS independent_checkpoint(required INTEGER)"
      );
      db.exec("COMMIT");
    }
    const current = () => {
      const head = local();
      if (checkpoint && !sameCheckpoint(head, checkpoint.current()))
        throw Error("witness-checkpoint-history-mismatch");
      if (head)
        protocol.validateHead(head, {
          storeId: scope.storeId,
          authorityDigest: head.authorityDigest,
        });
      return head;
    };

    async function append(
      next,
      requestedScope,
      { rotation, authority, migration }
    ) {
      const targetScope = rotation
        ? { ...requestedScope, authorityDigest: next.authorityDigest }
        : requestedScope;
      const state = protocol.validateHead(next, targetScope);
      const old = current();
      const active = old?.authorityDigest ?? scope.authorityDigest;
      if (rotation && old?.checkpointDigest === next.checkpointDigest) {
        // A lost response may be retried with the old authority only for this exact transition.
        const applied = state.receipts.some((row) => {
          const b = JSON.parse(row.bundle);
          return (
            ["rotate", "recover-quorum"].includes(b.request.action) &&
            b.request.authorityDigest === requestedScope.authorityDigest &&
            b.request.destinationAuthorityDigest === active &&
            b.request.checkpointDigest === next.previousCheckpoint
          );
        });
        if (!applied) throw Error("witness-conflict");
        return old;
      }
      if (requestedScope.authorityDigest !== active)
        throw Error("witness-conflict");
      if (old?.checkpointDigest === next.checkpointDigest) return old;
      if (
        next.sequence !== (old?.sequence ?? 0) + 1 ||
        next.previousCheckpoint !== (old?.checkpointDigest ?? null)
      )
        throw Error("witness-conflict");
      if (rotation) {
        if (!old || targetScope.authorityDigest === active)
          throw Error("witness-conflict");
        verifyWitnessRotation(old, next, requestedScope, targetScope);
      } else {
        await verifyWitnessWrite(
          old,
          next,
          requestedScope,
          state,
          authority,
          migration
        );
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const live = current();
        if (live?.checkpointDigest !== old?.checkpointDigest) {
          if (live?.checkpointDigest !== next.checkpointDigest)
            throw Error("witness-conflict");
        } else {
          insert.run(next.sequence, JSON.stringify(next));
          // Keep the independently durable checkpoint ahead if the history commit is interrupted.
          checkpoint?.advance(live, next);
        }
        db.exec("COMMIT");
        return next;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }

    const tokenMatches = (actual, expected) => {
      const a = Buffer.from(actual ?? ""),
        b = Buffer.from("Bearer " + expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    };
    const server = https.createServer(
      {
        ...tls,
        minVersion: "TLSv1.2",
        requestTimeout: 6000,
        headersTimeout: 5000,
      },
      async (req, res) => {
        res.setHeader("cache-control", "no-store");
        try {
          if (req.url !== "/v1/checkpoint" || req.method !== "POST") {
            res.writeHead(404).end();
            return;
          }
          const canWrite = tokenMatches(req.headers.authorization, writeToken);
          if (
            !canWrite &&
            !tokenMatches(req.headers.authorization, readToken)
          ) {
            res.writeHead(401).end();
            return;
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > protocol.MAX) {
              req.destroy();
              return;
            }
            chunks.push(chunk);
          }
          const body = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          );
          const write = Object.hasOwn(body, "next");
          const probe = Object.hasOwn(body, "writeProbe");
          const rotation = Object.hasOwn(body, "rotation");
          const migration = Object.hasOwn(body, "migration");
          if (
            !protocol.exact(body, [
              "storeId",
              "authorityDigest",
              "nonce",
              ...(write ? ["next"] : []),
              ...(probe ? ["writeProbe"] : []),
              ...(rotation ? ["rotation"] : []),
              ...(write && !rotation ? ["authority"] : []),
              ...(migration ? ["migration"] : []),
            ]) ||
            body.storeId !== scope.storeId ||
            !protocol.digest(body.authorityDigest) ||
            (rotation && (!write || body.rotation !== true)) ||
            (migration && (!write || rotation || body.next?.sequence !== 1)) ||
            typeof body.nonce !== "string" ||
            !/^[a-f0-9]{64}$/.test(body.nonce) ||
            (probe && (write || body.writeProbe !== true)) ||
            ((write || probe) && !canWrite)
          ) {
            res.writeHead(403).end();
            return;
          }
          const requestedScope = {
            storeId: scope.storeId,
            authorityDigest: body.authorityDigest,
          };
          const head = write
            ? await append(body.next, requestedScope, body)
            : current();
          if (
            !write &&
            requestedScope.authorityDigest !==
              (head?.authorityDigest ?? scope.authorityDigest)
          ) {
            res.writeHead(403).end();
            return;
          }
          const receipt = {
            ...requestedScope,
            nonce: body.nonce,
            head,
            ...(probe ? { writeAuthorized: true } : {}),
          };
          const signature = crypto
            .sign(null, protocol.signingBytes(receipt), signingKey)
            .toString("base64");
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ receipt, signature }));
        } catch (error) {
          res
            .writeHead(
              error.message === "witness-conflict" ||
                error.message === "witness-checkpoint-history-mismatch" ||
                error.message === "remote-witness-history-regression"
                ? 409
                : 400,
            )
            .end();
        }
      },
    );
    server.setTimeout(8000, (socket) => socket.destroy());
    server.once("close", () => {
      checkpoint?.close();
      db.close();
    });
    return server;
  } catch (error) {
    checkpoint?.close();
    db.close();
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [file, ...flags] = process.argv.slice(2);
    if (
      !file ||
      (flags.length !== 0 &&
        !(
          flags.length === 1 &&
          ["--initialize", "--repair-checkpoint"].includes(flags[0])
        ) &&
        !(
          flags.length === 2 &&
          flags[0] === "--bind-checkpoint" &&
          protocol.digest(flags[1])
        ))
    )
      throw Error(
        "usage: remote-witness-server.mjs CONFIG.json [--initialize | --bind-checkpoint DIGEST | --repair-checkpoint]"
      );
    const read = (p) => {
      const full = path.resolve(p);
      core.protectedPath(path.dirname(full));
      const fd = fs.openSync(
        full,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const s = fs.fstatSync(fd);
        if (
          !s.isFile() ||
          s.uid !== process.getuid() ||
          s.mode & 0o077 ||
          s.nlink !== 1 ||
          s.size > 65536
        )
          throw Error("witness-service-config-permissions");
        return fs.readFileSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    };
    const c = JSON.parse(read(file));
    if (
      typeof c.host !== "string" ||
      !Number.isSafeInteger(c.port) ||
      c.port < 1 ||
      c.port > 65535
    )
      throw Error("invalid-witness-service-address");
    const server = createWitness({
      directory: c.directory,
      scope: { storeId: c.storeId, authorityDigest: c.authorityDigest },
      readToken: read(c.readTokenFile).toString().trim(),
      writeToken: read(c.writeTokenFile).toString().trim(),
      signingKey: read(c.signingKeyFile),
      tls: { key: read(c.tlsKeyFile), cert: read(c.tlsCertificateFile) },
      checkpointDirectory: c.checkpointDirectory,
      initialize: flags[0] === "--initialize",
      bindCheckpoint: flags[0] === "--bind-checkpoint" ? flags[1] : undefined,
      repairCheckpoint: flags[0] === "--repair-checkpoint",
    });
    server.on("error", () => {
      process.stderr.write("Witness listener failed.\n");
      process.exitCode = 2;
    });
    server.listen(c.port, c.host, () =>
      process.stdout.write("Remote witness ready.\n"),
    );
  } catch (error) {
    const reason = /^witness-checkpoint-[a-z-]+$/.test(error.message)
      ? ` (${error.message})`
      : "";
    process.stderr.write(
      `Remote witness startup rejected${reason}. Check configuration and private storage.\n`
    );
    process.exitCode = 2;
  }
}
