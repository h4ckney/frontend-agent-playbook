import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { queryInventory } from '../scripts/query-osv.mjs';
const require = createRequire(import.meta.url);
const { inspectSecurityContext } = require('./security-context.js');
const { createAuditBundle, validateAuditResult, createBaseline, compareWithBaseline, buildAuditMarkdown } = require('./audit-contract.js');
const record = (path, data) => ({ path, content: typeof data === 'string' ? data : JSON.stringify(data) });
const at = '2026-11-01T00:00:00Z';
const manifests = [record('package.json', { name: 'root' }),
  record('apps/web/package.json', { name: 'web', dependencies: { ui: 'workspace:*' } }),
  record('packages/ui/package.json', { name: 'ui', version: '1.0.0', dependencies: { next: '^16.4.0' }, devDependencies: { vite: '^8.0.0' } }),
  record('apps/tools/package.json', { name: 'tools', devDependencies: { next: '^16.4.0' } })];
const pnpm = `lockfileVersion: '9.0'
importers:
  .: {}
  apps/web:
    dependencies:
      ui: {specifier: 'workspace:*', version: 'link:../../packages/ui'}
  packages/ui:
    dependencies:
      next: {specifier: ^16.4.0, version: 16.4.0}
    devDependencies:
      vite: {specifier: ^8.0.0, version: 8.0.0}
  apps/tools:
    devDependencies:
      next: {specifier: ^16.4.0, version: 16.4.0}
packages:
  next@16.4.0: {resolution: {integrity: ignored}}
  vite@8.0.0: {resolution: {integrity: ignored}}
snapshots:
  next@16.4.0: {}
  vite@8.0.0: {}
`;
const berry = `__metadata:
  version: 8
"root@workspace:.":
  version: 0.0.0-use.local
  resolution: "root@workspace:."
"web@workspace:apps/web":
  version: 0.0.0-use.local
  resolution: "web@workspace:apps/web"
  dependencies:
    ui: "workspace:*"
"ui@workspace:*, ui@workspace:packages/ui":
  version: 0.0.0-use.local
  resolution: "ui@workspace:packages/ui"
  dependencies:
    next: "npm:^16.4.0"
    vite: "npm:^8.0.0"
"tools@workspace:apps/tools":
  version: 0.0.0-use.local
  resolution: "tools@workspace:apps/tools"
  dependencies:
    next: "npm:^16.4.0"
"next@npm:^16.4.0, next@npm:16.4.0":
  version: 16.4.0
  resolution: "next@npm:16.4.0"
  checksum: ignored
"vite@npm:^8.0.0":
  version: 8.0.0
  resolution: "vite@npm:8.0.0"
`;
const bun = `{
  // Synthetic Bun text lock: trailing commas and comments are data.
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "root" },
    "apps/web": { "name": "web", "dependencies": { "ui": "workspace:*" } },
    "packages/ui": { "name": "ui", "version": "1.0.0", "dependencies": { "next": "^16.4.0" }, "devDependencies": { "vite": "^8.0.0" } },
    "apps/tools": { "name": "tools", "devDependencies": { "next": "^16.4.0" } },
  },
  "packages": {
    "ui": ["ui@workspace:packages/ui"],
    "next": ["next@16.4.0", "https://user:secret@example.invalid/a,}", {}, "ignored"],
    "vite": ["vite@8.0.0", "", {}, "ignored"],
  },
}`;
const formats = [['pnpm-lock.yaml', pnpm], ['yarn.lock', berry], ['bun.lock', bun]];
const inspect = records => inspectSecurityContext(records, { now: at });
const bundle = records => createAuditBundle({ records, generatedAt: at }).audit;

for (const [path, content] of formats) test(`${path}: shared workspace edges, independent phases and canonical evidence survive export`, async () => {
  const records = [...manifests, record(path, content)];
  const result = inspect(records);
  assert.deepEqual(result.coverage.gaps, []);
  assert.equal(result.coverage.unresolvedVersionCount, 0);
  assert.equal(result.graphs[0].complete, true);
  const next = result.inventory.find(item => item.name === 'next' && item.provenance === 'lockfile');
  assert.equal(next.phase, 'unknown'); // Both service and dev paths exist.
  assert.deepEqual(next.workspaceUsage.map(item => [item.manifest, item.phase, item.direct]), [
    ['apps/tools/package.json', 'development', true], ['apps/web/package.json', 'runtime', false], ['packages/ui/package.json', 'runtime', true]
  ]);
  const vite = result.inventory.find(item => item.name === 'vite' && item.provenance === 'lockfile');
  assert.deepEqual(vite.workspaceUsage.map(item => [item.manifest, item.phase]), [['packages/ui/package.json', 'build']]);
  assert.ok(!vite.workspaceUsage.some(item => item.manifest === 'apps/web/package.json'));
  const audit = bundle(records);
  assert.deepEqual(validateAuditResult(audit), []);
  assert.ok(audit.findings.find(item => item.id === 'security.rsc-typed-array-rce').observedFact.includes('apps/web/package.json'));
  assert.match(buildAuditMarkdown(audit), /apps\/web\/package.json.*transitive/);
  assert.doesNotMatch(JSON.stringify(audit), /user:secret|example.invalid/);
  assert.deepEqual(bundle([...records].reverse()).securityContext.graphs, audit.securityContext.graphs);
  const requests = [];
  const report = await queryInventory(audit, { fetchImpl: async (url, options) => { requests.push(options.body); return new Response(JSON.stringify({ results: [{}, {}] })); } });
  assert.equal(report.packages.length, 2);
  assert.doesNotMatch(requests.join(''), /apps\/|workspace|manifest|phase/);
  assert.ok(report.declarations.some(item => item.manifest === 'apps/tools/package.json' && item.name === 'next'));
  assert.deepEqual(report.packages.find(item => item.name === 'next').occurrences[0].workspaceUsage, next.workspaceUsage);
});

test('npm shared hoisting respects nested versions and workspace links instead of matching names globally', () => {
  const records = [record('package.json', { name: 'root' }), record('apps/a/package.json', { name: 'a', dependencies: { shared: 'file:../../packages/shared', next: '^16.4.0' } }),
    record('apps/b/package.json', { name: 'b', dependencies: { next: '^16.4.1' } }), record('packages/shared/package.json', { name: 'shared', dependencies: { 'react-server-dom-webpack': '19.3.0' } }),
    record('package-lock.json', { lockfileVersion: 3, packages: {
      '': { name: 'root' }, 'apps/a': { name: 'a', dependencies: { shared: 'file:../../packages/shared', next: '^16.4.0' } },
      'apps/b': { name: 'b', dependencies: { next: '^16.4.1' } }, 'packages/shared': { name: 'shared', dependencies: { 'react-server-dom-webpack': '19.3.0' } },
      'node_modules/shared': { link: true, resolved: 'packages/shared' }, 'node_modules/next': { version: '16.4.0' },
      'apps/b/node_modules/next': { version: '16.4.1' }, 'node_modules/react-server-dom-webpack': { version: '19.3.0' }
    } })];
  const result = inspect(records);
  assert.deepEqual(result.coverage.gaps, []);
  const locks = result.inventory.filter(item => item.provenance === 'lockfile');
  assert.deepEqual(locks.find(item => item.name === 'next' && item.version === '16.4.0').workspaceUsage.map(item => item.manifest), ['apps/a/package.json']);
  assert.deepEqual(locks.find(item => item.name === 'next' && item.version === '16.4.1').workspaceUsage.map(item => item.manifest), ['apps/b/package.json']);
  assert.ok(locks.find(item => item.name === 'react-server-dom-webpack').workspaceUsage.some(item => item.manifest === 'apps/a/package.json' && !item.direct));
  assert.deepEqual(validateAuditResult(bundle(records)), []);
});

test('pnpm v6 single importer and v9 peer contexts keep distinct installations and exact versions', () => {
  const v6 = inspect([record('package.json', { dependencies: { next: '^16.4.0' } }), record('pnpm-lock.yaml', `lockfileVersion: '6.0'
dependencies:
  next: {specifier: ^16.4.0, version: 16.4.0}
packages:
  /next@16.4.0: {}
`)]);
  assert.deepEqual(v6.coverage.gaps, []);
  assert.equal(v6.inventory.find(item => item.provenance === 'lockfile').workspaceUsage[0].direct, true);
  const contexts = pnpm.replace('version: 16.4.0}', 'version: 16.4.0(react@19.0.0)}').replace('  next@16.4.0: {}', '  next@16.4.0(react@19.0.0): {}\n  next@16.4.0(react@19.1.0): {}');
  const result = inspect([...manifests, record('pnpm-lock.yaml', contexts)]);
  assert.equal(result.inventory.filter(item => item.name === 'next' && item.provenance === 'lockfile').length, 2);
});

test('Bun nested scoped keys resolve the closest version for a workspace and transitive dependency', () => {
  const data = { lockfileVersion: 1, workspaces: { '': {}, 'apps/a': { name: '@scope/app', dependencies: { next: '*' } } }, packages: {
    '@scope/app': ['@scope/app@workspace:apps/a'], next: ['next@16.4.0', '', {}],
    '@scope/app/next': ['next@16.4.1', '', { dependencies: { '@scope/child': '*' } }],
    '@scope/app/next/@scope/child': ['@scope/child@1.2.3', '', {}]
  } };
  const result = inspect([record('package.json', {}), record('apps/a/package.json', { name: '@scope/app', dependencies: { next: '*' } }), record('bun.lock', data)]);
  assert.deepEqual(result.coverage.gaps, []);
  assert.equal(result.inventory.find(item => item.name === 'next' && item.version === '16.4.0').workspaceUsage.length, 0);
  assert.equal(result.inventory.find(item => item.name === 'next' && item.version === '16.4.1').workspaceUsage[0].manifest, 'apps/a/package.json');
  assert.equal(result.inventory.find(item => item.name === '@scope/child').workspaceUsage[0].direct, false);
});

test('Yarn npm aliases use the resolved package identity and retain the declaration name', () => {
  const records = [record('package.json', { name: 'app', dependencies: { alias: 'npm:next@^16.4.0' } }), record('yarn.lock', `__metadata: {version: 8}
"app@workspace:.":
  resolution: "app@workspace:."
  dependencies: {alias: "npm:next@^16.4.0"}
"alias@npm:next@^16.4.0":
  version: 16.4.0
  resolution: "next@npm:16.4.0"
`)];
  const result = inspect(records);
  assert.deepEqual(result.coverage.gaps, []);
  assert.equal(result.coverage.unresolvedVersionCount, 0);
  assert.equal(result.inventory.find(item => item.provenance === 'lockfile').name, 'next');
  assert.equal(result.inventory.find(item => item.provenance === 'lockfile').workspaceUsage[0].dependency, 'alias');
});

test('invalid, duplicate, alias, tagged, deep, future and executable syntax stay explicit gaps', () => {
  for (const [path, content] of [
    ['pnpm-lock.yaml', pnpm + '\nimporters: {}'], ['pnpm-lock.yaml', 'lockfileVersion: 99\npackages: {}'],
    ['pnpm-lock.yaml', 'a: &a [1]\nb: *a'], ['pnpm-lock.yaml', 'a: !!js/function "function(){}"'],
    ['pnpm-lock.yaml', 'a: ' + '['.repeat(60) + '1' + ']'.repeat(60)],
    ['bun.lock', '{"lockfileVersion":1,"lockfileVersion":1,"packages":{},"workspaces":{}}'],
    ['bun.lock', '{"lockfileVersion":1,"packages":{},"workspaces":{}, "run": (() => 1)()}'],
    ['bun.lock', '{"lockfileVersion":1, /* not closed'], ['yarn.lock', '__metadata: {version: 99}'],
    ['bun.lockb', 'binary-unreadable']
  ]) {
    const result = inspect([record(path, content)]);
    assert.ok(result.coverage.gaps.length, path + content.slice(0, 30));
    assert.ok(result.findings.some(item => item.id === 'security.dependency-coverage'));
  }
  assert.equal({}.polluted, undefined);
});

test('dangling, escaped and stale workspace references cannot silently inherit another workspace lock', () => {
  for (const content of [pnpm.replace('link:../../packages/ui', 'link:../../../../outside'), pnpm.replace('version: 16.4.0}', 'version: 99.0.0}'), pnpm.replace('specifier: ^16.4.0', 'specifier: ^15.0.0')]) {
    const result = inspect([...manifests, record('pnpm-lock.yaml', content)]);
    assert.ok(result.coverage.gaps.length);
    assert.equal(result.graphs[0].complete, false);
    assert.ok(result.findings.some(item => item.id === 'security.rsc-typed-array-rce')); // Orphan version evidence retained.
  }
  const missing = inspect([record('apps/not-member/package.json', { dependencies: { next: '*' } }), record('pnpm-lock.yaml', pnpm)]);
  assert.ok(missing.coverage.gaps.some(item => item.path === 'apps/not-member/package.json' && item.reason === 'dependency-without-supported-lock-entry'));
});

test('dependency cycles terminate and malformed graph evidence prevents false resolution', () => {
  const cycle = pnpm.replace('  next@16.4.0: {}', '  next@16.4.0:\n    dependencies: {next: 16.4.0}');
  const records = [...manifests, record('pnpm-lock.yaml', cycle)];
  assert.deepEqual(inspect(records).coverage.gaps, []);
  const baseline = createBaseline(bundle(records));
  const fingerprint = baseline.findings.find(item => item.detectorId === 'security.rsc-typed-array-rce').fingerprint;
  const broken = bundle([...manifests, record('pnpm-lock.yaml', pnpm.replaceAll('16.4.0', '16.4.1').replace('snapshots:', 'missingSnapshots:'))]);
  assert.ok(compareWithBaseline(broken, baseline).diff.unverified.includes(fingerprint));
});

test('pinned vendored parser bytes match the reviewed upstream distribution', () => {
  const source = fs.readFileSync(new URL('./vendor/js-yaml-5.5.0.js', import.meta.url));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), '02970a652376ad653ff069c606ee7440b0514f52ed94a98426cb52426c8e5a02');
});

test('empty pnpm workspaces are supported and duplicate npm JSON never hides a prior advisory', () => {
  const empty = inspect([record('package.json', {}), record('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters: {.: {}}")]);
  assert.deepEqual(empty.coverage.gaps, []);
  const before = bundle([record('package.json', {}), record('package-lock.json', { lockfileVersion: 3, packages: { '': {}, 'node_modules/next': { version: '16.4.0' } } })]);
  const after = bundle([record('package.json', {}), record('package-lock.json', '{"lockfileVersion":3,"packages":{"":{},"node_modules/next":{"version":"16.4.0"},"node_modules/next":{"version":"16.4.1"}}}')]);
  const fingerprint = before.findings.find(item => item.id === 'security.rsc-typed-array-rce').fingerprint;
  assert.ok(after.securityContext.coverage.gaps.length);
  assert.ok(compareWithBaseline(after, createBaseline(before)).diff.unverified.includes(fingerprint));
});

test('many workspace consumers keep review metadata bounded and reopen a decision when an omitted consumer changes', () => {
  const { findingSignature } = require('./triage-state.js');
  const data = { lockfileVersion: 3, packages: { '': {}, 'node_modules/next': { version: '16.4.0' } } };
  const records = [record('package.json', {})];
  for (let index = 0; index < 25; index += 1) {
    const location = 'apps/app-' + String(index).padStart(2, '0');
    const manifest = { name: 'app-' + index, dependencies: { next: '^16.4.0' } };
    data.packages[location] = manifest;
    records.push(record(location + '/package.json', manifest));
  }
  const result = bundle([...records, record('package-lock.json', data)]);
  const finding = result.findings.find(item => item.id === 'security.rsc-typed-array-rce');
  assert.ok(finding.evidence[0].label.length < 10000);
  const signature = findingSignature(finding);
  data.packages['apps/app-24'].dependencies = {};
  records[25] = record('apps/app-24/package.json', { name: 'app-24' });
  const changed = bundle([...records, record('package-lock.json', data)]).findings.find(item => item.id === finding.id);
  assert.notEqual(findingSignature(changed), signature);
});

test('workspace and registry package identities never collide when both are named next', () => {
  const records = [record('package.json', { name: 'root', dependencies: { next: '^16.4.0' } }), record('packages/next/package.json', { name: 'next', version: '1.0.0' }), record('bun.lock', {
    lockfileVersion: 1, workspaces: { '': { name: 'root', dependencies: { next: '^16.4.0' } }, 'packages/next': { name: 'next', version: '1.0.0' } },
    packages: { next: ['next@16.4.0', '', {}] }
  })];
  const result = inspect(records);
  assert.deepEqual(result.coverage.gaps, []);
  assert.ok(result.findings.some(item => item.id === 'security.rsc-typed-array-rce'));
  assert.equal(result.inventory.find(item => item.provenance === 'lockfile').workspaceUsage[0].manifest, 'package.json');
});

test('npm v-prefixed exact versions retain the previous advisory matching behavior', () => {
  const result = inspect([record('package.json', {}), record('package-lock.json', { lockfileVersion: 3, packages: { '': {}, 'node_modules/next': { version: 'v16.4.0' } } })]);
  assert.ok(result.findings.some(item => item.id === 'security.rsc-typed-array-rce'));
  assert.equal(result.inventory[0].versionKind, 'locked-exact');
});
