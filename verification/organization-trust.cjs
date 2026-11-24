"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  crypto = require("node:crypto"),
  tuf = require("./sigstore-tuf.cjs"),
  attestations = require("../analysis/attestations.js"),
  { sha256 } = require("../analysis/execution-evidence.js");
const compiledPolicies = new WeakMap();
function approved(compiled) {
  const internal = compiledPolicies.get(compiled);
  if (!internal) reject("organization-policy-token-invalid");
  return internal;
}
const tokens = new WeakMap(),
  id = (v) => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v),
  digest = (v) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v),
  object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const canonical = (v) =>
    Array.isArray(v)
      ? "[" + v.map(canonical).join(",") + "]"
      : object(v)
        ? "{" +
          Object.keys(v)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
            .join(",") +
          "}"
        : JSON.stringify(v),
  clone = (v) => JSON.parse(JSON.stringify(v));
const reject = (code) => {
    const e = Error(code);
    e.code = code;
    throw e;
  },
  keys = (v, allowed) =>
    object(v) && Object.keys(v).every((k) => allowed.includes(k));
function readJSON(file, max = 200000) {
  const h = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(h);
    if (!stat.isFile() || stat.size > max) reject("trust-file-unavailable");
    return tuf.strict(
      new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(h)),
      max,
    );
  } finally {
    fs.closeSync(h);
  }
}
function floor(value) {
  if (
    !keys(value, [
      "versions",
      "signedDigests",
      "snapshotMeta",
      "snapshotFromTimestamp",
    ]) ||
    !object(value.versions) ||
    !object(value.signedDigests) ||
    !object(value.snapshotMeta) ||
    Object.keys(value.snapshotMeta).length > 128
  )
    reject("invalid-trust-floor");
  for (const [role, version] of Object.entries(value.versions))
    if (
      !["root", "timestamp", "snapshot", "targets"].includes(role) ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !digest(value.signedDigests[role])
    )
      reject("invalid-trust-floor");
  if (
    Object.keys(value.signedDigests).some(
      (k) => value.versions[k] === undefined,
    ) ||
    Object.values(value.snapshotMeta).some(
      (v) => !Number.isSafeInteger(v) || v < 1,
    ) ||
    (value.snapshotFromTimestamp !== undefined &&
      (!Number.isSafeInteger(value.snapshotFromTimestamp) ||
        value.snapshotFromTimestamp < 1))
  )
    reject("invalid-trust-floor");
  return clone(value);
}
function mergeFloors(a, b) {
  const out = floor(a),
    next = floor(b);
  for (const [role, version] of Object.entries(next.versions)) {
    const old = out.versions[role];
    if (old === version && out.signedDigests[role] !== next.signedDigests[role])
      reject("trust-floor-fork");
    if (old === undefined || version > old) {
      out.versions[role] = version;
      out.signedDigests[role] = next.signedDigests[role];
    }
  }
  for (const [name, v] of Object.entries(next.snapshotMeta))
    out.snapshotMeta[name] = Math.max(out.snapshotMeta[name] || 0, v);
  if (next.snapshotFromTimestamp !== undefined)
    out.snapshotFromTimestamp = Math.max(
      out.snapshotFromTimestamp || 0,
      next.snapshotFromTimestamp,
    );
  return out;
}
const emptyFloor = () => ({
  versions: {},
  signedDigests: {},
  snapshotMeta: {},
});
async function compilePolicy(raw) {
  const p = tuf.strict(JSON.stringify(raw), 200000);
  if (
    !keys(p, [
      "schemaVersion",
      "organizationId",
      "revision",
      "trustDomains",
      "profiles",
    ]) ||
    p.schemaVersion !== "1" ||
    !id(p.organizationId) ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    !Array.isArray(p.trustDomains) ||
    !p.trustDomains.length ||
    p.trustDomains.length > 8 ||
    !Array.isArray(p.profiles) ||
    p.profiles.length > 16
  )
    reject("invalid-organization-policy");
  const domains = new Map(),
    profiles = new Map();
  for (const d of p.trustDomains) {
    if (
      !keys(d, [
        "id",
        "bootstrapRootDigest",
        "mirror",
        "maxRefreshAgeSeconds",
        "minimumFloor",
      ]) ||
      !id(d.id) ||
      domains.has(d.id) ||
      !digest(d.bootstrapRootDigest) ||
      !Number.isSafeInteger(d.maxRefreshAgeSeconds) ||
      d.maxRefreshAgeSeconds < 1 ||
      d.maxRefreshAgeSeconds > 604800
    )
      reject("invalid-trust-domain");
    if (d.mirror !== undefined) {
      try {
        const u = new URL(d.mirror);
        if (
          typeof d.mirror !== "string" ||
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          u.search ||
          u.hash ||
          /[\\%]/.test(d.mirror)
        )
          throw Error();
      } catch {
        reject("invalid-trust-mirror");
      }
    }
    d.minimumFloor = floor(
      d.minimumFloor === undefined ? emptyFloor() : d.minimumFloor,
    );
    domains.set(d.id, d);
  }
  for (const pfile of p.profiles) {
    if (
      !keys(pfile, ["id", "trustDomain", "repository", "trustPolicy"]) ||
      !id(pfile.id) ||
      profiles.has(pfile.id) ||
      !domains.has(pfile.trustDomain) ||
      typeof pfile.repository !== "string" ||
      !keys(pfile.trustPolicy, ["schemaVersion", "keyless"]) ||
      !Array.isArray(pfile.trustPolicy.keyless) ||
      !pfile.trustPolicy.keyless.length ||
      (await attestations.validateTrustPolicy(pfile.trustPolicy)).length
    )
      reject("invalid-trust-profile");
    const d = domains.get(pfile.trustDomain);
    if (
      pfile.trustPolicy.keyless.some(
        (r) =>
          r.repository !== pfile.repository ||
          r.tufBootstrapRootDigest !== d.bootstrapRootDigest ||
          r.trustedRootDigest !== undefined,
      )
    )
      reject("trust-profile-scope-mismatch");
    profiles.set(pfile.id, pfile);
  }
  const internal = {
    policy: p,
    digest: sha256(canonical(p)),
    domains,
    profiles,
  };
  // Public descriptions are copies; only this compiler can mint an authoritative handle.
  const handle = Object.freeze({
    policy: clone(p),
    digest: internal.digest,
    domains: new Map([...domains].map(([k, v]) => [k, clone(v)])),
    profiles: new Map([...profiles].map(([k, v]) => [k, clone(v)])),
  });
  compiledPolicies.set(handle, internal);
  return handle;
}
function protectedPath(input, initialize = false) {
  let root = path.resolve(input);
  if (initialize) {
    try {
      fs.mkdirSync(root, { mode: 0o700 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  const stat = fs.lstatSync(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077
  )
    reject("trust-store-directory-permissions");
  root = fs.realpathSync(root);
  for (let parent = path.dirname(root); ; parent = path.dirname(parent)) {
    const s = fs.statSync(parent);
    if (
      (s.uid !== 0 && s.uid !== process.getuid()) ||
      (s.mode & 0o022 && !(s.mode & 0o1000))
    )
      reject("trust-store-parent-permissions");
    if (parent === path.dirname(parent)) break;
  }
  return root;
}
function openStore(input, initialize = false, permit) {
  const root = protectedPath(input, initialize),
    file = path.join(root, "trust-store.sqlite");
  if (initialize) {
    if (fs.readdirSync(root).length) reject("trust-store-already-exists");
    const h = fs.openSync(
      file,
      fs.constants.O_RDWR |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.closeSync(h);
  } else {
    const s = fs.lstatSync(file);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid() ||
      s.mode & 0o077 ||
      s.nlink !== 1
    )
      reject("trust-store-file-permissions");
  }
  const { DatabaseSync } = require("node:sqlite"),
    db = new DatabaseSync(file, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
  try {
    if (initialize) {
      db.exec(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE marker(value TEXT NOT NULL); INSERT INTO marker VALUES('frontend-organization-trust-v1'); CREATE TABLE organizations(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, digest TEXT NOT NULL, policy TEXT NOT NULL, generation INTEGER NOT NULL); CREATE TABLE domains(org TEXT NOT NULL, id TEXT NOT NULL, anchor TEXT NOT NULL, state TEXT, checkpoint TEXT NOT NULL, lease TEXT, PRIMARY KEY(org,id), FOREIGN KEY(org) REFERENCES organizations(id)); PRAGMA user_version=1;",
      );
    }
    const storeVersion = db.prepare("PRAGMA user_version").get().user_version;
    if (
      ![1, 2, 3].includes(storeVersion) ||
      db.prepare("SELECT value FROM marker").get()?.value !==
        "frontend-organization-trust-v1"
    )
      reject("invalid-trust-store");
    db.exec(
      "PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;",
    );
    const governed = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='governance_binding'",
      )
      .get();
    if (
      (governed || storeVersion >= 2) &&
      !require("./organization-governance.cjs").isPermit(permit)
    )
      reject("organization-governance-required");
    if (storeVersion >= 2 && !governed) reject("invalid-trust-store");
    return { db, root, close: () => db.close() };
  } catch (e) {
    db.close();
    throw e;
  }
}
function transaction(store, fn) {
  if (store.governance?.run) return store.governance.run(fn);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const guard = store.governance?.before();
    const out = fn();
    store.governance?.after(guard);
    store.db.exec("COMMIT");
    return out;
  } catch (e) {
    store.db.exec("ROLLBACK");
    throw e;
  }
}
function orgRow(store, compiled, organizationId) {
  if (organizationId !== compiled.policy.organizationId)
    reject("organization-selection-mismatch");
  const row = store.db
    .prepare("SELECT * FROM organizations WHERE id=?")
    .get(organizationId);
  if (
    !row ||
    row.revision !== compiled.policy.revision ||
    row.digest !== compiled.digest
  )
    reject("organization-policy-not-adopted");
  return row;
}
function bump(store, org) {
  store.db
    .prepare("UPDATE organizations SET generation=generation+1 WHERE id=?")
    .run(org);
}
function adopt(store, compiled, organizationId, approval) {
  compiled = approved(compiled);
  if (organizationId !== compiled.policy.organizationId)
    reject("organization-selection-mismatch");
  return transaction(store, () => {
    const receipt = store.governance?.authorizeAdopt(
      compiled,
      organizationId,
      approval,
    );
    const p = compiled.policy,
      old = store.db
        .prepare("SELECT * FROM organizations WHERE id=?")
        .get(organizationId);
    if (old) {
      if (
        store.db
          .prepare("SELECT id FROM domains WHERE org=? AND lease IS NOT NULL")
          .get(organizationId)
      )
        reject("trust-refresh-in-progress");
      if (
        p.revision < old.revision ||
        (p.revision === old.revision && compiled.digest !== old.digest)
      )
        reject("organization-policy-rollback");
      if (p.revision === old.revision)
        return { status: "unchanged", organizationId, revision: p.revision };
    }
    for (const d of p.trustDomains) {
      const existing = store.db
        .prepare("SELECT * FROM domains WHERE org=? AND id=?")
        .get(organizationId, d.id);
      if (existing && existing.anchor !== d.bootstrapRootDigest)
        reject("trust-domain-anchor-reassignment");
      const prev =
        old && JSON.parse(old.policy).trustDomains.find((x) => x.id === d.id);
      if (
        prev &&
        canonical(
          mergeFloors(d.minimumFloor, prev.minimumFloor || emptyFloor()),
        ) !== canonical(d.minimumFloor)
      )
        reject("organization-minimum-floor-rollback");
      if (existing)
        mergeFloors(JSON.parse(existing.checkpoint), d.minimumFloor);
    }
    if (old)
      store.db
        .prepare(
          "UPDATE organizations SET revision=?,digest=?,policy=?,generation=generation+1 WHERE id=?",
        )
        .run(p.revision, compiled.digest, JSON.stringify(p), organizationId);
    else
      store.db
        .prepare("INSERT INTO organizations VALUES(?,?,?,?,1)")
        .run(organizationId, p.revision, compiled.digest, JSON.stringify(p));
    for (const d of p.trustDomains) {
      const existing = store.db
        .prepare("SELECT checkpoint FROM domains WHERE org=? AND id=?")
        .get(organizationId, d.id);
      if (existing)
        store.db
          .prepare("UPDATE domains SET checkpoint=? WHERE org=? AND id=?")
          .run(
            JSON.stringify(
              mergeFloors(JSON.parse(existing.checkpoint), d.minimumFloor),
            ),
            organizationId,
            d.id,
          );
      else
        store.db
          .prepare(
            "INSERT INTO domains(org,id,anchor,checkpoint) VALUES(?,?,?,?)",
          )
          .run(
            organizationId,
            d.id,
            d.bootstrapRootDigest,
            JSON.stringify(d.minimumFloor),
          );
    }
    if (receipt) store.governance.record(receipt);
    return { status: "adopted", organizationId, revision: p.revision };
  });
}
function beginRefresh(store, compiled, organizationId, domainId, initialize) {
  compiled = approved(compiled);
  return transaction(store, () => {
    orgRow(store, compiled, organizationId);
    const d = compiled.domains.get(domainId),
      row = store.db
        .prepare("SELECT * FROM domains WHERE org=? AND id=?")
        .get(organizationId, domainId);
    if (!d || !row) reject("unknown-trust-domain");
    if (row.lease) reject("trust-refresh-in-progress");
    if (Boolean(row.state) === Boolean(initialize))
      reject(
        row.state
          ? "trust-domain-already-initialized"
          : "trust-domain-initialization-required",
      );
    const lease = {
      id: crypto.randomUUID(),
      pid: process.pid,
      host: os.hostname(),
      startedAt: new Date().toISOString(),
    };
    store.db
      .prepare("UPDATE domains SET lease=? WHERE org=? AND id=?")
      .run(JSON.stringify(lease), organizationId, domainId);
    bump(store, organizationId);
    return {
      lease,
      domain: d,
      previous: row.state ? JSON.parse(row.state) : null,
      floor: JSON.parse(row.checkpoint),
    };
  });
}
function finishRefresh(
  store,
  compiled,
  organizationId,
  domainId,
  lease,
  state,
) {
  compiled = approved(compiled);
  return transaction(store, () => {
    orgRow(store, compiled, organizationId);
    const row = store.db
      .prepare("SELECT * FROM domains WHERE org=? AND id=?")
      .get(organizationId, domainId);
    if (!row || JSON.parse(row.lease || "null")?.id !== lease.id)
      reject("trust-refresh-lease-changed");
    const checkpoint = mergeFloors(JSON.parse(row.checkpoint), state.floor);
    state.floor = checkpoint;
    store.db
      .prepare(
        "UPDATE domains SET state=?,checkpoint=?,lease=NULL WHERE org=? AND id=?",
      )
      .run(
        JSON.stringify(state),
        JSON.stringify(checkpoint),
        organizationId,
        domainId,
      );
    bump(store, organizationId);
    return {
      status: state.lastAttempt.status,
      reason: state.lastAttempt.reason,
      organizationId,
      trustDomain: domainId,
    };
  });
}
function recover(store, compiled, organizationId, domainId) {
  compiled = approved(compiled);
  return transaction(store, () => {
    orgRow(store, compiled, organizationId);
    const row = store.db
      .prepare("SELECT * FROM domains WHERE org=? AND id=?")
      .get(organizationId, domainId);
    if (!row?.lease) reject("no-interrupted-refresh");
    const lease = JSON.parse(row.lease);
    if (
      lease.host !== os.hostname() ||
      !Number.isSafeInteger(lease.pid) ||
      lease.pid < 1
    )
      reject("refresh-owner-unverifiable");
    try {
      process.kill(lease.pid, 0);
      reject("refresh-owner-still-running");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
    const state = row.state ? JSON.parse(row.state) : null;
    if (state)
      state.lastAttempt = {
        status: "rejected",
        reason: "organization-refresh-interrupted",
        checkedAt: new Date().toISOString(),
      };
    store.db
      .prepare("UPDATE domains SET state=?,lease=NULL WHERE org=? AND id=?")
      .run(state ? JSON.stringify(state) : null, organizationId, domainId);
    bump(store, organizationId);
    return {
      status: "recovered-needs-refresh",
      organizationId,
      trustDomain: domainId,
    };
  });
}
function snapshot(store, compiled, organizationId, profileId) {
  compiled = approved(compiled);
  return transaction(store, () => {
    const org = orgRow(store, compiled, organizationId),
      profile = compiled.profiles.get(profileId);
    if (!profile) reject("unknown-trust-profile");
    const domain = compiled.domains.get(profile.trustDomain),
      row = store.db
        .prepare("SELECT * FROM domains WHERE org=? AND id=?")
        .get(organizationId, domain.id);
    if (!row || !row.state) reject("trust-domain-not-initialized");
    if (row.lease) reject("trust-refresh-in-progress");
    const state = JSON.parse(row.state),
      now = Date.now(),
      checked = Date.parse(state.lastAttempt?.checkedAt),
      age = now - checked;
    if (
      !Number.isFinite(checked) ||
      age < -30000 ||
      age >= domain.maxRefreshAgeSeconds * 1000
    )
      reject("organization-trust-refresh-stale");
    const verified = tuf.verifyState(state, domain.bootstrapRootDigest, now);
    if (verified.status !== "verified") reject(verified.reason);
    const checkpoint = tuf.verifyRepository(
      state.repository,
      domain.bootstrapRootDigest,
      now,
      JSON.parse(row.checkpoint),
    );
    if (checkpoint.status !== "verified")
      reject("organization-trust-checkpoint-rejected");
    const context = {
      organizationId,
      ...(store.governance ? { governance: store.governance.context() } : {}),
      profileId,
      trustDomain: domain.id,
      policyRevision: org.revision,
      policyDigest: org.digest,
      storeGeneration: org.generation,
      checkedAt: new Date(now).toISOString(),
      lastRefreshAt: new Date(checked).toISOString(),
      expiresAt: new Date(
        Math.min(
          Date.parse(verified.proof.expiresAt),
          checked + domain.maxRefreshAgeSeconds * 1000,
        ),
      ).toISOString(),
    };
    const scopeDigest = sha256(
        canonical({
          organizationId,
          ...(store.governance
            ? { authorityDigest: store.governance.context().authorityDigest }
            : {}),
          profile,
          domain: {
            id: domain.id,
            bootstrapRootDigest: domain.bootstrapRootDigest,
            maxRefreshAgeSeconds: domain.maxRefreshAgeSeconds,
            minimumFloor: domain.minimumFloor,
          },
        }),
      ),
      token = Object.freeze({});
    tokens.set(token, {
      root: store.root,
      governancePath: store.governance?.authorityPath,
      context,
      scopeDigest,
      trustPolicy: clone(profile.trustPolicy),
      sigstoreTufState: clone(state),
      expires: Math.min(now + 300000, Date.parse(context.expiresAt)),
    });
    return token;
  });
}
function read(token) {
  const stored = tokens.get(token);
  if (
    !stored ||
    Date.now() < Date.parse(stored.context.checkedAt) ||
    Date.now() >= stored.expires
  )
    reject("organization-trust-token-invalid");
  const store = stored.governancePath
    ? require("./organization-governance.cjs").open(
        stored.root,
        stored.governancePath,
      )
    : openStore(stored.root);
  function readState() {
    return transaction(store, () => {
      if (
        Date.now() < Date.parse(stored.context.checkedAt) ||
        Date.now() >= stored.expires
      )
        reject("organization-trust-token-invalid");
      const org = store.db
          .prepare(
            "SELECT generation,digest,revision FROM organizations WHERE id=?",
          )
          .get(stored.context.organizationId),
        domain = store.db
          .prepare("SELECT lease FROM domains WHERE org=? AND id=?")
          .get(stored.context.organizationId, stored.context.trustDomain);
      if (
        org?.generation !== stored.context.storeGeneration ||
        org?.digest !== stored.context.policyDigest ||
        org?.revision !== stored.context.policyRevision ||
        !domain ||
        domain.lease
      )
        reject("organization-trust-state-changed");
      return clone({
        context: stored.context,
        scopeDigest: stored.scopeDigest,
        trustPolicy: stored.trustPolicy,
        sigstoreTufState: stored.sigstoreTufState,
      });
    });
  }
  if (store.governance?.run)
    return Promise.resolve()
      .then(readState)
      .finally(() => store.close());
  try {
    return readState();
  } finally {
    store.close();
  }
}
function status(store, compiled, organizationId) {
  compiled = approved(compiled);
  return transaction(store, () => {
    const org = orgRow(store, compiled, organizationId);
    return {
      organizationId,
      ...(store.governance ? { governance: store.governance.context() } : {}),
      policyRevision: org.revision,
      storeGeneration: org.generation,
      domains: [...compiled.domains.values()].map((d) => {
        const row = store.db
            .prepare("SELECT * FROM domains WHERE org=? AND id=?")
            .get(organizationId, d.id),
          s = row?.state && JSON.parse(row.state);
        return {
          id: d.id,
          status: row?.lease
            ? "refreshing"
            : !s
              ? "not-initialized"
              : Date.now() - Date.parse(s.lastAttempt?.checkedAt) >=
                    d.maxRefreshAgeSeconds * 1000 ||
                  !Number.isFinite(Date.parse(s.lastAttempt?.checkedAt)) ||
                  Date.parse(s.lastAttempt?.checkedAt) > Date.now() + 30000
                ? "stale"
                : tuf.verifyState(s, d.bootstrapRootDigest).status ===
                      "verified" &&
                    tuf.verifyRepository(
                      s.repository,
                      d.bootstrapRootDigest,
                      Date.now(),
                      JSON.parse(row.checkpoint),
                    ).status === "verified"
                  ? "ready"
                  : "rejected",
          lastRefreshAt: s?.lastAttempt?.checkedAt || null,
          versions: JSON.parse(row.checkpoint).versions,
        };
      }),
    };
  });
}
module.exports = Object.freeze({
  readJSON,
  compilePolicy,
  openStore,
  adopt,
  beginRefresh,
  finishRefresh,
  recover,
  snapshot,
  read,
  status,
  mergeFloors,
  canonical,
  protectedPath,
});
