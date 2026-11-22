// Historical interoperability evidence. CI is offline and does not treat this
// 2026-11-22 observation as current root freshness or a new OIDC authentication.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),tuf=require('../verification/sigstore-tuf.cjs'),adapter=require('../verification/sigstore-keyless.cjs'),dir=new URL('./fixtures/public-sigstore/',import.meta.url);
const json=async name=>JSON.parse(await fs.readFile(new URL(name,dir),'utf8'));
const pin='sha256:27aea7e372aa7864065174f0661784fcf8b0e28b1dbfebeada31a0f1fb19167f';
const expected={certificateIdentity:'https://github.com/sigstore/sigstore-js/.github/workflows/release.yml@refs/heads/main',oidcIssuer:'https://token.actions.githubusercontent.com',notBefore:'2026-01-01T00:00:00Z',notAfter:'2027-01-01T00:00:00Z'};
async function fixture(t){const observed=await json('public-probe.json');t.mock.timers.enable({apis:['Date'],now:new Date(observed.checkedAt)});const repository=await json('repository.json'),trusted=tuf.verifyRepository(repository,pin,Date.now());assert.equal(trusted.status,'verified',trusted.reason);return {observed,trusted,rule:{...expected,trustedRootDigest:trusted.rootDigest},bundle:await json('bundle.json')};}
test('actual public Sigstore TUF root and npm GitHub OIDC/Fulcio/CT/Rekor provenance verify offline',async t=>{
 const {trusted,rule,bundle}=await fixture(t);const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('unexpected network');};try {const result=adapter.verifyBundle(bundle,[rule],trusted.trustedRoot,Date.now());assert.equal(result.status,'verified',result.reason);assert.equal(result.proof.signingTimes[0],'2026-11-05T00:18:00.000Z');assert.equal(trusted.proof.rootVersion,16);}finally{globalThis.fetch=original;}
});
test('public sharded Rekor SET global index and Merkle local index are independently authenticated',async t=>{
 const {trusted,rule,bundle}=await fixture(t),entry=bundle.verificationMaterial.tlogEntries[0];assert.notEqual(entry.logIndex,entry.inclusionProof.logIndex);assert.equal(adapter.verifyBundle(bundle,[rule],trusted.trustedRoot,Date.now()).status,'verified');
 for(const mode of ['global','local']){const bad=structuredClone(bundle),e=bad.verificationMaterial.tlogEntries[0];if(mode==='global')e.logIndex=String(BigInt(e.logIndex)+1n);else e.inclusionProof.logIndex=String(BigInt(e.inclusionProof.logIndex)+1n);assert.notEqual(adapter.verifyBundle(bad,[rule],trusted.trustedRoot,Date.now()).status,'verified',mode);}
 const live=await json('live-bundle.json');assert.equal(adapter.verifyBundle(live,[rule],trusted.trustedRoot,Date.now()).status,'verified');
});
test('public package archive bytes match both registry integrity and the authenticated signed subject',async t=>{
 const {trusted,rule,bundle}=await fixture(t),v=adapter.verifyBundle(bundle,[rule],trusted.trustedRoot,Date.now());assert.equal(v.status,'verified');const artifact=await fs.readFile(new URL('verify-4.1.3.tgz',dir)),hash=createHash('sha512').update(artifact).digest(),pkg=await json('package.json'),statement=JSON.parse(Buffer.from(bundle.dsseEnvelope.payload,'base64'));
 assert.equal(pkg.name,'@sigstore/verify');assert.equal(pkg.version,'4.1.3');assert.equal(pkg.dist.integrity,'sha512-'+hash.toString('base64'));assert.equal(statement._type,'https://in-toto.io/Statement/v1');assert.equal(statement.predicateType,'https://slsa.dev/provenance/v1');assert.deepEqual(statement.predicate.buildDefinition.externalParameters.workflow,{ref:'refs/heads/main',repository:'https://github.com/sigstore/sigstore-js',path:'.github/workflows/release.yml'});assert.equal(statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit,'4576519f81b93bf96bd7457fc7252b8cfa11e67f');assert.deepEqual(statement.subject,[{name:'pkg:npm/%40sigstore/verify@4.1.3',digest:{sha512:hash.toString('hex')}}]);
});
test('real evidence cannot authenticate a different exact workflow or issuer',async t=>{
 const {trusted,rule,bundle}=await fixture(t);for(const r of [{...rule,certificateIdentity:rule.certificateIdentity.replace('release.yml','other.yml')},{...rule,oidcIssuer:'https://accounts.google.com'}])assert.notEqual(adapter.verifyBundle(bundle,[r],trusted.trustedRoot,Date.now()).status,'verified');
});
