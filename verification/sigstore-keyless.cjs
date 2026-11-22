"use strict";
// Offline-only adapter. No TUF updater, URL fetcher, certificate downloader or project loader.
const crypto=require("node:crypto"),evidence=require("../analysis/execution-evidence.js");
const object=v=>v!==null && typeof v==="object" && !Array.isArray(v);
const canonical=v=>Array.isArray(v)?"["+v.map(canonical).join(",")+"]":object(v)?"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}":JSON.stringify(v);
const rootDigest=root=>evidence.sha256(canonical(root));
const fail=(reason,status="rejected")=>({status,reason});
function loadVerifier() {
  // Resolve only this tool's pinned dependencies, never the scanned project's node_modules.
  if(require("./sigstore/node_modules/@sigstore/verify/package.json").version!=="4.1.3") throw Error("version");
  return {...require("./sigstore/node_modules/@sigstore/verify"),...require("./sigstore/node_modules/@sigstore/bundle"),TrustedRoot:require("./sigstore/node_modules/@sigstore/protobuf-specs").TrustedRoot};
}
function boundedRoot(root) {
  if(!object(root) || root.mediaType!=="application/vnd.dev.sigstore.trustedroot+json;version=0.1" || JSON.stringify(root).length>200000) return false;
  for(const key of ["certificateAuthorities","ctlogs","tlogs"]) if(!Array.isArray(root[key]) || !root[key].length || root[key].length>8) return false;
  return root.certificateAuthorities.every(ca=>object(ca) && Array.isArray(ca.certChain?.certificates) && ca.certChain.certificates.length>0 && ca.certChain.certificates.length<=4);
}
function verifyBundle(raw,rules,trustedRoot,now) {
  if(!trustedRoot) return fail("sigstore-trusted-root-required","unverified");
  if(!boundedRoot(trustedRoot)) return fail("invalid-sigstore-trusted-root");
  const hash=rootDigest(trustedRoot),eligible=rules.filter(rule=>rule.trustedRootDigest===hash);
  if(!eligible.length) return fail("sigstore-trusted-root-digest-mismatch");
  const [major,minor,patch]=process.versions.node.split(".").map(Number);
  if(!((major===22 && (minor>22 || minor===22 && patch>=2)) || major===24 && minor>=15 || major>=26)) return fail("sigstore-runtime-not-supported","unverified");
  let lib;try {lib=loadVerifier();}catch{return fail("sigstore-verifier-not-installed","unverified");}
  try {
    if(!object(raw) || !["application/vnd.dev.sigstore.bundle+json;version=0.2","application/vnd.dev.sigstore.bundle+json;version=0.3","application/vnd.dev.sigstore.bundle.v0.3+json"].includes(raw.mediaType)
      || !object(raw.dsseEnvelope) || raw.messageSignature!==undefined || raw.dsseEnvelope.payloadType!=="application/vnd.in-toto+json" || !Array.isArray(raw.dsseEnvelope.signatures) || raw.dsseEnvelope.signatures.length!==1) return fail("unsupported-sigstore-bundle");
    const vm=raw.verificationMaterial;
    if(!object(vm) || vm.publicKey!==undefined || !Array.isArray(vm.tlogEntries) || !vm.tlogEntries.length || vm.tlogEntries.length>4) return fail("unsupported-sigstore-verification-material");
    // One explicit certificate representation; chain roots supplied by the bundle are never anchors.
    if(Boolean(vm.certificate)===Boolean(vm.x509CertificateChain) || vm.x509CertificateChain && (!Array.isArray(vm.x509CertificateChain.certificates) || vm.x509CertificateChain.certificates.length!==1)) return fail("ambiguous-sigstore-certificate");
    const leaf=vm.certificate || vm.x509CertificateChain?.certificates[0];
    if(typeof leaf?.rawBytes!=="string" || leaf.rawBytes.length>22000) return fail("sigstore-certificate-budget");
    const stamps=vm.timestampVerificationData?.rfc3161Timestamps||[];
    if(!Array.isArray(stamps) || stamps.length>2 || vm.timestampVerificationData && !stamps.length) return fail("unsupported-sigstore-timestamps");
    if(stamps.length && (!Array.isArray(trustedRoot.timestampAuthorities) || !trustedRoot.timestampAuthorities.length || trustedRoot.timestampAuthorities.length>8 || trustedRoot.timestampAuthorities.some(ca=>!Array.isArray(ca?.certChain?.certificates) || !ca.certChain.certificates.length || ca.certChain.certificates.length>4))) return fail("sigstore-timestamp-authority-required");
    const seen=new Set();
    for(const entry of vm.tlogEntries) {
      if(!object(entry) || !entry.inclusionProof?.checkpoint?.envelope || !Array.isArray(entry.inclusionProof.hashes) || entry.inclusionProof.hashes.length>64
        || entry.logIndex!==entry.inclusionProof.logIndex || (!entry.inclusionPromise?.signedEntryTimestamp && !stamps.length)
        || (entry.inclusionPromise && (typeof entry.integratedTime!=="string" || !/^[1-9][0-9]{0,12}$/.test(entry.integratedTime) || !Number.isSafeInteger(Number(entry.integratedTime)) || Number(entry.integratedTime)*1000>now))) return fail("sigstore-signed-time-and-inclusion-required");
      const note=entry.inclusionProof.checkpoint.envelope.split("\n");
      if(note[1]!==entry.inclusionProof.treeSize || note[2]!==entry.inclusionProof.rootHash) return fail("sigstore-inclusion-metadata-mismatch");
      const id=entry.logId?.keyId+":"+entry.canonicalizedBody;if(seen.has(id)) return fail("duplicate-sigstore-log-entry");seen.add(id);
    }
    const bundle=lib.bundleFromJSON(raw),entity=lib.toSignedEntity(bundle);
    if(entity.key.$case!=="certificate") return fail("sigstore-certificate-required");
    const trust=lib.toTrustMaterial(lib.TrustedRoot.fromJSON(trustedRoot));
    const verifier=new lib.Verifier(trust,{tlogThreshold:1,ctlogThreshold:1,timestampThreshold:1});
    if((entity.key.certificate.extSCT?.signedCertificateTimestamps.length||0)>8) return fail("sigstore-sct-budget");
    // Verify cryptography once, then apply literal identity and rule constraints.
    // The upstream SAN string policy is a regex, so do not pass unescaped policy input.
    const signer=verifier.verify(entity);
    const times=[...bundle.verificationMaterial.tlogEntries.filter(e=>e.inclusionPromise).map(e=>Number(e.integratedTime)*1000),...entity.timestamps.filter(t=>t.$case==="timestamp-authority").map(t=>t.timestamp.signingTime.getTime())];
    const authorized=eligible.filter(rule=>signer.identity?.subjectAlternativeName===rule.certificateIdentity && signer.identity?.extensions?.issuer===rule.oidcIssuer
      && times.length && times.every(t=>Number.isFinite(t) && t<=now && t>=Date.parse(rule.notBefore) && t<=Date.parse(rule.notAfter)));
    // Proof-only Rekor entries must use a log key valid at authenticated TSA time,
    // never at their unsigned integratedTime field.
    const tsaTimes=entity.timestamps.filter(t=>t.$case==="timestamp-authority").map(t=>t.timestamp.signingTime.getTime());
    if(bundle.verificationMaterial.tlogEntries.some(entry=>!trust.tlogs.some(authority=>authority.logID.equals(entry.logId.keyId) && (entry.inclusionPromise?[Number(entry.integratedTime)*1000]:tsaTimes).every(t=>t>=authority.validFor.start.getTime() && t<=authority.validFor.end.getTime())))) return fail("sigstore-log-key-outside-validity");
    if(authorized.length) {
      const keyId="sha256:"+crypto.createHash("sha256").update(signer.key.export({format:"der",type:"spki"})).digest("hex");
      return {status:"verified",reason:"sigstore-chain-identity-log-and-signature-verified",rules:authorized,keyId,envelope:raw.dsseEnvelope,
        proof:{verifier:"@sigstore/verify@4.1.3",trustedRootDigest:hash,certificateChainVerified:true,oidcIssuerVerified:true,certificateIdentityVerified:true,certificateTransparencyVerified:true,rekorInclusionVerified:true,signedTimeVerified:true,signingTimes:times.map(t=>new Date(t).toISOString())}};
    }
    return fail("sigstore-crypto-or-identity-rejected");
  }catch {return fail("malformed-or-unverifiable-sigstore-bundle");}
}
module.exports=Object.freeze({verifyBundle,rootDigest});
