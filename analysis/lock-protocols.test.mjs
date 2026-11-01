import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { queryInventory, buildMarkdown } from '../scripts/query-osv.mjs';
const require = createRequire(import.meta.url);
const { inspectSecurityContext } = require('./security-context.js');
const { createAuditBundle, validateAuditResult, createBaseline, compareWithBaseline } = require('./audit-contract.js');
const { fileExclusionReason } = require('./analyzer.js');
const record = (path, content) => ({ path, content: typeof content === 'string' ? content : JSON.stringify(content) });
const date = '2026-11-01T00:00:00Z';
const inspect = records => inspectSecurityContext(records, { now: date });
const bundle = records => createAuditBundle({ records, generatedAt: date }).audit;
const manifest = record('package.json', { name: 'root', dependencies: { next: '^16.4.0' } });
const boot = `lockfileVersion: '9.0'
importers:
  .:
    configDependencies:
      next: {specifier: 16.4.0, version: 16.4.0}
    packageManagerDependencies:
      pnpm: {specifier: 12.3.4, version: 12.3.4}
packages:
  next@16.4.0: {}
  pnpm@12.3.4: {}
snapshots:
  next@16.4.0: {}
  pnpm@12.3.4: {}
`;
const project = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      next: {specifier: ^16.4.0, version: 16.4.0}
packages:
  next@16.4.0: {}
snapshots:
  next@16.4.0: {}
`;
const response = results => new Response(JSON.stringify({ results }));

test('pnpm boot and project documents retain both inventories without mixing build and runtime declarations', async () => {
  const records = [manifest, record('pnpm-lock.yaml', '---\n' + boot + '---\n' + project)];
  const result = inspect(records);
  assert.deepEqual(result.coverage.gaps, []);
  assert.deepEqual(result.graphs.map(graph => graph.document), ['boot', 'project']);
  const versions = result.inventory.filter(item => item.name === 'next' && item.provenance === 'lockfile');
  assert.deepEqual(versions.map(item => item.phase), ['build', 'runtime']);
  assert.equal(new Set(versions.map(item => item.path)).size, 2);
  const audit = bundle(records);
  assert.deepEqual(validateAuditResult(audit), []);
  const findings = audit.findings.filter(item => item.id === 'security.rsc-typed-array-rce');
  assert.equal(findings.length, 2);
  assert.equal(new Set(findings.map(item => item.fingerprint)).size, 2);
  const requests = [];
  const report = await queryInventory(audit, { fetchImpl: async (url, options) => { requests.push(options.body); return response([{}, {}]); } });
  assert.equal(report.packages.find(item => item.name === 'next').occurrences.length, 2);
  assert.doesNotMatch(requests.join(''), /boot|build|package.json|manifest/);
  assert.equal(report.declarations.find(item => item.name === 'next').status, 'covered-by-lock');
});

test('pnpm boot-only package evidence cannot cover a missing application dependency', async () => {
  const records = [manifest, record('pnpm-lock.yaml', '---\n' + boot + '---\nlockfileVersion: \'9.0\'\nimporters: {.: {}}\n')];
  const result = inspect(records);
  assert.ok(result.coverage.gaps.some(gap => gap.reason === 'dependency-without-supported-lock-entry'));
  const report = await queryInventory(bundle(records), { fetchImpl: async () => response([{}, {}]) });
  assert.ok(report.skipped.some(item => item.manifest === 'package.json' && item.name === 'next'));
  assert.ok(!report.declarations.some(item => item.manifest === 'package.json' && item.name === 'next'));
});

test('malformed pnpm document layouts and dropped project documents remain unverified', () => {
  const before = bundle([manifest, record('pnpm-lock.yaml', '---\n' + boot + '---\n' + project)]);
  const baseline = createBaseline(before);
  const fingerprint = before.findings.find(item => item.id === 'security.rsc-typed-array-rce' && !item.fingerprint.includes('boot/')).fingerprint;
  for (const text of [boot, '---\n' + project + '---\n' + boot, '---\n' + boot + '---\n' + project.replace("'9.0'", "'6.0'"), '---\n' + boot + '---\n' + project + '---\n' + project]) {
    const after = bundle([manifest, record('pnpm-lock.yaml', text)]);
    assert.ok(after.securityContext.coverage.gaps.length);
    assert.ok(compareWithBaseline(after, baseline).diff.unverified.includes(fingerprint));
  }
});

test('pnpm 5.0–5.4 specifiers, scoped keys, aliases and peer contexts preserve exact identities', () => {
  for (const version of ['5', '5.1', '5.2', '5.3', '5.4']) {
    const result = inspect([record('package.json', { dependencies: { next: '^16.4.0', alias: 'npm:@scope/server@^1' } }), record('pnpm-lock.yaml', `lockfileVersion: ${version}
specifiers:
  next: ^16.4.0
  alias: npm:@scope/server@^1
dependencies:
  next: 16.4.0_react@19.0.0
  alias: /@scope/server/1.2.3
packages:
  /next/16.4.0_react@19.0.0: {}
  /next/16.4.0_react@19.1.0: {}
  /@scope/server/1.2.3: {}
`)]);
    assert.deepEqual(result.coverage.gaps, [], version);
    assert.equal(result.coverage.unresolvedVersionCount, 0);
    assert.equal(result.inventory.filter(item => item.name === 'next' && item.provenance === 'lockfile').length, 2);
    assert.equal(result.inventory.find(item => item.name === '@scope/server').workspaceUsage[0].dependency, 'alias');
  }
});

function patchedYarn({ patch = './private.patch', wrapped = false, version = '16.4.0' } = {}) {
  const locator = 'next@patch:next@npm%3A' + version + '#' + patch + '::version=' + version + '&hash=abcdef';
  const resolution = wrapped ? 'next@virtual:abc123#' + locator.slice(5) : locator;
  return `__metadata: {version: 8}
"root@workspace:.":
  resolution: "root@workspace:."
  dependencies: {next: ${JSON.stringify(resolution.slice(5))}}
${JSON.stringify(resolution)}:
  version: ${version}
  resolution: ${JSON.stringify(resolution)}
`;
}

test('Yarn patched registry base remains an advisory candidate without exposing patch paths', async () => {
  const content = patchedYarn({ patch: 'https://user:secret@example.invalid/private.patch' });
  const ref = /dependencies: \{next: (.+)\}/.exec(content)[1];
  const records = [record('package.json', { name: 'root', dependencies: { next: JSON.parse(ref) } }), record('yarn.lock', content)];
  const result = inspect(records);
  assert.deepEqual(result.coverage.gaps, []);
  const item = result.inventory.find(item => item.provenance === 'lockfile');
  assert.deepEqual(item.modifications, ['patch']);
  assert.equal(item.version, '16.4.0');
  const audit = bundle(records);
  assert.deepEqual(validateAuditResult(audit), []);
  const finding = audit.findings.find(item => item.id === 'security.rsc-typed-array-rce');
  assert.match(finding.observedFact, /modified registry base.*patch/);
  assert.doesNotMatch(JSON.stringify(audit), /private.patch|secret|example.invalid/);
  const report = await queryInventory(audit, { fetchImpl: async (url, options) => { assert.doesNotMatch(options.body, /patch|secret|private/); return response([{}]); } });
  assert.deepEqual(report.packages[0].occurrences[0].modifications, ['patch']);
  assert.match(buildMarkdown(report), /modified registry base.*patch/);
});

test('different Yarn patches and virtual contexts have separate stable child identities', () => {
  const first = patchedYarn({ patch: './one.patch' });
  const second = patchedYarn({ patch: './two.patch', wrapped: true }).split('\n').slice(4).join('\n');
  const result = inspect([record('yarn.lock', first + '\n' + second)]);
  const locked = result.inventory.filter(item => item.provenance === 'lockfile');
  assert.equal(locked.length, 2);
  assert.notEqual(locked[0].path, locked[1].path);
  assert.ok(result.coverage.gaps.some(gap => gap.reason === 'yarn-virtual-peer-context-unverified'));
});

test('patches with an unprovable npm origin are gaps, never registry coordinates from entry.version alone', () => {
  for (const source of ['next@https%3A%2F%2Fexample.invalid%2Fx', 'next@npm%3A%5E16', 'unrelated@npm%3A16.4.0', '%invalid']) {
    const result = inspect([record('yarn.lock', `__metadata: {version: 8}\n"next@patch:${source}#./x":\n  version: 16.4.0\n  resolution: "next@patch:${source}#./x"\n`)]);
    assert.ok(result.coverage.gaps.length);
    assert.equal(result.inventory.length, 0);
  }
});

test('pnpm registry revisions and patched snapshots preserve base-version warnings and context', () => {
  const text = project.replace('next@16.4.0: {}', 'next@16.4.0: {resolution: {revision: 2}}');
  const result = inspect([manifest, record('pnpm-lock.yaml', text)]);
  const item = result.inventory.find(item => item.provenance === 'lockfile');
  assert.deepEqual(item.modifications, ['registry-revision']);
  assert.equal(item.registryRevision, 2);
  assert.ok(result.findings.some(item => item.id === 'security.rsc-typed-array-rce'));
  assert.deepEqual(validateAuditResult(bundle([manifest, record('pnpm-lock.yaml', text)])), []);
  const invalid = inspect([manifest, record('pnpm-lock.yaml', text.replace('revision: 2', 'revision: -1'))]);
  assert.ok(invalid.coverage.gaps.some(gap => gap.reason === 'invalid-registry-revision'));
});

function localYarn(protocol = 'portal', relative = './packages/local', bindings = 'root%40workspace%3A.') {
  const ref = protocol + ':' + relative + '::locator=' + bindings;
  return `__metadata: {version: 8}
"root@workspace:.":
  resolution: "root@workspace:."
  dependencies: {local: ${JSON.stringify(ref)}}
${JSON.stringify('local@' + ref)}:
  version: 1.0.0
  resolution: ${JSON.stringify('local@' + ref)}
  dependencies: {next: "npm:^16.4.0"}
"next@npm:^16.4.0":
  version: 16.4.0
  resolution: "next@npm:16.4.0"
`;
}
const localManifests = [record('package.json', { name: 'root', dependencies: { local: 'portal:./packages/local' } }),
  record('packages/local/package.json', { name: 'local', version: '1.0.0', dependencies: { next: '^16.4.0' } })];

test('Yarn portal resolves only a bound selected local package and never queries its name as registry evidence', async () => {
  const records = [...localManifests, record('yarn.lock', localYarn())];
  const result = inspect(records);
  assert.deepEqual(result.coverage.gaps.map(gap => gap.reason), ['local-package-registry-origin-unverified']);
  assert.equal(result.graphs[0].nodes.find(node => node.kind === 'local').manifest, 'packages/local/package.json');
  const locked = result.inventory.filter(item => item.provenance === 'lockfile');
  assert.equal(locked.length, 1);
  assert.equal(locked[0].name, 'next');
  assert.equal(locked[0].workspaceUsage[0].direct, false);
  const audit = bundle(records);
  assert.deepEqual(validateAuditResult(audit), []);
  const report = await queryInventory(audit, { fetchImpl: async (url, options) => { assert.doesNotMatch(options.body, /local|portal|packages/); return response([{}]); } });
  assert.equal(report.declarations.find(item => item.name === 'local').status, 'workspace-link');
  assert.equal(report.declarations.find(item => item.manifest === 'packages/local/package.json' && item.name === 'next').status, 'covered-by-lock');
});

test('Yarn file folder copies retain graph evidence but do not claim current source equals the installed copy', () => {
  const records = [record('package.json', { name: 'root', dependencies: { local: 'file:./packages/local' } }), localManifests[1], record('yarn.lock', localYarn('file'))];
  const result = inspect(records);
  assert.ok(result.graphs[0].nodes.some(node => node.kind === 'local'));
  assert.ok(result.coverage.gaps.some(gap => gap.reason === 'local-package-copy-unverified'));
  assert.ok(result.findings.some(item => item.id === 'security.rsc-typed-array-rce'));
});

test('local references cannot escape the selected lock root, infer an unbound parent, or unpack archives', () => {
  for (const text of [localYarn('portal', '../../outside'), localYarn('portal', '%2Fabsolute'), localYarn('portal', './packages/local', 'missing%40workspace%3A.'), localYarn('file', './local.tgz')]) {
    const result = inspect([...localManifests, record('yarn.lock', text)]);
    assert.ok(result.coverage.gaps.length);
    assert.ok(!result.graphs[0].nodes.some(node => node.kind === 'local'));
  }
  assert.equal(fileExclusionReason({ name: 'bun.lockb', path: 'bun.lockb', size: 100 }), 'binary-lockfile');
});

test('pnpm snapshot patches keep original advisory coordinates and document aliases cannot bypass parser limits', () => {
  const text = project.replaceAll('version: 16.4.0}', 'version: 16.4.0(patch_hash=abc)}').replace('snapshots:\n  next@16.4.0: {}', 'snapshots:\n  next@16.4.0(patch_hash=abc): {}');
  const result = inspect([manifest, record('pnpm-lock.yaml', text)]);
  assert.deepEqual(result.coverage.gaps, []);
  assert.deepEqual(result.inventory.find(item => item.provenance === 'lockfile').modifications, ['patch']);
  assert.ok(result.findings.some(item => item.id === 'security.rsc-typed-array-rce'));
  for (const bad of [boot + '\na: &a [1]\nb: *a\n---\n' + project, boot + '\na: ' + '['.repeat(55) + '1' + ']'.repeat(55) + '\n---\n' + project]) {
    assert.ok(inspect([record('pnpm-lock.yaml', bad)]).coverage.gaps.length);
  }
});

test('source selectors are redacted consistently in manifests, project context and graph versions without inventing npm versions', () => {
  const selector = 'git+https://user:private-token@example.invalid/repo#main';
  const records = [record('package.json', { dependencies: { next: selector, react: 'portal:../private' } }), record('package-lock.json', { lockfileVersion: 3, packages: { '': { dependencies: { next: selector } }, 'node_modules/next': { version: selector } } })];
  const audit = bundle(records);
  assert.doesNotMatch(JSON.stringify(audit), /private-token|example.invalid|\.\.\/private/);
  assert.ok(audit.securityContext.coverage.gaps.length);
  assert.ok(!audit.findings.some(item => item.id === 'security.rsc-typed-array-rce'));
  assert.deepEqual(validateAuditResult(audit), []);
});

test('replacing a registry dependency with a same-version local package does not prove the old advisory fixed', () => {
  const before = bundle([record('package.json', {}), record('package-lock.json', { lockfileVersion: 3, packages: { '': {}, 'node_modules/next': { version: '16.4.0' } } })]);
  const after = bundle([record('package.json', { name: 'root', dependencies: { next: 'portal:./packages/next' } }), record('packages/next/package.json', { name: 'next', version: '16.4.0' }), record('yarn.lock', `__metadata: {version: 8}
"root@workspace:.":
  resolution: "root@workspace:."
  dependencies: {next: "portal:./packages/next::locator=root%40workspace%3A."}
"next@portal:./packages/next::locator=root%40workspace%3A.":
  version: 16.4.0
  resolution: "next@portal:./packages/next::locator=root%40workspace%3A."
`)]);
  const fingerprint = before.findings.find(item => item.id === 'security.rsc-typed-array-rce').fingerprint;
  const compared = compareWithBaseline(after, createBaseline(before));
  assert.ok(compared.diff.unverified.includes(fingerprint));
  assert.ok(!compared.diff.resolved.includes(fingerprint));
});

test('malformed manifest dependency maps and non-string selectors cannot hide lost version evidence', () => {
  const before = bundle([record('package.json', {}), record('package-lock.json', { lockfileVersion: 3, packages: { '': {}, 'node_modules/next': { version: '16.4.0' } } })]);
  const baseline = createBaseline(before);
  const fingerprint = before.findings.find(item => item.id === 'security.rsc-typed-array-rce').fingerprint;
  for (const dependencies of [[], null, false, { next: null }, { next: 16 }, { next: {} }]) {
    const after = bundle([record('package.json', { dependencies })]);
    assert.ok(after.securityContext.coverage.gaps.length);
    assert.ok(compareWithBaseline(after, baseline).diff.unverified.includes(fingerprint));
  }
});
