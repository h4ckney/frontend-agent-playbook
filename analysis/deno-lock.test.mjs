import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {queryInventory} from '../scripts/query-osv.mjs';
const require = createRequire(import.meta.url);
const {inspectSecurityContext} = require('./security-context.js');
const {createAuditBundle, createBaseline, compareWithBaseline, validateAuditResult} = require('./audit-contract.js');
const rec = (path, content) => ({path, content:typeof content === 'string' ? content : JSON.stringify(content)});
const at = '2026-11-02T03:00:00Z';
const inspect = records => inspectSecurityContext(records, {now:at});
const lock = (overrides={}) => ({version:'5', specifiers:{'npm:next@^16.4.0':'16.4.0'}, npm:{'next@16.4.0':{integrity:'sha512-synthetic'}}, workspace:{dependencies:['npm:next@^16.4.0']}, ...overrides});
const files = (data=lock(),config={imports:{next:'npm:next@^16.4.0'}}) => [rec('deno.lock',data),rec('deno.json',config)];
const bundle = records => createAuditBundle({records,generatedAt:at}).audit;

test('v5 npm inventory connects the configured import root to existing advisories without executing Deno', () => {
  const result=inspect(files());
  assert.deepEqual(result.coverage.gaps,[]);
  assert.equal(result.graphs[0].format,'deno');
  assert.equal(result.graphs[0].complete,true);
  assert.equal(result.inventory[0].phase,'runtime');
  assert.deepEqual(result.inventory[0].workspaceUsage,[{manifest:'deno.json',phase:'runtime',direct:true,dependency:'next'}]);
  assert.ok(result.findings.some(item=>item.id === 'security.rsc-typed-array-rce'));
  assert.deepEqual(validateAuditResult(bundle(files())),[]);
});

test('v3 nested and v4 flat layouts retain exact pins but never pretend missing optional metadata is complete', () => {
  for(const version of ['3','4']) {
    const data=lock({version});
    if(version === '3') {data.packages={specifiers:{'npm:next@^16.4.0':'npm:next@16.4.0'},npm:data.npm};delete data.specifiers;delete data.npm;}
    const result=inspect(files(data));
    assert.equal(result.inventory[0].version,'16.4.0');
    assert.equal(result.graphs[0].complete,false);
    assert.ok(result.coverage.gaps.some(item=>item.reason === 'deno-legacy-optional-metadata-unavailable'));
    assert.ok(result.findings.some(item=>item.id === 'security.rsc-typed-array-rce'));
  }
});

test('JSR packages preserve their ecosystem and npm transitive edges without becoming npm OSV queries', async () => {
  const data=lock({specifiers:{'jsr:@example/app@^1':'1.0.0','npm:next@^16.4.0':'16.4.0'},jsr:{'@example/app@1.0.0':{integrity:'synthetic',dependencies:['npm:next']}},workspace:{dependencies:['jsr:@example/app@^1']}});
  const records=files(data,{imports:{app:'jsr:@example/app@^1'}}), result=inspect(records);
  assert.equal(result.graphs[0].complete,true);
  const next=result.inventory.find(item=>item.ecosystem === 'npm');
  assert.equal(next.workspaceUsage[0].direct,false);
  assert.ok(result.coverage.gaps.some(item=>item.reason === 'jsr-advisory-coverage-unavailable'));
  const requests=[];
  const response=await queryInventory(bundle(records),{fetchImpl:async (url,init)=>{requests.push(JSON.parse(init.body));return new Response(JSON.stringify({results:[{}]}));}});
  assert.equal(response.packages.length,1);
  assert.deepEqual(requests[0].queries[0].package,{ecosystem:'npm',name:'next'});
  assert.ok(response.skipped.some(item=>item.ecosystem === 'jsr' && item.reason === 'unsupported-ecosystem'));
});

test('npm aliases, optional edges and peer-specific instances keep exact identities', () => {
  const data=lock();
  data.npm['next@16.4.0'].dependencies=['alias@npm:react@19.0.0'];
  data.npm['next@16.4.0'].optionalDependencies=['react-server-dom-webpack@19.0.0_react@19.0.0'];
  data.npm['next@16.4.0'].optionalPeers=['react'];
  data.npm['react@19.0.0']={integrity:'synthetic'};
  data.npm['react-server-dom-webpack@19.0.0_react@19.0.0']={integrity:'synthetic'};
  const result=inspect(files(data));
  assert.deepEqual(result.coverage.gaps,[]);
  assert.ok(result.graphs[0].edges.some(item=>item.dependency === 'alias' && item.to === 'npm/react@19.0.0'));
  assert.ok(result.graphs[0].edges.some(item=>item.scope === 'optional'));
  assert.ok(result.inventory.some(item=>item.path.endsWith('_react@19.0.0')));
});

test('bare duplicate versions and missing edges remain gaps instead of selecting an arbitrary package', () => {
  const data=lock();data.npm['next@16.4.0'].dependencies=['react'];data.npm['react@18.0.0']={integrity:'x'};data.npm['react@19.0.0']={integrity:'x'};
  const result=inspect(files(data));
  assert.equal(result.graphs[0].complete,false);
  assert.ok(result.coverage.gaps.some(item=>item.reason === 'unresolved-deno-dependency-edge'));
  assert.ok(!result.graphs[0].edges.some(item=>item.dependency === 'react'));
});

test('root and a member named root remain distinct and package.json roles stay scoped', () => {
  const data=lock({workspace:{dependencies:['npm:next@^16.4.0'],members:{root:{packageJson:{dependencies:['npm:next@^16.4.0']}}}}});
  const result=inspect([...files(data),rec('root/package.json',{devDependencies:{next:'^16.4.0'}})]);
  assert.equal(result.graphs[0].roots.length,2);
  assert.equal(new Set(result.graphs[0].roots.map(item=>item.node)).size,2);
  const uses=result.inventory.find(item=>item.provenance === 'lockfile').workspaceUsage;
  assert.ok(uses.some(item=>item.manifest === 'deno.json' && item.phase === 'runtime'));
  assert.ok(uses.some(item=>item.manifest === 'root/package.json' && item.phase === 'development'));
  assert.equal(result.inventory.find(item=>item.provenance === 'lockfile').phase,'unknown');
});

test('the same package declared in runtime and development retains both roles and a package alias name', () => {
  const data=lock({workspace:{packageJson:{dependencies:['npm:next@^16.4.0']}}});
  const result=inspect([rec('deno.lock',data),rec('package.json',{dependencies:{alias:'npm:next@^16.4.0'},devDependencies:{alias:'npm:next@^16.4.0'}})]);
  const uses=result.inventory.find(item=>item.provenance === 'lockfile').workspaceUsage;
  assert.deepEqual(uses.map(item=>item.phase).sort(),['development','runtime']);
  assert.ok(uses.every(item=>item.dependency === 'alias'));
  assert.ok(!result.coverage.gaps.some(item=>item.reason === 'dependency-without-supported-lock-entry'));
});

test('stale imports, missing workspace files, lock:false and custom lock paths cannot claim complete import coverage', () => {
  for(const config of [{imports:{next:'npm:next@^16.5.0'}},{imports:{next:'npm:next@^16.4.0'},lock:false},{imports:{next:'npm:next@^16.4.0'},lock:'elsewhere.lock'}]) {
    const result=inspect(files(lock(),config));
    if (config.lock !== undefined) assert.equal(result.graphs,undefined);
    else assert.equal(result.graphs[0].complete,false);
    assert.ok(result.coverage.gaps.some(item=>item.reason === 'deno-dependency-lock-coverage-unavailable'));
  }
  assert.equal(inspect([rec('deno.lock',lock())]).graphs[0].complete,false);
});

test('remote selectors never leak credentials, and custom tarballs, links and old/future formats retain old risks as unverified', () => {
  const original=bundle(files()), baseline=createBaseline(original);
  const id=original.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
  for(const data of [lock({version:'2'}),lock({version:'99'}),lock({remote:{'https://user:private-token@host.invalid/private.ts':'hash'},npm:{}}),lock({npm:{'next@16.4.0':{integrity:'x',tarball:'https://user:private-token@host.invalid/private.tgz'}}}),lock({workspace:{dependencies:['npm:next@^16.4.0'],links:{'../secret':{}}}})]) {
    const after=bundle(files(data)), compared=compareWithBaseline(after,baseline);
    assert.ok(after.securityContext.coverage.gaps.length);
    assert.doesNotMatch(JSON.stringify(after),/private-token|host.invalid|private.tgz|\.\.\/secret/);
    if(!compared.diff.unchanged.includes(id)) {assert.ok(compared.diff.unverified.includes(id));assert.ok(!compared.diff.resolved.includes(id));}
  }
});

test('malformed data, duplicate keys, conflict markers and unsafe paths fail into gaps without crashing', () => {
  for(const value of ['null','{"version":"5","npm":{},"npm":{}}','<<<<<<< HEAD\n{}',lock({npm:[]}),lock({workspace:{members:{'../escape':{dependencies:[]}}}}),lock({npm:{'next@999999999999999999999.0.0':{integrity:'x'}}})]) {
    const result=inspect(files(value));
    assert.ok(result.coverage.gaps.length);
    assert.equal(result.graphs[0].complete,false);
    assert.deepEqual(validateAuditResult(bundle(files(value))),[]);
  }
});

test('pinned official Deno v3 JSR and v5 npm fixtures retain their complete recorded graphs', async () => {
  const fs=await import('node:fs/promises');
  const load=name=>fs.readFile(new URL('./fixtures/deno-upstream/'+name,import.meta.url),'utf8');
  const {createHash}=await import('node:crypto');
  for(const [name,hash] of [['v3-jsr.lock','9c1d3a1446a55462f01c8648cd85171a0209b93b379f678451483309db510b4d'],['v5-npm.lock','b229cf5837d22873cc50fd3c3ece9378828f3c1c5611fac963932f5ca1ee5f07'],['v5-package.json','573e44a575d988c7081d78d6b1e4474e182c4cc5851ae91d32024c85c0ef7815']]) assert.equal(createHash('sha256').update(await load(name)).digest('hex'),hash);
  const jsr=inspect([rec('deno.lock',await load('v3-jsr.lock')),rec('deno.json',{imports:{assert:'jsr:@std/assert@^1.0.2'}})]);
  assert.equal(jsr.inventory.length,2);
  assert.equal(jsr.graphs[0].complete,true);
  assert.ok(jsr.graphs[0].edges.some(item=>item.from === 'jsr/@std/assert@1.0.2' && item.to === 'jsr/@std/internal@1.0.1'));
  const npm=inspect([rec('deno.lock',await load('v5-npm.lock')),rec('package.json',await load('v5-package.json'))]);
  assert.equal(npm.graphs[0].complete,true);
  assert.deepEqual(npm.coverage.gaps,[]);
  assert.equal(npm.inventory.filter(item=>item.provenance === 'lockfile').length,68);
  assert.ok(npm.inventory.find(item=>item.path === 'npm/express@4.22.1').workspaceUsage[0].direct);
});

test('known dev build tools retain the same build phase across Deno and npm graph inputs', () => {
  const data=lock({specifiers:{'npm:vite@^7':'7.0.0'},npm:{'vite@7.0.0':{integrity:'synthetic'}},workspace:{packageJson:{dependencies:['npm:vite@^7']}}});
  const result=inspect([rec('deno.lock',data),rec('package.json',{devDependencies:{vite:'^7'}})]);
  const entry=result.inventory.find(item=>item.provenance === 'lockfile');
  assert.equal(entry.phase,'build');
  assert.equal(entry.workspaceUsage[0].phase,'build');
});

test('mixed old/new version layouts remain incomplete rather than silently ignoring hidden package maps', () => {
  for(const data of [{version:'3',packages:{},npm:{'next@16.4.0':{integrity:'x'}}},{version:'5',packages:{npm:{'next@16.4.0':{integrity:'x'}}}}]) {
    const result=inspect([rec('deno.lock',data)]);
    assert.equal(result.graphs[0].complete,false);
    assert.ok(result.coverage.gaps.some(item=>item.reason === 'unsupported-deno-lock-section'));
  }
});

test('actual manifest overrides, local links and external import maps cannot silently validate a stale lock', () => {
  const before=bundle(files()), baseline=createBaseline(before);
  const id=before.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
  for(const records of [
    [rec('deno.lock',lock({specifiers:{'npm:next@^16.4.0':'16.4.1'},npm:{'next@16.4.1':{integrity:'x'}},workspace:{packageJson:{dependencies:['npm:next@^16.4.0']}}})),rec('package.json',{dependencies:{next:'^16.4.0'},overrides:{next:'file:../private-patch'}})],
    files(lock(),{imports:{next:'npm:next@^16.4.0'},links:['../private-patch']}),
    files(lock(),{imports:{next:'npm:next@^16.4.0'},importMap:'https://user:secret-token@private.invalid/imports.json'})
  ]) {
    const result=bundle(records), compared=compareWithBaseline(result,baseline);
    assert.equal(result.securityContext.graphs[0].complete,false);
    assert.ok(result.securityContext.coverage.gaps.length);
    assert.ok(compared.diff.unchanged.includes(id) || compared.diff.unverified.includes(id));
    assert.ok(!compared.diff.resolved.includes(id));
    assert.doesNotMatch(JSON.stringify(result),/private-patch|secret-token|private.invalid/);
  }
});
