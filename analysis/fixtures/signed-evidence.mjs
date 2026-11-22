// Controlled test signers; no private keys are written or trusted automatically.
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {fixture,records,hash,at} from './execution-evidence.mjs';
export function signedFixture({encoding='der',time=at}={}) {
 const f=fixture({version:'16.5.0'});f.config.subjects[0].observedAt=time;f.sbom.metadata.timestamp=time;f.deployment.observedAt=time;records(f);const s=f.config.subjects[0];s.artifactName='web.tgz';
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=pair.publicKey.export({format:'pem',type:'spki'}),keyId='sha256:'+createHash('sha256').update(pair.publicKey.export({format:'der',type:'spki'})).digest('hex');
 const policy={schemaVersion:'1',keys:[{keyId,publicKey,algorithm:'ecdsa-p256-sha256',signatureEncoding:encoding,roles:['build','deployment'],repository:'git+https://github.com/example/web@refs/heads/main',builderId:'https://ci.example/builders/isolated-v1',buildType:'https://ci.example/build-types/web-v1',externalParameters:{target:'web',ref:'refs/heads/main',frontendEvidence:{installation:{format:'npm-ls',mode:'installed-tree'},sbom:{format:'cyclonedx-json'}}},environments:['production'],notBefore:new Date(Date.parse(time)-30*86400000).toISOString(),notAfter:new Date(Date.parse(time)+365*86400000).toISOString()}]};
 const output=ref=>({name:ref.path,digest:{sha256:ref.sha256.slice(7)}}),artifact={name:s.artifactName,digest:{sha256:s.artifactDigest.slice(7)}};
 const build={_type:'https://in-toto.io/Statement/v1',subject:[artifact,output(s.installation),output(s.sbom)],predicateType:'https://slsa.dev/provenance/v1',predicate:{buildDefinition:{buildType:policy.keys[0].buildType,externalParameters:JSON.parse(JSON.stringify(policy.keys[0].externalParameters)),resolvedDependencies:[{uri:policy.keys[0].repository,digest:{gitCommit:s.revision}},{uri:'file:'+s.manifest,digest:{sha256:s.manifestSha256.slice(7)}},{uri:'file:'+s.lockfile.path,digest:{sha256:s.lockfile.sha256.slice(7)}}]},runDetails:{builder:{id:policy.keys[0].builderId},metadata:{startedOn:new Date(Date.parse(time)-60000).toISOString(),finishedOn:time}}}};
 const deployment={_type:'https://in-toto.io/Statement/v1',subject:[artifact,output(s.deployment)],predicateType:'https://h4ckney.github.io/frontend-agent-playbook/attestation/deployment/v1',predicate:{reportFormat:'deployment-observation',collector:{id:policy.keys[0].builderId},source:{uri:policy.keys[0].repository,revision:s.revision},environment:'production',status:'succeeded',observedAt:time}};
 return {f,policy,privateKey:pair.privateKey,build,deployment,encoding};
}
export function envelope(statement,key,encoding='der') {
 const body=Buffer.from(JSON.stringify(statement)),type='application/vnd.in-toto+json';
 const message=Buffer.concat([Buffer.from('DSSEv1 '+Buffer.byteLength(type)+' '+type+' '+body.length+' '),body]);
 return {payloadType:type,payload:body.toString('base64'),signatures:[{keyid:'unauthenticated-hint',sig:sign('sha256',message,{key,dsaEncoding:encoding}).toString('base64')}]};
}
export function signedRecords(f,{envelopes}={}) {
 const r=records(f.f),s=f.f.config.subjects[0];s.attestations=[];
 for(const kind of ['build','deployment']) {
  const value=envelopes?.[kind]||envelope(f[kind],f.privateKey,f.encoding),content=JSON.stringify(value),path='evidence/'+kind+'.dsse';
  s.attestations.push({kind,path,format:'dsse-in-toto',sha256:hash(content)});r.push({path,content});
 }
 r.find(x=>x.path==='.frontend-evidence.json').content=JSON.stringify(f.f.config);return r;
}
