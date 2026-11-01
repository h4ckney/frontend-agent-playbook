import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {queryInventory} from '../scripts/query-osv.mjs';
const require = createRequire(import.meta.url);
const {inspectSecurityContext} = require('./security-context.js');
const {createAuditBundle, validateAuditResult, compareWithBaseline, createBaseline, buildAuditMarkdown} = require('./audit-contract.js');
const {selectFilesWithinBudget} = require('./analyzer.js');
const {findingSignature} = require('./triage-state.js');
const at = '2026-11-02T03:00:00Z';
const rec = (path, content) => ({path, content: typeof content === 'string' ? content : JSON.stringify(content)});
const inspect = (records, now = at) => inspectSecurityContext(records, {now});
const bundle = (records, now = at) => createAuditBundle({records, generatedAt: now}).audit;
const row = (result, component) => result.lifecycle.entries.find(entry => entry.component === component);
const ids = result => result.findings.map(item => item.id);

test('Deno runtime retirement is a product announcement, never an already-ended runtime or a hosting assumption', () => {
  const result = inspect([rec('.deno-version', '2.9.8')]);
  assert.equal(row(result, 'deno-runtime').state, 'end-announced');
  assert.equal(row(result, 'deno-runtime').supportEnds, '2027-10');
  assert.equal(row(result, 'deno-runtime').datePrecision, 'month');
  assert.equal(row(result, 'deno-runtime').dateBasis, 'announcement-relative');
  assert.equal(row(result, 'deno-runtime').supportScope, 'product');
  assert.equal(result.lifecycle.entries.length, 1);
  assert.ok(ids(result).includes('security.support-ending'));
  assert.ok(!ids(result).includes('security.runtime-eol'));
  assert.equal(result.inventory[0].ecosystem, 'runtime');
  assert.equal(result.inventory[0].name, 'deno');
});

test('Deno JSONC runtime, new Deploy and JSR keep independent categories, deadlines and issue boundaries', () => {
  const records = [rec('deno.jsonc', '{ // local configuration\n"deploy":{"app":"private-app-name"},"imports":{"@std/assert":"jsr:@std/assert@^1"},}')];
  const result = inspect(records);
  assert.equal(row(result, 'deno-runtime').supportEnds, '2027-10');
  assert.equal(row(result, 'deno-deploy').supportEnds, '2027-04');
  assert.equal(row(result, 'deno-deploy').category, 'hosting');
  assert.equal(row(result, 'jsr').state, 'continuing');
  assert.equal(row(result, 'jsr').supportEnds, null);
  const audit = bundle(records);
  assert.deepEqual(validateAuditResult(audit), []);
  const planned = audit.findings.filter(item => item.id === 'security.support-ending');
  assert.equal(planned.length, 2);
  assert.equal(new Set(planned.flatMap(item => item.scope.boundaryIds)).size, 2);
  assert.doesNotMatch(JSON.stringify(audit), /private-app-name/);
  assert.match(buildAuditMarkdown(audit, {locale:'ko'}), /2027-04.*month.*announcement-relative/);
});

test('Deploy Classic is ended under its own exact calendar; deployctl does not inherit the new Deploy deadline', () => {
  const result = inspect([rec('.github/workflows/deploy.yml', 'jobs:\n  classic:\n    steps:\n      - uses: denoland/deployctl@v1\n        with: {project: secret-project}\n')]);
  assert.equal(row(result, 'deno-deploy-classic').state, 'ended');
  assert.equal(row(result, 'deno-deploy-classic').supportEnds, '2026-07-20');
  assert.ok(!row(result, 'deno-deploy'));
  assert.ok(!row(result, 'deno-runtime'));
  const audit = bundle([rec('package.json', {scripts:{old:'deployctl deploy', modern:'deno deploy'}})]);
  assert.equal(audit.findings.find(item => item.id === 'security.runtime-eol').severity, 'high');
  assert.equal(audit.findings.find(item => item.id === 'security.support-ending').severity, 'medium');
});

test('Node support dates replace branch allowlists: past, maintenance, future and unknown branches differ', () => {
  for (const [version, state] of [['20.19.0','ended'], ['22.23.4','maintenance'], ['24.22.1','maintenance'], ['25.0.0','ended'], ['26.12.1','supported'], ['27.0.0','not-released'], ['30.0.0','unknown']]) {
    const result = inspect([rec('.node-version',version)]);
    assert.equal(row(result,'node').state,state,version);
    assert.equal(ids(result).includes('security.runtime-eol'),state === 'ended',version);
  }
  assert.equal(row(inspect([rec('.node-version','22')]),'node').endingSoon,true);
  assert.equal(row(inspect([rec('.node-version','24')]),'node').endingSoon,false);
});

test('PHP active support and security support are distinct; a major-only selector never gets a made-up minor', () => {
  for (const [version,state] of [['8.1.34','ended'],['8.2.35','security-only'],['8.3.36','security-only'],['8.4.27','supported'],['8.5.12','supported'],['8','unknown'],['8.6.0','unknown']]) {
    const result = inspect([rec('.php-version',version)]);
    assert.equal(row(result,'php').state,state,version);
  }
  assert.equal(row(inspect([rec('.php-version','8.2')]),'php').endingSoon,true);
  assert.equal(row(inspect([rec('.php-version','8.4')]),'php').supportEnds,'2028-12-31');
});

test('Bun uses its published 1.x policy without inventing an EOL date or supporting unknown majors/channels', () => {
  const supported = inspect([rec('.bun-version','1.4.4')]);
  assert.equal(row(supported,'bun').state,'supported');
  assert.equal(row(supported,'bun').supportEnds,null);
  assert.equal(row(supported,'bun').supportScope,'major-family');
  assert.ok(!ids(supported).includes('security.support-ending'));
  for (const version of ['2.0.0','canary','1.4.4-canary']) assert.equal(row(inspect([rec('.bun-version',version)]),'bun').state,'unknown');
  assert.equal(row(inspect([rec('package.json',{packageManager:'bun@1.4.4'})]),'bun').phase,'build');
});

test('Korean date boundaries retain support through the official final day', () => {
  const records = [rec('.node-version','22')];
  const before = inspect(records,'2027-04-30T14:59:59Z');
  const after = inspect(records,'2027-04-30T15:00:00Z');
  assert.equal(before.lifecycle.asOf,'2027-04-30');
  assert.equal(row(before,'node').state,'maintenance');
  assert.equal(after.lifecycle.asOf,'2027-05-01');
  assert.equal(row(after,'node').state,'ended');
  assert.equal(after.lifecycle.policy.freshness,'stale');
});

test('relative Deno announcements never turn into observed shutdown claims after an estimated month', () => {
  const records = [rec('deno.json',{deploy:{}})];
  const during = inspect(records,'2027-04-15T00:00:00Z');
  const after = inspect(records,'2027-05-01T00:00:00Z');
  assert.equal(row(during,'deno-deploy').state,'end-announced');
  assert.equal(row(after,'deno-deploy').state,'unknown');
  assert.equal(row(after,'deno-deploy').datePrecision,'month');
  assert.equal(row(after,'deno-runtime').state,'end-announced');
  assert.ok(!ids(after).includes('security.runtime-eol'));
});

test('invalid clocks and dates before policy review do not manufacture ended/supported states', () => {
  for (const now of ['not-a-date','2026-11-01T14:59:59Z','+275760-09-13T00:00:00Z']) {
    const result = inspect([rec('.node-version','20'),rec('deno.json',{})],now);
    assert.equal(result.lifecycle.policy.freshness,'unverified-clock');
    assert.ok(result.lifecycle.entries.every(entry=>entry.state === 'unknown'));
    assert.ok(!ids(result).includes('security.runtime-eol'));
  }
  assert.equal(inspect([rec('.node-version','20')],'2026-11-01T15:00:00Z').lifecycle.policy.freshness,'within-30-days');
});

test('official Docker images retain stages; prerelease tags cannot masquerade as stable vulnerable pins', () => {
  const result = inspect([rec('Dockerfile','FROM denoland/deno:alpine-2.9.8 AS build\nFROM oven/bun:1.4.4-alpine\n')]);
  assert.deepEqual(result.inventory.map(item=>[item.name,item.version,item.phase]),[['deno','2.9.8','build'],['bun','1.4.4','runtime']]);
  const prerelease = inspect([rec('Dockerfile','FROM node:24.22.0-rc.1 AS a\nFROM php:8.4.26-beta1\n')]);
  assert.ok(prerelease.inventory.every(item=>item.versionKind === 'image-selector'));
  assert.ok(!ids(prerelease).includes('security.node-brotli-2026'));
  assert.ok(!ids(prerelease).includes('security.php-oom-2026'));
  assert.ok(prerelease.lifecycle.entries.every(entry=>entry.state === 'unknown'));
  assert.equal(inspect([rec('Dockerfile','FROM private/deno:2.9.8')]).lifecycle.entries.length,0);
});

test('compatibility and Composer platform values do not prove an installed unsupported runtime', () => {
  const result = inspect([rec('package.json',{engines:{node:'20.0.0'}}),rec('composer.json',{require:{php:'8.1.30'},config:{platform:{php:'8.1.30'}}})]);
  assert.ok(result.lifecycle.entries.every(entry=>entry.state === 'unknown'));
  assert.ok(!ids(result).includes('security.runtime-eol'));
  assert.ok(!ids(result).includes('security.lifecycle-coverage')); // Existing version gap owns this uncertainty.
});

test('setup action versions bind to their own step and retain build-only phase', () => {
  const records = [rec('.github/workflows/build.yml', 'jobs:\n  check:\n    steps:\n      - uses: custom/action@v1\n        with:\n          node-version: 20.0.0\n      - uses: actions/setup-node@v7\n        with: {node-version: 26.12.1}\n      - uses: denoland/setup-deno@v2\n        with: {deno-version: v2.9.8}\n      - uses: oven-sh/setup-bun@v2\n        with: {bun-version: 1.4.4}\n')];
  const result = inspect(records);
  assert.deepEqual(result.inventory.map(item=>[item.name,item.version,item.phase]),[['node','26.12.1','build'],['deno','v2.9.8','build'],['bun','1.4.4','build']]);
  assert.ok(!ids(result).includes('security.runtime-eol'));
  assert.equal(row(result,'deno-runtime').state,'end-announced');
});

test('JSR publishing/proxy dependencies do not imply Deno runtime or hosting usage', async () => {
  const records = [rec('jsr.jsonc','{"name":"@private/module","exports":"./mod.ts",}'),rec('package.json',{dependencies:{'@jsr/std__assert':'^1'}})];
  const result = inspect(records);
  assert.ok(result.lifecycle.entries.every(entry=>entry.component === 'jsr' && entry.state === 'continuing'));
  assert.ok(!ids(result).some(id=>id === 'security.support-ending' || id === 'security.runtime-eol'));
  const audit = bundle(records);
  assert.deepEqual(validateAuditResult(audit),[]);
  assert.doesNotMatch(JSON.stringify(audit),/@private\/module/);
  const report = await queryInventory(audit,{fetchImpl:async()=>{throw new Error('no locked package coordinate should be transmitted');}});
  assert.equal(report.coverage.queriedPackages,0);
});

test('docs and help commands are not usage; invalid configuration remains a gap and version pins are not inherited by siblings', () => {
  assert.deepEqual(inspect([rec('README.md','deno deploy; JSR; denoland/deployctl'),rec('package.json',{scripts:{help:'deno deploy --help'}})]).lifecycle.entries,[]);
  const bad = inspect([rec('deno.jsonc','{"deploy":{},"deploy":{},}')]);
  assert.ok(bad.lifecycle.gaps.length);
  assert.equal(bad.lifecycle.entries.length,0);
  const siblings = inspect([rec('apps/a/.deno-version','2.9.8'),rec('apps/b/deno.json',{})]);
  assert.equal(siblings.lifecycle.entries.filter(entry=>entry.component === 'deno-runtime').length,2);
  assert.equal(siblings.lifecycle.entries.find(entry=>entry.manifest === 'apps/b/deno.json').version,null);
  const selected = selectFilesWithinBudget(['.deno-version','.bun-version','.tool-versions','deno.jsonc','jsr.jsonc'].map(name=>({name,size:100})));
  assert.equal(selected.accepted.length,5);
});

test('missing/unknown lifecycle evidence cannot resolve an old ended runtime, but a supported replacement can', () => {
  const previous = bundle([rec('.node-version','20.0.0')]);
  const baseline = createBaseline(previous);
  const fingerprint = previous.findings.find(item=>item.id === 'security.runtime-eol').fingerprint;
  for (const records of [[],[rec('.node-version','latest')],[rec('.node-version','30.0.0')]]) {
    const after = compareWithBaseline(bundle(records),baseline);
    assert.ok(after.diff.unverified.includes(fingerprint));
    assert.ok(!after.diff.resolved.includes(fingerprint));
  }
  assert.ok(compareWithBaseline(bundle([rec('.node-version','26.12.1')]),baseline).diff.resolved.includes(fingerprint));
  assert.ok(compareWithBaseline(bundle([rec('.node-version','26.12.1')],'2026-12-03T00:00:00Z'),baseline).diff.unverified.includes(fingerprint));
});

test('upcoming-to-ended is a worsened lifecycle transition, not a resolved preparation issue', () => {
  const records = [rec('.node-version','22')];
  const before = bundle(records);
  const fingerprint = before.findings.find(item=>item.id === 'security.support-ending').fingerprint;
  const after = bundle(records,'2027-05-01T00:00:00Z');
  after.securityContext.lifecycle.policy.freshness='within-30-days'; // Isolate transition logic from the stale-policy guard.
  const compared = compareWithBaseline(after,createBaseline(before));
  assert.ok(compared.diff.unverified.includes(fingerprint));
  assert.ok(!compared.diff.resolved.includes(fingerprint));
  assert.ok(compared.findings.some(item=>item.id === 'security.runtime-eol' && item.diffStatus === 'new'));
});

test('policy freshness and component boundaries affect review signatures without copying source secrets', () => {
  const records=[rec('.node-version','20.0.0'),rec('package.json',{scripts:{deploy:'deployctl deploy'}})];
  const current=bundle(records), older=bundle(records,'2026-12-03T00:00:00Z');
  const runtime=current.findings.find(item=>item.id === 'security.runtime-eol' && item.scope.paths.includes('.node-version'));
  const hosting=current.findings.find(item=>item.id === 'security.runtime-eol' && item.scope.paths.includes('package.json'));
  assert.equal(runtime.severity,'medium');
  assert.equal(hosting.severity,'high');
  assert.notDeepEqual(runtime.scope.boundaryIds,hosting.scope.boundaryIds);
  assert.notEqual(findingSignature(runtime),findingSignature(older.findings.find(item=>item.fingerprint === runtime.fingerprint)));
});

test('an exact Composer PHP compatibility constraint cannot resolve a previously pinned vulnerable runtime', () => {
  const previous=bundle([rec('.php-version','8.4.26')]);
  const fingerprint=previous.findings.find(item=>item.id === 'security.php-oom-2026').fingerprint;
  const current=bundle([rec('composer.json',{require:{php:'8.4.26'}})]);
  assert.equal(current.securityContext.coverage.unresolvedVersionCount,1);
  const compared=compareWithBaseline(current,createBaseline(previous));
  assert.ok(compared.diff.unverified.includes(fingerprint));
  assert.ok(!compared.diff.resolved.includes(fingerprint));
});

test('quoted mentions and comments are not deployment commands, while a preceding version check does not hide deployment', () => {
  const mentions=inspect([rec('package.json',{scripts:{quote:'echo "done && deployctl deploy"', comment:'echo done # deno deploy'}})]);
  assert.equal(mentions.lifecycle.entries.length,0);
  const actual=inspect([rec('package.json',{scripts:{deploy:'deno --version && deno deploy'}})]);
  assert.equal(row(actual,'deno-deploy').state,'end-announced');
  const maintenance=inspect([rec('.node-version','26')],'2027-10-20T00:00:00Z');
  assert.equal(row(maintenance,'node').state,'maintenance');
});

test('a product retirement review is stable across patch upgrades, while release-line lifecycle evidence changes', () => {
  const before=bundle([rec('.deno-version','2.9.7')]);
  const after=bundle([rec('.deno-version','2.9.8')]);
  const first=before.findings.find(item=>item.id === 'security.support-ending');
  const second=after.findings.find(item=>item.id === first.id);
  assert.equal(findingSignature(first),findingSignature(second));
  const nodeBefore=bundle([rec('.node-version','20.0.0')]).findings.find(item=>item.id === 'security.runtime-eol');
  const nodeAfter=bundle([rec('.node-version','18.0.0')]).findings.find(item=>item.id === 'security.runtime-eol');
  assert.notEqual(findingSignature(nodeBefore),findingSignature(nodeAfter));
});

test('Deno dependency imports remain an explicit version-coverage gap instead of clearing an old npm advisory', () => {
  const before=bundle([rec('package-lock.json',{lockfileVersion:3,packages:{'node_modules/next':{version:'16.4.0'}}})]);
  const fingerprint=before.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
  const after=bundle([rec('.deno-version','2.9.8'),rec('deno.json',{imports:{next:'npm:next@16.4.0'}})]);
  assert.ok(after.securityContext.coverage.gaps.some(item=>item.reason === 'deno-dependency-lock-coverage-unavailable'));
  const compared=compareWithBaseline(after,createBaseline(before));
  assert.ok(compared.diff.unverified.includes(fingerprint));
  assert.ok(!compared.diff.resolved.includes(fingerprint));
  const selected=selectFilesWithinBudget([{name:'deno.lock',size:100}]);
  assert.equal(selected.excludedByReason['unsupported-lockfile'], undefined);
  assert.equal(selected.coverageIncomplete,false);
});

 test('null or scalar configuration roots remain gaps and never crash a scan', () => {
  for (const content of ['null', '[]', '"text"']) {
    const result = inspect([rec('deno.json', content), rec('jsr.json', content), rec('.github/workflows/ci.yml', '# actions/setup-node@v4\n' + content)]);
    assert.equal(result.lifecycle.entries.length, 0);
    assert.ok(result.lifecycle.gaps.some(item => item.reason === 'invalid-lifecycle-configuration'));
    assert.ok(result.coverage.gaps.length > 0);
  }
});

test('explicit LTS selectors receive a separate dated line policy without fabricating an installed patch', () => {
  for (const records of [[rec('.dvmrc','lts')],[rec('.deno-version','lts')],[rec('.tool-versions','deno lts')],[rec('.github/workflows/ci.yml','jobs:\n  test:\n    steps:\n      - uses: denoland/setup-deno@v2\n        with:\n          deno-version: lts\n')]]) {
    const result=inspect(records), lts=row(result,'deno-lts');
    assert.equal(lts.releaseLine,'2.9');
    assert.match(buildAuditMarkdown(bundle(records),{locale:'ko'}), /lts \/ LTS 2\.9/);
    assert.equal(lts.version,'lts');
    assert.equal(lts.supportEnds,'2027-01-31');
    assert.equal(lts.state,'maintenance');
    assert.equal(lts.endingSoon,true);
    assert.equal(row(result,'deno-runtime').supportEnds,'2027-10');
    assert.deepEqual(validateAuditResult(bundle(records)),[]);
    assert.ok(!result.inventory.some(item=>item.versionKind === 'runtime-pin'));
  }
});

test('numeric Deno versions, unrelated action inputs and comments never imply an LTS channel', () => {
  for(const records of [[rec('.deno-version','2.9.3')],[rec('deno.json',{description:'lts'})],[rec('.github/workflows/ci.yml','jobs:\n  test:\n    steps:\n      - uses: vendor/custom@v1\n        with: {deno-version: lts}\n      - uses: denoland/setup-deno@v2\n        with: {deno-version: "2.9.3"}\n')]]) assert.equal(row(inspect(records),'deno-lts'),undefined);
});

test('a moving LTS channel outside a reviewed window stays unknown instead of confirming an old branch is still installed', () => {
  const records=[rec('.dvmrc','lts')];
  assert.equal(row(inspect(records,'2027-01-31T03:00:00Z'),'deno-lts').state,'maintenance');
  const expired=inspect(records,'2027-02-01T03:00:00Z');
  assert.equal(row(expired,'deno-lts').state,'unknown');
  assert.equal(row(expired,'deno-lts').supportEnds,null);
  assert.equal(row(expired,'deno-lts').releaseLine,undefined);
  const before=bundle(records), after=bundle(records,'2027-02-01T03:00:00Z');
  const id=before.findings.find(item=>item.observedFact.includes('Deno LTS')).fingerprint;
  assert.ok(compareWithBaseline(after,createBaseline(before)).diff.unverified.includes(id));
});
