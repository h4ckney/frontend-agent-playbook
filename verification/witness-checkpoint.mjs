import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { protectedPath } = require("./organization-trust.cjs");
const protocol = require("./remote-witness.cjs");

export function openCheckpoint(
  directory,
  historyRoot,
  scope,
  { initialize, seed }
) {
  const root = protectedPath(directory, initialize);
  if (
    root === historyRoot ||
    root.startsWith(historyRoot + path.sep) ||
    historyRoot.startsWith(root + path.sep)
  )
    throw Error("witness-checkpoint-location-overlaps-history");

  const file = path.join(root, "checkpoint.sqlite");
  if (initialize) fs.closeSync(fs.openSync(file, "wx", 0o600));
  function stat() {
    const s = fs.lstatSync(file);
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.nlink !== 1
    )
      throw Error("witness-checkpoint-storage-permissions");
    return s;
  }
  const identity = stat();
  const db = new DatabaseSync(file, { allowExtension: false });
  try {
    db.exec(
      "PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;"
    );
    if (initialize) {
      db.exec(
        "BEGIN IMMEDIATE; CREATE TABLE identity(storeId TEXT, authorityDigest TEXT); CREATE TABLE checkpoint(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);"
      );
      db.prepare("INSERT INTO identity VALUES(?,?)").run(
        scope.storeId,
        scope.authorityDigest
      );
      db.prepare("INSERT INTO checkpoint VALUES(1,?)").run(
        JSON.stringify(seed ?? null)
      );
      db.exec("COMMIT");
    }
    const id = db.prepare("SELECT * FROM identity").get();
    if (
      id?.storeId !== scope.storeId ||
      id.authorityDigest !== scope.authorityDigest
    )
      throw Error("witness-checkpoint-scope-mismatch");
    const select = db.prepare("SELECT body FROM checkpoint WHERE id=1");
    const update = db.prepare("UPDATE checkpoint SET body=? WHERE id=1");
    function current() {
      const present = stat();
      if (present.dev !== identity.dev || present.ino !== identity.ino)
        throw Error("witness-checkpoint-storage-replaced");
      const row = select.get();
      if (!row) throw Error("witness-checkpoint-missing");
      const head = JSON.parse(row.body);
      if (head !== null) {
        if (!protocol.digest(head?.authorityDigest))
          throw Error("witness-checkpoint-scope-mismatch");
        protocol.validateHead(head, {
          ...scope,
          authorityDigest: head.authorityDigest,
        });
      }
      return head;
    }
    return {
      current,
      advance(previous, next) {
        db.exec("BEGIN IMMEDIATE");
        try {
          if (!sameCheckpoint(previous, current()))
            throw Error("witness-checkpoint-history-mismatch");
          update.run(JSON.stringify(next));
          db.exec("COMMIT");
        } catch (error) {
          if (db.isTransaction) db.exec("ROLLBACK");
          throw error;
        }
      },
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function sameCheckpoint(a, b) {
  return (
    a?.sequence === b?.sequence && a?.checkpointDigest === b?.checkpointDigest
  );
}
