// Real controlled TUF signatures. Private keys remain only in test memory.
import {generateKeyPairSync,sign,createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),models=require('../../verification/sigstore/node_modules/@tufjs/models'),{sha256}=require('../execution-evidence.js');
const key=()=>{const {publicKey,privateKey}=generateKeyPairSync('ed25519'),raw=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),id=createHash('sha256').update(raw).digest('hex');return {id,privateKey,json:{keytype:'ed25519',scheme:'ed25519',keyval:{public:raw}}};};
const encode=(type,signed,keys)=>{const meta=models.Metadata.fromJSON(type,{signed,signatures:[]});for(const key of keys)meta.sign(bytes=>new models.Signature({keyID:key.id,sig:sign(null,bytes,key.privateKey).toString('hex')}));return JSON.stringify(meta.toJSON());};
const info=(text,version)=>({version,length:Buffer.byteLength(text),hashes:{sha256:sha256(text).slice(7)}});
export function tufFixture(trustedRoot) {
 const oldRoots=[key(),key()],newRoots=[key(),key()],timestamp=key(),snapshot=key(),targets=key(),replacementTimestamp=key();
 const expires=new Date(Date.now()+86400000).toISOString(),common=(_type,version=1,expiry=expires)=>({_type,spec_version:'1.0.31',version,expires:expiry});
 const root=(version,roots,ts=timestamp,signers=roots,expiry=expires)=>encode('root',{...common('root',version,expiry),consistent_snapshot:true,keys:Object.fromEntries([...roots,ts,snapshot,targets].map(k=>[k.id,k.json])),roles:Object.fromEntries([['root',roots,2],['timestamp',[ts],1],['snapshot',[snapshot],1],['targets',[targets],1]].map(([name,keys,threshold])=>[name,{keyids:keys.map(k=>k.id),threshold}]))},signers);
 const bootstrapRoot=root(1,oldRoots),rotated=root(2,newRoots,timestamp,[...oldRoots,...newRoots]);
 const make=({version=1,roots=[],ts=timestamp,remove=false,target=JSON.stringify(trustedRoot),expiry={},delegations,extraMeta={},targetHashes={}}={})=>{
  const targetInfo={length:Buffer.byteLength(target),hashes:{sha256:sha256(target).slice(7),...targetHashes}};
  const targetMeta=encode('targets',{...common('targets',version,expiry.targets),targets:remove?{}:{'trusted_root.json':targetInfo},...(delegations?{delegations}: {})},[targets]);
  const snapshotMeta=encode('snapshot',{...common('snapshot',version,expiry.snapshot),meta:{'targets.json':info(targetMeta,version),...extraMeta}},[snapshot]);
  const timestampMeta=encode('timestamp',{...common('timestamp',version,expiry.timestamp),meta:{'snapshot.json':info(snapshotMeta,version)}},[ts]);
  return {bootstrapRoot,roots,timestamp:timestampMeta,snapshot:snapshotMeta,targets:targetMeta,target};
 };
 const timestampFor=(text,version)=>encode('timestamp',{...common('timestamp',version),meta:{'snapshot.json':info(text,JSON.parse(text).signed.version)}},[timestamp]);
 return {pin:sha256(bootstrapRoot),make,timestampFor,root,oldRoots,newRoots,replacementTimestamp,rotated,expires};
}
