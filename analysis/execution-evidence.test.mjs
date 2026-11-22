import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fixture,records,hash,at} from './fixtures/execution-evidence.mjs';
const require=createRequire(import.meta.url),execution=require('./execution-evidence.js');
const {createAuditBundle,createBaseline,compareWithBaseline,validateAuditResult,buildAuditMarkdown}=require('./audit-contract.js');
const scan=r=>createAuditBundle({records:r,generatedAt:at}).audit;
const subject=r=>r.securityContext.executionEvidence.subjects[0];
const gaps=r=>r.securityContext.coverage.gaps;
const reported=r=>r.securityContext.inventory.filter(x=>x.provenance.endsWith('-report'));

test('shared SHA-256 agrees with Node for UTF-8, padding boundaries and replacement characters',()=>{
 for(const value of ['', 'abc','한글😀','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'a'.repeat(500000),'\ud800']) assert.equal(execution.sha256(value),'sha256:'+createHash('sha256').update(value).digest('hex'));
});
test('installation, CycloneDX and deployment link to a workspace while authenticity stays unknown',()=>{
 const result=scan(records(fixture())),s=subject(result);
 assert.equal(s.status,'linked',JSON.stringify(gaps(result)));assert.equal(s.deployment.linked,true);
 assert.deepEqual(s.components[0],{ecosystem:'npm',name:'next',version:'16.4.0',sources:['installation','sbom'],lockVersions:['16.4.0'],comparison:'matches-lock',deploymentLinked:true});
 assert.equal(reported(result).length,3);assert.ok(reported(result).every(x=>['reported-exact','runtime-observation'].includes(x.versionKind)));
 assert.ok(gaps(result).some(x=>x.reason==='execution-evidence-authenticity-unverified'));
 assert.deepEqual(validateAuditResult(result),[]);assert.match(buildAuditMarkdown(result),/Installation\/SBOM\/deployment reports/);
 const advisory=result.findings.filter(x=>x.id==='security.rsc-typed-array-rce');assert.equal(advisory.length,3);assert.equal(new Set(advisory.map(x=>x.priority.clusterId)).size,1);
});
test('a synthetic SPDX package purl is separated from the described root artifact checksum',()=>{
 const result=scan(records(fixture({format:'spdx-json'})));assert.equal(subject(result).deployment.linked,true);assert.equal(subject(result).components.length,1);
});
test('installed and SBOM versions never replace a vulnerable lock or borrow a sibling workspace pin',()=>{
 const f=fixture({version:'16.5.0',locked:'16.4.0'}),r=records(f);r.push({path:'apps/other/package-lock.json',content:JSON.stringify({lockfileVersion:3,packages:{'':{},'node_modules/next':{version:'16.5.0'}}})});
 const result=scan(r);assert.equal(subject(result).components[0].comparison,'differs-lock');assert.equal(subject(result).deployment.linked,false);
 assert.ok(result.findings.some(x=>x.id==='security.rsc-typed-array-rce' && x.fingerprint.includes('apps/web/package-lock.json')));
});
test('report tampering and absent files are never accepted as hash-matched evidence',()=>{
 for(const key of ['installation','sbom','deployment']) {
  const f=fixture(),r=records(f);r.find(x=>x.path===f.config.subjects[0][key].path).content+=' ';
  const result=scan(r);assert.equal(subject(result).artifacts.find(x=>x.kind===key).integrity,'mismatch');assert.equal(subject(result).deployment?.linked||false,false);
  const missing=scan(r.filter(x=>x.path!==f.config.subjects[0][key].path));assert.ok(gaps(missing).some(x=>x.reason==='evidence-report-unavailable'));
 }
});
test('source manifest or lock hash drift cannot promote a deployment chain',()=>{
 for(const key of ['manifest','lock']) {
  const r=records(fixture());r.find(x=>x.path.endsWith(key==='manifest'?'/package.json':'/package-lock.json')).content+=' ';
  const result=scan(r);assert.equal(subject(result).status,key==='manifest'?'rejected':'partial');assert.ok(!subject(result).deployment?.linked);
 }
});
test('revision, digest, workspace, failed status and observation order mismatches keep deployments unverified',()=>{
 for(const [key,value] of [['revision','c'.repeat(40)],['artifactDigest','sha256:'+'c'.repeat(64)],['manifest','apps/other/package.json'],['status','failed'],['observedAt','2026-11-21T03:00:00.000Z']]) {
  const f=fixture();f.deployment[key]=value;const result=scan(records(f));assert.equal(subject(result).deployment.linked,false,key);assert.ok(gaps(result).some(x=>x.reason==='deployment-subject-chain-unverified'));
 }
});
test('stale, future and missing SBOM dates stay unverified',()=>{
 for(const value of ['2026-09-01T03:00:00.000Z','2026-11-23T03:00:00.000Z',undefined]) {
  const f=fixture();f.sbom.metadata.timestamp=value;assert.equal(subject(scan(records(f))).deployment.linked,false);
 }
 const f=fixture();f.config.subjects[0].observedAt='2026-09-01T03:00:00.000Z';assert.equal(subject(scan(records(f))).freshness,'stale');
});
test('qualified, unsupported or ambiguous purls and conflicting fields never certify a chain',()=>{
 for(const value of ['pkg:jsr/next@16.4.0','pkg:npm/next@16.4.0?repository_url=https://private.invalid','pkg:npm/next@%ZZ','pkg:npm/next@latest']) {
  const f=fixture();f.sbom.components[0].purl=value;assert.equal(subject(scan(records(f))).deployment.linked,false);
 }
 const f=fixture();f.sbom.components[0].version='16.5.0';assert.ok(gaps(scan(records(f))).some(x=>x.reason==='sbom-coordinate-conflict'));
});
test('npm report problems, missing versions, links and unknown capture mode stay unverified',()=>{
 for(const child of [{missing:true},{version:'16.4.0',invalid:true},{version:'16.4.0',resolved:'file:../lib'}]) {
  const f=fixture();f.installation.dependencies.next=child;assert.equal(subject(scan(records(f))).deployment.linked,false);
 }
 const f=fixture();delete f.config.subjects[0].installation.mode;assert.ok(gaps(scan(records(f))).some(x=>x.reason==='unsupported-installation-report-format'));
});
test('duplicate subject IDs and shared reports cannot bind different subjects implicitly',()=>{
 const f=fixture();f.config.subjects.push({...f.config.subjects[0]});assert.equal(scan(records(f)).securityContext.executionEvidence.subjects.length,0);
 f.config.subjects[1].id='other';const result=scan(records(f));assert.ok(result.securityContext.executionEvidence.subjects.every(x=>x.status==='partial'));assert.ok(gaps(result).some(x=>x.reason==='unsafe-or-shared-evidence-report'));
});
test('unsafe report paths never get added to collection or copied to output',()=>{
 for(const path of ['../secret.tree','/private/secret.tree','https://user:token@private.invalid/report','keys/key.pem','.aws/credentials','node_modules/foo/report.tree']) {
  const f=fixture();f.config.subjects[0].installation.path=path;const r=records(f);
  assert.ok(!execution.discoverInputs(r).includes(path));assert.doesNotMatch(JSON.stringify(scan(r)),/user:token|private.invalid/);
 }
});
test('malformed report and config shapes do not crash or clear old vulnerabilities',()=>{
 for(const key of ['installation','sbom','deployment']) for(const value of [null,[],{components:{bad:true}},'{broken']) {
  const f=fixture(),r=records(f);r.find(x=>x.path===f.config.subjects[0][key].path).content=typeof value==='string'?value:JSON.stringify(value);
  f.config.subjects[0][key].sha256=hash(r.find(x=>x.path===f.config.subjects[0][key].path).content);r.find(x=>x.path==='.frontend-evidence.json').content=JSON.stringify(f.config);
  const result=scan(r);assert.ok(result.findings.some(x=>x.id==='security.rsc-typed-array-rce'));assert.deepEqual(validateAuditResult(result),[]);
 }
 for(const value of [null,{},[],{schemaVersion:'99',subjects:[]}]) {const result=scan([{path:'.frontend-evidence.json',content:JSON.stringify(value)}]);assert.ok(gaps(result).length);}
});
test('report-only vulnerability disappearance remains unverified even after evidence config removal',()=>{
 const original=scan(records(fixture({version:'16.4.0',locked:'16.5.0'}))),baseline=createBaseline(original),ids=original.findings.filter(x=>x.id==='security.rsc-typed-array-rce').map(x=>x.fingerprint);
 assert.equal(ids.length,2);
 for(const r of [records(fixture({version:'16.5.0'})),records(fixture({version:'16.5.0'})).filter(x=>!x.path.startsWith('evidence/') && x.path!=='.frontend-evidence.json')]) {
  const diff=compareWithBaseline(scan(r),baseline).diff;assert.ok(ids.every(id=>diff.unverified.includes(id)));assert.ok(ids.every(id=>!diff.resolved.includes(id)));
 }
});
test('Composer installed reports and scoped npm purls preserve their ecosystems',()=>{
 const f=fixture();f.manifest={name:'example/app',require:{'example/lib':'1.0.0'}};f.lock={packages:[{name:'example/lib',version:'1.0.0'}],'packages-dev':[]};const s=f.config.subjects[0];s.manifest='apps/web/composer.json';s.lockfile.path='apps/web/composer.lock';s.installation.format='composer-installed';f.installation={packages:[{name:'example/lib',version:'1.0.0'}]};f.sbom.components=[{name:'lib',group:'example',version:'1.0.0',purl:'pkg:composer/example/lib@1.0.0'},{name:'pkg',group:'@example',version:'1.0.0',purl:'pkg:npm/%40example/pkg@1.0.0'}];
 const r=records(f).map(x=>({...x,path:x.path==='apps/web/package.json'?s.manifest:x.path==='apps/web/package-lock.json'?s.lockfile.path:x.path}));const result=scan(r);assert.deepEqual(new Set(subject(result).components.map(x=>x.ecosystem)),new Set(['composer','npm']));assert.ok(reported(result).some(x=>x.ecosystem==='composer'));
});

test('duplicate runtime observations are diagnosed and never create duplicate finding identities',()=>{
 const f=fixture();f.deployment.runtimes.push({name:'node',version:'22.0.0'});const result=scan(records(f));assert.equal(subject(result).deployment.linked,false);assert.ok(gaps(result).some(x=>x.reason==='ambiguous-runtime-observation'));assert.deepEqual(validateAuditResult(result),[]);
});
test('removing a reported ended runtime never auto-resolves its lifecycle finding',()=>{
 const f=fixture();f.deployment.runtimes=[{name:'node',version:'18.0.0'}];const original=scan(records(f)),baseline=createBaseline(original),ids=original.findings.filter(x=>x.id==='security.runtime-eol').map(x=>x.fingerprint);assert.ok(ids.length);
 const without=scan(records(fixture()).filter(x=>!x.path.startsWith('evidence/') && x.path!=='.frontend-evidence.json')),diff=compareWithBaseline(without,baseline).diff;assert.ok(ids.every(id=>diff.unverified.includes(id)));
});

test('empty reports do not turn missing vulnerable lock packages into a linked complete-looking chain',()=>{
 const f=fixture();f.installation.dependencies={};f.sbom.components=[];const result=scan(records(f));assert.equal(subject(result).deployment.linked,false);assert.ok(gaps(result).some(x=>x.reason==='workspace-lock-package-absent-from-sbom-report'));assert.ok(result.findings.some(x=>x.id==='security.rsc-typed-array-rce'));
});
test('extreme nesting and repeated package observations stop at the shared work budget',()=>{
 const f=fixture();f.installation.dependencies=Object.fromEntries(Array.from({length:10050},(_,i)=>['p'+i,{version:'1.0.0',dependencies:{leaf:{version:'1.0.0'}}}]));const result=scan(records(f));assert.ok(gaps(result).some(x=>x.reason==='execution-evidence-component-budget'||x.reason==='invalid-evidence-report'));assert.equal(subject(result).deployment.linked,false);
});

test('the captured npm 11 installed-tree fixture keeps local file packages unverified and hides source paths',async()=>{
 const {readFile}=await import('node:fs/promises'),raw=await readFile(new URL('./fixtures/execution-reports/npm-installed-local.json',import.meta.url),'utf8');assert.equal(hash(raw),'sha256:bb2082263e3359ea3b414ba67081c628e90a8ef0dd64c81c18c56b98e5dc38b9');
 const f=fixture();f.manifest.name='playbook-observation-root';f.lock.packages[''].name=f.manifest.name;f.installation=JSON.parse(raw);const result=scan(records(f));assert.ok(gaps(result).some(x=>x.reason==='local-installation-package-unverified'));assert.doesNotMatch(JSON.stringify(result),/private\/tmp|"resolved":"file:|"overridden":/);
});
test('same-directory Composer lock evidence binds installed packages without borrowing an unrelated workspace',()=>{
 const f=fixture();f.manifest={name:'example/app',require:{'example/lib':'1.0.0'}};f.lock={packages:[{name:'example/lib',version:'1.0.0'}],'packages-dev':[]};const s=f.config.subjects[0];s.manifest='apps/web/composer.json';s.lockfile.path='apps/web/composer.lock';s.installation.format='composer-installed';f.installation={packages:[{name:'example/lib',version:'1.0.0'}]};f.sbom.components=[{name:'lib',group:'example',version:'1.0.0',purl:'pkg:composer/example/lib@1.0.0'}];f.deployment.manifest=s.manifest;
 const r=records(f).map(x=>({...x,path:x.path==='apps/web/package.json'?s.manifest:x.path==='apps/web/package-lock.json'?s.lockfile.path:x.path}));const result=scan(r);assert.equal(subject(result).components[0].comparison,'matches-lock');assert.equal(subject(result).status,'linked',JSON.stringify(gaps(result)));
});
test('duplicate selected paths cannot silently choose a different source for an evidence subject',()=>{
 const r=records(fixture());r.push({...r[0],content:'{}'});assert.ok(gaps(scan(r)).some(x=>x.reason==='ambiguous-evidence-input-path'));
});

test('a reported PHP runtime matches its advisory independently of npm packages without inferring SAPI or backports',()=>{
 const f=fixture({version:'16.5.0'});f.deployment.runtimes=[{name:'php',version:'8.4.26'}];const result=scan(records(f));
 assert.ok(result.findings.some(x=>x.id==='security.php-oom-2026'));assert.ok(result.findings.some(x=>x.id==='security.php-stale-state-2026'));
 const entry=reported(result).find(x=>x.ecosystem==='runtime');assert.equal(entry.versionKind,'runtime-observation');assert.match(entry.phaseEvidence,/backports unverified/);assert.deepEqual(validateAuditResult(result),[]);
});

test('the shared security API accepts ISO strings, numeric clocks and Date observations consistently',()=>{
 const r=records(fixture());for(const now of [at,Date.parse(at),new Date(at)]) {const result=execution.inspect(r,[],{now});assert.equal(result.subjects[0].freshness,'within-30-days');assert.equal(result.subjects[0].artifacts.find(x=>x.kind==='deployment').componentCount,1);}
});
