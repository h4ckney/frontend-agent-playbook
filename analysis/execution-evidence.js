(function () {
  "use strict";
  const parser = typeof module !== "undefined" && module.exports ? require("./lockfile-graph.js") : globalThis.FrontendLockGraph;
  const resolution = typeof module !== "undefined" && module.exports ? require("./deno-resolution.js") : globalThis.FrontendDenoResolution;
  const CONFIG = ".frontend-evidence.json";
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const exact = value => typeof value === "string" && /^v?\d+\.\d+\.\d+$/.test(value) && value.replace(/^v/, "").split(".").every(part => Number.isSafeInteger(Number(part)));
  const digest = value => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  const revision = value => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
  const safePath = value => typeof value === "string" && value.length <= 1000 && resolution.relativePath("", value) === value && !value.startsWith(".") && !value.split("/").some(part => part.startsWith(".")) && !resolution.protectedTarget(value);
  const manifestPath = value => typeof value === "string" && /(?:^|\/)(?:(?:package|composer)\.json|deno\.jsonc?)$/.test(value) && resolution.relativePath("",value) === value && !resolution.protectedTarget(value.replace(/[^/]+$/, "source.txt"));
  const date = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,19) === value.slice(0,19);
  const nameOK = (name, ecosystem) => typeof name === "string" && name.length <= 214 && (ecosystem === "composer" ? /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/ : /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/).test(name);
  // Synchronous UTF-8 SHA-256 keeps the offline browser and CLI on the same contract.
  function sha256(text) {
    const bytes=[];
    for (const char of text) {
      let n=char.codePointAt(0); if(n >= 0xd800 && n <= 0xdfff) n=0xfffd;
      if(n < 128) bytes.push(n);
      else if(n < 2048) bytes.push(192|(n>>6),128|(n&63));
      else if(n < 65536) bytes.push(224|(n>>12),128|((n>>6)&63),128|(n&63));
      else bytes.push(240|(n>>18),128|((n>>12)&63),128|((n>>6)&63),128|(n&63));
    }
    const bits=bytes.length*8;bytes.push(128);while(bytes.length%64 !== 56) bytes.push(0);
    for(let i=7;i>=0;i--) bytes.push(Math.floor(bits/2**(i*8))&255);
    const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],r=(n,b)=>(n>>>b)|(n<<(32-b));
    for(let offset=0;offset<bytes.length;offset+=64) {
      const w=[];for(let i=0;i<16;i++) w[i]=(bytes[offset+i*4]<<24)|(bytes[offset+i*4+1]<<16)|(bytes[offset+i*4+2]<<8)|bytes[offset+i*4+3];
      for(let i=16;i<64;i++) w[i]=(w[i-16]+(r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3))+w[i-7]+(r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10)))|0;
      let [a,b,c,d,e,f,g,j]=h;
      for(let i=0;i<64;i++) {const t=(j+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i])|0,u=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0;j=g;g=f;f=e;e=(d+t)|0;d=c;c=b;b=a;a=(t+u)|0;}
      [a,b,c,d,e,f,g,j].forEach((n,i)=>h[i]=(h[i]+n)|0);
    }
    return "sha256:"+h.map(n=>(n>>>0).toString(16).padStart(8,"0")).join("");
  }
  function read(text) { const value=parser.parseJSONC(text);JSON.parse(text);if(!object(value)) throw Error("object");return value; }
  function discoverInputs(records) {
    try {
      const value=read(records.find(item=>item.path === CONFIG).content);
      if(!Array.isArray(value.subjects) || value.subjects.length > 100) return [];
      return [...new Set(value.subjects.flatMap(subject=>[subject?.installation,subject?.sbom,subject?.deployment].map(item=>item?.path)).filter(safePath))];
    } catch {return [];}
  }
  function inspect(records, inventory, options={}) {
    const config=records.find(item=>item.path === CONFIG);if(!config) return null;
    const files=new Map(records.map(item=>[item.path,item])),gaps=[],additions=[],subjects=[],hashes=new Map();
    const gap=(path,reason)=>gaps.push({path,reason});
    const hash=path=>{if(!hashes.has(path)) hashes.set(path,sha256(files.get(path).content));return hashes.get(path);};
    const now=options.now == null ? Date.now() : new Date(options.now).getTime();
    const fresh=value=>!date(value) || !Number.isFinite(now) || Date.parse(value)>now ? "unverified-clock" : now-Date.parse(value)>30*86400000 ? "stale" : "within-30-days";
    if(files.size!==records.length) {gap(CONFIG,"ambiguous-evidence-input-path");return {schemaVersion:"1",subjects,additions,gaps};}
    let data;
    try {data=read(config.content);if(data.schemaVersion !== "1" || !Array.isArray(data.subjects) || data.subjects.length > 100) throw Error("schema");}
    catch {gap(CONFIG,"invalid-execution-evidence-config");return {schemaVersion:"1",subjects,additions,gaps};}
    const ids=new Map(),reports=new Map(),lockIndex=new Map(),workspaceLocks=new Map();
    for(const item of data.subjects) if(typeof item?.id === "string") ids.set(item.id,(ids.get(item.id)||0)+1);
    for(const entry of inventory) if(entry.provenance === "lockfile" && entry.versionKind === "locked-exact") {
      const legacyManifest=entry.manifest.replace(/[^/]+$/,entry.ecosystem === "composer" ? "composer.json" : "package.json");
      const uses=entry.workspaceUsage === undefined && files.has(legacyManifest) ? [{manifest:legacyManifest}] : entry.workspaceUsage||[];
      for(const use of uses) {
        const key=JSON.stringify([entry.manifest,use.manifest,entry.ecosystem,entry.name]);
        if(!lockIndex.has(key)) lockIndex.set(key,new Set());lockIndex.get(key).add(entry.version);
        const root=JSON.stringify([entry.manifest,use.manifest]);if(!workspaceLocks.has(root)) workspaceLocks.set(root,new Set());workspaceLocks.get(root).add(entry.ecosystem+":"+entry.name+"@"+entry.version);
      }
    }
    for(const item of data.subjects) for(const kind of ["installation","sbom","deployment"]) if(safePath(item?.[kind]?.path)) {
      const path=item[kind].path;reports.set(path,(reports.get(path)||0)+1);
    }
    let work=0;
    for(const input of data.subjects) {
      if(!object(input) || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id) || ids.get(input.id)!==1 || !manifestPath(input.manifest) || !revision(input.revision) || !digest(input.manifestSha256) || !date(input.observedAt)) {gap(CONFIG,"invalid-or-duplicate-evidence-subject");continue;}
      const subject={id:input.id,manifest:input.manifest,revision:input.revision,observedAt:input.observedAt,freshness:fresh(input.observedAt),status:"partial",manifestMatched:false,lockfileMatched:false,artifacts:[],components:[],deployment:null};subjects.push(subject);
      const start=gaps.length;
      if(subject.freshness !== "within-30-days") gap(CONFIG,"execution-evidence-"+subject.freshness);
      subject.manifestMatched=files.has(input.manifest) && hash(input.manifest) === input.manifestSha256;
      if(!subject.manifestMatched) {subject.status="rejected";gap(CONFIG,"evidence-manifest-hash-unavailable-or-mismatch");continue;}
      let manifest;
      try {manifest=parser.parseJSONC(files.get(input.manifest).content);if(!object(manifest)) throw Error("manifest");}catch {gap(input.manifest,"invalid-evidence-manifest");subject.status="rejected";continue;}
      const lock=input.lockfile;
      if(object(lock) && typeof lock.path === "string" && resolution.relativePath("",lock.path) === lock.path && !resolution.protectedTarget(lock.path.replace(/[^/]+$/,"source.txt")) && digest(lock.sha256)) subject.lockfileMatched=files.has(lock.path) && hash(lock.path) === lock.sha256;
      if(!subject.lockfileMatched) gap(CONFIG,"evidence-lock-hash-unavailable-or-mismatch");
      const components=new Map(),seen=new Set();
      function component(ecosystem,name,version,source,phase="unknown") {
        if(!nameOK(name,ecosystem) || !exact(version)) {gap(CONFIG,"unsupported-evidence-package-coordinate");return;}
        version=version.replace(/^v/,"");const key=ecosystem+":"+name+"@"+version;
        if(!components.has(key)) components.set(key,{ecosystem,name,version,sources:[],lockVersions:[],comparison:"not-in-lock",deploymentLinked:false});
        const item=components.get(key);if(!item.sources.includes(source)) item.sources.push(source);
        const occurrence=source+":"+key;if(seen.has(occurrence)) return;seen.add(occurrence);
        additions.push({ecosystem,name,version,versionKind:"reported-exact",manifest:CONFIG,path:"subjects/"+input.id+"/"+source+"/"+key,phase,
          phaseEvidence:"Selected "+source+" report for "+input.manifest+"; report authenticity, execution and reachability unverified",direct:false,provenance:source+"-report",workspaceUsage:[{manifest:input.manifest,phase,direct:false}]});
      }
      function artifact(kind) {
        const ref=input[kind];if(ref === undefined) return null;
        const result={kind,path:safePath(ref?.path)?ref.path:CONFIG,format:typeof ref?.format === "string" && /^[a-z-]{1,30}$/.test(ref.format)?ref.format:"unknown",integrity:"unavailable",componentCount:0};subject.artifacts.push(result);
        if(!safePath(ref?.path) || !digest(ref.sha256) || reports.get(ref.path)!==1) {gap(CONFIG,"unsafe-or-shared-evidence-report");return null;}
        if(!files.has(ref.path)) {gap(ref.path,"evidence-report-unavailable");return null;}
        if(hash(ref.path)!==ref.sha256) {result.integrity="mismatch";gap(ref.path,"evidence-report-hash-mismatch");return null;}
        result.integrity="matched";
        try {return {data:read(files.get(ref.path).content),result};}catch {gap(ref.path,"invalid-evidence-report");return null;}
      }
      const installation=artifact("installation");
      if(installation) {
        const {data:value,result}=installation;
        if(result.format === "npm-ls" && input.installation.mode === "installed-tree" && /(?:^|\/)package\.json$/.test(input.manifest)) {
          if(manifest.name && value.name !== manifest.name) gap(result.path,"npm-installation-root-name-mismatch");
          const queue=[value];
          for(let i=0;i<queue.length;i++) {
            if(++work>20000) {gap(result.path,"execution-evidence-component-budget");break;}
            const node=queue[i];if(node.problems !== undefined || node.error !== undefined || node.missing || node.invalid || node.extraneous) gap(result.path,"npm-installation-problems");
            if(node.dependencies !== undefined && !object(node.dependencies)) {gap(result.path,"invalid-npm-installation-dependencies");continue;}
            for(const [name,child] of Object.entries(node.dependencies||{})) {
              if(!object(child)) {gap(result.path,"invalid-npm-installation-entry");continue;}
              if(queue.length>=20000) {gap(result.path,"execution-evidence-component-budget");break;}
              queue.push(child);
              if(child.link || /^(?:file:|link:|workspace:)/.test(child.resolved||child._resolved||"")) {gap(result.path,"local-installation-package-unverified");continue;}
              component("npm",child.name||name,child.version,"installation",child.dev === true?"development":"unknown");
            }
          }
        } else if(result.format === "composer-installed" && /(?:^|\/)composer\.json$/.test(input.manifest) && Array.isArray(value.packages)) {
          for(const child of value.packages) {if(++work>20000) {gap(result.path,"execution-evidence-component-budget");break;}component("composer",child?.name,child?.version,"installation");}
        } else gap(result.path,"unsupported-installation-report-format");
        result.componentCount=[...components.values()].filter(item=>item.sources.includes("installation")).length;
      }
      function purl(value,source) {
        const match=typeof value === "string" && /^pkg:(npm|composer)\/([^?#]+)@([^?#]+)$/.exec(value);
        if(!match) {gap(CONFIG,"unsupported-sbom-purl");return null;}
        try {const name=decodeURIComponent(match[2]),version=decodeURIComponent(match[3]);if(!nameOK(name,match[1]) || !exact(version)) throw Error();component(match[1],name,version,source);return {name,version};}
        catch {gap(CONFIG,"unsupported-sbom-purl");return null;}
      }
      let sbomDigest=null;
      const sbom=artifact("sbom");
      if(sbom) {
        const {data:value,result}=sbom;
        if(result.format === "cyclonedx-json" && value.bomFormat === "CycloneDX" && ["1.4","1.5","1.6","1.7"].includes(value.specVersion) && Array.isArray(value.components)) {
          const hashes=(Array.isArray(value.metadata?.component?.hashes)?value.metadata.component.hashes:[]).filter(item=>item?.alg === "SHA-256" && typeof item.content === "string" && /^[a-f0-9]{64}$/.test(item.content)) || [];
          if(hashes.length===1) sbomDigest="sha256:"+hashes[0].content;
          if(fresh(value.metadata?.timestamp)!=="within-30-days") gap(result.path,"sbom-timestamp-unverified-or-stale");
          const queue=[...value.components];
          for(let i=0;i<queue.length;i++) {
            if(++work>20000) {gap(result.path,"execution-evidence-component-budget");break;}
            const item=queue[i];if(!object(item)) {gap(result.path,"invalid-sbom-component");continue;}
            const ref=purl(item.purl,"sbom");
            if(ref && (item.version !== undefined && item.version!==ref.version || item.name !== undefined && (item.group?item.group+"/":"")+item.name!==ref.name)) gap(result.path,"sbom-coordinate-conflict");
            if(item.components !== undefined) {if(!Array.isArray(item.components) || queue.length+item.components.length>20000) gap(result.path,"execution-evidence-component-budget");else queue.push(...item.components);}
          }
        } else if(result.format === "spdx-json" && ["SPDX-2.2","SPDX-2.3"].includes(value.spdxVersion) && Array.isArray(value.packages)) {
          if(fresh(value.creationInfo?.created)!=="within-30-days") gap(result.path,"sbom-timestamp-unverified-or-stale");
          const described=new Set(Array.isArray(value.documentDescribes)?value.documentDescribes:[]);
          const roots=value.packages.filter(item=>described.has(item?.SPDXID));
          if(roots.length===1) {const hashes=(Array.isArray(roots[0].checksums)?roots[0].checksums:[]).filter(item=>item?.algorithm === "SHA256" && typeof item.checksumValue === "string" && /^[a-f0-9]{64}$/.test(item.checksumValue))||[];if(hashes.length===1) sbomDigest="sha256:"+hashes[0].checksumValue;}
          for(const item of value.packages) {
            if(++work>20000) {gap(result.path,"execution-evidence-component-budget");break;}
            const refs=Array.isArray(item?.externalRefs)?item.externalRefs.filter(ref=>ref?.referenceType === "purl" && ref.referenceCategory === "PACKAGE-MANAGER"):[];
            if(!refs.length && described.has(item?.SPDXID)) continue;
            if(refs.length!==1) {gap(result.path,"unsupported-sbom-purl");continue;}
            const ref=purl(refs[0].referenceLocator,"sbom");if(ref && item.versionInfo!==undefined && item.versionInfo!==ref.version) gap(result.path,"sbom-coordinate-conflict");
          }
        } else gap(result.path,"unsupported-sbom-format");
        result.componentCount=[...components.values()].filter(item=>item.sources.includes("sbom")).length;
      }
      const deployment=artifact("deployment");
      if(deployment) {
        const {data:value,result}=deployment;
        const valid=result.format === "deployment-observation" && value.schemaVersion === "1" && value.kind === "deployment" && value.status === "succeeded" && ["production","staging","preview"].includes(value.environment) && date(value.observedAt) && digest(value.artifactDigest) && revision(value.revision) && manifestPath(value.manifest);
        const linked=Boolean(valid && value.manifest===input.manifest && value.revision===input.revision && value.artifactDigest===sbomDigest && digest(input.artifactDigest) && value.artifactDigest===input.artifactDigest && fresh(value.observedAt)==="within-30-days" && Date.parse(value.observedAt)>=Date.parse(input.observedAt) && gaps.length===start);
        subject.deployment={status:valid?"reported":"rejected",linked,environment:valid?value.environment:"unknown",artifactDigest:valid?value.artifactDigest:null,observedAt:valid?value.observedAt:null};
        if(!linked) gap(result.path,"deployment-subject-chain-unverified");
        if(valid && value.manifest===input.manifest && value.revision===input.revision) {
          if(value.runtimes!==undefined && !Array.isArray(value.runtimes)) gap(result.path,"invalid-deployment-runtime-observations");
          const runtimeSeen=new Set();
          if(value.runtimes?.length>20) gap(result.path,"deployment-runtime-budget");
          for(const item of (Array.isArray(value.runtimes)?value.runtimes:[]).slice(0,20)) {
            if(!object(item) || !["node","php","deno","bun"].includes(item.name) || !exact(item.version)) {gap(result.path,"unsupported-runtime-observation");continue;}
            if(runtimeSeen.has(item.name)) {gap(result.path,"ambiguous-runtime-observation");continue;}runtimeSeen.add(item.name);
            additions.push({ecosystem:"runtime",name:item.name,version:item.version.replace(/^v/,""),versionKind:"runtime-observation",manifest:CONFIG,path:"subjects/"+input.id+"/deployment/runtime/"+item.name+"@"+item.version,phase:"runtime",phaseEvidence:"Reported runtime version; binary authenticity, service reachability and backports unverified",direct:true,provenance:"deployment-report"});
          }
          result.componentCount=runtimeSeen.size;
        }
      }
      for(const item of components.values()) {
        item.sources.sort();
        item.lockVersions=[...new Set(lockIndex.get(JSON.stringify([lock?.path,input.manifest,item.ecosystem,item.name]))||[])].sort();
        item.comparison=item.lockVersions.includes(item.version)?"matches-lock":item.lockVersions.length?"differs-lock":"not-in-lock";
        if(item.comparison!=="matches-lock") gap(CONFIG,"reported-package-not-matched-to-workspace-lock");
        if(installation && sbom && item.sources.length!==2) gap(CONFIG,"installation-sbom-inventory-difference");
        item.deploymentLinked=Boolean(subject.deployment?.linked && item.sources.includes("sbom"));
      }
      for(const key of workspaceLocks.get(JSON.stringify([lock?.path,input.manifest]))||[]) for(const kind of ["installation","sbom"]) if(input[kind] && !components.get(key)?.sources.includes(kind)) gap(CONFIG,"workspace-lock-package-absent-from-"+kind+"-report");
      subject.components=[...components.values()].sort((a,b)=>(a.ecosystem+":"+a.name+"@"+a.version).localeCompare(b.ecosystem+":"+b.name+"@"+b.version));
      if(!subject.artifacts.length) gap(CONFIG,"execution-evidence-reports-unavailable");
      if(subject.deployment && gaps.length!==start) subject.deployment.linked=false;
      for(const item of subject.components) item.deploymentLinked=Boolean(subject.deployment?.linked && item.sources.includes("sbom"));
      if(gaps.length===start && subject.deployment?.linked) subject.status="linked";
    }
    gap(CONFIG,"execution-evidence-authenticity-unverified");
    return {schemaVersion:"1",subjects,additions,gaps:[...new Map(gaps.map(item=>[item.path+":"+item.reason,item])).values()]};
  }
  const api=Object.freeze({CONFIG,sha256,discoverInputs,inspect});
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(typeof globalThis!=="undefined") globalThis.FrontendExecutionEvidence=api;
})();
