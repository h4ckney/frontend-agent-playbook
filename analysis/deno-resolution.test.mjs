import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {queryInventory} from '../scripts/query-osv.mjs';
const require=createRequire(import.meta.url);
const {inspectSecurityContext}=require('./security-context.js');
const {createAuditBundle,validateAuditResult,createBaseline,compareWithBaseline}=require('./audit-contract.js');
const {expandPaths,discoverLocks}=require('./deno-resolution.js');
const {selectFilesWithinBudget,extendSelectionForDenoLocks}=require('./analyzer.js');
const rec=(path,value)=>({path,content:typeof value === 'string'?value:JSON.stringify(value)});
const at='2026-11-03T03:00:00Z';
const scan=records=>inspectSecurityContext(records,{now:at});
const bundle=records=>createAuditBundle({records,generatedAt:at}).audit;
const pinned=(extra={})=>({version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'x'}},...extra});
const linked=(patterns=['./packages/*','!./packages/excluded'])=>[
 rec('deno.json',{links:patterns,imports:{lib:'jsr:@example/lib'}}),
 rec('packages/lib/deno.json',{name:'@example/lib',imports:{next:'npm:next@^16.4.0'}}),
 rec('packages/excluded/deno.json',{name:'@example/lib',imports:{next:'npm:next@^17'}}),
 rec('deno.lock',pinned({workspace:{dependencies:['jsr:@example/lib@*'],links:{'jsr:@example/lib':{dependencies:['npm:next@^16.4.0']}}}}))
];

test('glob star, globstar, question, negation and overlap are deterministic and do not escape selected manifests',()=>{
 const errors=[];
 assert.deepEqual(expandPaths('app/',['../packages/**','!../packages/private/**','../packages/a'],new Set(['packages/a','packages/a/nested','packages/private/secret']),reason=>errors.push(reason)),['packages/a','packages/a/nested']);
 assert.deepEqual(errors,[]);
 assert.deepEqual(expandPaths('',['packages/?'],new Set(['packages/a','packages/ab']),()=>{}),['packages/a']);
 const result=scan(linked(['./packages/**','./packages/lib','!./packages/excluded']));
 assert.equal(result.graphs[0].complete,true);
 assert.equal(result.graphs[0].nodes.filter(node=>node.kind === 'local').length,1);
 assert.equal(result.inventory[0].workspaceUsage[0].phase,'runtime');
 assert.deepEqual(validateAuditResult(bundle(linked())),[]);
});

test('malformed, unmatched, protected and expensive patterns are explicit incomplete evidence',()=>{
 for(const patterns of [['../outside/*'],['https://user:token@private.invalid/*'],['packages/{a,b}'],['missing/*'],['.ssh/*'],['!only-negative']]) {
  const errors=[];expandPaths('',patterns,new Set(['packages/a']),reason=>errors.push(reason));assert.ok(errors.length || patterns[0].startsWith('!'));
 }
 const errors=[];expandPaths('',['**/*a*a*a*'],new Set(['a'.repeat(1000)]),reason=>errors.push(reason),{work:99999});
 assert.ok(errors.includes('deno-path-pattern-budget'));
 const records=linked(['missing/*']);assert.equal(scan(records).graphs[0].complete,false);
});

test('relative file protocol connects local npm metadata and never promotes its version into a registry pin',async()=>{
 const records=[rec('deno.json',{}),rec('package.json',{dependencies:{alias:'file:./lib/'}}),rec('lib/package.json',{name:'lib',version:'99.0.0',dependencies:{next:'^16.4.0'}}),rec('deno.lock',pinned({workspace:{packageJson:{dependencies:[]},links:{'npm:lib':{dependencies:['npm:next@^16.4.0']}}}}))];
 const result=bundle(records);
 assert.equal(result.securityContext.graphs[0].complete,true);
 assert.ok(result.securityContext.graphs[0].edges.some(item=>item.dependency === 'alias' && item.to === 'local/lib/npm'));
 assert.equal(result.securityContext.inventory.find(item=>item.provenance === 'lockfile').workspaceUsage[0].direct,false);
 const requests=[];await queryInventory(result,{fetchImpl:async(url,init)=>{requests.push(JSON.parse(init.body));return new Response('{"results":[{}]}');}});
 assert.deepEqual(requests[0].queries.map(item=>[item.package.name,item.version]),[['next','16.4.0']]);
});

test('workspace star, caret and tilde bind only a declared member and keep its own root role',()=>{
 for(const protocol of ['workspace:*','workspace:^','workspace:~']) {
  const records=[rec('deno.json',{workspace:['packages/*']}),rec('package.json',{dependencies:{lib:protocol}}),rec('packages/lib/package.json',{name:'lib',version:'1.0.0',dependencies:{next:'^16.4.0'}}),rec('deno.lock',pinned({workspace:{packageJson:{dependencies:[]},members:{'packages/lib':{packageJson:{dependencies:['npm:next@^16.4.0']}}}}}))];
  const result=scan(records);assert.equal(result.graphs[0].complete,true,JSON.stringify(result.coverage.gaps));
  const uses=result.inventory.find(item=>item.provenance === 'lockfile').workspaceUsage;
  assert.ok(uses.some(item=>item.manifest === 'package.json' && !item.direct));
  assert.ok(uses.some(item=>item.manifest === 'packages/lib/package.json' && item.direct));
  assert.deepEqual(validateAuditResult(bundle(records)),[]);
 }
});

test('missing or duplicate workspace names cannot borrow a sibling or silently fall back to a registry',()=>{
 for(const protocols of ['workspace:*','workspace:^1.0.0']) {
  const records=[rec('deno.json',{workspace:['packages/*']}),rec('package.json',{dependencies:{lib:protocols}}),rec('elsewhere/package.json',{name:'lib'}),rec('deno.lock',pinned({workspace:{packageJson:{dependencies:[]}}}))];
  assert.equal(scan(records).graphs[0].complete,false);
 }
 const records=[rec('deno.json',{workspace:['packages/*']}),rec('package.json',{dependencies:{lib:'workspace:*'}}),rec('packages/a/package.json',{name:'lib'}),rec('packages/b/package.json',{name:'lib'}),rec('deno.lock',{version:'5',workspace:{packageJson:{dependencies:[]}}})];
 assert.ok(scan(records).coverage.gaps.some(item=>item.reason === 'ambiguous-deno-workspace-name'));
});

test('a linked workspace expands its declared members while unsupported nested workspace declarations stay explicit',()=>{
 const records=linked(['./repo']);records[0]=rec('deno.json',{links:['./repo'],imports:{lib:'jsr:@example/lib'}});records[1]=rec('repo/deno.json',{workspace:['./packages/*']});records[2]=rec('repo/packages/lib/deno.json',{name:'@example/lib',imports:{next:'npm:next@^16.4.0'}});
 const result=scan(records);assert.equal(result.graphs[0].complete,true,JSON.stringify(result.coverage.gaps));
 assert.ok(result.graphs[0].nodes.some(item=>item.kind === 'local' && item.manifest === 'repo/packages/lib/deno.json'));
 const nested=[rec('deno.json',{workspace:['./child']}),rec('child/deno.json',{workspace:['./grandchild']}),rec('child/grandchild/deno.json',{}),rec('deno.lock',{version:'5',workspace:{members:{child:{}}}})];
 assert.ok(scan(nested).coverage.gaps.some(item=>/nested-deno-workspace/.test(item.reason)));
 assert.ok(!discoverLocks(nested).plans.some(item=>item.config === 'child/deno.json'));
 nested[3]=rec('deno.lock',{version:'5',workspace:{}});assert.equal(scan(nested).graphs[0].complete,false);
});

test('nested member paths listed at one root are legal and do not invent independent child locks',()=>{
 const records=[rec('deno.json',{workspace:['foo','foo/bar']}),rec('foo/deno.json',{}),rec('foo/bar/deno.json',{imports:{next:'npm:next@^16.4.0'}}),rec('deno.lock',pinned({workspace:{members:{foo:{},'foo/bar':{dependencies:['npm:next@^16.4.0']}}}}))];
 const result=scan(records);assert.equal(result.graphs[0].complete,true,JSON.stringify(result.coverage.gaps));
 assert.equal(discoverLocks(records).plans.length,1);
 assert.ok(result.inventory[0].workspaceUsage.some(item=>item.manifest === 'foo/bar/deno.json'));
});

const mapped=()=>[rec('app/deno.json',{importMap:'maps/imports.map'}),rec('app/maps/imports.map',{imports:{next:'npm:next@^16.4.0',module:'../module.ts'},scopes:{'../feature/':{next:'npm:next@^16.4.0'}}}),rec('app/module.ts','export const value=1;'),rec('app/deno.lock',pinned({workspace:{dependencies:['npm:next@^16.4.0']}}))];

test('separate import map resolves relative to the map file and records selected module mapping without executing it',()=>{
 const result=bundle(mapped()),graph=result.securityContext.graphs[0];
 assert.equal(graph.complete,true,JSON.stringify(result.securityContext.coverage.gaps));
 assert.deepEqual(graph.importMaps,['app/maps/imports.map']);
 assert.deepEqual(graph.localMappings,[{source:'app/maps/imports.map',target:'app/module.ts',prefix:false,exists:true}]);
 assert.ok(result.findings.some(item=>item.id === 'security.rsc-typed-array-rce'));
 const files=mapped().map(item=>({path:item.path,name:item.path.split('/').at(-1),size:item.content.length}));
 const selection=extendSelectionForDenoLocks(files,mapped().filter(item=>item.path !== 'app/maps/imports.map'),selectFilesWithinBudget(files));
 assert.equal(selection.additional[0].path,'app/maps/imports.map');
 assert.deepEqual(validateAuditResult(result),[]);
});

test('missing, malformed, remote or conflicting import maps retain old advisories as unverified',()=>{
 const before=bundle(mapped()),baseline=createBaseline(before),id=before.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
 for(const records of [mapped().filter(item=>item.path !== 'app/maps/imports.map'),mapped().map(item=>item.path.endsWith('.map') ? rec(item.path,'{"imports":{"next":{}}}') : item),[rec('app/deno.json',{importMap:'https://user:private-token@private.invalid/map'}),rec('app/deno.lock',{version:'5',workspace:{dependencies:[]}})]]) {
  const result=bundle(records),diff=compareWithBaseline(result,baseline).diff;
  assert.ok(result.securityContext.coverage.gaps.length);assert.ok(!diff.resolved.includes(id));
  if(!result.findings.some(item=>item.fingerprint === id)) assert.ok(diff.unverified.includes(id));
  assert.doesNotMatch(JSON.stringify(result),/private-token|private.invalid/);
 }
 const conflict=mapped();conflict[0]=rec('app/deno.json',{importMap:'maps/imports.map',imports:{next:'npm:next@^16.5.0'}});
 assert.ok(scan(conflict).coverage.gaps.some(item=>item.reason === 'conflicting-deno-inline-import-map'));
});

test('file paths outside root, absolute file URLs and archives never become local package pins',()=>{
 for(const value of ['file:../outside','file:///private/lib','file:https://private.invalid/lib','file:./lib.tgz']) {
  const records=[rec('deno.json',{}),rec('package.json',{dependencies:{lib:value}}),rec('deno.lock',{version:'5',workspace:{packageJson:{dependencies:[]}}})];
  const result=bundle(records);assert.equal(result.securityContext.graphs[0].complete,false);assert.ok(result.securityContext.coverage.gaps.length);
 }
});

test('a map at the selected root retains its empty base instead of borrowing the config folder',()=>{
 const records=mapped();records[0]=rec('app/deno.json',{importMap:'../imports.map'});records[1]=rec('imports.map',{imports:{next:'npm:next@^16.4.0',module:'./module.ts'}});records[2]=rec('module.ts','export const value=1;');
 const result=scan(records);assert.deepEqual(result.graphs[0].localMappings,[{source:'imports.map',target:'module.ts',prefix:false,exists:true}]);
});

test('missing locks cannot turn malformed inline or external-map evidence into resolved baseline risks',()=>{
 const before=bundle(mapped()),baseline=createBaseline(before),id=before.findings.find(item=>item.id === 'security.rsc-typed-array-rce').fingerprint;
 for(const config of [{importMap:'maps/imports.map'},{imports:{next:{invalid:'npm:next@^16.4.0'}}},{imports:{module:'./module.ts'}}]) {
  const result=bundle([rec('app/deno.json',config),rec('app/maps/imports.map',{imports:{next:'npm:next@^16.4.0'}}),rec('app/module.ts','')]);
  assert.ok(result.securityContext.coverage.gaps.length);
  assert.ok(compareWithBaseline(result,baseline).diff.unverified.includes(id));
 }
});

test('member importMap and a root-map/member-imports combination remain invalid root settings',()=>{
 const records=[rec('deno.json',{workspace:['member'],importMap:'imports.map'}),rec('imports.map',{}),rec('member/deno.json',{importMap:'member.map',imports:{next:'npm:next@^16.4.0'}}),rec('member/member.map',{}),rec('deno.lock',pinned({workspace:{members:{member:{dependencies:[]}}}}))];
 const result=scan(records);assert.equal(result.graphs[0].complete,false);
 assert.ok(result.coverage.gaps.some(item=>item.reason === 'deno-member-root-setting'));
 assert.ok(result.coverage.gaps.some(item=>item.reason === 'deno-root-map-member-imports-conflict'));
});

test('file package cycles terminate and keep local versions out of registry evidence',()=>{
 const records=[rec('deno.json',{}),rec('package.json',{dependencies:{a:'file:./a'}}),rec('a/package.json',{name:'a',version:'1.0.0',dependencies:{b:'file:../b'}}),rec('b/package.json',{name:'b',version:'1.0.0',dependencies:{a:'file:../a',next:'^16.4.0'}}),rec('deno.lock',pinned({workspace:{packageJson:{dependencies:[]},links:{'npm:a':{dependencies:['npm:b@*']},'npm:b':{dependencies:['npm:a@*','npm:next@^16.4.0']}}}}))];
 const result=scan(records);assert.equal(result.graphs[0].complete,true,JSON.stringify(result.coverage.gaps));
 assert.equal(result.graphs[0].nodes.filter(item=>item.kind === 'local').length,2);
 assert.ok(result.inventory.filter(item=>item.provenance === 'lockfile').every(item=>item.name === 'next'));
});

test('file packages with the same name stay bound to their own declaration and version-qualified lock metadata',()=>{
 const records=[rec('deno.json',{workspace:['apps/*']}),rec('apps/a/package.json',{name:'a',dependencies:{lib:'file:../../local-a'}}),rec('apps/b/package.json',{name:'b',dependencies:{lib:'file:../../local-b'}}),
 rec('local-a/package.json',{name:'lib',version:'1.0.0',dependencies:{next:'^16.4.0'}}),rec('local-b/package.json',{name:'lib',version:'2.0.0',dependencies:{next:'^16.5.0'}}),
 rec('deno.lock',{version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0','npm:next@^16.5.0':'16.5.0'},npm:{'next@16.4.0':{integrity:'x'},'next@16.5.0':{integrity:'y'}},workspace:{members:{'apps/a':{packageJson:{dependencies:[]}},'apps/b':{packageJson:{dependencies:[]}}},links:{'npm:lib@1.0.0':{dependencies:['npm:next@^16.4.0']},'npm:lib@2.0.0':{dependencies:['npm:next@^16.5.0']}}}})];
 const result=scan(records);assert.equal(result.graphs[0].complete,true,JSON.stringify(result.coverage.gaps));
 const old=result.inventory.find(item=>item.provenance === 'lockfile' && item.version === '16.4.0');
 const fixed=result.inventory.find(item=>item.provenance === 'lockfile' && item.version === '16.5.0');
 assert.deepEqual(old.workspaceUsage.map(item=>item.manifest),['apps/a/package.json']);
 assert.deepEqual(fixed.workspaceUsage.map(item=>item.manifest),['apps/b/package.json']);
});

test('official external import map fixture retains npm and JSR coordinates as distinct ecosystems',async()=>{
 const {readFile}=await import('node:fs/promises');
 const data=await readFile(new URL('./fixtures/deno-upstream/external-import-map.json',import.meta.url),'utf8');
 const {createHash}=await import('node:crypto');assert.equal(createHash('sha256').update(data).digest('hex'),'94714412a239b3850e63be3dddad5b22348b3fdd9069cecd8bd01adf21189294');
 const records=[rec('deno.json',{importMap:'maps/imports.map'}),rec('maps/imports.map',data),rec('deno.lock',{version:'5',specifiers:{'jsr:@denotest/add@1.0.0':'1.0.0','npm:@denotest/esm-basic@1.0.0':'1.0.0'},jsr:{'@denotest/add@1.0.0':{integrity:'x'}},npm:{'@denotest/esm-basic@1.0.0':{integrity:'y'}},workspace:{dependencies:['jsr:@denotest/add@1.0.0','npm:@denotest/esm-basic@1.0.0']}})];
 const result=scan(records);assert.equal(result.graphs[0].complete,true,JSON.stringify(result.coverage.gaps));
 assert.deepEqual(new Set(result.inventory.map(item=>item.ecosystem)),new Set(['npm','jsr']));
});

test('an explicit link and a different workspace member with the same name stay ambiguous',()=>{
 const records=linked(['./packages/lib']);records[0]=rec('deno.json',{workspace:['members/*'],links:['packages/lib'],imports:{lib:'jsr:@example/lib'}});
 records.push(rec('members/other/deno.json',{name:'@example/lib',imports:{next:'npm:next@^16.4.0'}}));
 const data=JSON.parse(records[3].content);data.workspace.members={'members/other':{dependencies:['npm:next@^16.4.0']}};records[3]=rec('deno.lock',data);
 const result=scan(records);assert.equal(result.graphs[0].complete,false);
 assert.ok(result.coverage.gaps.some(item=>item.reason === 'ambiguous-deno-workspace-link-name'));
});

test('nontrivial or mismatched registry ranges cannot silently certify a workspace version match',()=>{
 const records=[rec('deno.json',{workspace:['lib'],imports:{lib:'jsr:@example/lib@^2'}}),rec('lib/deno.json',{name:'@example/lib',version:'1.0.0'}),rec('deno.lock',{version:'5',workspace:{dependencies:['jsr:@example/lib@^2'],members:{lib:{}}}})];
 const result=scan(records);assert.equal(result.graphs[0].complete,false);
 assert.ok(result.coverage.gaps.some(item=>item.reason === 'deno-workspace-version-compatibility-unverified'));
});

test('JSR in a selected external map remains registry evidence without implying Deploy or a locked module version',()=>{
 const records=[rec('deno.json',{importMap:'imports.map'}),rec('imports.map',{imports:{lib:'jsr:@example/lib@^1'}})];
 const result=scan(records);
 assert.ok(result.lifecycle.entries.some(item=>item.component === 'jsr' && item.manifest === 'imports.map'));
 assert.ok(!result.lifecycle.entries.some(item=>item.component === 'deno-deploy'));
 assert.ok(result.coverage.gaps.some(item=>item.reason === 'deno-import-map-lock-coverage-unavailable'));
});
