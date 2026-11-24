"use strict";
// Local POSIX witness; an independent restore boundary is an operator prerequisite.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  core = require("./organization-trust.cjs"),
  { sha256 } = require("../analysis/execution-evidence.js"),
  { DatabaseSync } = require("node:sqlite");
const remote = require("./remote-witness.cjs");
const permits = new WeakSet(),
  MAX = 16_000_000,
  canonical = core.canonical,
  clone = (v) => JSON.parse(JSON.stringify(v)),
  hash = (v) => sha256(canonical(v));
const fail = (code) => {
    throw Error(code);
  },
  object = (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  exact = (v, keys) =>
    object(v) && Object.keys(v).every((k) => keys.includes(k)),
  slug = (v) => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v),
  digest = (v) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v),
  uuid = (v) =>
    typeof v === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const relation = (a, b) =>
  a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
function privateFile(file) {
  const s = fs.lstatSync(file);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.uid !== process.getuid() ||
    s.mode & 0o077 ||
    s.nlink !== 1
  )
    fail("governance-file-permissions");
  core.protectedPath(path.dirname(file));
  return fs.realpathSync(file);
}
function authority(file) {
  const location = privateFile(path.resolve(file)),
    a = core.readJSON(location);
  if (
    !exact(a, [
      "schemaVersion",
      "storeId",
      "organizationId",
      "witnessDirectory",
      "threshold",
      "approvers",
      "remoteWitness",
    ]) ||
    a.schemaVersion !== "1" ||
    !uuid(a.storeId) ||
    !slug(a.organizationId) ||
    typeof a.witnessDirectory !== "string" ||
    !path.isAbsolute(a.witnessDirectory) ||
    !Number.isSafeInteger(a.threshold) ||
    a.threshold < 2 ||
    a.threshold > 8 ||
    !Array.isArray(a.approvers) ||
    a.approvers.length < a.threshold ||
    a.approvers.length > 8
  )
    fail("invalid-governance-authority");
  const ids = new Set(),
    keys = new Set(),
    roles = new Set();
  for (const r of a.approvers) {
    if (
      !exact(r, ["id", "role", "publicKey"]) ||
      !slug(r.id) ||
      ids.has(r.id) ||
      !["owner", "security"].includes(r.role) ||
      typeof r.publicKey !== "string" ||
      r.publicKey.length > 2000
    )
      fail("invalid-governance-approver");
    const k = crypto.createPublicKey(r.publicKey);
    if (k.asymmetricKeyType !== "ed25519") fail("invalid-governance-key");
    const fingerprint = crypto
      .createHash("sha256")
      .update(k.export({ format: "der", type: "spki" }))
      .digest("hex");
    if (keys.has(fingerprint)) fail("duplicate-governance-key");
    ids.add(r.id);
    keys.add(fingerprint);
    roles.add(r.role);
  }
  if (roles.size !== 2) fail("governance-roles-required");
  if (a.remoteWitness !== undefined) remote.validateConfig(a.remoteWitness);
  return { a, location, digest: hash(a) };
}
function permit() {
  const p = Object.freeze({});
  permits.add(p);
  return p;
}
const isPermit = (p) => permits.has(p);
function transaction(store, fn) {
  store.db.exec("BEGIN IMMEDIATE");
  const rollback = (error) => {
    if (store.db.isTransaction) store.db.exec("ROLLBACK");
    throw error;
  };
  const commit = (value) => {
    try {
      store.db.exec("COMMIT");
      return value;
    } catch (error) {
      return rollback(error);
    }
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.then(commit, rollback);
    return commit(result);
  } catch (error) {
    return rollback(error);
  }
}
function withStore(store, fn) {
  let result;
  try {
    result = fn();
  } catch (error) {
    store.close();
    throw error;
  }
  if (result instanceof Promise) return result.finally(() => store.close());
  store.close();
  return result;
}
function then(value, next) {
  return value instanceof Promise ? value.then(next) : next(value);
}
function hasBinding(store) {
  return !!store.db
    .prepare(
      "SELECT name FROM main.sqlite_master WHERE type='table' AND name='governance_binding'",
    )
    .get();
}
function storeVersion(store) {
  return store.db.prepare("PRAGMA main.user_version").get().user_version;
}
function dump(store) {
  const value = {
    schemaVersion: storeVersion(store),
    organizations: store.db
      .prepare("SELECT * FROM main.organizations ORDER BY id")
      .all(),
    domains: store.db
      .prepare("SELECT * FROM main.domains ORDER BY org,id")
      .all(),
    binding: hasBinding(store)
      ? store.db.prepare("SELECT * FROM main.governance_binding").all()
      : [],
    receipts: hasBinding(store)
      ? store.db
          .prepare("SELECT * FROM main.governance_receipts ORDER BY requestId")
          .all()
      : [],
  };
  assertLogicalBudget(value);
  return clone(value);
}
function assertLogicalBudget(value) {
  if (
    value.organizations.length > 1 ||
    value.domains.length > 16 ||
    value.receipts.length > 256 ||
    Buffer.byteLength(JSON.stringify(value)) > MAX
  )
    fail("governance-store-budget");
}
function assertDomain(a, logical) {
  if (
    logical.organizations.some((r) => r.id !== a.organizationId) ||
    logical.domains.some((r) => r.org !== a.organizationId)
  )
    fail("governance-organization-mismatch");
}
function quiescent(logical) {
  if (logical.domains.some((r) => r.lease !== null))
    fail("governance-refresh-in-progress");
}
function binding(store, c) {
  const b = store.db.prepare("SELECT * FROM main.governance_binding").all();
  if (
    b.length !== 1 ||
    b[0].storeId !== c.a.storeId ||
    b[0].authorityDigest !== c.digest
  )
    fail("governance-authority-mismatch");
}
function attach(store, c, create = false) {
  const root = core.protectedPath(c.a.witnessDirectory, create);
  if (relation(root, store.root) || relation(root, path.dirname(c.location)))
    fail("witness-must-be-independent");
  const file = path.join(root, "witness.sqlite");
  if (create) {
    if (fs.readdirSync(root).length) fail("witness-already-exists");
    const fd = fs.openSync(
      file,
      fs.constants.O_RDWR |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.closeSync(fd);
  } else privateFile(file);
  store.db.prepare("ATTACH DATABASE ? AS witness").run(file);
  if (create)
    store.db.exec(
      "PRAGMA witness.journal_mode=DELETE; PRAGMA witness.synchronous=FULL;",
    );
  if (
    store.db.prepare("PRAGMA main.journal_mode").get().journal_mode !==
      "delete" ||
    store.db.prepare("PRAGMA witness.journal_mode").get().journal_mode !==
      "delete"
  )
    fail("witness-rollback-journal-required");
  store.db.exec(
    "PRAGMA main.synchronous=FULL; PRAGMA witness.synchronous=FULL;",
  );
  return root;
}
const headSchema =
  "CREATE TABLE IF NOT EXISTS witness.head(id INTEGER PRIMARY KEY CHECK(id=1),storeId TEXT,authorityDigest TEXT,sequence INTEGER,activeRoot TEXT,stateDigest TEXT,previousCheckpoint TEXT,checkpointDigest TEXT,logical TEXT);";
function head(store, c, rootCheck = true) {
  const rows = store.db.prepare("SELECT * FROM witness.head").all();
  if (rows.length !== 1) fail("invalid-witness-head");
  const h = rows[0];
  if (
    h.storeId !== c.a.storeId ||
    h.authorityDigest !== c.digest ||
    !Number.isSafeInteger(h.sequence) ||
    h.sequence < 1 ||
    hash(JSON.parse(h.logical)) !== h.stateDigest ||
    checkpoint(h) !== h.checkpointDigest
  )
    fail("witness-integrity-rejected");
  if (rootCheck && h.activeRoot !== store.root)
    fail("witness-active-store-mismatch");
  return h;
}
function checkpoint(h) {
  return hash({
    storeId: h.storeId,
    authorityDigest: h.authorityDigest,
    sequence: h.sequence,
    activeRoot: h.activeRoot,
    stateDigest: h.stateDigest,
    previousCheckpoint: h.previousCheckpoint,
  });
}
function makeHead(store, c, previous, logical) {
  assertDomain(c.a, logical);
  const h = {
    storeId: c.a.storeId,
    authorityDigest: c.digest,
    sequence: previous ? previous.sequence + 1 : 1,
    activeRoot: store.root,
    stateDigest: hash(logical),
    previousCheckpoint: previous?.checkpointDigest || null,
  };
  if (!Number.isSafeInteger(h.sequence)) fail("witness-sequence-overflow");
  h.checkpointDigest = checkpoint(h);
  h.logical = JSON.stringify(logical);
  return h;
}
function writeHead(store, c, previous, logical) {
  const h = makeHead(store, c, previous, logical);
  saveHead(store, h);
  return h;
}
function saveHead(store, h) {
  store.db
    .prepare("INSERT OR REPLACE INTO witness.head VALUES(1,?,?,?,?,?,?,?,?)")
    .run(
      h.storeId,
      h.authorityDigest,
      h.sequence,
      h.activeRoot,
      h.stateDigest,
      h.previousCheckpoint,
      h.checkpointDigest,
      h.logical,
    );
}
async function remoteHead(c) {
  const h = await remote.call(c, privateFile);
  if (!h) fail("remote-witness-checkpoint-missing");
  return h;
}
function compareRemote(local, independent) {
  if (local.checkpointDigest === independent.checkpointDigest) return;
  if (local.sequence === independent.sequence)
    fail("remote-witness-sequence-conflict");
  if (local.sequence < independent.sequence)
    fail("remote-witness-local-behind");
  fail("remote-witness-history-regressed");
}
function check(store, c) {
  binding(store, c);
  const h = head(store, c),
    logical = dump(store);
  assertDomain(c.a, logical);
  if (hash(logical) !== h.stateDigest)
    fail("whole-store-rollback-or-tampering");
  return h;
}
function message(request) {
  return Buffer.from(
    "frontend-organization-approval-v1\n" + canonical(request),
  );
}
function validateRequest(c, b, action, now = Date.now()) {
  if (
    !exact(b, ["request", "review", "signatures"]) ||
    !exact(b.request, [
      "schemaVersion",
      "action",
      "requestId",
      "storeId",
      "organizationId",
      "authorityDigest",
      "issuedAt",
      "expiresAt",
      "reviewDigest",
      "stateDigest",
      "policyDigest",
      "policyRevision",
      "previousPolicyDigest",
      "checkpointDigest",
      "targetRoot",
      "backupDigest",
      "destinationAuthorityDigest",
    ]) ||
    !Array.isArray(b.signatures) ||
    b.signatures.length > 8
  )
    fail("invalid-governance-approval");
  const r = b.request,
    issued = Date.parse(r.issuedAt),
    expiry = Date.parse(r.expiresAt);
  if (
    r.schemaVersion !== "1" ||
    r.action !== action ||
    !uuid(r.requestId) ||
    r.storeId !== c.a.storeId ||
    r.organizationId !== c.a.organizationId ||
    r.authorityDigest !== c.digest ||
    r.reviewDigest !== hash(b.review) ||
    typeof r.issuedAt !== "string" ||
    typeof r.expiresAt !== "string" ||
    !Number.isFinite(issued) ||
    !Number.isFinite(expiry) ||
    new Date(issued).toISOString() !== r.issuedAt ||
    new Date(expiry).toISOString() !== r.expiresAt ||
    issued > now + 30000 ||
    expiry <= now ||
    expiry <= issued ||
    expiry - issued > 604800000
  )
    fail("approval-scope-or-time-rejected");
  const specific = {
    enroll: ["stateDigest"],
    adopt: ["policyDigest", "policyRevision", "previousPolicyDigest"],
    restore: ["checkpointDigest", "targetRoot", "backupDigest"],
    migrate: ["checkpointDigest", "targetRoot", "destinationAuthorityDigest"],
  }[action];
  if (
    !specific ||
    Object.keys(r).some(
      (k) =>
        ![
          "schemaVersion",
          "action",
          "requestId",
          "storeId",
          "organizationId",
          "authorityDigest",
          "issuedAt",
          "expiresAt",
          "reviewDigest",
          ...specific,
        ].includes(k),
    ) ||
    specific.some((k) => !Object.hasOwn(r, k))
  )
    fail("invalid-approval-action");
  if (
    action === "enroll" &&
    (!digest(r.stateDigest) || hash(b.review?.state) !== r.stateDigest)
  )
    fail("approval-review-mismatch");
  if (
    action === "adopt" &&
    (!digest(r.policyDigest) ||
      !Number.isSafeInteger(r.policyRevision) ||
      r.policyRevision < 1 ||
      (r.previousPolicyDigest !== null && !digest(r.previousPolicyDigest)) ||
      hash(b.review?.policy) !== r.policyDigest ||
      (b.review?.previousPolicy === null
        ? null
        : hash(b.review?.previousPolicy)) !== r.previousPolicyDigest)
  )
    fail("approval-review-mismatch");
  if (
    action === "restore" &&
    (!digest(r.checkpointDigest) ||
      typeof r.targetRoot !== "string" ||
      !path.isAbsolute(r.targetRoot) ||
      (r.backupDigest !== null && !digest(r.backupDigest)))
  )
    fail("approval-review-mismatch");
  if (
    action === "migrate" &&
    (c.a.remoteWitness ||
      !digest(r.checkpointDigest) ||
      !digest(r.destinationAuthorityDigest) ||
      typeof r.targetRoot !== "string" ||
      !path.isAbsolute(r.targetRoot))
  )
    fail("approval-migration-scope-invalid");
  if (action === "restore" && !c.a.remoteWitness) {
    const h = witness(c);
    if (
      h.checkpointDigest !== r.checkpointDigest ||
      canonical(b.review) !== canonical(restoreReview(h))
    )
      fail("approval-restore-review-mismatch");
  }
  return r;
}
function verifyApproval(c, b, action, threshold = true, at) {
  const r = validateRequest(c, b, action, at),
    seen = new Set(),
    roles = new Set();
  for (const s of b.signatures) {
    if (
      !exact(s, ["approverId", "signature"]) ||
      seen.has(s.approverId) ||
      typeof s.signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(s.signature)
    )
      fail("invalid-approval-signature");
    const approver = c.a.approvers.find((k) => k.id === s.approverId);
    if (
      !approver ||
      !crypto.verify(
        null,
        message(r),
        approver.publicKey,
        Buffer.from(s.signature, "base64"),
      )
    )
      fail("approval-signature-rejected");
    seen.add(s.approverId);
    roles.add(approver.role);
  }
  if (threshold && (seen.size < c.a.threshold || roles.size !== 2))
    fail("approval-threshold-not-met");
  return r;
}
function record(store, b) {
  if (
    store.db
      .prepare(
        "SELECT requestId FROM main.governance_receipts WHERE requestId=?",
      )
      .get(b.request.requestId)
  )
    fail("approval-already-consumed");
  store.db
    .prepare("INSERT INTO main.governance_receipts VALUES(?,?)")
    .run(b.request.requestId, JSON.stringify(b));
}
function guard(store, c) {
  let current;
  return {
    authorityPath: c.location,
    remotePaths: c.a.remoteWitness
      ? [
          c.a.remoteWitness.readTokenFile,
          c.a.remoteWitness.writeTokenFile,
          c.a.remoteWitness.caFile,
        ].filter(Boolean)
      : [],
    ...(c.a.remoteWitness
      ? {
          run(fn) {
            return transaction(store, async () => {
              current = check(store, c);
              compareRemote(current, await remoteHead(c));
              const result = fn();
              const logical = dump(store);
              if (hash(logical) !== current.stateDigest) {
                current = writeHead(store, c, current, logical);
                await remote.call(c, privateFile, current);
              }
              return result;
            });
          },
        }
      : {}),

    witnessRoot: core.protectedPath(c.a.witnessDirectory),
    before() {
      current = check(store, c);
      return current;
    },
    after(old) {
      const logical = dump(store);
      if (hash(logical) !== old.stateDigest)
        current = writeHead(store, c, old, logical);
    },
    context() {
      return {
        mode: c.a.remoteWitness ? "remote-witness" : "external-witness",
        authorityDigest: c.digest,
        witnessSequence: current.sequence,
        checkpointDigest: current.checkpointDigest,
      };
    },
    authorizeAdopt(compiled, id, b) {
      const r = verifyApproval(c, b, "adopt"),
        old = store.db
          .prepare("SELECT digest FROM main.organizations WHERE id=?")
          .get(id);
      if (
        id !== c.a.organizationId ||
        r.policyDigest !== compiled.digest ||
        r.policyRevision !== compiled.policy.revision ||
        r.previousPolicyDigest !== (old?.digest || null)
      )
        fail("approval-policy-transition-mismatch");
      return b;
    },
    record: (b) => record(store, b),
  };
}
function open(root, authorityPath) {
  const c = authority(authorityPath),
    store = core.openStore(root, false, permit());
  try {
    if (storeVersion(store) === 4) fail("governance-migration-pending");
    if (!hasBinding(store)) fail("governance-enrollment-required");
    attach(store, c);
    store.governance = guard(store, c);
    transaction(store, () => check(store, c));
    return store;
  } catch (e) {
    store.close();
    throw e;
  }
}
function initBinding(store, c) {
  store.db.exec(
    c.a.remoteWitness
      ? "PRAGMA main.user_version=3"
      : "PRAGMA main.user_version=2",
  );
  store.db.exec(
    "CREATE TABLE main.governance_binding(storeId TEXT NOT NULL,authorityDigest TEXT NOT NULL); CREATE TABLE main.governance_receipts(requestId TEXT PRIMARY KEY,bundle TEXT NOT NULL);",
  );
  store.db
    .prepare("INSERT INTO main.governance_binding VALUES(?,?)")
    .run(c.a.storeId, c.digest);
}
function enroll(root, authorityPath, b) {
  const c = authority(authorityPath),
    store = core.openStore(root);
  return withStore(store, () => {
    verifyApproval(c, b, "enroll");
    attach(store, c, true);
    return transaction(store, () => {
      const logical = dump(store);
      assertDomain(c.a, logical);
      quiescent(logical);
      const r = verifyApproval(c, b, "enroll");
      if (r.stateDigest !== hash(logical))
        fail("approval-enrollment-state-changed");
      store.db.exec(headSchema);
      initBinding(store, c);
      record(store, b);
      const h = writeHead(store, c, null, dump(store));
      const result = {
        status: "enrolled",
        checkpointDigest: h.checkpointDigest,
        sequence: h.sequence,
      };
      return c.a.remoteWitness
        ? remote.call(c, privateFile, h).then(() => result)
        : result;
    });
  });
}
function witness(c) {
  const root = core.protectedPath(c.a.witnessDirectory),
    file = privateFile(path.join(root, "witness.sqlite")),
    db = new DatabaseSync(file, { allowExtension: false });
  try {
    db.exec("PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0;");
    const fake = {
      db: { prepare: (sql) => db.prepare(sql.replaceAll("witness.", "")) },
      root: null,
    };
    return clone(head(fake, c, false));
  } finally {
    db.close();
  }
}
function request(c, action, specific, review) {
  const now = Date.now();
  return {
    request: {
      schemaVersion: "1",
      action,
      requestId: crypto.randomUUID(),
      storeId: c.a.storeId,
      organizationId: c.a.organizationId,
      authorityDigest: c.digest,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 86400000).toISOString(),
      reviewDigest: hash(review),
      ...specific,
    },
    review,
    signatures: [],
  };
}
function planEnroll(root, authorityPath) {
  const c = authority(authorityPath),
    s = core.openStore(root);
  try {
    return transaction(s, () => {
      const state = dump(s);
      assertDomain(c.a, state);
      quiescent(state);
      return request(c, "enroll", { stateDigest: hash(state) }, { state });
    });
  } finally {
    s.close();
  }
}
function planAdopt(root, authorityPath, compiled) {
  const c = authority(authorityPath),
    s = open(root, authorityPath);
  const run = s.governance.run || ((fn) => transaction(s, fn));
  return withStore(s, () =>
    run(() => {
      check(s, c);
      if (compiled.policy.organizationId !== c.a.organizationId)
        fail("governance-organization-mismatch");
      const old = s.db
        .prepare("SELECT digest,policy FROM main.organizations WHERE id=?")
        .get(c.a.organizationId);
      return request(
        c,
        "adopt",
        {
          policyDigest: compiled.digest,
          policyRevision: compiled.policy.revision,
          previousPolicyDigest: old?.digest || null,
        },
        {
          policy: compiled.policy,
          previousPolicy: old ? JSON.parse(old.policy) : null,
        },
      );
    }),
  );
}
function signRequest(authorityPath, b, approverId, keyFile) {
  const c = authority(authorityPath);
  verifyApproval(c, b, b.request?.action, false);
  const approver = c.a.approvers.find((r) => r.id === approverId);
  if (!approver) fail("unknown-approver");
  const fd = fs.openSync(
    privateFile(path.resolve(keyFile)),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  let key;
  try {
    if (fs.fstatSync(fd).size > 5000) fail("invalid-private-key");
    key = crypto.createPrivateKey(fs.readFileSync(fd));
  } finally {
    fs.closeSync(fd);
  }
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !crypto
      .createPublicKey(key)
      .export({ format: "der", type: "spki" })
      .equals(
        crypto
          .createPublicKey(approver.publicKey)
          .export({ format: "der", type: "spki" }),
      )
  )
    fail("approval-key-mismatch");
  return {
    ...clone(b),
    signatures: [
      {
        approverId,
        signature: crypto
          .sign(null, message(b.request), key)
          .toString("base64"),
      },
    ],
  };
}
function combine(authorityPath, bundles) {
  const c = authority(authorityPath);
  if (!bundles.length || bundles.length > 8) fail("invalid-approval-batch");
  const b = clone(bundles[0]);
  for (const other of bundles.slice(1)) {
    if (
      canonical(other.request) !== canonical(b.request) ||
      canonical(other.review) !== canonical(b.review)
    )
      fail("approval-request-mismatch");
    b.signatures.push(...other.signatures);
  }
  verifyApproval(c, b, b.request?.action);
  return b;
}
function writeJSON(file, value) {
  const parent = core.protectedPath(path.dirname(path.resolve(file))),
    out = path.join(parent, path.basename(file)),
    fd = fs.openSync(
      out,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
  try {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    if (Buffer.byteLength(bytes) > MAX) fail("governance-file-budget");
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const dir = fs.openSync(parent, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
  return { status: "written" };
}
function backup(root, authorityPath, file) {
  const c = authority(authorityPath),
    s = open(root, authorityPath);
  const run = s.governance.run || ((fn) => transaction(s, fn));
  return withStore(s, () =>
    run(() => {
      const h = check(s, c),
        logical = dump(s);
      quiescent(logical);
      const target = path.join(
        core.protectedPath(path.dirname(path.resolve(file))),
        path.basename(file),
      );
      if (
        relation(target, s.root) ||
        relation(target, core.protectedPath(c.a.witnessDirectory))
      )
        fail("backup-must-be-independent");
      writeJSON(target, {
        format: "frontend-organization-backup-v1",
        authorityDigest: c.digest,
        checkpointDigest: h.checkpointDigest,
        sequence: h.sequence,
        stateDigest: h.stateDigest,
        createdAt: new Date().toISOString(),
        logical,
      });
      return {
        status: "backed-up",
        checkpointDigest: h.checkpointDigest,
        sequence: h.sequence,
      };
    }),
  );
}
function backupSource(c, h, file) {
  if (!file) return { logical: JSON.parse(h.logical), backupDigest: null };
  const b = core.readJSON(privateFile(path.resolve(file)), MAX);
  if (
    !exact(b, [
      "format",
      "authorityDigest",
      "checkpointDigest",
      "sequence",
      "stateDigest",
      "createdAt",
      "logical",
    ]) ||
    b.format !== "frontend-organization-backup-v1" ||
    b.authorityDigest !== c.digest ||
    b.stateDigest !== hash(b.logical)
  )
    fail("backup-integrity-rejected");
  if (
    b.checkpointDigest !== h.checkpointDigest ||
    b.sequence !== h.sequence ||
    b.stateDigest !== h.stateDigest
  )
    fail("backup-stale-or-forked");
  return { logical: b.logical, backupDigest: hash(b) };
}
function targetPath(input) {
  const abs = path.resolve(input);
  return path.join(core.protectedPath(path.dirname(abs)), path.basename(abs));
}
function restoreReview(h) {
  const logical = JSON.parse(h.logical);
  return {
    sourceSequence: h.sequence,
    policy: JSON.parse(logical.organizations[0]?.policy || "null"),
    floor: logical.domains.map((d) => ({
      id: d.id,
      checkpoint: JSON.parse(d.checkpoint),
    })),
    requiresRefresh: true,
  };
}
function authoritativeHead(c) {
  return c.a.remoteWitness ? remoteHead(c) : witness(c);
}
function planRestore(authorityPath, target, file) {
  const c = authority(authorityPath);
  return then(authoritativeHead(c), (h) => {
    const source = backupSource(c, h, file);
    const targetRoot = targetPath(target);
    if (
      exists(targetRoot) ||
      relation(targetRoot, h.activeRoot) ||
      relation(targetRoot, witnessPath(c))
    )
      fail("restore-requires-empty-independent-target");
    return request(
      c,
      "restore",
      {
        checkpointDigest: h.checkpointDigest,
        targetRoot,
        backupDigest: source.backupDigest,
      },
      restoreReview(h),
    );
  });
}
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function witnessPath(c) {
  return exists(c.a.witnessDirectory)
    ? core.protectedPath(c.a.witnessDirectory)
    : targetPath(c.a.witnessDirectory);
}
function installLogical(s, c, logical, recovering = false) {
  assertDomain(c.a, logical);
  for (const row of logical.organizations)
    s.db
      .prepare("INSERT INTO main.organizations VALUES(?,?,?,?,?)")
      .run(
        row.id,
        row.revision,
        row.digest,
        row.policy,
        row.generation + (recovering ? 1 : 0),
      );
  for (const row of logical.domains) {
    const state = row.state ? JSON.parse(row.state) : null;
    if (state && recovering)
      state.lastAttempt = {
        status: "rejected",
        reason: "organization-restore-needs-refresh",
        checkedAt: new Date().toISOString(),
      };
    s.db
      .prepare("INSERT INTO main.domains VALUES(?,?,?,?,?,?)")
      .run(
        row.org,
        row.id,
        row.anchor,
        recovering && state ? JSON.stringify(state) : row.state,
        row.checkpoint,
        recovering ? null : row.lease,
      );
  }
  initBinding(s, c);
  for (const row of logical.receipts)
    s.db
      .prepare("INSERT INTO main.governance_receipts VALUES(?,?)")
      .run(row.requestId, row.bundle);
}
function replaceLogical(store, c, logical) {
  store.db.exec(
    "DELETE FROM main.domains; DELETE FROM main.organizations; DROP TABLE main.governance_receipts; DROP TABLE main.governance_binding;",
  );
  installLogical(store, c, logical);
}
function restore(authorityPath, target, b, file) {
  const c = authority(authorityPath);
  const r = verifyApproval(c, b, "restore");
  const targetRoot = targetPath(target);
  if (targetRoot !== r.targetRoot || exists(targetRoot))
    fail("restore-target-mismatch");
  return then(authoritativeHead(c), (observed) => {
    if (
      relation(targetRoot, observed.activeRoot) ||
      relation(targetRoot, witnessPath(c))
    )
      fail("restore-requires-empty-independent-target");
    if (
      observed.checkpointDigest !== r.checkpointDigest ||
      canonical(b.review) !== canonical(restoreReview(observed))
    )
      fail("restore-approval-state-changed");
    const source = backupSource(c, observed, file);
    if (source.backupDigest !== r.backupDigest)
      fail("restore-approval-state-changed");
    const s = core.openStore(targetRoot, true);
    return withStore(s, () => {
      const witnessFile = path.join(witnessPath(c), "witness.sqlite");
      attach(s, c, !!c.a.remoteWitness && !exists(witnessFile));
      return transaction(s, () => {
        // Local mode must reread under lock. Remote mode binds the exact observed parent through CAS.
        const h = c.a.remoteWitness ? observed : head(s, c, false);
        if (c.a.remoteWitness) verifyApproval(c, b, "restore");
        if (h.checkpointDigest !== r.checkpointDigest)
          fail("restore-approval-state-changed");
        s.db.exec(headSchema);
        installLogical(s, c, source.logical, true);
        record(s, b);
        const next = writeHead(s, c, h, dump(s));
        const result = {
          status: "restored-needs-refresh",
          checkpointDigest: next.checkpointDigest,
          sequence: next.sequence,
        };
        return c.a.remoteWitness
          ? remote.call(c, privateFile, next).then(() => result)
          : result;
      });
    });
  });
}
function reconcile(root, authorityPath) {
  const c = authority(authorityPath);
  if (!c.a.remoteWitness) fail("remote-witness-required");
  const s = open(root, authorityPath);
  return withStore(s, () =>
    transaction(s, async () => {
      const local = check(s, c);
      const independent = await remoteHead(c);
      if (local.checkpointDigest === independent.checkpointDigest)
        return { status: "already-synchronized", sequence: local.sequence };
      // This is the exact remote commit of an interrupted local write. Wider rollback requires approved restore.
      if (
        independent.sequence !== local.sequence + 1 ||
        independent.previousCheckpoint !== local.checkpointDigest ||
        independent.activeRoot !== s.root
      ) {
        if (independent.sequence <= local.sequence)
          compareRemote(local, independent);
        fail("remote-witness-recovery-approval-required");
      }
      const before = JSON.parse(local.logical),
        next = JSON.parse(independent.logical);
      remote.preserveHistory(before, next);
      replaceLogical(s, c, next);
      saveHead(s, independent);
      if (hash(dump(s)) !== independent.stateDigest)
        fail("remote-witness-reconcile-state-mismatch");
      // Disallow a concurrent remote cutover before returning success.
      compareRemote(independent, await remoteHead(c));
      return {
        status: "reconciled",
        sequence: independent.sequence,
        checkpointDigest: independent.checkpointDigest,
      };
    }),
  );
}
function migrationAuthorities(sourcePath, destinationPath) {
  const source = authority(sourcePath),
    destination = authority(destinationPath);
  const { remoteWitness, ...unchanged } = destination.a;
  if (
    source.a.remoteWitness ||
    !remoteWitness ||
    canonical(source.a) !== canonical(unchanged)
  )
    fail("migration-authority-mismatch");
  return { source, destination };
}
function migrationReview(h, logical, destination) {
  return {
    ...restoreReview({ ...h, logical: JSON.stringify(logical) }),
    sourceCheckpoint: h.checkpointDigest,
    sourceStateDigest: h.stateDigest,
    destinationAuthorityDigest: destination.digest,
    remoteEndpoint: destination.a.remoteWitness.url,
    remotePublicKeyDigest: hash(destination.a.remoteWitness.publicKey),
    priorApprovalCount: logical.receipts.length,
    priorApprovalDigest: hash(logical.receipts),
  };
}
function planMigration(root, sourcePath, destinationPath) {
  const { source, destination } = migrationAuthorities(
    sourcePath,
    destinationPath,
  );
  const store = open(root, sourcePath);
  return withStore(store, () =>
    transaction(store, () => {
      if (storeVersion(store) !== 2) fail("migration-requires-v2");
      const head = check(store, source);
      const logical = dump(store);
      quiescent(logical);
      return request(
        source,
        "migrate",
        {
          checkpointDigest: head.checkpointDigest,
          targetRoot: store.root,
          destinationAuthorityDigest: destination.digest,
        },
        migrationReview(head, logical, destination),
      );
    }),
  );
}
function migrationCandidate(store, source, destination, intent) {
  const { approval, sourceHead, authorizedAt } = intent;
  if (!Number.isSafeInteger(authorizedAt) || authorizedAt < 0)
    fail("migration-fence-invalid");
  const r = verifyApproval(source, approval, "migrate", true, authorizedAt);
  const logical = dump(store);
  logical.schemaVersion = 2;
  binding(store, source);
  quiescent(logical);
  if (
    sourceHead.storeId !== source.a.storeId ||
    sourceHead.authorityDigest !== source.digest ||
    sourceHead.activeRoot !== store.root ||
    sourceHead.stateDigest !== hash(logical) ||
    checkpoint(sourceHead) !== r.checkpointDigest ||
    sourceHead.checkpointDigest !== r.checkpointDigest ||
    r.targetRoot !== store.root ||
    r.destinationAuthorityDigest !== destination.digest ||
    canonical(approval.review) !==
      canonical(migrationReview(sourceHead, logical, destination))
  )
    fail("migration-source-or-approval-changed");
  if (logical.receipts.some((row) => row.requestId === r.requestId))
    fail("approval-already-consumed");

  // Keep policy, TUF repositories, floor, tombstones and signed receipts. Reset readiness at cutover.
  const next = clone(logical);
  next.schemaVersion = 3;
  next.binding[0].authorityDigest = destination.digest;
  for (const row of next.organizations) row.generation++;
  for (const row of next.domains) {
    if (!row.state) continue;
    const state = JSON.parse(row.state);
    state.lastAttempt = {
      status: "rejected",
      reason: "organization-migration-needs-refresh",
      checkedAt: new Date(authorizedAt).toISOString(),
    };
    row.state = JSON.stringify(state);
  }
  next.receipts.push({
    requestId: r.requestId,
    bundle: JSON.stringify(approval),
  });
  next.receipts.sort((a, b) =>
    a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0,
  );
  assertLogicalBudget(next);
  remote.preserveHistory(logical, next);
  return { head: makeHead(store, destination, null, next), logical: next };
}
function prepareMigration(store, source, destination, approval) {
  if (storeVersion(store) !== 2) fail("migration-requires-v2");
  const { logical, ...sourceHead } = check(store, source);
  const intent = { approval, sourceHead, authorizedAt: Date.now() };
  const next = migrationCandidate(store, source, destination, intent);
  return { ...intent, expectedDigest: next.head.checkpointDigest };
}
function migrationStage(store, intent) {
  // Removing the old head fences old v2 restore commands that can run without the main DB.
  store.db
    .exec(`CREATE TABLE main.governance_migration (id INTEGER PRIMARY KEY CHECK (id=1), intent TEXT NOT NULL);
    DELETE FROM witness.head;
    PRAGMA main.user_version=4;`);
  store.db
    .prepare("INSERT INTO main.governance_migration VALUES(1,?)")
    .run(JSON.stringify(intent));
}
function migrationIntent(store) {
  const row = store.db
    .prepare("SELECT intent FROM main.governance_migration WHERE id=1")
    .get();
  if (!row || store.db.prepare("SELECT id FROM witness.head").get())
    fail("migration-fence-invalid");
  return JSON.parse(row.intent);
}
function migrationReceipt(store, source, destination, approval) {
  const candidates = store.db
    .prepare("SELECT bundle FROM main.governance_receipts")
    .all()
    .map((row) => JSON.parse(row.bundle));
  const applied = candidates.find(
    (b) =>
      b.request.action === "migrate" &&
      b.request.authorityDigest === source.digest &&
      b.request.destinationAuthorityDigest === destination.digest &&
      b.request.targetRoot === store.root,
  );
  if (!applied || (approval && canonical(applied) !== canonical(approval)))
    fail("migration-receipt-mismatch");
  return applied.request;
}
async function migrate(root, sourcePath, destinationPath, approval) {
  if (approval !== undefined) approval = clone(approval);
  const { source, destination } = migrationAuthorities(
    sourcePath,
    destinationPath,
  );
  const store = core.openStore(root, false, permit());
  return withStore(store, async () => {
    // Check both paths against both authority-file directories before attaching the shared witness.
    if (
      relation(
        core.protectedPath(destination.a.witnessDirectory),
        path.dirname(destination.location),
      )
    )
      fail("witness-must-be-independent");
    attach(store, source);
    if (storeVersion(store) === 2) {
      if (!approval) fail("migration-approved-request-required");
      verifyApproval(source, approval, "migrate");
      await transaction(store, async () => {
        // Establish approval of the exact destination before reading or sending its credentials.
        const intent = prepareMigration(store, source, destination, approval);
        if (
          await remote.call(destination, privateFile, undefined, {
            writeProbe: true,
          })
        )
          fail("migration-remote-already-initialized");
        verifyApproval(source, approval, "migrate");
        migrationStage(store, intent);
      });
    }
    return transaction(store, async () => {
      if (storeVersion(store) === 3) {
        const local = check(store, destination);
        const receipt = migrationReceipt(store, source, destination, approval);
        compareRemote(local, await remoteHead(destination));
        return {
          status: "already-migrated",
          sequence: local.sequence,
          checkpointDigest: local.checkpointDigest,
          sourceCheckpoint: receipt.checkpointDigest,
        };
      }
      if (storeVersion(store) !== 4) fail("migration-requires-v2");
      const intent = migrationIntent(store);
      if (approval && canonical(intent.approval) !== canonical(approval))
        fail("migration-retry-approval-mismatch");
      // The approval was validated at the durable freeze time. A retry cannot alter that transition.
      const { head, logical } = migrationCandidate(
        store,
        source,
        destination,
        intent,
      );
      if (head.checkpointDigest !== intent.expectedDigest)
        fail("migration-candidate-changed");
      const independent = await remote.call(destination, privateFile);
      if (independent) compareRemote(head, independent);
      else await remote.call(destination, privateFile, head);
      replaceLogical(store, destination, logical);
      saveHead(store, head);
      if (hash(dump(store)) !== head.stateDigest)
        fail("migration-local-state-mismatch");
      store.db.exec("DROP TABLE main.governance_migration");
      return {
        status: "migrated-needs-refresh",
        sequence: head.sequence,
        checkpointDigest: head.checkpointDigest,
        sourceCheckpoint: intent.sourceHead.checkpointDigest,
      };
    });
  });
}
function inspect(authorityPath) {
  const c = authority(authorityPath);
  return then(authoritativeHead(c), (h) => ({
    storeId: h.storeId,
    organizationId: c.a.organizationId,
    sequence: h.sequence,
    checkpointDigest: h.checkpointDigest,
    stateDigest: h.stateDigest,
  }));
}
function authorityInfo(authorityPath) {
  const c = authority(authorityPath);
  return {
    storeId: c.a.storeId,
    organizationId: c.a.organizationId,
    authorityDigest: c.digest,
  };
}
module.exports = Object.freeze({
  isPermit,
  authorityInfo,
  reconcile,
  open,
  enroll,
  planEnroll,
  planMigration,
  migrate,
  planAdopt,
  planRestore,
  signRequest,
  combine,
  backup,
  restore,
  inspect,
  writeJSON,
});
