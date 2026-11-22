// Controlled offline Fulcio-compatible CA, CT log and Rekor/TSA. No identity token or service call.
import {createRequire} from 'node:module';import {generateKeyPairSync,createPublicKey,createHash,sign} from 'node:crypto';
import {signedFixture,envelope} from './signed-evidence.mjs';import {records,hash} from './execution-evidence.mjs';
const require=createRequire(import.meta.url),mock=require('../../verification/sigstore/node_modules/@sigstore/mock');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const sha=b=>createHash('sha256').update(b).digest(),b64=b=>Buffer.from(b).toString('base64');
const pair=()=>generateKeyPairSync('ec',{namedCurve:'prime256v1'}),der=k=>k.export({format:'der',type:'spki'});
export async function keylessFixture({tsa=false}={}) {
 const caKeys=pair(),ctKeys=pair(),rekorKeys=pair(),ct=await mock.initializeCTLog(ctKeys),ca=await mock.initializeCA(caKeys,ct),log=await mock.initializeTLog('https://rekor.mock.invalid',rekorKeys);
 const tsaClock=new Date();const timestamp=tsa?await mock.initializeTSA(pair(),tsaClock):null;
 const time=new Date().toISOString(),f=signedFixture({time}),s=f.f.config.subjects[0];
 const issuer='https://token.actions.example',identity='https://github.com/example/web/.github/workflows/build.yml@refs/heads/main';
 const cert=await ca.issueCertificate({publicKey:der(createPublicKey(f.privateKey)),subjectAltName:identity,extensions:[{oid:'1.3.6.1.4.1.57264.1.8',value:issuer}]});
 const validFor={start:new Date(Date.now()-86400000).toISOString(),end:new Date(Date.now()+364*86400000).toISOString()};
 const authority=(publicKey,baseUrl)=>({baseUrl,hashAlgorithm:'SHA2_256',publicKey:{rawBytes:b64(publicKey),keyDetails:'PKIX_ECDSA_P256_SHA_256',validFor},logId:{keyId:b64(sha(publicKey))}});
 const root={mediaType:'application/vnd.dev.sigstore.trustedroot+json;version=0.1',certificateAuthorities:[{uri:'https://fulcio.mock.invalid',certChain:{certificates:[{rawBytes:b64(ca.rootCertificate)}]},validFor}],ctlogs:[authority(der(ctKeys.publicKey),'https://ct.mock.invalid')],tlogs:[authority(der(rekorKeys.publicKey),'https://rekor.mock.invalid')],timestampAuthorities:timestamp?[{uri:'https://tsa.mock.invalid',certChain:{certificates:[{rawBytes:b64(timestamp.intCertificate)},{rawBytes:b64(timestamp.rootCertificate)}]},validFor}]:[]};
 const bundles={};
 for(const kind of ['build','deployment']) {
  const env=envelope(f[kind],f.privateKey),body={apiVersion:'0.0.1',kind:'dsse',spec:{envelopeHash:{algorithm:'sha256',value:sha(Buffer.from(JSON.stringify(env))).toString('hex')},payloadHash:{algorithm:'sha256',value:sha(Buffer.from(env.payload,'base64')).toString('hex')},signatures:[{signature:env.signatures[0].sig,verifier:b64(Buffer.from(new (require('node:crypto').X509Certificate)(cert).toString()))}]}};
  const logged=Object.values(await log.log(body))[0];
  // The upstream mock SET uses a random index while its one-leaf proof uses 0.
  // Bind both assertions to index 0 and sign the corrected SET with the controlled log key.
  logged.logIndex=0;
  logged.verification.signedEntryTimestamp=sign('sha256',Buffer.from(canonical({body:logged.body,integratedTime:logged.integratedTime,logID:logged.logID,logIndex:0})),rekorKeys.privateKey).toString('base64');
  const proof=logged.verification.inclusionProof;
  const entry={logIndex:'0',logId:{keyId:b64(Buffer.from(logged.logID,'hex'))},kindVersion:{kind:'dsse',version:'0.0.1'},integratedTime:String(logged.integratedTime),canonicalizedBody:logged.body,inclusionPromise:{signedEntryTimestamp:logged.verification.signedEntryTimestamp},inclusionProof:{logIndex:'0',treeSize:String(proof.treeSize),rootHash:b64(Buffer.from(proof.rootHash,'hex')),hashes:proof.hashes,checkpoint:{envelope:proof.checkpoint}}};
  const material={certificate:{rawBytes:b64(cert)},tlogEntries:[entry]};
  if(timestamp) {tsaClock.setTime(Math.floor(Date.now()/1000)*1000);delete entry.inclusionPromise;entry.integratedTime='0';const token=await timestamp.timestamp({artifactHash:sha(Buffer.from(env.signatures[0].sig,'base64')),hashAlgorithmOID:'2.16.840.1.101.3.4.2.1',nonce:1,policyOID:'1.3.6.1.4.1.57264.2',certReq:true});material.timestampVerificationData={rfc3161Timestamps:[{signedTimestamp:b64(token)}]};}
  bundles[kind]={mediaType:'application/vnd.dev.sigstore.bundle.v0.3+json',verificationMaterial:material,dsseEnvelope:env};
 }
 const {keyId,publicKey,algorithm,signatureEncoding,...common}=f.policy.keys[0];
 const rule={...common,oidcIssuer:issuer,certificateIdentity:identity,trustedRootDigest:hash(canonical(root))};
 const policy={schemaVersion:'1',keyless:[rule]};
 const r=records(f.f);s.attestations=[];
 for(const kind of ['build','deployment']) {const content=JSON.stringify(bundles[kind]),path='evidence/'+kind+'.sigstore';r.push({path,content});s.attestations.push({kind,path,format:'sigstore-bundle',sha256:hash(content)});}
 r.find(x=>x.path==='.frontend-evidence.json').content=JSON.stringify(f.f.config);
 return {records:r,f,policy,root,bundles,now:new Date().toISOString()};
}
