(function () {
  "use strict";
  const parser=typeof module!=="undefined" && module.exports ? require("./lockfile-graph.js") : globalThis.FrontendLockGraph;
  const evidence=typeof module!=="undefined" && module.exports ? require("./execution-evidence.js") : globalThis.FrontendExecutionEvidence;
  const PAYLOAD_TYPE="application/vnd.in-toto+json",BUILD="https://slsa.dev/provenance/v1",DEPLOY="https://h4ckney.github.io/frontend-agent-playbook/attestation/deployment/v1";
  const tokens=new WeakMap(),object=v=>v!==null && typeof v==="object" && !Array.isArray(v);
  const hex=v=>typeof v==="string" && /^[a-f0-9]{64}$/.test(v),digest=v=>typeof v==="string" && /^sha256:[a-f0-9]{64}$/.test(v);
  const date=v=>typeof v==="string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,19)===v.slice(0,19);
  const encode=s=>new TextEncoder().encode(s);
  const parse=s=>{const v=parser.parseJSONC(s);JSON.parse(s);if(!object(v)) throw Error("object");return v;};
  const canonical=v=>Array.isArray(v)?"["+v.map(canonical).join(",")+"]":object(v)?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
  function base64(s,max=500000) {
    if(typeof s!=="string" || s.length>Math.ceil(max/3)*4 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(s) || s.replace(/=+$/,"").length%4===1) throw Error("base64");
    const normalized=s.replace(/-/g,"+").replace(/_/g,"/"),plain=normalized.replace(/=+$/,"");
    const raw=atob(plain+"=".repeat((4-plain.length%4)%4));
    if(raw.length>max || btoa(raw).replace(/=+$/,"")!==plain) throw Error("base64");
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  }
  function pae(type,payload) {
    const prefix=encode("DSSEv1 "+encode(type).length+" "+type+" "+payload.length+" "),out=new Uint8Array(prefix.length+payload.length);out.set(prefix);out.set(payload,prefix.length);return out;
  }
  function rawSignature(sig,encoding) {
    if(encoding==="ieee-p1363") {if(sig.length!==64) throw Error("signature");return sig;}
    // Strict DER SEQUENCE(INTEGER r, INTEGER s), converted to WebCrypto's r||s.
    if(sig.length<8 || sig.length>72 || sig[0]!==48 || sig[1]!==sig.length-2) throw Error("der");
    let offset=2;const out=new Uint8Array(64);
    for(let n=0;n<2;n++) {
      if(sig[offset++]!==2) throw Error("der");const length=sig[offset++];
      if(!length || length>33 || offset+length>sig.length || sig[offset]&128 || length>1 && sig[offset]===0 && !(sig[offset+1]&128)) throw Error("der");
      const value=sig.slice(offset,offset+length);offset+=length;
      const bytes=value.length===33 ? value.slice(1):value;if(bytes.length>32 || value.length===33 && value[0]!==0) throw Error("der");out.set(bytes,n*32+32-bytes.length);
    }
    if(offset!==sig.length) throw Error("der");return out;
  }
  function cryptoSubtle() {return typeof module!=="undefined" && module.exports ? require("node:crypto").webcrypto?.subtle : globalThis.crypto?.subtle;}
  async function verifySignature(envelope,key,encoding,subtle=cryptoSubtle(),payload=base64(envelope.payload)) {
    if(!subtle) return false;
    const message=pae(envelope.payloadType,payload);
    for(const signature of envelope.signatures) {try {if(await subtle.verify({name:"ECDSA",hash:"SHA-256"},key,rawSignature(base64(signature?.sig,100),encoding),message)) return true;} catch { /* Invalid signatures do not confer trust. */ }}
    return false;
  }
  function webURI(v,git=false) {
    try {if(typeof v!=="string" || v.length>1000 || /[\x00-\x20]/.test(v)) return false;const u=new URL(git?v.replace(/^git\+/,""):v);return u.protocol==="https:" && !u.username && !u.password && !u.search && !u.hash;}catch{return false;}
  }
  async function policyKeys(policy,now,subtle) {
    if(!object(policy) || policy.schemaVersion!=="1" || Object.keys(policy).some(k=>!["schemaVersion","keys","keyless"].includes(k)) || (policy.keys!==undefined && !Array.isArray(policy.keys)) || (policy.keyless!==undefined && !Array.isArray(policy.keyless)) || !((policy.keys?.length||0)+(policy.keyless?.length||0)) || (policy.keys?.length||0)+(policy.keyless?.length||0)>8) throw Error("policy");
    const keys=[],ids=new Set();
    for(const rule of policy.keys||[]) {
      if(!object(rule) || Object.keys(rule).some(k=>!["keyId","publicKey","algorithm","signatureEncoding","roles","repository","builderId","buildType","externalParameters","environments","notBefore","notAfter"].includes(k)) || !digest(rule.keyId) || ids.has(rule.keyId) || rule.algorithm!=="ecdsa-p256-sha256" || !["der","ieee-p1363"].includes(rule.signatureEncoding) || !Array.isArray(rule.roles) || !rule.roles.length || rule.roles.some(r=>!["build","deployment"].includes(r)) || new Set(rule.roles).size!==rule.roles.length || !webURI(rule.repository,true) || !webURI(rule.builderId) || !date(rule.notBefore) || !date(rule.notAfter) || Date.parse(rule.notAfter)<=Date.parse(rule.notBefore)) throw Error("policy");
      if(rule.roles.includes("build") && (!webURI(rule.buildType) || !object(rule.externalParameters))) throw Error("policy");
      if(rule.roles.includes("deployment") && (!Array.isArray(rule.environments) || !rule.environments.length || rule.environments.some(v=>!["production","staging","preview"].includes(v)))) throw Error("policy");
      const pem=typeof rule.publicKey==="string" && /^-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END PUBLIC KEY-----\s*$/.exec(rule.publicKey);
      if(!pem || rule.publicKey.length>2000) throw Error("policy");
      const der=base64(pem[1].replace(/[\r\n]/g,""),1024),actual="sha256:"+Array.from(new Uint8Array(await subtle.digest("SHA-256",der)),n=>n.toString(16).padStart(2,"0")).join("");
      if(actual!==rule.keyId) throw Error("policy");ids.add(actual);
      keys.push({rule,key:await subtle.importKey("spki",der,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]),active:now>=Date.parse(rule.notBefore) && now<=Date.parse(rule.notAfter)});
    }
    return keys;
  }
  function keylessRules(policy) {
    const rules=[];
    for(const rule of policy.keyless||[]) {
      if(!object(rule) || Object.keys(rule).some(k=>!["oidcIssuer","certificateIdentity","trustedRootDigest","tufBootstrapRootDigest","roles","repository","builderId","buildType","externalParameters","environments","notBefore","notAfter"].includes(k))
        || !webURI(rule.oidcIssuer) || typeof rule.certificateIdentity!=="string" || !rule.certificateIdentity.length || rule.certificateIdentity.length>1000 || /[\x00-\x20]/.test(rule.certificateIdentity) || (digest(rule.trustedRootDigest)===digest(rule.tufBootstrapRootDigest)) || rule.trustedRootDigest!==undefined && !digest(rule.trustedRootDigest) || rule.tufBootstrapRootDigest!==undefined && !digest(rule.tufBootstrapRootDigest)
        || !Array.isArray(rule.roles) || !rule.roles.length || rule.roles.some(r=>!["build","deployment"].includes(r)) || new Set(rule.roles).size!==rule.roles.length || !webURI(rule.repository,true) || !webURI(rule.builderId)
        || !date(rule.notBefore) || !date(rule.notAfter) || Date.parse(rule.notAfter)<=Date.parse(rule.notBefore)
        || rule.roles.includes("build") && (!webURI(rule.buildType) || !object(rule.externalParameters))
        || rule.roles.includes("deployment") && (!Array.isArray(rule.environments) || !rule.environments.length || rule.environments.some(v=>!["production","staging","preview"].includes(v)))) throw Error("policy");
      rules.push(rule);
    }
    if(new Set(rules.map(r=>r.tufBootstrapRootDigest?"tuf":"pinned")).size>1 || new Set(rules.filter(r=>r.tufBootstrapRootDigest).map(r=>r.tufBootstrapRootDigest)).size>1) throw Error("ambiguous trust source");
    return rules;
  }
  function matches(entries,name,sha,field="name",algorithm="sha256") {
    if(!Array.isArray(entries) || entries.length>200) return false;
    const selected=entries.filter(item=>object(item) && item[field]===name);
    return selected.length===1 && selected[0].digest?.[algorithm]===sha;
  }
  function bindings(statement,kind,input,rule,files,now) {
    if(statement._type!=="https://in-toto.io/Statement/v1" || !Array.isArray(statement.subject) || !statement.subject.length || statement.subject.length>200 || new Set(statement.subject.map(v=>v?.name)).size!==statement.subject.length || !digest(input.artifactDigest) || typeof input.artifactName!=="string" || input.artifactName.length>300 || !matches(statement.subject,input.artifactName,input.artifactDigest.slice(7))) return false;
    if(typeof input.revision!=="string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.revision) || !date(input.observedAt) || typeof input.manifest!=="string" || !digest(input.manifestSha256) || !object(input.lockfile) || !digest(input.lockfile.sha256) || typeof input.lockfile.path!=="string" || !files.has(input.manifest) || evidence.sha256(files.get(input.manifest))!==input.manifestSha256 || !files.has(input.lockfile.path) || evidence.sha256(files.get(input.lockfile.path))!==input.lockfile.sha256) return false;
    const output=ref=>object(ref) && evidence.safePath(ref.path) && digest(ref.sha256) && files.has(ref.path) && evidence.sha256(files.get(ref.path))===ref.sha256 && matches(statement.subject,ref.path,ref.sha256.slice(7));
    const current=t=>date(t) && Date.parse(t)<=now && now-Date.parse(t)<=30*86400000 && Date.parse(t)>=Date.parse(rule.notBefore) && Date.parse(t)<=Date.parse(rule.notAfter);
    const p=statement.predicate;if(!object(p)) return false;
    if(kind==="build") {
      const definition=p.buildDefinition,run=p.runDetails,interpretation={};
      for(const kind of ["installation","sbom"]) if(input[kind]) interpretation[kind]={format:input[kind].format,...(input[kind].mode===undefined?{}:{mode:input[kind].mode})};
      return statement.predicateType===BUILD && object(definition) && definition.buildType===rule.buildType && object(definition.externalParameters) && canonical(definition.externalParameters)===canonical(rule.externalParameters) && canonical(definition.externalParameters.frontendEvidence)===canonical(interpretation) && run?.builder?.id===rule.builderId
        && matches(definition.resolvedDependencies,rule.repository,input.revision,"uri","gitCommit")
        && matches(definition.resolvedDependencies,"file:"+input.manifest,input.manifestSha256?.slice(7),"uri")
        && object(input.lockfile) && matches(definition.resolvedDependencies,"file:"+input.lockfile.path,input.lockfile.sha256?.slice(7),"uri")
        && [input.installation,input.sbom].some(Boolean) && [input.installation,input.sbom].filter(Boolean).every(output)
        && current(run.metadata?.startedOn) && current(run.metadata?.finishedOn) && Date.parse(run.metadata.startedOn)<=Date.parse(run.metadata.finishedOn) && date(input.observedAt) && Date.parse(run.metadata.finishedOn)<=Date.parse(input.observedAt);
    }
    let report;try {report=parse(files.get(input.deployment?.path));}catch{return false;}
    return statement.predicateType===DEPLOY && p.reportFormat===input.deployment?.format && output(input.deployment) && p.collector?.id===rule.builderId && p.source?.uri===rule.repository && p.source?.revision===input.revision
      && p.environment===report.environment && rule.environments.includes(p.environment) && p.status==="succeeded" && report.status==="succeeded" && p.observedAt===report.observedAt && current(p.observedAt);
  }
  function empty(policyDigest=null) {return {policyDigest,checkedAt:null,subjects:[],reason:"verification-not-run"};}
  async function prepare(records,trustPolicy,at,options={}) {
    const snapshot=records.map(r=>({path:r.path,content:r.content})),files=new Map(snapshot.map(r=>[r.path,r.content])),token=Object.freeze({});
    const now=at==null?Date.now():new Date(at).getTime();let policy=null,policyDigest=null,trustedRoot;
    try {if(options.sigstoreTrustedRoot!==undefined){const text=JSON.stringify(options.sigstoreTrustedRoot);if(text.length>200000) throw Error();trustedRoot=parse(text);}}catch {trustedRoot={};}
    try {if(trustPolicy!==undefined && trustPolicy!==null) {const text=JSON.stringify(trustPolicy);if(text.length>100000) throw Error();policy=parse(text);policyDigest=evidence.sha256(canonical(policy));}}catch {policy={};policyDigest=null;}
    const result={...empty(policyDigest),checkedAt:Number.isFinite(now)?new Date(now).toISOString():null,reason:"no-trust-policy"};
    let validUntil=now+300000;
    const finish=()=>{tokens.set(token,{snapshot,result:JSON.parse(JSON.stringify(result)),now,validUntil});return token;};
    if(files.size!==snapshot.length || !Number.isFinite(now)) {result.reason="ambiguous-input-or-clock";return finish();}
    let config;try {config=parse(files.get(evidence.CONFIG));if(config.schemaVersion!=="1" || !Array.isArray(config.subjects) || config.subjects.length>100) throw Error();}catch{return finish();}
    const subtle=cryptoSubtle();let keys=[],keyless=[];
    if(policy!==null && subtle) {try {keys=await policyKeys(policy,now,subtle);keyless=keylessRules(policy);validUntil=Math.min(validUntil,...keys.filter(k=>k.active).map(k=>Date.parse(k.rule.notAfter)),...keyless.filter(k=>now>=Date.parse(k.notBefore) && now<=Date.parse(k.notAfter)).map(k=>Date.parse(k.notAfter)));result.reason="verification-completed";}catch {keys=[];keyless=[];result.reason="invalid-trust-policy";}}
    else if(!subtle) result.reason="crypto-unavailable";
    let tufState,tufVerification;
    try {if(options.sigstoreTufState!==undefined){const text=JSON.stringify(options.sigstoreTufState);if(text.length>4500000) throw Error();tufState=parse(text);}}catch {tufState={};}
    if(keyless.some(r=>r.tufBootstrapRootDigest) && typeof module!=="undefined" && module.exports) {
      try {tufVerification=require("../verification/sigstore-tuf.cjs").verifyState(tufState,keyless[0].tufBootstrapRootDigest,now);}catch {tufVerification={status:"unverified",reason:"sigstore-tuf-verifier-unavailable"};}
      if(tufVerification.status==="verified") validUntil=Math.min(validUntil,Date.parse(tufVerification.proof.expiresAt)-1);
    }
    let work=0,envelopes=0;
    for(const input of config.subjects) {
      if(!object(input) || typeof input.id!=="string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id)) continue;
      const entry={id:input.id,attestations:[]};result.subjects.push(entry);
      const refs=input.attestations;if(refs===undefined) continue;
      if(!Array.isArray(refs) || refs.length>2 || refs.some(ref=>!object(ref) || !["build","deployment"].includes(ref.kind)) || new Set(refs.map(ref=>ref.kind)).size!==refs.length) {entry.attestations.push({kind:"unknown",path:evidence.CONFIG,status:"rejected",signatureVerified:false,bindingsVerified:false,keyId:null,reason:"invalid-or-duplicate-attestation-reference"});continue;}
      for(const ref of refs) {
        const check={kind:ref.kind,path:evidence.safePath(ref.path)?ref.path:evidence.CONFIG,status:"unverified",signatureVerified:false,bindingsVerified:false,keyId:null,reason:result.reason};entry.attestations.push(check);
        if(!evidence.safePath(ref.path) || !digest(ref.sha256) || !["dsse-in-toto","sigstore-bundle"].includes(ref.format)) {check.status="rejected";check.reason="unsafe-or-unsupported-attestation-reference";continue;}
        if(!files.has(ref.path) || evidence.sha256(files.get(ref.path))!==ref.sha256) {check.status="rejected";check.reason="attestation-file-unavailable-or-hash-mismatch";continue;}
        if(ref.format==="sigstore-bundle") {
          check.method="sigstore-keyless";
          let rules=keyless.filter(rule=>rule.roles.includes(ref.kind) && now>=Date.parse(rule.notBefore) && now<=Date.parse(rule.notAfter));
          if(result.reason!=="verification-completed") continue;
          if(!rules.length) {check.status="rejected";check.reason="no-active-authorized-keyless-identity";continue;}
          if(++envelopes>50 || ++work>256) {check.reason="attestation-work-budget";continue;}
          if(typeof module==="undefined" || !module.exports) {check.reason="sigstore-node-verifier-required";continue;}
          let verificationRoot=trustedRoot;
          if(rules[0].tufBootstrapRootDigest) {
            if(tufVerification?.status!=="verified") {check.status=tufVerification?.status||"unverified";check.reason=tufVerification?.reason||"sigstore-tuf-state-required";continue;}
            verificationRoot=tufVerification.trustedRoot;rules=rules.map(rule=>({...rule,trustedRootDigest:tufVerification.rootDigest}));
          }
          let verified;
          try {verified=require("../verification/sigstore-keyless.cjs").verifyBundle(parse(files.get(ref.path)),rules,verificationRoot,now);}catch {verified={status:"rejected",reason:"malformed-or-unverifiable-sigstore-bundle"};}
          check.status=verified.status;check.reason=verified.reason;
          if(verified.status!=="verified") continue;
          check.signatureVerified=true;check.keyId=verified.keyId;check.keyless={...verified.proof,...(tufVerification?.status==="verified"?{tuf:tufVerification.proof}:{})};
          let statement;try {statement=parse(new TextDecoder("utf-8",{fatal:true}).decode(base64(verified.envelope.payload)));}catch {check.status="rejected";check.reason="malformed-keyless-statement";continue;}
          const observed=ref.kind==="build"?statement.predicate?.runDetails?.metadata?.finishedOn:statement.predicate?.observedAt;
          if(verified.rules.some(rule=>bindings(statement,ref.kind,input,rule,files,now)) && date(observed) && verified.proof.signingTimes.every(t=>Date.parse(t)+999>=Date.parse(observed))) {check.bindingsVerified=true;check.reason="signature-and-bindings-verified";}
          else {check.status="rejected";check.reason="attestation-binding-mismatch";}
          continue;
        }
        if(!keys.length) continue;
        if(++envelopes>50) {check.reason="attestation-work-budget";continue;}
        let envelope,statement,payload;
        try {
          envelope=parse(files.get(ref.path));
          if(envelope.payloadType!==PAYLOAD_TYPE || !Array.isArray(envelope.signatures) || !envelope.signatures.length || envelope.signatures.length>4) throw Error();
          // These exact decoded bytes feed both PAE verification and the parser.
          payload=base64(envelope.payload);statement=parse(new TextDecoder("utf-8",{fatal:true}).decode(payload));
        }catch {check.status="rejected";check.reason="unsupported-or-malformed-dsse-envelope";continue;}
        let active=false;
        for(const {rule,key,active:usable} of keys) {
          if(!usable || !rule.roles.includes(ref.kind)) continue;active=true;
          work+=envelope.signatures.length;if(work>256) {check.reason="attestation-work-budget";break;}
          if(!await verifySignature(envelope,key,rule.signatureEncoding,subtle,payload)) continue;
          check.signatureVerified=true;check.keyId=rule.keyId;
          if(bindings(statement,ref.kind,input,rule,files,now)) {check.status="verified";check.bindingsVerified=true;check.reason="signature-and-bindings-verified";break;}
        }
        if(check.status!=="verified" && check.reason!=="attestation-work-budget") {check.status="rejected";check.reason=check.signatureVerified?"attestation-binding-mismatch":active?"invalid-or-untrusted-signature":"no-active-authorized-key";}
      }
    }
    return finish();
  }
  function read(token,records,at) {
    const cached=tokens.get(token),now=at==null?Date.now():new Date(at).getTime();
    if(!cached || !Number.isFinite(now) || now<cached.now || now>cached.validUntil || records.length!==cached.snapshot.length || records.some((r,i)=>r.path!==cached.snapshot[i].path || r.content!==cached.snapshot[i].content)) return empty();
    return JSON.parse(JSON.stringify(cached.result));
  }
  const api=Object.freeze({PAYLOAD_TYPE,BUILD,DEPLOY,prepare,read,pae,base64,rawSignature,verifySignature});
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(typeof globalThis!=="undefined") globalThis.FrontendAttestations=api;
})();
