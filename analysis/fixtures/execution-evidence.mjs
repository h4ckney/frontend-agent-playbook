// Synthetic pairing fixture. This does not assert a real installation or deployment.
import {createHash} from 'node:crypto';
export const at='2026-11-22T03:00:00.000Z';
export const hash=value=>'sha256:'+createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function fixture({version='16.4.0',locked=version,format='cyclonedx-json'}={}) {
 const manifest={name:'web',version:'1.0.0',dependencies:{next:'^'+locked}};
 const lock={lockfileVersion:3,packages:{'':manifest,'node_modules/next':{version:locked,integrity:'sha512-test'}}};
 const installation={name:'web',version:'1.0.0',dependencies:{next:{version}}};
 const artifactDigest='sha256:'+'a'.repeat(64),revision='b'.repeat(40);
 const sbom=format==='spdx-json'?{spdxVersion:'SPDX-2.3',creationInfo:{created:at},documentDescribes:['SPDXRef-app'],packages:[{SPDXID:'SPDXRef-app',name:'web',checksums:[{algorithm:'SHA256',checksumValue:'a'.repeat(64)}]},{SPDXID:'SPDXRef-next',name:'next',versionInfo:version,externalRefs:[{referenceCategory:'PACKAGE-MANAGER',referenceType:'purl',referenceLocator:'pkg:npm/next@'+version}]}]}:{bomFormat:'CycloneDX',specVersion:'1.6',metadata:{timestamp:at,component:{type:'application',name:'web',hashes:[{alg:'SHA-256',content:'a'.repeat(64)}]}},components:[{type:'library',name:'next',version,purl:'pkg:npm/next@'+version}]};
 const deployment={schemaVersion:'1',kind:'deployment',status:'succeeded',environment:'production',manifest:'apps/web/package.json',revision,artifactDigest,observedAt:at,runtimes:[{name:'node',version:'24.22.0'}]};
 const subject={id:'web',manifest:'apps/web/package.json',manifestSha256:hash(manifest),revision,observedAt:at,artifactDigest,lockfile:{path:'apps/web/package-lock.json',sha256:hash(lock)},installation:{path:'evidence/install.tree',format:'npm-ls',mode:'installed-tree',sha256:hash(installation)},sbom:{path:'evidence/sbom.cdx',format,sha256:hash(sbom)},deployment:{path:'evidence/deployment.report',format:'deployment-observation',sha256:hash(deployment)}};
 return {manifest,lock,installation,sbom,deployment,config:{schemaVersion:'1',subjects:[subject]}};
}
export function records(f,{seal=true}={}) {
 const s=f.config.subjects[0];
 if(seal) {s.manifestSha256=hash(f.manifest);s.lockfile.sha256=hash(f.lock);for(const key of ['installation','sbom','deployment']) if(s[key]) s[key].sha256=hash(f[key]);}
 return [{path:'apps/web/package.json',content:JSON.stringify(f.manifest)},{path:'apps/web/package-lock.json',content:JSON.stringify(f.lock)},...['installation','sbom','deployment'].filter(key=>s[key]).map(key=>({path:s[key].path,content:JSON.stringify(f[key])})),{path:'.frontend-evidence.json',content:JSON.stringify(f.config)}];
}
