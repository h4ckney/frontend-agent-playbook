"use strict";
// Bounded offline TUF profile. Crypto/threshold/rotation verification is upstream,
// not a replacement implementation. The internal store API is pinned and tested.
const crypto=require('node:crypto'),parser=require('../analysis/lockfile-graph.js'),{rootDigest}=require('./sigstore-keyless.cjs'),{sha256}=require('../analysis/execution-evidence.js');
const object=v=>v!==null && typeof v==='object' && !Array.isArray(v),digest=v=>typeof v==='string' && /^sha256:[a-f0-9]{64}$/.test(v);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const fail=(reason,status='rejected')=>({status,reason});
function strict(text,max=500000) {if(typeof text!=='string' || Buffer.byteLength(text)>max) throw Error('size');const v=parser.parseJSONC(text);JSON.parse(text);if(!object(v)) throw Error('object');return v;}
function metadata(text,type) {
 const v=strict(text),s=v.signed;if(!object(s) || s._type!==type || !Number.isSafeInteger(s.version) || s.version<1 || typeof s.expires!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s.expires) || (!Number.isFinite(Date.parse(s.expires)) || new Date(s.expires).toISOString().slice(0,19)!==s.expires.slice(0,19)) || !Array.isArray(v.signatures) || v.signatures.length>64 || new Set(v.signatures.map(x=>x?.keyid)).size!==v.signatures.length) throw Error('metadata');
 if(type==='root') {if(!object(s.keys) || Object.keys(s.keys).length>64 || !object(s.roles)) throw Error('root');for(const name of ['root','timestamp','snapshot','targets']) {const r=s.roles[name];if(!object(r) || !Array.isArray(r.keyids) || !r.keyids.length || r.keyids.length>64 || new Set(r.keyids).size!==r.keyids.length || !Number.isSafeInteger(r.threshold) || r.threshold<1 || r.threshold>r.keyids.length) throw Error('threshold');}}
 if(type==='snapshot' || type==='timestamp') {if(!object(s.meta) || Object.keys(s.meta).length>128 || Object.values(s.meta).some(v=>!object(v) || !Number.isSafeInteger(v.version) || v.version<1)) throw Error('meta');}
 return v;
}
function verifyRepository(repository,expectedBootstrapDigest,now=Date.now(),floor) {
 let checkpoint,rootCheckpoint,metadataProgress;
 const reject=reason=>{const error=Error();error.tufReason=reason;throw error;};
 try {
  if(!digest(expectedBootstrapDigest) || !object(repository) || JSON.stringify(repository).length>4000000 || !Array.isArray(repository.roots) || repository.roots.length>32 || !Number.isFinite(now)) return fail('sigstore-tuf-invalid-input');
  if(sha256(repository.bootstrapRoot)!==expectedBootstrapDigest) return fail('sigstore-tuf-bootstrap-digest-mismatch');
  if(floor && (!object(floor.versions) || !object(floor.signedDigests) || !object(floor.snapshotMeta))) return fail('sigstore-tuf-invalid-floor');
  if(require('./sigstore/node_modules/tuf-js/package.json').version!=='6.0.3') return fail('sigstore-tuf-verifier-version');
  const {TrustedMetadataStore}=require('./sigstore/node_modules/tuf-js/dist/store.js');
  let root=metadata(repository.bootstrapRoot,'root');const store=new TrustedMetadataStore(Buffer.from(repository.bootstrapRoot)),acceptedRoots=[];
  metadataProgress={versions:{},signedDigests:{},snapshotMeta:{}};
  const remember=(role,meta)=>{
    const version=meta.signed.version,signedDigest=sha256(canonical(meta.signed)),previous=floor?.versions[role];
    // Expired intermediate roots may be needed for recovery. Other roles must
    // be unexpired before accepting progress at the caller's reference time.
    if(role!=='root' && Date.parse(meta.signed.expires)<=now)reject('sigstore-tuf-metadata-expired');
    if(previous!==undefined && (!Number.isSafeInteger(previous) || previous<1 || !digest(floor.signedDigests[role]) || version<previous && role!=='root' || version===previous && signedDigest!==floor.signedDigests[role]))reject('sigstore-tuf-rollback-or-equivocation');
    if(role==='timestamp') {
      const referenced=meta.signed.meta['snapshot.json']?.version,prior=floor?.snapshotFromTimestamp??floor?.versions.snapshot;
      if(!Number.isSafeInteger(referenced) || prior!==undefined && (!Number.isSafeInteger(prior) || prior<1 || referenced<prior))reject('sigstore-tuf-snapshot-rollback');
      metadataProgress.snapshotFromTimestamp=referenced;
    }
    if(role==='snapshot') {
      for(const [name,prior] of Object.entries(floor?.snapshotMeta||{}))if(!Number.isSafeInteger(prior) || prior<1 || !meta.signed.meta[name] || meta.signed.meta[name].version<prior)reject('sigstore-tuf-snapshot-rollback');
      metadataProgress.snapshotMeta=Object.fromEntries(Object.entries(meta.signed.meta).map(([k,v])=>[k,v.version]));
    }
    metadataProgress.versions[role]=version;metadataProgress.signedDigests[role]=signedDigest;
  };
  const rememberRoot=()=>{
    // A replay must pass through the exact previously accepted root. Checking
    // only the final higher version permits a fork through a substituted root.
    remember('root',root);
    rootCheckpoint={version:root.signed.version,signedDigest:metadataProgress.signedDigests.root,bootstrapRoot:repository.bootstrapRoot,roots:acceptedRoots.slice()};
  };
  rememberRoot();
  for(const text of repository.roots) {const next=metadata(text,'root');store.updateRoot(Buffer.from(text));root=next;acceptedRoots.push(text);rememberRoot();}
  if(floor?.versions.root!==undefined && root.signed.version<floor.versions.root)reject('sigstore-tuf-rollback-or-equivocation');
  const timestamp=metadata(repository.timestamp,'timestamp');store.updateTimestamp(Buffer.from(repository.timestamp));remember('timestamp',timestamp);
  const snapshot=metadata(repository.snapshot,'snapshot');store.updateSnapshot(Buffer.from(repository.snapshot));remember('snapshot',snapshot);
  // Top-level trusted_root.json wins over unrelated delegation declarations;
  // a missing top-level target is never recovered through delegated metadata.
  const targets=metadata(repository.targets,'targets');store.updateDelegatedTargets(Buffer.from(repository.targets),'targets','root');remember('targets',targets);
  const roles={root,timestamp,snapshot,targets};
  for(const meta of Object.values(roles))if(Date.parse(meta.signed.expires)<=now)reject('sigstore-tuf-metadata-expired');
  checkpoint=metadataProgress;const {versions}=checkpoint;
  const expiresAt=new Date(Math.min(...Object.values(roles).map(v=>Date.parse(v.signed.expires)))).toISOString();
  const proof={bootstrapRootDigest:expectedBootstrapDigest,rootVersion:versions.root,timestampVersion:versions.timestamp,snapshotVersion:versions.snapshot,targetsVersion:versions.targets,expiresAt,checkedAt:new Date(now).toISOString()};
  const info=store.targets.signed.targets['trusted_root.json'];
  if(!info) return {...fail('sigstore-tuf-target-removed'),checkpoint,rootCheckpoint,metadataProgress,proof};
  if(typeof repository.target!=='string' || Buffer.byteLength(repository.target)>200000) return {...fail('sigstore-tuf-target-unavailable'),checkpoint,rootCheckpoint,metadataProgress,proof};
  // Require SHA256 and check every declared target hash with Node crypto.
  // This sync adapter uses the same bytes as the strict target JSON parser.
  const target=Buffer.from(repository.target);if(!Number.isSafeInteger(info.length) || info.length!==target.length || !/^[a-f0-9]{64}$/.test(info.hashes.sha256||'') || sha256(repository.target)!=='sha256:'+info.hashes.sha256 || Object.keys(info.hashes).length>8 || !Object.entries(info.hashes).every(([name,hash])=>typeof hash==='string' && crypto.createHash(name).update(target).digest('hex')===hash)) return {...fail('sigstore-tuf-target-hash-mismatch'),checkpoint,rootCheckpoint,metadataProgress,proof};
  const trustedRoot=strict(repository.target,200000);
  return {status:'verified',reason:'sigstore-tuf-metadata-and-target-verified',trustedRoot,checkpoint,rootCheckpoint,metadataProgress,proof:{...proof,targetDigest:sha256(repository.target)},rootDigest:rootDigest(trustedRoot)};
 }catch(error) {return {...fail(error?.tufReason || (error?.constructor?.name==='ExpiredMetadataError'?'sigstore-tuf-metadata-expired':'sigstore-tuf-metadata-rejected')),...(checkpoint?{checkpoint}:{}),...(rootCheckpoint?{rootCheckpoint}:{}),...(metadataProgress?{metadataProgress}:{})};}
}
function verifyState(state,expectedBootstrapDigest,now=Date.now()) {
 if(!state) return fail('sigstore-tuf-state-required','unverified');
 if(!object(state) || state.schemaVersion!=='1' || state.bootstrapRootDigest!==expectedBootstrapDigest || !object(state.floor)) return fail('sigstore-tuf-invalid-state');
 const verified=verifyRepository(state.repository,expectedBootstrapDigest,now,state.floor);
 // A floor must describe exactly this accepted repository, not a fabricated lower cache floor.
 if(verified.status==='verified' && canonical(verified.checkpoint)!==canonical(state.floor)) return fail('sigstore-tuf-state-floor-mismatch');
 if(verified.status==='verified' && state.lastAttempt?.status!=='verified') return fail('sigstore-tuf-refresh-not-verified','unverified');
 return verified;
}
function applyProgress(previous,repository,result) {
 const progress=result.rootCheckpoint,partial=result.metadataProgress;let floor=previous?.floor||{versions:{},signedDigests:{},snapshotMeta:{}};
 if(result.checkpoint)floor=result.checkpoint;
 else if(partial) {
   floor=JSON.parse(JSON.stringify(floor));
   if(partial.snapshotFromTimestamp!==undefined)floor.snapshotFromTimestamp=Math.max(floor.snapshotFromTimestamp||0,partial.snapshotFromTimestamp);
   for(const [role,version] of Object.entries(partial.versions))if(floor.versions[role]===undefined || version>floor.versions[role]){floor.versions[role]=version;floor.signedDigests[role]=partial.signedDigests[role];if(role==='snapshot')floor.snapshotMeta=partial.snapshotMeta;}
 }
 let accepted=result.checkpoint?repository:previous?.repository||repository;
 if(progress && progress.version===floor.versions.root && progress.signedDigest===floor.signedDigests.root)accepted={...accepted,bootstrapRoot:progress.bootstrapRoot,roots:progress.roots};
 return {repository:accepted,floor};
}
module.exports=Object.freeze({strict,metadata,verifyRepository,verifyState,applyProgress});
