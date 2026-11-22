import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {webcrypto} from 'node:crypto';
import {signedFixture,signedRecords,envelope} from './fixtures/signed-evidence.mjs';import {at,hash} from './fixtures/execution-evidence.mjs';
const require=createRequire(import.meta.url),a=require('./attestations.js'),e=require('./execution-evidence.js'),c=require('./audit-contract.js');
const scan=(records,policy,now=at)=>c.createAuditBundleAsync({records,trustPolicy:policy,generatedAt:now}).then(x=>x.audit);
const auth=r=>r.securityContext.executionEvidence.subjects[0]?.authentication;

test('DSSE official PAE test vector and public ECDSA signature agree with platform crypto',async()=>{
 const text='hello world',type='http://example.com/HelloWorld';assert.equal(new TextDecoder().decode(a.pae(type,new TextEncoder().encode(text))),'DSSEv1 29 http://example.com/HelloWorld 11 hello world');
 const bytes=n=>Buffer.from(BigInt(n).toString(16).padStart(64,'0'),'hex').toString('base64url');
 const key=await webcrypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:bytes('46950820868899156662930047687818585632848591499744589407958293238635476079160'),y:bytes('5640078356564379163099075877009565129882514886557779369047442380624545832820'),ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 assert.equal(await a.verifySignature({payload:'aGVsbG8gd29ybGQ=',payloadType:type,signatures:[{sig:'A3JqsQGtVsJ2O2xqrI5IcnXip5GToJ3F+FnZ+O88SjtR6rDAajabZKciJTfUiHqJPcIAriEGAHTVeCUjW2JIZA=='}]},key,'ieee-p1363'),true);
});
test('real DER and P1363 signatures authenticate selected reports under explicit pinned policies',async()=>{
 for(const encoding of ['der','ieee-p1363']) {const f=signedFixture({encoding}),r=await scan(signedRecords(f),f.policy);assert.equal(auth(r).status,'verified',JSON.stringify(auth(r)));assert.deepEqual(auth(r).verifiedReports,['deployment','installation','sbom']);assert.ok(auth(r).attestations.every(x=>x.signatureVerified && x.bindingsVerified));assert.deepEqual(c.validateAuditResult(r),[]);assert.ok(r.securityContext.coverage.gaps.some(x=>x.reason==='signed-evidence-operation-unverified'));assert.ok(!r.securityContext.coverage.gaps.some(x=>x.reason==='execution-evidence-authenticity-unverified'));}
});
test('project keys and forged verified objects never replace an explicit reviewer trust policy',async()=>{
 const f=signedFixture(),records=signedRecords(f);f.f.config.trustPolicy=f.policy;records.find(x=>x.path===e.CONFIG).content=JSON.stringify(f.f.config);
 assert.equal(auth(await scan(records)).status,'unverified');const r=c.createAuditBundle({records,generatedAt:at,attestationVerification:{subjects:[{id:'web',status:'verified'}]}}).audit;assert.equal(auth(r).status,'unverified');
});
test('tampering with payload, payload type, report bytes and signature cannot authenticate reports',async()=>{
 for(const mode of ['payload','payloadType','signature','report']) {
  const f=signedFixture(),env=envelope(f.build,f.privateKey);if(mode==='payload') env.payload=Buffer.from(JSON.stringify({...f.build,predicateType:'bad'})).toString('base64');if(mode==='payloadType')env.payloadType='application/json';if(mode==='signature')env.signatures[0].sig=Buffer.alloc(64).toString('base64');
  const r=signedRecords(f,{envelopes:{build:env}});if(mode==='report')r.find(x=>x.path==='evidence/sbom.cdx').content+=' ';
  const result=await scan(r,f.policy);assert.notEqual(auth(result).status,'verified',mode);
 }
});
test('valid signatures cannot borrow another builder, source revision, input file, parameters, artifact or environment',async()=>{
 for(const mode of ['builder','source','revision','manifest','lock','parameters','artifact','report','environment']) {
  const f=signedFixture();if(mode==='builder')f.build.predicate.runDetails.builder.id='https://evil.example/builder';if(mode==='source')f.build.predicate.buildDefinition.resolvedDependencies[0].uri='git+https://github.com/evil/web@refs/heads/main';if(mode==='revision')f.build.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit='c'.repeat(40);if(mode==='manifest')f.build.predicate.buildDefinition.resolvedDependencies[1].digest.sha256='c'.repeat(64);if(mode==='lock')f.build.predicate.buildDefinition.resolvedDependencies[2].digest.sha256='c'.repeat(64);if(mode==='parameters')f.build.predicate.buildDefinition.externalParameters={target:'other'};if(mode==='artifact')f.build.subject[0].digest.sha256='c'.repeat(64);if(mode==='report')f.build.subject[1].digest.sha256='c'.repeat(64);if(mode==='environment')f.deployment.predicate.environment='staging';
  const r=await scan(signedRecords(f),f.policy);assert.notEqual(auth(r).status,'verified',mode);assert.ok(auth(r).attestations.some(x=>x.signatureVerified && !x.bindingsVerified),mode);
 }
});
test('unknown keys, expired/future validity, role restrictions and key fingerprint drift cannot confer authority',async()=>{
 for(const mode of ['unknown','expired','future','role','fingerprint','algorithm','threshold']) {
  const f=signedFixture(),records=signedRecords(f);if(mode==='unknown')f.policy.keys[0].publicKey=signedFixture().policy.keys[0].publicKey;if(mode==='expired')f.policy.keys[0].notAfter='2026-11-21T00:00:00Z';if(mode==='future')f.policy.keys[0].notBefore='2026-11-23T00:00:00Z';if(mode==='role')f.policy.keys[0].roles=['build'];if(mode==='fingerprint')f.policy.keys[0].keyId='sha256:'+'0'.repeat(64);if(mode==='algorithm')f.policy.keys[0].algorithm='none';if(mode==='threshold')f.policy.threshold=2;
  assert.notEqual(auth(await scan(records,f.policy)).status,'verified',mode);
 }
});
test('signed stale/future/invalid chronology remains unauthenticated',async()=>{
 for(const t of ['2026-09-01T00:00:00Z','2026-11-23T00:00:00Z','2026-02-31T00:00:00Z']) {const f=signedFixture();f.build.predicate.runDetails.metadata.startedOn=t;f.build.predicate.runDetails.metadata.finishedOn=t;assert.notEqual(auth(await scan(signedRecords(f),f.policy)).status,'verified');}
});
test('base64url envelopes, padding and unauthenticated keyid hints do not change trusted-key verification',async()=>{
 const f=signedFixture(),env=envelope(f.build,f.privateKey);env.payload=Buffer.from(env.payload,'base64').toString('base64url');env.signatures[0].sig=Buffer.from(env.signatures[0].sig,'base64').toString('base64url');env.signatures[0].keyid='claimed-admin-key';const r=await scan(signedRecords(f,{envelopes:{build:env}}),f.policy);assert.equal(auth(r).status,'verified');assert.equal(auth(r).attestations[0].keyId,f.policy.keys[0].keyId);
});
test('verification results are opaque, byte-bound, time-bound and cannot be mutated by readers',async()=>{
 const f=signedFixture(),records=signedRecords(f),token=await a.prepare(records,f.policy,at),first=a.read(token,records,at);first.subjects[0].attestations[0].status='rejected';assert.equal(a.read(token,records,at).subjects[0].attestations[0].status,'verified');assert.equal(a.read(token,records,'2026-11-22T03:06:00Z').subjects.length,0);records[0].content+=' ';assert.equal(a.read(token,records,at).subjects.length,0);
});
test('duplicate material/subject names and duplicate role references cannot produce a verified chain',async()=>{
 for(const mode of ['material','subject','role']) {const f=signedFixture();if(mode==='material')f.build.predicate.buildDefinition.resolvedDependencies.push(f.build.predicate.buildDefinition.resolvedDependencies[0]);if(mode==='subject')f.build.subject.push(f.build.subject[0]);const records=signedRecords(f);if(mode==='role'){f.f.config.subjects[0].attestations[1].kind='build';records.find(x=>x.path===e.CONFIG).content=JSON.stringify(f.f.config);}assert.notEqual(auth(await scan(records,f.policy)).status,'verified');}
});
test('removing signed report evidence never auto-resolves reported vulnerabilities or changes runtime safety',async()=>{
 const f=signedFixture();f.f.installation.dependencies.next.version='16.4.0';const records=signedRecords(f),before=await scan(records,f.policy),baseline=c.createBaseline(before);const ids=before.findings.filter(x=>x.id==='security.rsc-typed-array-rce').map(x=>x.fingerprint);assert.ok(ids.length);
 const after=await scan(records.filter(x=>x.path!==e.CONFIG),f.policy),diff=c.compareWithBaseline(after,baseline).diff;assert.ok(ids.every(id=>diff.unverified.includes(id)));
});
test('malformed signed values fail closed without crashing the audit',async()=>{
 for(const mode of ['manifestHash','lockHash','payloadJSON','signatures','base64']) {const f=signedFixture(),env=envelope(f.build,f.privateKey);if(mode==='manifestHash')f.f.config.subjects[0].manifestSha256=3;if(mode==='lockHash')f.f.config.subjects[0].lockfile.sha256=3;if(mode==='payloadJSON')env.payload=Buffer.from('{"a":1,"a":2}').toString('base64');if(mode==='signatures')env.signatures=Array(5).fill(env.signatures[0]);if(mode==='base64')env.payload='!!!';const records=signedRecords(f,{envelopes:{build:env}});if(mode==='manifestHash')f.f.config.subjects[0].manifestSha256=3;if(mode==='lockHash')f.f.config.subjects[0].lockfile.sha256=3;records.find(x=>x.path===e.CONFIG).content=JSON.stringify(f.f.config);const r=await scan(records,f.policy);assert.notEqual(auth(r)?.status,'verified');assert.deepEqual(c.validateAuditResult(r),[]);}
});

test('cached verification cannot extend a key beyond its explicit expiry boundary',async()=>{
 const f=signedFixture();f.policy.keys[0].notAfter='2026-11-22T03:00:01Z';const records=signedRecords(f),token=await a.prepare(records,f.policy,at);assert.equal(a.read(token,records,at).subjects[0].attestations[0].status,'verified');assert.equal(a.read(token,records,'2026-11-22T03:00:02Z').subjects.length,0);
});
test('rejected proofs produce one actionable parent and removal is not automatic remediation',async()=>{
 const f=signedFixture();f.build.subject[0].digest.sha256='c'.repeat(64);const before=await scan(signedRecords(f),f.policy),baseline=c.createBaseline(before),findings=before.findings.filter(x=>x.id==='security.attestation-integrity');assert.ok(findings.length);assert.ok(findings.every(x=>x.severity==='medium'));
 const after=await scan(signedRecords(signedFixture())),diff=c.compareWithBaseline(after,baseline).diff;assert.ok(findings.every(x=>diff.unverified.includes(x.fingerprint)));
});

test('unsigned format and capture-mode switches cannot reinterpret authenticated report bytes',async()=>{
 for(const field of ['format','mode']) {const f=signedFixture(),records=signedRecords(f);f.f.config.subjects[0].installation[field]='other';records.find(r=>r.path===e.CONFIG).content=JSON.stringify(f.f.config);const result=await scan(records,f.policy);assert.notEqual(auth(result).status,'verified');assert.ok(auth(result).attestations.some(x=>x.signatureVerified && !x.bindingsVerified));}
});
