import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {X509Certificate} from 'node:crypto';
import {keylessFixture} from './fixtures/keyless-evidence.mjs';import {hash} from './fixtures/execution-evidence.mjs';
const require=createRequire(import.meta.url),c=require('./audit-contract.js'),adapter=require('../verification/sigstore-keyless.cjs');
const auth=r=>r.securityContext.executionEvidence.subjects[0]?.authentication;
const scan=async(f,{root=f.root,at=f.now}={})=>(await c.createAuditBundleAsync({records:seal(f),trustPolicy:f.policy,sigstoreTrustedRoot:root,generatedAt:at})).audit;
function seal(f) {const config=JSON.parse(f.records.find(r=>r.path==='.frontend-evidence.json').content);for(const ref of config.subjects[0].attestations){const record=f.records.find(r=>r.path===ref.path);record.content=JSON.stringify(f.bundles[ref.kind]);ref.sha256=hash(record.content);}f.records.find(r=>r.path==='.frontend-evidence.json').content=JSON.stringify(config);return f.records;}
const clone=f=>structuredClone({records:f.records,policy:f.policy,root:f.root,bundles:f.bundles,now:f.now});
const entry=f=>f.bundles.build.verificationMaterial.tlogEntries[0];
const flip=s=>Buffer.from(s,'base64').map((v,i)=>i===5?v^1:v).toString('base64');
const repin=f=>{f.policy.keyless[0].trustedRootDigest=adapter.rootDigest(f.root);};

test('official verifier authenticates full Fulcio/CT/OIDC/Rekor chains offline with SET or RFC3161 time',async()=>{
 for(const tsa of [false,true]) {const f=await keylessFixture({tsa}),previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('unexpected network');};try {const result=await scan(f);assert.equal(auth(result).status,'verified',JSON.stringify(auth(result)));assert.ok(auth(result).attestations.every(check=>check.method==='sigstore-keyless' && check.signatureVerified && check.bindingsVerified && Object.entries(check.keyless).filter(([k])=>k.endsWith('Verified')).every(([,v])=>v)));assert.deepEqual(c.validateAuditResult(result),[]);assert.ok(result.securityContext.coverage.gaps.some(x=>x.reason==='signed-evidence-operation-unverified'));const text=JSON.stringify(result);assert.doesNotMatch(text,/BEGIN CERTIFICATE|token.actions.example|github.com\/example\/web\/\.github/);}finally{globalThis.fetch=previous;}}
});
test('bundle-supplied roots and public keys do not replace separately pinned trusted material',async()=>{
 const f=await keylessFixture();f.bundles.build.trustedRoot=f.root;assert.notEqual(auth(await scan(f,{root:null})).status,'verified');
 const result=(await c.createAuditBundleAsync({records:seal(f),trustPolicy:f.policy,generatedAt:f.now})).audit;assert.equal(auth(result).status,'unverified');assert.ok(auth(result).attestations.every(x=>x.reason==='sigstore-trusted-root-required'));
 f.root.tlogs[0].baseUrl='https://wrong.example';assert.notEqual(auth(await scan(f)).status,'verified');
});
test('OIDC issuer and SAN identity compare exactly, including regex punctuation and prefixes',async()=>{
 const base=await keylessFixture();for(const field of ['oidcIssuer','certificateIdentity']) for(const mutation of [v=>v+'-suffix',v=>v.replace('example','ex.mple'),v=>'.*'+v]) {const f=clone(base);f.policy.keyless[0][field]=mutation(f.policy.keyless[0][field]);assert.notEqual(auth(await scan(f)).status,'verified',field);}
});
test('untrusted Fulcio or CT anchors cannot certify a copied certificate even with a matching root pin',async()=>{
 const base=await keylessFixture(),other=await keylessFixture();for(const field of ['certificateAuthorities','ctlogs']) {const f=clone(base);f.root[field]=other.root[field];repin(f);assert.notEqual(auth(await scan(f)).status,'verified',field);}
});
test('tampered leaf certificate, payload and DSSE signature fail the chain or signed-content checks',async()=>{
 const base=await keylessFixture();for(const mode of ['certificate','payload','signature']) {const f=clone(base);if(mode==='certificate')f.bundles.build.verificationMaterial.certificate.rawBytes=flip(f.bundles.build.verificationMaterial.certificate.rawBytes);if(mode==='payload')f.bundles.build.dsseEnvelope.payload=flip(f.bundles.build.dsseEnvelope.payload);if(mode==='signature')f.bundles.build.dsseEnvelope.signatures[0].sig=flip(f.bundles.build.dsseEnvelope.signatures[0].sig);assert.notEqual(auth(await scan(f)).status,'verified',mode);}
});
test('proof-only unsigned integratedTime is insufficient without an authenticated timestamp',async()=>{
 const f=await keylessFixture();delete entry(f).inclusionPromise;entry(f).integratedTime='1';const r=await scan(f);assert.notEqual(auth(r).status,'verified');assert.ok(auth(r).attestations.some(x=>x.reason==='sigstore-signed-time-and-inclusion-required'));
});
test('SET, inclusion proof, checkpoint, log ID, index and duplicate entry mutations cannot pass',async()=>{
 const base=await keylessFixture();for(const mode of ['set','time','root','checkpoint','name','id','index','duplicate']) {const f=clone(base),e=entry(f);if(mode==='set')e.inclusionPromise.signedEntryTimestamp=flip(e.inclusionPromise.signedEntryTimestamp);if(mode==='time')e.integratedTime=String(Number(e.integratedTime)-86400);if(mode==='root')e.inclusionProof.rootHash=flip(e.inclusionProof.rootHash);if(mode==='checkpoint')e.inclusionProof.checkpoint.envelope=e.inclusionProof.checkpoint.envelope.replace(/\n1\n/,'\n2\n');if(mode==='name')e.inclusionProof.checkpoint.envelope=e.inclusionProof.checkpoint.envelope.replace(/— \S+ /,'— .* ');if(mode==='id')e.logId.keyId=flip(e.logId.keyId);if(mode==='index')e.logIndex='1';if(mode==='duplicate')f.bundles.build.verificationMaterial.tlogEntries.push({...structuredClone(e),logIndex:'1'});assert.notEqual(auth(await scan(f)).status,'verified',mode);}
});
test('TSA signatures and chains are checked; unsigned Rekor time never substitutes for TSA time',async()=>{
 const base=await keylessFixture({tsa:true});const good=clone(base);entry(good).integratedTime='1';const r=await scan(good);assert.equal(auth(r).status,'verified');assert.ok(auth(r).attestations[0].keyless.signingTimes.every(t=>Date.parse(t)>Date.parse('2026-01-01T00:00:00Z')));
 for(const mode of ['timestamp','root']) {const f=clone(base);if(mode==='timestamp'){const stamps=f.bundles.build.verificationMaterial.timestampVerificationData.rfc3161Timestamps;stamps[0].signedTimestamp=flip(stamps[0].signedTimestamp);}else{f.root.timestampAuthorities=[];repin(f);}assert.notEqual(auth(await scan(f)).status,'verified',mode);}
});
test('a retired log key cannot be used at an authenticated TSA time outside its validity range',async()=>{
 const f=await keylessFixture({tsa:true});f.root.tlogs[0].publicKey.validFor.end=new Date(Date.parse(f.now)-86400000).toISOString();repin(f);assert.notEqual(auth(await scan(f)).status,'verified');
});
test('expired short-lived leaf certificates remain verifiable at authenticated historical signing time',async()=>{
 const f=await keylessFixture(),later=new Date(Date.parse(f.now)+86400000).toISOString();const leaf=new X509Certificate(Buffer.from(f.bundles.build.verificationMaterial.certificate.rawBytes,'base64'));assert.ok(Date.parse(leaf.validTo)<Date.parse(later));assert.equal(auth(await scan(f,{at:later})).status,'verified');
});
test('valid keyless signatures still reject different build/source/report bindings',async()=>{
 const base=await keylessFixture();for(const field of ['repository','builderId','externalParameters']) {const f=clone(base);if(field==='externalParameters')f.policy.keyless[0].externalParameters={target:'other'};else f.policy.keyless[0][field]='https://other.example/';const r=await scan(f);assert.notEqual(auth(r).status,'verified');assert.ok(auth(r).attestations.some(x=>x.signatureVerified && !x.bindingsVerified),field);}
});
test('unknown formats, public-key bundle substitution and excessive verification material fail closed',async()=>{
 const base=await keylessFixture();for(const mode of ['format','key','chain','logs','message']) {const f=clone(base);if(mode==='format')f.bundles.build.mediaType='application/json';if(mode==='key')f.bundles.build.verificationMaterial.publicKey={hint:'trusted'};if(mode==='chain')f.bundles.build.verificationMaterial.x509CertificateChain={certificates:[]};if(mode==='logs')f.bundles.build.verificationMaterial.tlogEntries=Array(5).fill(entry(f));if(mode==='message')f.bundles.build.messageSignature={};assert.notEqual(auth(await scan(f)).status,'verified',mode);}
});
test('invalid mixed policy cannot leave partially compiled pinned keys active',async()=>{
 const {signedFixture,signedRecords}=await import('./fixtures/signed-evidence.mjs');const f=signedFixture();f.policy.keyless=[{}];const r=(await c.createAuditBundleAsync({records:signedRecords(f),trustPolicy:f.policy,generatedAt:f.f.config.subjects[0].observedAt})).audit;assert.notEqual(auth(r).status,'verified');
});
test('multiple authorized contexts for one exact signer do not depend on policy order',async()=>{
 const f=await keylessFixture();f.policy.keyless.unshift({...structuredClone(f.policy.keyless[0]),repository:'https://other.example/repo'});assert.equal(auth(await scan(f)).status,'verified');
});
test('oversized leaf certificate material is rejected before certificate parsing',async()=>{
 const f=await keylessFixture();f.bundles.build.verificationMaterial.certificate.rawBytes='A'.repeat(22004);const result=await scan(f);assert.ok(auth(result).attestations.some(x=>x.reason==='sigstore-certificate-budget'));
});
test('supported bundle v0.2 and both v0.3 media types preserve authenticated evidence',async()=>{
 const base=await keylessFixture();for(const mediaType of ['application/vnd.dev.sigstore.bundle+json;version=0.2','application/vnd.dev.sigstore.bundle+json;version=0.3']) {const f=clone(base);for(const bundle of Object.values(f.bundles)){bundle.mediaType=mediaType;if(mediaType.endsWith('0.2')){const vm=bundle.verificationMaterial;vm.x509CertificateChain={certificates:[vm.certificate]};delete vm.certificate;}}assert.equal(auth(await scan(f)).status,'verified',mediaType);}
});
test('removing rejected keyless evidence cannot automatically resolve its baseline integrity finding',async()=>{
 const f=await keylessFixture();f.policy.keyless[0].oidcIssuer='https://other.example';const before=await scan(f),baseline=c.createBaseline(before),previous=before.findings.filter(x=>x.id==='security.attestation-integrity');assert.ok(previous.length);
 const records=seal(f).filter(r=>!r.path.endsWith('.sigstore')),config=records.find(r=>r.path==='.frontend-evidence.json'),parsed=JSON.parse(config.content);delete parsed.subjects[0].attestations;config.content=JSON.stringify(parsed);
 const after=(await c.createAuditBundleAsync({records,trustPolicy:f.policy,sigstoreTrustedRoot:f.root,generatedAt:f.now})).audit,diff=c.compareWithBaseline(after,baseline).diff;assert.ok(previous.every(x=>diff.unverified.includes(x.fingerprint)));assert.ok(!previous.some(x=>diff.resolved.includes(x.fingerprint)));
});
test('Rekor v2 authenticates the top-level position and signed checkpoint despite absent redundant fields',async()=>{
 const f=await keylessFixture({rekorV2:true});for(const b of Object.values(f.bundles)){delete b.verificationMaterial.tlogEntries[0].inclusionProof.logIndex;delete b.verificationMaterial.tlogEntries[0].inclusionProof.treeSize;delete b.verificationMaterial.tlogEntries[0].inclusionProof.rootHash;}assert.equal(auth(await scan(f)).status,'verified');
 for(const mode of ['index','checkpoint','timestamp','payload']){const bad=clone(f),e=entry(bad);if(mode==='index')e.logIndex='1';if(mode==='checkpoint')e.inclusionProof.checkpoint.envelope=e.inclusionProof.checkpoint.envelope.replace('\n1\n','\n2\n');if(mode==='timestamp')delete bad.bundles.build.verificationMaterial.timestampVerificationData;if(mode==='payload')bad.bundles.build.dsseEnvelope.payload=flip(bad.bundles.build.dsseEnvelope.payload);assert.notEqual(auth(await scan(bad)).status,'verified',mode);}
});
test('cryptographically signed unknown log versions are not silently parsed as the latest known format',async()=>{
 const f=await keylessFixture({rekorV2:true,bodyVersion:'0.0.99'});const r=await scan(f);assert.ok(auth(r).attestations.every(x=>x.reason==='unsupported-sigstore-log-entry'));
});
