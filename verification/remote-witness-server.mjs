#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const protocol = require("./remote-witness.cjs");
const core = require("./organization-trust.cjs");

// An instance serves one preconfigured store and never resets its append history.
export function createWitness({
  directory,
  scope,
  readToken,
  writeToken,
  signingKey,
  tls,
  initialize = false,
}) {
  if (
    !protocol.uuid(scope.storeId) ||
    !protocol.digest(scope.authorityDigest) ||
    !protocol.credential(readToken) ||
    !protocol.credential(writeToken) ||
    readToken === writeToken ||
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
      "SELECT body FROM history ORDER BY sequence DESC LIMIT 1",
    );
    const insert = db.prepare("INSERT INTO history VALUES(?,?)");
    const current = () => JSON.parse(latest.get()?.body ?? "null");

    function append(next) {
      const state = protocol.validateHead(next, scope);
      db.exec("BEGIN IMMEDIATE");
      try {
        const old = current();
        if (old?.checkpointDigest !== next.checkpointDigest) {
          if (
            next.sequence !== (old?.sequence ?? 0) + 1 ||
            next.previousCheckpoint !== (old?.checkpointDigest ?? null)
          )
            throw Error("witness-conflict");
          if (old)
            protocol.preserveHistory(protocol.validateHead(old, scope), state);
          insert.run(next.sequence, JSON.stringify(next));
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
          if (
            !protocol.exact(body, [
              "storeId",
              "authorityDigest",
              "nonce",
              ...(write ? ["next"] : []),
            ]) ||
            body.storeId !== scope.storeId ||
            body.authorityDigest !== scope.authorityDigest ||
            typeof body.nonce !== "string" ||
            !/^[a-f0-9]{64}$/.test(body.nonce) ||
            (write && !canWrite)
          ) {
            res.writeHead(403).end();
            return;
          }
          const head = write ? append(body.next) : current();
          const receipt = { ...scope, nonce: body.nonce, head };
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
                error.message === "remote-witness-history-regression"
                ? 409
                : 400,
            )
            .end();
        }
      },
    );
    server.setTimeout(8000, (socket) => socket.destroy());
    server.once("close", () => db.close());
    return server;
  } catch (error) {
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
      flags.length > 1 ||
      (flags.length && flags[0] !== "--initialize")
    )
      throw Error(
        "usage: remote-witness-server.mjs CONFIG.json [--initialize]",
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
      initialize: flags.length === 1,
    });
    server.on("error", () => {
      process.stderr.write("Witness listener failed.\n");
      process.exitCode = 2;
    });
    server.listen(c.port, c.host, () =>
      process.stdout.write("Remote witness ready.\n"),
    );
  } catch (error) {
    process.stderr.write(
      "Remote witness startup rejected. Check configuration and private storage.\n",
    );
    process.exitCode = 2;
  }
}
