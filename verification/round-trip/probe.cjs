'use strict';
const {randomUUID,createHash}=require('node:crypto'),{sha256}=require('../../analysis/execution-evidence.js'),attestations=require('../../analysis/attestations.js');
const REPO='h4ckney/frontend-agent-playbook',WORKFLOW='.github/workflows/keyless-round-trip.yml',ISSUER='https://token.actions.githubusercontent.com',ACK='public-synthetic-keyless-round-trip-v1';
const refs=['refs/heads/main','refs/heads/feature/keyless-live-round-trip'];
function contextFromEnv(env) {
 if(env.DEBUG || env.NODE_DEBUG || env.GITHUB_ACTIONS!=='true' || env.GITHUB_REPOSITORY!==REPO || !['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) || !refs.includes(env.GITHUB_REF) || env.GITHUB_SERVER_URL!=='https://github.com' || env.SIGSTORE_PUBLICATION_ACK!==ACK
  || env.GITHUB_WORKFLOW_REF!==REPO+'/'+WORKFLOW+'@'+env.GITHUB_REF || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'') || !/^[1-9][0-9]{0,15}$/.test(env.GITHUB_RUN_ID||'') || !/^[1-9][0-9]{0,2}$/.test(env.GITHUB_RUN_ATTEMPT||'')) throw Error('trusted workflow required');
 return Object.freeze({repository:REPO,ref:env.GITHUB_REF,sha:env.GITHUB_SHA,workflowRef:env.GITHUB_WORKFLOW_REF,runId:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,identity:'https://github.com/'+env.GITHUB_WORKFLOW_REF,invocation:'https://github.com/'+REPO+'/actions/runs/'+env.GITHUB_RUN_ID+'/attempts/'+env.GITHUB_RUN_ATTEMPT});
}
function requestUrl(env) {
 const url=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);if(url.protocol!=='https:' || !url.hostname.endsWith('.actions.githubusercontent.com') || url.username || url.password || url.hash || url.port && url.port!=='443' || typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN!=='string' || env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length<20 || env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length>20000)throw Error('GitHub OIDC endpoint required');
 url.searchParams.set('audience','sigstore');return url.href;
}
// Claim checks constrain the requested token but do not authenticate JWT signatures.
// Fulcio verifies that signature; the returned certificate is independently verified.
function validateTokenClaims(token,context,started,now=Date.now()) {
 if(typeof token!=='string' || token.length>24000 || token.split('.').length!==3)throw Error('OIDC claims rejected');
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
 if(claims.iss!==ISSUER || claims.aud!=='sigstore' || claims.repository!==context.repository || claims.ref!==context.ref || claims.sha!==context.sha || claims.workflow_ref!==context.workflowRef || String(claims.run_id)!==context.runId || String(claims.run_attempt)!==context.attempt || claims.repository_visibility!=='public' || String(claims.repository_id)!=='1298353113' || String(claims.repository_owner_id)!=='46347578' || claims.runner_environment!=='github-hosted' || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.nbf) || claims.iat*1000<started-60000 || claims.iat*1000>now+30000 || claims.nbf*1000>now+30000 || claims.exp*1000<=now || claims.exp-claims.iat>900 || typeof claims.sub!=='string' || !claims.sub.length)throw Error('OIDC claims rejected');
 return true;
}
function createSynthetic(context,startedAt,nonce=randomUUID()) {
 if(!/^[a-f0-9-]{36}$/.test(nonce) || !Number.isFinite(Date.parse(startedAt)))throw Error('invalid synthetic input');
 const manifest={name:'synthetic-keyless-probe',private:true,version:'0.0.0',dependencies:{next:'16.5.0'}},lock={lockfileVersion:3,packages:{'':manifest,'node_modules/next':{version:'16.5.0',integrity:'synthetic-not-an-installation'}}};
 const artifact=JSON.stringify({kind:'synthetic-keyless-round-trip',repository:context.repository,ref:context.ref,sha:context.sha,runId:context.runId,attempt:context.attempt,nonce})+'\n',artifactPath='synthetic/round-trip.txt',artifactDigest=sha256(artifact),manifestPath='synthetic/package.json',lockPath='synthetic/package-lock.json',sbomPath='evidence/synthetic.cdx.json';
 const sbom={bomFormat:'CycloneDX',specVersion:'1.6',metadata:{timestamp:startedAt,component:{type:'application',name:'synthetic-keyless-probe',hashes:[{alg:'SHA-256',content:artifactDigest.slice(7)}]}},components:[{type:'library',name:'next',version:'16.5.0',purl:'pkg:npm/next@16.5.0'}]};
 const subject={id:'synthetic-keyless-probe',manifest:manifestPath,manifestSha256:sha256(JSON.stringify(manifest)),revision:context.sha,observedAt:startedAt,artifactDigest,artifactName:artifactPath,lockfile:{path:lockPath,sha256:sha256(JSON.stringify(lock))},sbom:{path:sbomPath,format:'cyclonedx-json',sha256:sha256(JSON.stringify(sbom))}};
 const repository='git+https://github.com/'+context.repository+'@'+context.ref,buildType='https://h4ckney.github.io/frontend-agent-playbook/buildtypes/keyless-round-trip/v1',externalParameters={synthetic:true,frontendEvidence:{sbom:{format:'cyclonedx-json'}},run:{id:context.runId,attempt:context.attempt,ref:context.ref,sha:context.sha}};
 const statement={_type:'https://in-toto.io/Statement/v1',subject:[{name:artifactPath,digest:{sha256:artifactDigest.slice(7)}},{name:sbomPath,digest:{sha256:subject.sbom.sha256.slice(7)}}],predicateType:'https://slsa.dev/provenance/v1',predicate:{buildDefinition:{buildType,externalParameters,resolvedDependencies:[{uri:repository,digest:{gitCommit:context.sha}},{uri:'file:'+manifestPath,digest:{sha256:subject.manifestSha256.slice(7)}},{uri:'file:'+lockPath,digest:{sha256:subject.lockfile.sha256.slice(7)}}]},runDetails:{builder:{id:context.identity},metadata:{invocationId:context.invocation,startedOn:startedAt,finishedOn:startedAt}}}};
 const rule={roles:['build'],repository,builderId:context.identity,buildType,externalParameters,oidcIssuer:ISSUER,certificateIdentity:context.identity,tufBootstrapRootDigest:'sha256:27aea7e372aa7864065174f0661784fcf8b0e28b1dbfebeada31a0f1fb19167f',notBefore:new Date(Date.parse(startedAt)-300000).toISOString(),notAfter:new Date(Date.parse(startedAt)+1800000).toISOString()};
 const records=[{path:manifestPath,content:JSON.stringify(manifest)},{path:lockPath,content:JSON.stringify(lock)},{path:sbomPath,content:JSON.stringify(sbom)},{path:artifactPath,content:artifact}];
 return {records,subject,statement,policy:{schemaVersion:'1',keyless:[rule]}};
}
function asHashedRekord(content) {
 if(content.$case!=='dsseEnvelope' || content.dsseEnvelope.signatures.length!==1)throw Error('DSSE required');
 const env=content.dsseEnvelope;return {$case:'messageSignature',messageSignature:{messageDigest:{algorithm:1,digest:createHash('sha256').update(attestations.pae(env.payloadType,env.payload)).digest()},signature:env.signatures[0].sig}};
}
function assertVerifiedRoundTrip(bundle,statement,audit,started,now=Date.now()) {
 if(bundle.dsseEnvelope?.payload!==Buffer.from(JSON.stringify(statement)).toString('base64') || bundle.verificationMaterial?.tlogEntries?.length!==1 || bundle.verificationMaterial?.timestampVerificationData?.rfc3161Timestamps?.length!==1)throw Error('round-trip material mismatch');
 const entry=bundle.verificationMaterial.tlogEntries[0],auth=audit.securityContext.executionEvidence.subjects[0]?.authentication,check=auth?.attestations[0];
 if(entry.kindVersion?.kind!=='hashedrekord' || entry.kindVersion?.version!=='0.0.2' || entry.inclusionPromise!==undefined || auth?.status!=='partial' || auth.verifiedReports.length!==1 || auth.verifiedReports[0]!=='sbom' || auth.attestations.length!==1 || !check.signatureVerified || !check.bindingsVerified || !check.keyless?.tuf || !check.keyless.signingTimes.length || check.keyless.signingTimes.some(t=>Date.parse(t)<started-30000 || Date.parse(t)>now) || !audit.securityContext.coverage.gaps.some(g=>g.reason==='execution-evidence-authenticity-unverified'))throw Error('round-trip verification failed');
 return check;
}
module.exports=Object.freeze({REPO,WORKFLOW,ISSUER,ACK,contextFromEnv,requestUrl,validateTokenClaims,createSynthetic,asHashedRekord,assertVerifiedRoundTrip});
