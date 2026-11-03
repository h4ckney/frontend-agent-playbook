import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {queryInventory} from '../scripts/query-osv.mjs';
const require=createRequire(import.meta.url);
const {inspectSecurityContext}=require('./security-context.js');
const {createAuditBundle,validateAuditResult,createBaseline,compareWithBaseline,buildAuditMarkdown}=require('./audit-contract.js');
const {selectFilesWithinBudget,extendSelectionForDenoLocks,analysisLimits}=require('./analyzer.js');
const {discoverLocks}=require('./deno-lock.js');
const at='2026-11-03T03:00:00Z';
const rec=(path,content)=>({path,content:typeof content === 'string'?content:JSON.stringify(content)});
const scan=records=>inspectSecurityContext(records,{now:at});
const bundle=records=>createAuditBundle({records,generatedAt:at}).audit;
const hash='a'.repeat(64);
const v2=()=>({version:'2',npm:{specifiers:{'next@^16.4.0':'next@16.4.0'},packages:{'next@16.4.0':{integrity:'synthetic',dependencies:{react:'react@19.0.0'}},'react@19.0.0':{integrity:'synthetic',dependencies:{}}}},remote:{}});
const linked=()=>[
 rec('app/deno.json',{lock:'../locks/runtime.snapshot',links:['../local'],imports:{app:'jsr:@example/local'}}),
 rec('local/deno.json',{name:'@example/local',imports:{next:'npm:next@^16.4.0'}}),
 rec('locks/runtime.snapshot',{version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'synthetic'}},workspace:{dependencies:['jsr:@example/local@*'],links:{'jsr:@example/local':{dependencies:['npm:next@^16.4.0']}}}})
];

test('unversioned v1 preserves only remote integrity count and never derives npm versions or leaks URLs',async()=>{
 const records=[rec('deno.lock',{'https://user:private-token@private.invalid/next@16.4.0.ts':hash})], result=bundle(records);
 assert.deepEqual(validateAuditResult(result),[]);
 assert.equal(result.securityContext.graphs[0].lockVersion,'1');
 assert.equal(result.securityContext.graphs[0].remoteIntegrityCount,1);
 assert.deepEqual(result.securityContext.inventory,[]);
 assert.ok(result.securityContext.coverage.gaps.some(item=>item.reason === 'deno-v1-package-versions-unavailable'));
 assert.doesNotMatch(JSON.stringify(result),/private-token|private.invalid|16.4.0.ts/);
 assert.match(buildAuditMarkdown(result,{locale:'ko'}),/remote integrity records 1/);
 await queryInventory(result,{fetchImpl:async()=>assert.fail('v1 URL metadata must not be queried')});
});

test('v2 npm pins and map edges connect to existing advisories while legacy metadata stays incomplete',()=>{
 const result=scan([rec('deno.lock',v2())]);
 assert.equal(result.graphs[0].lockVersion,'2');
 assert.equal(result.inventory.length,2);
 assert.ok(result.graphs[0].edges.some(item=>item.from === 'npm/next@16.4.0' && item.to === 'npm/react@19.0.0'));
 assert.ok(result.findings.some(item=>item.id === 'security.rsc-typed-array-rce'));
 assert.ok(result.coverage.gaps.some(item=>item.reason === 'deno-legacy-optional-metadata-unavailable'));
 assert.ok(result.inventory.every(item=>item.phase === 'unknown'));
 assert.deepEqual(validateAuditResult(bundle([rec('deno.lock',v2())])),[]);
});

test('custom lock uses config owner directory rather than its storage folder for workspace and links',()=>{
 const result=scan(linked()),graph=result.graphs[0];
 assert.equal(graph.lockfile,'locks/runtime.snapshot');
 assert.equal(graph.complete,true);
 assert.equal(graph.roots[0].manifest,'app/deno.json');
 assert.ok(graph.nodes.some(item=>item.kind === 'local' && item.manifest === 'local/deno.json'));
 assert.equal(result.inventory[0].workspaceUsage[0].manifest,'app/deno.json');
 assert.equal(result.inventory[0].workspaceUsage[0].direct,false);
 assert.equal(result.inventory[0].phase,'runtime');
 assert.deepEqual(result.coverage.gaps,[{path:'local/deno.json',reason:'deno-local-package-content-unverified'}]);
 assert.deepEqual(validateAuditResult(bundle(linked())),[]);
});

test('custom selection includes only declared targets, retaining limits and protected-file exclusions',()=>{
 const files=[{path:'app/deno.json',name:'deno.json',size:100},{path:'locks/runtime.snapshot',name:'runtime.snapshot',size:200},{path:'other.snapshot',name:'other.snapshot',size:100}];
 const initial=selectFilesWithinBudget(files),selected=extendSelectionForDenoLocks(files,linked(),initial);
 assert.equal(selected.additional.length,1);
 assert.equal(selected.additional[0].path,'locks/runtime.snapshot');
 assert.equal(selected.acceptedBytes,300);
 assert.equal(selected.excludedByReason['unsupported-type'],1);
 const blocked=extendSelectionForDenoLocks(files,linked(),{...initial,acceptedBytes:analysisLimits.maxTotalBytes-50});
 assert.equal(blocked.additional.length,0);
 assert.equal(blocked.excludedByReason['input-budget'],1);
 assert.equal(blocked.coverageIncomplete,true);
 for(const path of ['../outside.lock','/private/keys','file:///tmp/secret','https://private.invalid/lock','%2e%2e/secret','..\\secret','.env.local','.ssh/id_rsa','.aws/credentials','secret.pem','package.json']) {
  const discovery=discoverLocks([rec('deno.json',{lock:path})]);
  assert.equal(discovery.plans.length,0,path);
  assert.ok(discovery.gaps.some(item=>item.reason === 'unsafe-deno-lock-path'),path);
 }
});

test('custom object config, no-extension target and missing/ambiguous ownership fail conservatively',()=>{
 const records=linked();records[0]=rec('app/deno.json',{lock:{path:'../locks/pins'},links:['../local'],imports:{app:'jsr:@example/local'}});records[2].path='locks/pins';
 assert.equal(scan(records).graphs[0].complete,true);
 const missing=scan(records.slice(0,2));
 assert.ok(missing.coverage.gaps.some(item=>item.reason === 'deno-custom-lock-unavailable'));
 const ambiguous=scan([...records,rec('other/deno.json',{lock:'../locks/pins'})]);
 assert.ok(ambiguous.coverage.gaps.some(item=>item.reason === 'ambiguous-deno-lock-owner'));
 assert.equal(ambiguous.graphs[0].roots.length,0);
});

test('literal npm links and legacy patch metadata retain local identities without querying local package versions',async()=>{
 const records=[rec('deno.json',{links:['./lib']}),rec('package.json',{dependencies:{lib:'^1'}}),rec('lib/package.json',{name:'lib',version:'1.0.0',dependencies:{next:'^16.4.0'}}),rec('deno.lock',{version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'x'}},workspace:{packageJson:{dependencies:['npm:lib@^1']},patches:{'npm:lib':{dependencies:['npm:next@^16.4.0']}}}})];
 const result=bundle(records);
 assert.equal(result.securityContext.graphs[0].complete,true);
 assert.ok(result.securityContext.graphs[0].nodes.some(item=>item.name === 'lib' && item.kind === 'local'));
 assert.ok(!result.securityContext.inventory.some(item=>item.name === 'lib' && item.provenance === 'lockfile'));
 const queries=[];
 await queryInventory(result,{fetchImpl:async(url,init)=>{queries.push(JSON.parse(init.body));return new Response(JSON.stringify({results:[{}]}));}});
 assert.deepEqual(queries[0].queries.map(item=>item.package.name),['next']);
});

test('missing, duplicate, outside-root, glob and stale local links never resolve a previous advisory',()=>{
 const before=bundle(linked()),baseline=createBaseline(before),id=before.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
 for(const paths of [['../../outside'],['../missing'],['../../*']]) {
  const records=linked();records[0]=rec('app/deno.json',{lock:'../locks/runtime.snapshot',links:paths,imports:{app:'jsr:@example/local'}});
  const after=bundle(records),compared=compareWithBaseline(after,baseline);
  assert.ok(after.securityContext.coverage.gaps.length);
  assert.ok(!compared.diff.resolved.includes(id));
  assert.equal(after.securityContext.graphs[0].complete,false);
 }
 const stale=linked();stale[1]=rec('local/deno.json',{name:'@example/local',imports:{next:'npm:next@^17'}});
 assert.ok(scan(stale).coverage.gaps.some(item=>item.reason === 'stale-deno-local-declaration'));
});

test('malformed v1/v2 data and mixed sections preserve explicit gaps rather than crashing',()=>{
 for(const data of [{'https://private.invalid/mod.ts':'not-a-sha256'},{version:'1'}, {version:'2',npm:[]},{version:'2',npm:{specifiers:[]}},{version:'2',packages:{}},{version:'2',npm:{packages:{'next@9999999999999999999.0.0':{integrity:'x'}}}}]) {
  const result=bundle([rec('deno.lock',data)]);
  assert.deepEqual(validateAuditResult(result),[]);
  assert.ok(result.securityContext.coverage.gaps.length);
  assert.equal(result.securityContext.graphs[0].complete,false);
 }
});

test('an explicitly replaced default lock cannot keep reporting inactive old pins or borrow missing replacement evidence',()=>{
 const old=rec('deno.lock',{version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'x'}},workspace:{dependencies:['npm:next@^16.4.0']}});
 const before=bundle([rec('deno.json',{imports:{next:'npm:next@^16.4.0'}}),old]);
 const id=before.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
 const config=rec('deno.json',{lock:'locks/fixed.snapshot',imports:{next:'npm:next@^16.4.0'}});
 const replacement=rec('locks/fixed.snapshot',{version:'5',specifiers:{'npm:next@^16.4.0':'16.4.1'},npm:{'next@16.4.1':{integrity:'x'}},workspace:{dependencies:['npm:next@^16.4.0']}});
 const after=bundle([config,old,replacement]);
 assert.equal(after.securityContext.graphs.length,1);
 assert.ok(!after.findings.some(item=>item.id === 'security.rsc-typed-array-rce'));
 assert.ok(compareWithBaseline(after,createBaseline(before)).diff.resolved.includes(id));
 const missing=bundle([config,old]);
 assert.equal(missing.securityContext.inventory.length,0);
 assert.ok(compareWithBaseline(missing,createBaseline(before)).diff.unverified.includes(id));
});

test('official pinned v1/v2 test inputs retain source integrity and recorded npm versions',async()=>{
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 for(const [version,count] of [['1',0],['2',2]]) {
  const content=await readFile(new URL('./fixtures/deno-upstream/v'+version+'-legacy.lock',import.meta.url),'utf8');
  const result=scan([rec('deno.lock',content)]);
  assert.equal(result.graphs[0].lockVersion,version);
  assert.equal(result.graphs[0].remoteIntegrityCount,2);
  assert.equal(result.inventory.length,count);
  if(version === '2') assert.ok(result.inventory.some(item=>item.name === 'nanoid' && item.version === '3.3.4'));
  assert.equal(createHash('sha256').update(content).digest('hex'),version === '1' ? 'f3590a675828e3894e53dff262af1741b281366ced80ea70aa624889b5dc7032' : '19587eb90e045064f3734efac25f6a9c2656536b10219753af951a920d368337');
 }
});

test('malformed import maps and package declarations cannot resolve a previous known vulnerable pin',()=>{
 const before=bundle([rec('deno.json',{imports:{next:'npm:next@^16.4.0'}}),rec('deno.lock',{version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'x'}},workspace:{dependencies:['npm:next@^16.4.0']}})]);
 const id=before.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
 for(const config of [{imports:{next:{invalid:'npm:next@^16.4.0'}}},{imports:[]},{scopes:{'./app':null}},{scopes:{'./app':{next:123}}}]) {
  const after=bundle([rec('deno.json',config),rec('deno.lock',{version:'5',workspace:{dependencies:[]}})]);
  assert.equal(after.securityContext.graphs[0].complete,false);
  assert.ok(after.securityContext.coverage.gaps.some(item=>item.reason === 'malformed-deno-import-map'));
  assert.ok(compareWithBaseline(after,createBaseline(before)).diff.unverified.includes(id));
 }
 const invalid=bundle([rec('deno.lock',{version:'5',workspace:{packageJson:{dependencies:['npm:next@null']}}}),rec('package.json',{dependencies:{next:null}})]);
 assert.ok(invalid.securityContext.coverage.gaps.some(item=>item.reason === 'malformed-deno-package-json-declaration'));
});
