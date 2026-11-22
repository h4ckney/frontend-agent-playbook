import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';
import {tufFixture} from './fixtures/tuf-evidence.mjs';import {keylessFixture} from './fixtures/keyless-evidence.mjs';
const require=createRequire(import.meta.url),tuf=require('../verification/sigstore-tuf.cjs'),c=require('./audit-contract.js'),a=require('./attestations.js');
const now=()=>Date.now(),verify=(f,repo,extra)=>tuf.verifyRepository(repo,f.pin,now(),extra),state=(f,repository)=>{const v=verify(f,repository);assert.equal(v.status,'verified',v.reason);return {schemaVersion:'1',bootstrapRootDigest:f.pin,repository,floor:v.checkpoint,lastAttempt:{status:'verified'}};};
const auth=r=>r.audit.securityContext.executionEvidence.subjects[0].authentication;
const policy=(k,f)=>{const p=structuredClone(k.policy);delete p.keyless[0].trustedRootDigest;p.keyless[0].tufBootstrapRootDigest=f.pin;return p;};

test('TUF authenticates threshold-signed rotation, roles, target bytes and snapshot state offline',async()=>{
 const k=await keylessFixture(),f=tufFixture(k.root),repo=f.make({roots:[f.rotated]});const previous=globalThis.fetch;globalThis.fetch=()=>{throw Error('network');};try{const r=verify(f,repo);assert.equal(r.status,'verified',r.reason);assert.equal(r.proof.rootVersion,2);const result=await c.createAuditBundleAsync({records:k.records,trustPolicy:policy(k,f),sigstoreTufState:state(f,repo),generatedAt:k.now});assert.equal(auth(result).status,'verified');assert.equal(auth(result).attestations[0].keyless.tuf.rootVersion,2);assert.deepEqual(c.validateAuditResult(result.audit),[]);}finally{globalThis.fetch=previous;}
});
test('root rotation needs old and new thresholds and cannot skip a version',()=>{
 const f=tufFixture({});for(const root of [f.root(2,f.newRoots,undefined,f.oldRoots),f.root(2,f.newRoots,undefined,f.newRoots),f.root(3,f.newRoots,undefined,[...f.oldRoots,...f.newRoots])])assert.notEqual(verify(f,f.make({roots:[root]})).status,'verified');
});
test('removed timestamp keys cannot sign metadata after an authenticated root rotation',()=>{
 const f=tufFixture({}),root=f.root(2,f.newRoots,f.replacementTimestamp,[...f.oldRoots,...f.newRoots]);assert.notEqual(verify(f,f.make({roots:[root]})).status,'verified');assert.equal(verify(f,f.make({roots:[root],ts:f.replacementTimestamp})).status,'verified');
});
test('metadata expiry is enforced at each role and bootstrap expiry can recover through rotation',()=>{
 const f=tufFixture({}),past=new Date(Date.now()-86400000).toISOString();for(const role of ['timestamp','snapshot','targets'])assert.notEqual(verify(f,f.make({expiry:{[role]:past}})).status,'verified',role);
 const expired=f.root(2,f.newRoots,undefined,[...f.oldRoots,...f.newRoots],past);assert.notEqual(verify(f,f.make({roots:[expired]})).status,'verified');
 const boot=f.root(1,f.oldRoots,undefined,f.oldRoots,past),repo=f.make({roots:[f.rotated]});repo.bootstrapRoot=boot;assert.equal(tuf.verifyRepository(repo,require('./execution-evidence.js').sha256(boot),now()).status,'verified');
});
test('metadata, target, anchor and duplicate-key tampering fail closed',()=>{
 const f=tufFixture({}),base=f.make();for(const mode of ['bootstrap','timestamp','snapshot','targets','target','duplicate']) {const r=structuredClone(base);if(mode==='duplicate')r.timestamp=r.timestamp.replace('"version":1','"version":1,"version":2');else r[mode==='bootstrap'?'bootstrapRoot':mode]+=' ';if(['bootstrap','snapshot','targets','target'].includes(mode))assert.notEqual(verify(f,r).status,'verified',mode);else if(mode==='timestamp'){const x=JSON.parse(r.timestamp);x.signed.version=9;r.timestamp=JSON.stringify(x);assert.notEqual(verify(f,r).status,'verified');}else assert.notEqual(verify(f,r).status,'verified');}
});
test('persisted high water rejects role rollback, same-version equivocation and removed snapshot roles',()=>{
 const f=tufFixture({}),fresh=f.make({version:2}),floor=verify(f,fresh).checkpoint;assert.notEqual(verify(f,f.make(),floor).status,'verified');assert.notEqual(verify(f,f.make({version:2,target:'{"changed":true}'}),floor).status,'verified');
 const old=f.make({extraMeta:{'legacy.json':{version:3}}}),previous=verify(f,old).checkpoint;assert.notEqual(verify(f,f.make({version:2}),previous).status,'verified');
});
test('authenticated target removal advances the floor and cannot fall back to stale root bytes',()=>{
 const f=tufFixture({}),old=f.make(),floor=verify(f,old).checkpoint,removed=verify(f,f.make({version:2,remove:true}),floor);assert.equal(removed.reason,'sigstore-tuf-target-removed');assert.equal(removed.checkpoint.versions.targets,2);assert.notEqual(verify(f,old,removed.checkpoint).status,'verified');
});
test('untrusted success JSON and absent/failed state cannot authenticate TUF-bound evidence',async()=>{
 const k=await keylessFixture(),f=tufFixture(k.root),valid=state(f,f.make());for(const input of [undefined,{status:'verified',trustedRoot:k.root}, {...valid,lastAttempt:{status:'rejected'}}]){const result=await c.createAuditBundleAsync({records:k.records,trustPolicy:policy(k,f),sigstoreTrustedRoot:k.root,sigstoreTufState:input,generatedAt:k.now});assert.notEqual(auth(result).status,'verified');}
 const forged=structuredClone(valid);forged.repository.target='{}';assert.notEqual(tuf.verifyState(forged,f.pin).status,'verified');
});
test('fresh trusted_root content removes a CA/CT/Rekor anchor without borrowing its previous pin',async()=>{
 const k=await keylessFixture(),other=await keylessFixture(),f=tufFixture(k.root),first=state(f,f.make());for(const field of ['certificateAuthorities','ctlogs','tlogs']){const root=structuredClone(k.root);root[field]=other.root[field];const repository=f.make({version:2,target:JSON.stringify(root)}),next=state(f,repository);assert.equal(verify(f,repository,first.floor).status,'verified');const result=await c.createAuditBundleAsync({records:k.records,trustPolicy:policy(k,f),sigstoreTufState:next,generatedAt:k.now});assert.notEqual(auth(result).status,'verified',field);}
});
test('expired TUF trust cannot be kept alive by an opaque attestation cache token',async()=>{
 const k=await keylessFixture(),f=tufFixture(k.root),expiry=new Date(Date.now()+30000).toISOString(),repo=f.make({expiry:{timestamp:expiry}}),s=state(f,repo),token=await a.prepare(k.records,policy(k,f),k.now,{sigstoreTufState:s});assert.equal(a.read(token,k.records,k.now).subjects[0].attestations[0].status,'verified');assert.ok(a.read(token,k.records,new Date(Date.parse(expiry)-1).toISOString()).subjects.length);assert.equal(a.read(token,k.records,expiry).subjects.length,0);assert.equal(a.read(token,k.records,new Date(Date.parse(expiry)+1).toISOString()).subjects.length,0);
});
const run=args=>spawnSync(process.execPath,[new URL('../verification/refresh-sigstore-tuf.mjs',import.meta.url).pathname,...args],{encoding:'utf8'});
test('explicit refresh persists floors, blocks after failure, recovers and serializes concurrent updates',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-tuf-state-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const f=tufFixture({}),repo=path.join(dir,'repo.json'),bootstrap=path.join(dir,'bootstrap.json'),file=path.join(dir,'state.json');await fs.writeFile(repo,JSON.stringify(f.make()));await fs.writeFile(bootstrap,f.make().bootstrapRoot);const args=['--state',file,'--bootstrap-sha256',f.pin,'--repository',repo];
 assert.equal(run(args).status,2);assert.equal(run([...args,'--initialize','--bootstrap',bootstrap]).status,0);let s=JSON.parse(await fs.readFile(file));assert.equal(s.lastAttempt.status,'verified');
 await fs.writeFile(repo,JSON.stringify(f.make({version:2})));assert.equal(run(args).status,0);await fs.writeFile(repo,JSON.stringify(f.make()));assert.equal(run(args).status,2);s=JSON.parse(await fs.readFile(file));assert.equal(s.floor.versions.targets,2);assert.equal(tuf.verifyState(s,f.pin).status,'unverified');
 await fs.writeFile(repo,JSON.stringify(f.make({version:3})));assert.equal(run(args).status,0);await fs.writeFile(file+'.lock','existing');assert.equal(run(args).status,2);assert.equal(await fs.readFile(file+'.lock','utf8'),'existing');assert.equal(run([...args,'--initialize','--bootstrap',bootstrap]).status,2);
});
test('unrelated delegations are permitted but a missing top-level root target is never recovered through one',()=>{
 const f=tufFixture({}),delegations={keys:{},roles:[]};assert.equal(verify(f,f.make({delegations})).status,'verified');assert.equal(verify(f,f.make({delegations,remove:true})).reason,'sigstore-tuf-target-removed');
});
test('zero thresholds, duplicate key IDs and every declared target hash fail closed',()=>{
 const f=tufFixture({});for(const mode of ['zero','duplicate']){const repo=f.make(),root=JSON.parse(repo.bootstrapRoot);if(mode==='zero')root.signed.roles.root.threshold=0;else root.signed.roles.root.keyids.push(root.signed.roles.root.keyids[0]);repo.bootstrapRoot=JSON.stringify(root);assert.notEqual(tuf.verifyRepository(repo,require('./execution-evidence.js').sha256(repo.bootstrapRoot)).status,'verified');}
 assert.notEqual(verify(f,f.make({targetHashes:{sha512:'a'.repeat(128)}})).status,'verified');
});
test('a rotated root floor rejects an older still-signed root repository',()=>{
 const f=tufFixture({}),floor=verify(f,f.make({roots:[f.rotated]})).checkpoint;assert.equal(verify(f,f.make(),floor).reason,'sigstore-tuf-rollback-or-equivocation');
});
test('a later root cannot bypass the exact previously accepted root through an alternate signed fork',()=>{
 const f=tufFixture({}),other=tufFixture({}),accepted=verify(f,f.make({roots:[f.rotated]})),fork2=f.root(2,other.newRoots,undefined,[...f.oldRoots,...other.newRoots]),fork3=f.root(3,other.newRoots,undefined,other.newRoots);
 assert.notEqual(verify(f,f.make({roots:[fork2,fork3]}),accepted.checkpoint).status,'verified');
});
test('a valid root rotation survives subsequent timestamp failure and blocks old-root recovery',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-tuf-root-progress-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const f=tufFixture({}),file=path.join(dir,'state.json'),repo=path.join(dir,'repo.json'),bootstrap=path.join(dir,'bootstrap.json');await fs.writeFile(bootstrap,f.make().bootstrapRoot);await fs.writeFile(repo,JSON.stringify(f.make()));const args=['--state',file,'--bootstrap-sha256',f.pin,'--repository',repo];assert.equal(run([...args,'--initialize','--bootstrap',bootstrap]).status,0);
 const broken=f.make({roots:[f.rotated],version:2});broken.timestamp='{}';await fs.writeFile(repo,JSON.stringify(broken));assert.equal(run(args).status,2);const retained=JSON.parse(await fs.readFile(file));assert.equal(retained.floor.versions.root,2);assert.equal(retained.repository.roots.length,1);
 await fs.writeFile(repo,JSON.stringify(f.make({version:3})));assert.equal(run(args).status,2);assert.equal(JSON.parse(await fs.readFile(file)).floor.versions.root,2);
 await fs.writeFile(repo,JSON.stringify(f.make({roots:[f.rotated],version:3})));assert.equal(run(args).status,0);
});
test('verified timestamp and snapshot floors survive failures in following metadata',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-tuf-role-progress-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const f=tufFixture({}),file=path.join(dir,'state.json'),repo=path.join(dir,'repo.json'),bootstrap=path.join(dir,'bootstrap.json');await fs.writeFile(bootstrap,f.make().bootstrapRoot);await fs.writeFile(repo,JSON.stringify(f.make()));const args=['--state',file,'--bootstrap-sha256',f.pin,'--repository',repo];assert.equal(run([...args,'--initialize','--bootstrap',bootstrap]).status,0);
 const broken=f.make({version:2});broken.snapshot='{}';await fs.writeFile(repo,JSON.stringify(broken));assert.equal(run(args).status,2);assert.equal(JSON.parse(await fs.readFile(file)).floor.versions.timestamp,2);
 await fs.writeFile(repo,JSON.stringify(f.make()));assert.equal(run(args).status,2);
 const badTargets=f.make({version:3});badTargets.targets='{}';await fs.writeFile(repo,JSON.stringify(badTargets));assert.equal(run(args).status,2);assert.equal(JSON.parse(await fs.readFile(file)).floor.versions.snapshot,3);
 await fs.writeFile(repo,JSON.stringify(f.make({version:2})));assert.equal(run(args).status,2);await fs.writeFile(repo,JSON.stringify(f.make({version:4})));assert.equal(run(args).status,0);
});
test('a newer timestamp cannot roll back a snapshot version already referenced before a download failure',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-tuf-reference-floor-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const f=tufFixture({}),file=path.join(dir,'state.json'),repo=path.join(dir,'repo.json'),bootstrap=path.join(dir,'bootstrap.json'),first=f.make();await fs.writeFile(bootstrap,first.bootstrapRoot);await fs.writeFile(repo,JSON.stringify(first));const args=['--state',file,'--bootstrap-sha256',f.pin,'--repository',repo];assert.equal(run([...args,'--initialize','--bootstrap',bootstrap]).status,0);
 const broken=f.make({version:2});broken.snapshot='{}';await fs.writeFile(repo,JSON.stringify(broken));assert.equal(run(args).status,2);assert.equal(JSON.parse(await fs.readFile(file)).floor.snapshotFromTimestamp,2);
 const replay=structuredClone(first);replay.timestamp=f.timestampFor(first.snapshot,3);await fs.writeFile(repo,JSON.stringify(replay));assert.equal(run(args).status,2);await fs.writeFile(repo,JSON.stringify(f.make({version:4})));assert.equal(run(args).status,0);
});
