import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import {
  governanceFixture,
  approve,
  enroll,
  core,
  g,
} from "./governance-evidence.mjs";
import { createWitness } from "../../verification/remote-witness-server.mjs";

const require = createRequire(import.meta.url);
const tuf = require("../../verification/sigstore-tuf.cjs");
const protocol = require("../../verification/remote-witness.cjs");

if (process.send) {
  process.once("message", async ({ options }) => {
    try {
      const server = createWitness(options);
      process.send({ port: await listen(server) });
    } catch (error) {
      process.send({ error: error.message }, () => process.exit(1));
    }
  });
  process.once("disconnect", () => process.exit());
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
async function close(server) {
  if (server?.listening) {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

export async function remoteFixture({
  legacy = false,
  subprocess = false,
  anchored = false,
} = {}) {
  const x = await governanceFixture();
  const removeFixture = x.cleanup;
  let service, worker, proxy;
  const stopService = async () => {
    await close(service);
    if (worker?.exitCode === null && worker.signalCode === null) {
      const stopped = once(worker, "exit");
      worker.kill();
      await stopped;
    }
  };
  const cleanup = async () => {
    await close(proxy);
    await stopService();
    removeFixture();
  };
  try {
    const tlsKey = path.join(x.keys, "transport.pem"),
      tlsCert = path.join(x.config, "transport.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "2",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        tlsKey,
        "-out",
        tlsCert,
      ],
      { stdio: "ignore" },
    );
    fs.chmodSync(tlsCert, 0o600);
    const tls = {
      key: fs.readFileSync(tlsKey),
      cert: fs.readFileSync(tlsCert),
    };
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const signingKey = privateKey.export({ type: "pkcs8", format: "pem" });
    const readToken = crypto.randomBytes(32).toString("base64url");
    const writeToken = crypto.randomBytes(32).toString("base64url");
    const readTokenFile = path.join(x.keys, "read-token"),
      writeTokenFile = path.join(x.keys, "write-token");
    fs.writeFileSync(readTokenFile, readToken, { mode: 0o600 });
    fs.writeFileSync(writeTokenFile, writeToken, { mode: 0o600 });

    let servicePort, lastResponse;
    x.intercept = null;
    proxy = https.createServer(tls, async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      const request = JSON.parse(data);
      if (x.intercept?.({ request, stage: "before", res, lastResponse }))
        return;
      const upstream = https.request(
        {
          host: "127.0.0.1",
          port: servicePort,
          path: req.url,
          method: "POST",
          ca: tls.cert,
          headers: req.headers,
        },
        async (result) => {
          const parts = [];
          for await (const chunk of result) parts.push(chunk);
          const bytes = Buffer.concat(parts);
          if (
            x.intercept?.({ request, stage: "after", res, bytes, lastResponse })
          )
            return;
          lastResponse = bytes;
          res.writeHead(result.statusCode, result.headers).end(bytes);
        },
      );
      upstream.on("error", () => res.destroy());
      upstream.end(data);
    });
    const port = await listen(proxy);
    const remoteAuthority = {
      ...x.a,
      remoteWitness: {
        url: `https://127.0.0.1:${port}/v1/checkpoint`,
        publicKey: publicKey.export({ type: "spki", format: "pem" }),
        readTokenFile,
        writeTokenFile,
        caFile: tlsCert,
      },
    };
    x.remoteAuthority = legacy
      ? path.join(x.config, "remote-authority.json")
      : x.authority;
    fs.writeFileSync(x.remoteAuthority, JSON.stringify(remoteAuthority), {
      mode: 0o600,
    });
    x.selectRemote = () => {
      x.a = remoteAuthority;
      x.authority = x.remoteAuthority;
    };
    if (!legacy) x.selectRemote();
    const { storeId, authorityDigest } = g.authorityInfo(x.remoteAuthority);
    const directory = path.join(x.dir, "off-host-storage");
    const options = {
      directory,
      scope: { storeId, authorityDigest },
      readToken,
      writeToken,
      signingKey,
      ...(anchored
        ? { checkpointDirectory: path.join(x.dir, "independent-checkpoint") }
        : {}),
      tls,
    };
    x.witnessOptions = options;
    x.stopService = stopService;
    x.startService = async (overrides) => {
      const config = { ...options, ...overrides };
      if (subprocess) {
        worker = fork(new URL(import.meta.url), [], {
          serialization: "advanced",
          execArgv: [],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const result = Promise.race([
          once(worker, "message").then(([message]) => message),
          once(worker, "exit").then(() => ({ error: "witness-worker-exited" })),
        ]);
        worker.send({ options: config });
        const { port, error } = await result;
        if (error) throw Error(error);
        servicePort = port;
      } else {
        service = createWitness(config);
        servicePort = await listen(service);
      }
    };
    await x.startService({ initialize: true });
    x.restart = async () => {
      await stopService();
      await x.startService();
    };
    x.withStore = async (fn) => {
      const s = g.open(x.root, x.authority);
      try {
        return await fn(s);
      } finally {
        s.close();
      }
    };
    x.initialize = async () => {
      await enroll(x);
      const approval = approve(
        x,
        await g.planAdopt(x.root, x.authority, x.compiled),
      );
      await x.withStore((s) =>
        core.adopt(s, x.compiled, x.a.organizationId, approval),
      );
      await x.refresh(x.f.make(), true);
    };
    x.begin = (initialize = false) =>
      x.withStore((s) =>
        core.beginRefresh(
          s,
          x.compiled,
          x.a.organizationId,
          "public",
          initialize,
        ),
      );
    x.finish = (pending, repository) =>
      x.withStore((s) => {
        const verified = tuf.verifyRepository(
          repository,
          x.f.pin,
          Date.now(),
          pending.floor,
        );
        const previous = pending.previous ?? {
          repository,
          floor: pending.floor,
        };
        return core.finishRefresh(
          s,
          x.compiled,
          x.a.organizationId,
          "public",
          pending.lease,
          {
            schemaVersion: "1",
            bootstrapRootDigest: x.f.pin,
            ...tuf.applyProgress(previous, repository, verified),
            lastAttempt: {
              status: verified.status,
              reason: verified.reason,
              checkedAt: new Date().toISOString(),
            },
          },
        );
      });
    x.refresh = async (repository, initialize = false) =>
      x.finish(await x.begin(initialize), repository);
    x.snapshot = () =>
      x.withStore((s) =>
        core.snapshot(s, x.compiled, x.a.organizationId, "frontend-main"),
      );
    x.status = () =>
      x.withStore((s) => core.status(s, x.compiled, x.a.organizationId));
    x.inspect = () => g.inspect(x.authority);
    x.sendCheckpoint = (head, options) =>
      protocol.call(
        { a: x.a, digest: g.authorityInfo(x.authority).authorityDigest },
        (file) => file,
        head,
        options
      );
    x.reconcile = () => g.reconcile(x.root, x.authority);
    x.restore = async (target) => {
      const planned = await g.planRestore(x.authority, target);
      return g.restore(x.authority, target, approve(x, planned));
    };
    x.capture = () => [
      [
        path.join(x.root, "trust-store.sqlite"),
        fs.readFileSync(path.join(x.root, "trust-store.sqlite")),
      ],
      [
        path.join(x.a.witnessDirectory, "witness.sqlite"),
        fs.readFileSync(path.join(x.a.witnessDirectory, "witness.sqlite")),
      ],
    ];
    x.rewind = (copy) => {
      for (const [file, bytes] of copy) fs.writeFileSync(file, bytes);
    };
    x.forkResponse = ({ stage, bytes, res }) => {
      if (stage !== "after") return false;
      const { receipt } = JSON.parse(bytes);
      const { logical, checkpointDigest, ...header } = receipt.head;
      header.activeRoot += "-fork";
      receipt.head = {
        ...header,
        logical,
        checkpointDigest:
          "sha256:" +
          crypto
            .createHash("sha256")
            .update(core.canonical(header))
            .digest("hex"),
      };
      const signature = crypto
        .sign(null, protocol.signingBytes(receipt), signingKey)
        .toString("base64");
      res.writeHead(200).end(JSON.stringify({ receipt, signature }));
      return true;
    };
    x.dropAppend = ({ request, stage, res }) => {
      if (stage !== "after" || !request.next) return false;
      res.destroy();
      return true;
    };
    x.cleanup = cleanup;
    return x;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
export { core, g };
