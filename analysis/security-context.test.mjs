import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { inspectSecurityContext, DETECTOR_IDS } = createRequire(import.meta.url)("./security-context.js");
const atSnapshot = { now: "2026-10-30T12:00:00Z" };
const json = (path, value) => ({ path, content: JSON.stringify(value) });
const inspect = (records, options = atSnapshot) => inspectSecurityContext(records, options);
const lock = (packages, version = 3) => json("package-lock.json", { lockfileVersion: version, packages });
const ids = (result) => result.findings.map((item) => item.id);

test("matches latest Node Brotli branch bounds and preserves runtime vs build evidence", () => {
  const result = inspect([{ path: "Dockerfile", content: "FROM node:24.22.0-alpine AS builder\nRUN npm run build\nFROM php:8.4.26-fpm\nCOPY --from=builder /dist /var/www" }]);
  assert.deepEqual(result.inventory.map((item) => [item.name, item.version, item.phase]), [["node", "24.22.0", "build"], ["php", "8.4.26", "runtime"]]);
  assert.ok(ids(result).includes("security.node-brotli-2026"));
  assert.ok(ids(result).includes("security.php-oom-2026"));
  assert.ok(ids(result).includes("security.php-stale-state-2026"));
  assert.equal(result.findings.find((item) => item.id === "security.node-brotli-2026").severity, "high");
  assert.match(result.findings[0].observedFact, /build/);
  assert.equal(result.coverage.complete, false);
  for (const version of ["22.23.4", "24.22.1", "26.12.1", "26.13.0"]) {
    assert.ok(!ids(inspect([{ path: ".node-version", content: version }])).includes("security.node-brotli-2026"), version);
  }
  for (const version of ["22.23.3", "24.22.0", "26.12.0"]) {
    assert.ok(ids(inspect([{ path: ".node-version", content: version }])).includes("security.node-brotli-2026"), version);
  }
});

test("does not claim CVE patch matching for a Node major tag, engine range, prerelease or future branch", () => {
  const result = inspect([
    { path: ".nvmrc", content: "24" }, { path: "Dockerfile", content: "FROM node:24-alpine" },
    json("package.json", { engines: { node: ">=22" } }),
    { path: "service/.node-version", content: "24.22.0-rc.1" }, { path: "future/.nvmrc", content: "30.0.0" }
  ]);
  assert.ok(!ids(result).includes("security.node-brotli-2026"));
  assert.ok(ids(result).includes("security.dependency-coverage"));
  assert.equal(result.inventory.find((item) => item.manifest === ".nvmrc").versionKind, "runtime-selector");
});

test("PHP branch fixes do not flag patched versions; composer platform overrides are not runtime proof", () => {
  for (const version of ["8.2.35", "8.3.36", "8.4.27", "8.5.12"]) {
    assert.ok(!ids(inspect([{ path: ".php-version", content: version }])).some((id) => /php-(oom|stale)/.test(id)), version);
  }
  const result = inspect([json("composer.json", { require: { php: "^8.4", "acme/server": "^1.0" }, config: { platform: { php: "8.4.26" } } })]);
  assert.ok(!ids(result).includes("security.php-oom-2026"));
  assert.equal(result.inventory.find((item) => item.path === "config/platform/php").versionKind, "platform-override");
  assert.ok(ids(result).includes("security.dependency-coverage"));
});

test("groups upstream and downstream RSC typed-array advisory occurrences once, retaining all paths", () => {
  const result = inspect([
    lock({ "": {}, "node_modules/react-server-dom-webpack": { version: "19.2.8" }, "node_modules/next": { version: "16.4.0" } }),
    json("apps/admin/package-lock.json", { lockfileVersion: 2, packages: { "": {}, "node_modules/react-server-dom-parcel": { version: "19.1.9" } } })
  ]);
  const typed = result.findings.filter((item) => item.id === "security.rsc-typed-array-rce");
  assert.equal(typed.length, 1);
  assert.equal(typed[0].occurrenceCount, 3);
  assert.deepEqual(typed[0].allEvidence, ["package-lock.json", "apps/admin/package-lock.json"]);
  assert.match(typed[0].observedFact, /GHSA-xqc2-xf4c-x3h3.*GHSA-673q-mjm6-r5xr/);
  assert.match(typed[0].riskFactors, /typed array|typed array/);
  assert.equal(typed[0].decision, "verify-first");
  assert.equal(typed[0].evidenceLevel, "inferred");
});

test("original React2Shell requires actual RSC lock evidence, not client React or declared ranges", () => {
  const result = inspect([
    json("package.json", { dependencies: { react: "19.0.0", "react-server-dom-webpack": "^19.0.0" } }),
    lock({ "": {}, "node_modules/react": { version: "19.0.0" } })
  ]);
  assert.ok(!ids(result).includes("security.react2shell"));
  assert.ok(ids(result).includes("security.dependency-coverage"));
  const affected = inspect([lock({ "node_modules/react-server-dom-webpack": { version: "19.1.1", dev: true } })]);
  assert.ok(ids(affected).includes("security.react2shell"));
  assert.match(affected.findings.find((item) => item.id === "security.react2shell").observedFact, /development/);
  for (const version of ["19.0.9", "19.1.10", "19.2.9", "19.3.1", "20.0.0"]) {
    const clean = inspect([lock({ "node_modules/react-server-dom-webpack": { version } })]);
    assert.ok(!ids(clean).includes("security.rsc-typed-array-rce"), version);
  }
});

test("Next image advisory retains platform/API/actual sharp conditions and exact upper bounds", () => {
  const result = inspect([lock({ "node_modules/next": { version: "15.5.27" }, "node_modules/sharp": { version: "0.35.5" } })]);
  const image = result.findings.find((item) => item.id === "security.next-image-svg-rce");
  assert.ok(image);
  assert.match(image.riskFactors, /glibc.*SVG.*sharp/);
  assert.match(image.recommendation, /0.35.5/);
  // A top-level sharp does not prove that Next resolves this copy; keep conditional.
  for (const version of ["15.5.28", "16.4.1", "16.0.0"]) {
    assert.ok(!ids(inspect([lock({ "node_modules/next": { version } })])).includes("security.next-image-svg-rce"), version);
  }
});

test("npm scopes, nested packages, known build tools and lock-based range resolution stay distinct", () => {
  const result = inspect([
    json("package.json", { dependencies: { "@scope/server": "^1.0.0" }, devDependencies: { vite: "^8.0.0", eslint: "^10.0.0" } }),
    lock({ "": {}, "node_modules/@scope/server": { version: "1.2.3" }, "node_modules/vite": { version: "8.0.0", dev: true },
      "node_modules/eslint": { version: "10.0.0", dev: true }, "node_modules/a/node_modules/@scope/server": { version: "1.0.0" } })
  ]);
  const locked = result.inventory.filter((item) => item.provenance === "lockfile");
  assert.equal(locked.find((item) => item.name === "vite").phase, "build");
  assert.equal(locked.find((item) => item.name === "eslint").phase, "development");
  assert.equal(locked.filter((item) => item.name === "@scope/server" && item.direct).length, 1);
  assert.equal(result.coverage.unresolvedVersionCount, 0);
  assert.ok(!ids(result).includes("security.dependency-coverage"));
});

test("Composer packages-dev are inventoried without inventing broad vulnerability coverage", () => {
  const result = inspect([
    json("composer.json", { require: { "acme/server": "^1.0" }, "require-dev": { "acme/test": "^2" } }),
    json("composer.lock", { packages: [{ name: "acme/server", version: "v1.2.3" }], "packages-dev": [{ name: "acme/test", version: "2.0.0" }] })
  ]);
  const locked = result.inventory.filter((item) => item.provenance === "lockfile");
  assert.deepEqual(locked.map((item) => item.phase), ["runtime", "development"]);
  assert.ok(locked.every((item) => item.direct));
  assert.equal(result.coverage.complete, false);
  assert.equal(result.snapshot.liveLookup, false);
  assert.ok(result.coverage.limitations.some((item) => /Finite advisory/.test(item)));
});

test("unsupported locks, invalid input and bounded inventory never claim complete coverage", () => {
  const result = inspect([
    lock({ x: { version: "1.0.0" } }, 1),
    { path: "composer.lock", content: "not json" },
    { path: "pnpm-lock.yaml", content: "lockfileVersion: 9.0" }
  ]);
  assert.deepEqual(result.coverage.gaps.map((item) => item.reason), ["unsupported-npm-lock-format", "invalid-json", "unsupported-lock-format"]);
  assert.ok(ids(result).includes("security.dependency-coverage"));
  const large = Object.fromEntries(Array.from({ length: 20_002 }, (_, index) => ["node_modules/dep-" + index, { version: "1.0.0" }]));
  const bounded = inspect([lock(large)]);
  assert.equal(bounded.inventory.length, 20_000);
  assert.ok(bounded.coverage.gaps.some((item) => item.reason === "inventory-budget"));
});

test("EOL is snapshot-qualified and not inferred from a broad allowed engine constraint", () => {
  const result = inspect([{ path: ".node-version", content: "20" }, { path: ".php-version", content: "8.1.30" }, json("package.json", { engines: { node: ">=18" } })]);
  const eol = result.findings.find((item) => item.id === "security.runtime-eol");
  assert.equal(eol.occurrenceCount, 2);
  assert.match(eol.limitation, /2026-10-30/);
  assert.ok(!ids(result).includes("security.node-brotli-2026"));
  for (const selector of ["22", "24", "26", "30"]) {
    assert.ok(!ids(inspect([{ path: ".nvmrc", content: selector }])).includes("security.runtime-eol"), selector);
  }
});

test("Docker final-stage inheritance retains runtime and unresolved image variables remain gaps", () => {
  const result = inspect([{ path: "Dockerfile", content: "FROM node:24.22.0 AS base\nFROM base AS production" }]);
  assert.equal(result.inventory[0].phase, "runtime");
  const unresolved = inspect([{ path: "Dockerfile", content: "ARG NODE_VERSION=24\nFROM node:${NODE_VERSION} AS build\nFROM ${FINAL_IMAGE}" }]);
  assert.ok(!ids(unresolved).includes("security.node-brotli-2026"));
  assert.ok(unresolved.coverage.gaps.some((item) => item.reason === "unresolved-docker-image-variable"));
});

test("literal workflow versions are build evidence and old snapshots surface an information gap", () => {
  const record = { path: ".github/workflows/build.yml", content: "steps:\n  - uses: actions/setup-node@v4\n    with:\n      node-version: '24.22.0'" };
  const result = inspect([record], { now: "2026-12-01T00:00:00Z" });
  assert.equal(result.inventory[0].phase, "build");
  assert.equal(result.snapshot.freshness, "stale");
  assert.ok(ids(result).includes("security.dependency-coverage"));
  assert.match(result.findings.find((item) => item.id === "security.node-brotli-2026").observedFact, /build/);
});

test("official Docker Hub image aliases retain the same runtime version and advisory evidence", () => {
  for (const prefix of ["", "library/", "docker.io/", "docker.io/library/"]) {
    const node = inspect([{ path: "Dockerfile", content: "FROM " + prefix + "node:24.22.0" }]);
    assert.equal(node.inventory[0].name, "node", prefix);
    assert.equal(node.inventory[0].phase, "runtime", prefix);
    assert.ok(ids(node).includes("security.node-brotli-2026"), prefix);
    const php = inspect([{ path: "Dockerfile", content: "FROM " + prefix + "php:8.4.26-fpm" }]);
    assert.equal(php.inventory[0].name, "php", prefix);
    assert.ok(ids(php).includes("security.php-oom-2026"), prefix);
    assert.ok(ids(php).includes("security.php-stale-state-2026"), prefix);
  }
});

test("unresolved CI versions remain explicit gaps even beside another job's literal version", () => {
  const setup = "steps:\n  - uses: actions/setup-node@v4\n    with:\n      ";
  for (const field of ["node-version: ${{ matrix.node }}", "node-version-file: '.node-version'", "node-version: *node", "node-version: '24.22.0\""]) {
    const result = inspect([{ path: ".github/workflows/build.yml", content: setup + field }]);
    assert.equal(result.inventory.length, 0, field);
    assert.ok(result.coverage.gaps.some((item) => item.reason === "unresolved-ci-node-version"), field);
    assert.ok(ids(result).includes("security.dependency-coverage"), field);
  }
  const mixed = inspect([{ path: ".github/workflows/build.yml", content: setup + "node-version: '24.22.0' # exact build pin\n" + setup + "node-version: ${{ matrix.node }}" }]);
  assert.equal(mixed.inventory.length, 1);
  assert.equal(mixed.inventory[0].version, "24.22.0");
  assert.ok(mixed.coverage.gaps.some((item) => item.reason === "unresolved-ci-node-version"));
  const absent = inspect([{ path: ".github/workflows/build.yml", content: "steps:\n  - uses: actions/setup-node@v4\n" }]);
  assert.ok(absent.coverage.gaps.some((item) => item.reason === "ci-node-version-unavailable"));
});

test("module findings use registered stable detector IDs and do not mutate input", () => {
  const records = [lock({ "node_modules/react-server-dom-webpack": { version: "19.0.0" } }), { path: ".nvmrc", content: "24.22.0" }];
  const before = JSON.stringify(records);
  const result = inspect(records);
  assert.equal(JSON.stringify(records), before);
  assert.ok(result.findings.every((item) => DETECTOR_IDS.includes(item.id)));
  assert.equal(new Set(ids(result)).size, result.findings.length);
  assert.deepEqual(inspect(null).inventory, []);
});

test("untrusted npm locations and package aliases are bounded before review fingerprints are built", () => {
  const longPath = Array.from({ length: 150 }, () => "node_modules/x").join("/") + "/node_modules/react-server-dom-webpack";
  const result = inspect([lock({
    ["node_modules/" + "x".repeat(2100)]: { name: "react-server-dom-webpack", version: "19.0.0" },
    [longPath]: { version: "19.0.0" },
    "../node_modules/react-server-dom-webpack": { version: "19.0.0" },
    "node_modules/alias": { name: "<script>bad-name</script>", version: "19.0.0" }
  })]);
  assert.equal(result.inventory.length, 0);
  assert.ok(!ids(result).includes("security.react2shell"));
  assert.ok(ids(result).includes("security.dependency-coverage"));
  assert.deepEqual(result.coverage.gaps.map((item) => item.reason), ["malformed-npm-lock-entry", "oversized-inventory-entry"]);
  const alias = inspect([lock({ "node_modules/server-alias": { name: "react-server-dom-webpack", version: "19.0.0" } })]);
  assert.ok(ids(alias).includes("security.react2shell"));
});

test("PHP sources without runtime evidence surface one version gap and no invented CVE match", () => {
  const result = inspect([{ path: "src/index.php", content: "<?php echo 'hello';" }, { path: "src/other.php", content: "<?php echo 'other';" }]);
  assert.equal(result.inventory.length, 0);
  assert.deepEqual(result.coverage.gaps, [{ path: "src/index.php", reason: "php-runtime-version-unavailable" }]);
  assert.deepEqual(ids(result), ["security.dependency-coverage"]);
  assert.equal(result.findings[0].evidenceLevel, "unknown");
  assert.ok(result.coverage.limitations.some((item) => /2026-10-23.*2026-10-26/.test(item)));
  const pinned = inspect([{ path: "src/index.php", content: "<?php echo 'hello';" }, { path: ".php-version", content: "8.5.12" }]);
  assert.ok(!pinned.coverage.gaps.some((item) => item.reason === "php-runtime-version-unavailable"));
  assert.ok(!ids(pinned).some((id) => /php-(oom|stale)/.test(id)));
  assert.ok(pinned.coverage.limitations.some((item) => /package rebuild/.test(item)));
  assert.deepEqual(inspect([{ path: "README.md", content: "documentation only" }]).findings, []);
});

test('review date freshness uses its declared calendar timezone across UTC midnight', () => {
  const result = inspectSecurityContext([], { now: '2026-10-29T15:30:00Z' });
  assert.equal(result.snapshot.timeZone, 'Asia/Seoul');
  assert.equal(result.snapshot.freshness, 'within-30-days');
  assert.equal(inspectSecurityContext([], { now: '2026-10-29T14:59:00Z' }).snapshot.freshness, 'unverified-clock');
});
