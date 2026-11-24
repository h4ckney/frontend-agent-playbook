"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const core = require("./organization-trust.cjs");

const MAX = 24_000_000;
const hash = (value) =>
  "sha256:" +
  crypto.createHash("sha256").update(core.canonical(value)).digest("hex");
const digest = (value) =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const credential = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value);
const exact = (v, keys) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
function fail(code) {
  throw Error(code);
}

function validateConfig(config) {
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).some(
      (k) =>
        ![
          "url",
          "publicKey",
          "readTokenFile",
          "writeTokenFile",
          "caFile",
        ].includes(k),
    ) ||
    typeof config.url !== "string" ||
    config.url.length > 2048 ||
    typeof config.publicKey !== "string" ||
    config.publicKey.length > 2000 ||
    typeof config.readTokenFile !== "string" ||
    !path.isAbsolute(config.readTokenFile) ||
    ["writeTokenFile", "caFile"].some(
      (k) =>
        config[k] !== undefined &&
        (typeof config[k] !== "string" || !path.isAbsolute(config[k])),
    )
  )
    fail("invalid-remote-witness-config");
  const url = new URL(config.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/v1/checkpoint" ||
    crypto.createPublicKey(config.publicKey).asymmetricKeyType !== "ed25519"
  )
    fail("invalid-remote-witness-config");
}

function validateHead(head, scope) {
  if (
    !exact(head, [
      "storeId",
      "authorityDigest",
      "sequence",
      "activeRoot",
      "stateDigest",
      "previousCheckpoint",
      "checkpointDigest",
      "logical",
    ]) ||
    head.storeId !== scope.storeId ||
    head.authorityDigest !== scope.authorityDigest ||
    !Number.isSafeInteger(head.sequence) ||
    head.sequence < 1 ||
    typeof head.activeRoot !== "string" ||
    !path.isAbsolute(head.activeRoot) ||
    !digest(head.stateDigest) ||
    !digest(head.checkpointDigest) ||
    (head.sequence === 1
      ? head.previousCheckpoint !== null
      : !digest(head.previousCheckpoint)) ||
    typeof head.logical !== "string" ||
    Buffer.byteLength(head.logical) > 16_000_000
  )
    fail("remote-witness-invalid-checkpoint");
  const { checkpointDigest, logical, ...header } = head;
  const state = JSON.parse(logical);
  if (
    hash(header) !== checkpointDigest ||
    hash(state) !== head.stateDigest ||
    state.schemaVersion !== 3 ||
    !Array.isArray(state.binding) ||
    state.binding.length !== 1 ||
    state.binding[0].storeId !== scope.storeId ||
    state.binding[0].authorityDigest !== scope.authorityDigest ||
    !Array.isArray(state.organizations) ||
    state.organizations.length > 1 ||
    !Array.isArray(state.domains) ||
    state.domains.length > 16 ||
    !Array.isArray(state.receipts) ||
    state.receipts.length > 256
  )
    fail("remote-witness-invalid-checkpoint");
  return state;
}

function preserveHistory(before, after) {
  for (const prior of before.organizations) {
    const next = after.organizations.find((row) => row.id === prior.id);
    if (
      !next ||
      next.revision < prior.revision ||
      next.generation < prior.generation ||
      (next.revision === prior.revision && next.digest !== prior.digest)
    )
      fail("remote-witness-history-regression");
  }
  for (const prior of before.domains) {
    const next = after.domains.find(
      (row) => row.org === prior.org && row.id === prior.id,
    );
    if (!next || next.anchor !== prior.anchor)
      fail("remote-witness-history-regression");
    const floor = JSON.parse(next.checkpoint);
    if (
      core.canonical(core.mergeFloors(floor, JSON.parse(prior.checkpoint))) !==
      core.canonical(floor)
    )
      fail("remote-witness-history-regression");
  }
  for (const prior of before.receipts)
    if (
      !after.receipts.some(
        (row) =>
          row.requestId === prior.requestId && row.bundle === prior.bundle,
      )
    )
      fail("remote-witness-history-regression");
}

const signingBytes = (receipt) =>
  Buffer.from("frontend-remote-witness-v1\n" + core.canonical(receipt));

function readPrivate(file, max, privateFile) {
  const fd = fs.openSync(
    privateFile(file),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    if (fs.fstatSync(fd).size > max)
      fail("remote-witness-config-file-too-large");
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function post(url, token, ca, payload) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > MAX) fail("remote-witness-request-too-large");
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        ca,
        rejectUnauthorized: true,
        agent: false,
        signal: AbortSignal.timeout(5000),
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
        },
      },
      async (response) => {
        try {
          if (response.statusCode !== 200) {
            response.destroy();
            fail(
              response.statusCode === 409
                ? "remote-witness-conflict"
                : "remote-witness-unavailable",
            );
          }
          const chunks = [];
          let size = 0;
          for await (const chunk of response) {
            size += chunk.length;
            if (size > MAX) fail("remote-witness-response-too-large");
            chunks.push(chunk);
          }
          resolve(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks),
              ),
            ),
          );
        } catch (error) {
          reject(error);
        }
      },
    );
    req.on("error", () => reject(Error("remote-witness-unavailable")));
    req.end(body);
  });
}

async function call(c, privateFile, next, { writeProbe = false } = {}) {
  const config = c.a.remoteWitness;
  const file =
    next || writeProbe ? config.writeTokenFile : config.readTokenFile;
  if (!file) fail("remote-witness-write-credential-required");
  const token = readPrivate(file, 256, privateFile).toString("utf8").trim();
  if (!credential(token)) fail("invalid-remote-witness-credential");
  const ca = config.caFile
    ? readPrivate(config.caFile, 65536, privateFile)
    : undefined;
  const scope = { storeId: c.a.storeId, authorityDigest: c.digest };
  const nonce = crypto.randomBytes(32).toString("hex");
  let reply;
  try {
    reply = await post(config.url, token, ca, {
      ...scope,
      nonce,
      ...(next ? { next } : {}),
      ...(writeProbe ? { writeProbe: true } : {}),
    });
  } catch (error) {
    if (/^remote-witness-(?:conflict|response-too-large)$/.test(error.message))
      throw error;
    fail("remote-witness-response-missing");
  }
  if (
    !exact(reply, ["receipt", "signature"]) ||
    !exact(reply.receipt, [
      "storeId",
      "authorityDigest",
      "nonce",
      "head",
      ...(writeProbe ? ["writeAuthorized"] : []),
    ]) ||
    (writeProbe && reply.receipt.writeAuthorized !== true) ||
    reply.receipt.storeId !== scope.storeId ||
    reply.receipt.authorityDigest !== scope.authorityDigest ||
    reply.receipt.nonce !== nonce ||
    typeof reply.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(reply.signature) ||
    !crypto.verify(
      null,
      signingBytes(reply.receipt),
      config.publicKey,
      Buffer.from(reply.signature, "base64"),
    )
  )
    fail("remote-witness-response-invalid");
  const { head } = reply.receipt;
  if (head === null && !next) return null;
  validateHead(head, scope);
  if (next && head.checkpointDigest !== next.checkpointDigest)
    fail("remote-witness-conflict");
  return head;
}

module.exports = {
  MAX,
  exact,
  digest,
  uuid,
  credential,
  validateConfig,
  validateHead,
  preserveHistory,
  signingBytes,
  call,
};
