(function () {
  "use strict";
  const parser = typeof module !== "undefined" && module.exports ? require("./lockfile-graph.js") : globalThis.FrontendLockGraph;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const pathOK = value => typeof value === "string" && value.length <= 1000 && !/[\\\x00-\x1f:?#%]/.test(value) && !value.startsWith("/") && value.split("/").every(part => part && part !== "." && part !== "..");
  function relativePath(base, input) {
    if (typeof input !== "string" || !input || input.length > 1000 || /[\\\x00-\x1f:?#%*{}\[\]!]/.test(input) || input.startsWith("/") || input.endsWith("/")) return null;
    if (base && !pathOK(base.replace(/\/$/, ""))) return null;
    const parts = base ? base.replace(/\/$/, "").split("/") : [];
    for (const part of input.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part);
    }
    return parts.length ? parts.join("/") : null;
  }
  function protectedTarget(path) {
    return /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|\.ssh|\.aws|\.azure|\.gnupg|node_modules|vendor|dist|build|coverage|generated|__generated__|\.frontend-audit)(?:\/|$)/i.test(path)
      || /(?:^|\/)(?:id_rsa|id_ed25519|credentials|\.npmrc|package\.json|composer\.json|deno\.jsonc?|package-lock\.json|composer\.lock|yarn\.lock|bun\.lockb?|pnpm-lock\.yaml|\.frontend-agent-playbook\.json)$/i.test(path)
      || /\.(?:pem|key|p12|pfx)$/i.test(path);
  }
  const directoryOf = path => path.replace(/[^/]+$/, "");
  function directoryPath(base, value) {
    if (typeof value !== "string") return null;
    const plain = value.replace(/\/+$/, "");
    if ([".", "./"].includes(value)) return base.replace(/\/$/, "");
    return relativePath(base, plain);
  }
  function expandPaths(base, patterns, directories, report, budget = {work:0}) {
    if (!Array.isArray(patterns) || patterns.some(value => typeof value !== "string") || patterns.length > 4000) { report("invalid-deno-path-patterns"); return []; }
    if(base && !pathOK(base.replace(/\/$/, ""))) {report("unsafe-or-unsupported-deno-path-pattern");return [];}
    const selected = new Set(), excluded = new Set();
    function partMatches(pattern, value) {
      let p=0, v=0, star=-1, saved=0;
      while (v < value.length) {
        if (++budget.work > 100000) throw Error("budget");
        if (pattern[p] === "?" || pattern[p] === value[v]) { p++; v++; }
        else if (pattern[p] === "*") { star=p++; saved=v; }
        else if (star >= 0) { p=star+1; v=++saved; }
        else return false;
      }
      while (pattern[p] === "*") p++;
      return p === pattern.length;
    }
    function matches(pattern, value) {
      const pp=pattern.split("/"), vv=value.split("/"), queue=[[0,0]], visited=new Set();
      for(let i=0;i<queue.length;i++) {
        if (++budget.work > 100000) throw Error("budget");
        const [p,v]=queue[i], key=p+":"+v;
        if(visited.has(key)) continue; visited.add(key);
        if(p === pp.length && v === vv.length) return true;
        if(pp[p] === "**") { queue.push([p+1,v]); if(v < vv.length) queue.push([p,v+1]); }
        else if(p < pp.length && v < vv.length && partMatches(pp[p],vv[v])) queue.push([p+1,v+1]);
      }
      return false;
    }
    try {
      for(const raw of patterns) {
        const negative=raw.startsWith("!"), input=negative ? raw.slice(1) : raw;
        if (!input || input.length > 1000 || /[\\\x00-\x1f:%#{}\[\]!]/.test(input) || input.startsWith("/")) { report("unsafe-or-unsupported-deno-path-pattern"); continue; }
        const parts=base ? base.replace(/\/$/, "").split("/") : [];
        let invalid=false;
        for(const part of input.replace(/\/+$/, "").split("/")) {
          if(!part || part === ".") continue;
          if(part === "..") { if(!parts.length || /[*?]/.test(parts.at(-1))) {invalid=true;break;} parts.pop(); }
          else parts.push(part);
        }
        const pattern=parts.join("/");
        if(invalid || !pattern || protectedTarget(pattern)) { report("unsafe-or-unsupported-deno-path-pattern"); continue; }
        let count=0;
        for(const path of directories) {
          if(++budget.work > 100000) throw Error("budget");
          if(protectedTarget(path)) continue;
          if(matches(pattern,path)) { (negative ? excluded : selected).add(path); count++; }
        }
        if(!negative && !count) report("unmatched-deno-path-pattern");
      }
    } catch { report("deno-path-pattern-budget"); }
    return [...selected].filter(path=>!excluded.has(path)).sort();
  }
  function validateMap(value,report) {
    if(value.imports !== undefined && !object(value.imports) || value.scopes !== undefined && !object(value.scopes)) report("malformed-deno-import-map");
    const maps=[value.imports,...Object.values(object(value.scopes) ? value.scopes : {})];
    for(const map of maps) {
      if(map === undefined) continue;
      if(!object(map)) {report("malformed-deno-import-map");continue;}
      if(Object.values(map).some(value=>value !== null && typeof value !== "string")) report("malformed-deno-import-map");
    }
  }
  function createContext(records) {
    const files=new Map(records.map(item=>[item.path,item])), parsed=new Map(), directories=new Set(), memberBudget={work:0};
    for(const record of records) if(/(^|\/)(?:deno\.jsonc?|package\.json)$/.test(record.path)) directories.add(directoryOf(record.path).replace(/\/$/, ""));
    function read(path) {
      if(!parsed.has(path)) {
        try { parsed.set(path,parser.parseJSONC(files.get(path).content)); } catch { parsed.set(path,null); }
      }
      return parsed.get(path);
    }
    function source(directory, kind) {
      const names=kind === "deno" ? ["deno.json","deno.jsonc"] : ["package.json"];
      const paths=names.map(name=>(directory ? directory+"/" : "")+name).filter(path=>files.has(path));
      if(paths.length !== 1) return null;
      const value=read(paths[0]);return value ? {file:paths[0],value} : null;
    }
    function members(directory, report) {
      const deno=source(directory,"deno"), npm=source(directory,"npm");
      const isDeno=deno?.value.workspace !== undefined;
      const patterns=isDeno ? deno.value.workspace : npm?.value.workspaces;
      if(patterns === undefined) return [];
      return expandPaths(directory ? directory+"/" : "", !isDeno && object(patterns) ? patterns.packages : patterns,directories,report,memberBudget).filter(path=>{if(path !== directory)return true;report("self-deno-workspace-member");return false;});
    }
    function importMap(source, report) {
      if(source.value.importMap === undefined) return {value:source.value,base:directoryOf(source.file),file:source.file};
      const path=relativePath(directoryOf(source.file),source.value.importMap);
      if(!path || protectedTarget(path)) { report("unsafe-deno-import-map-path"); return null; }
      if(source.value.imports !== undefined || source.value.scopes !== undefined) report("conflicting-deno-inline-import-map");
      const value=read(path);
      if(!value) {report("deno-import-map-unavailable-or-invalid");return null;}
      validateMap(value,report);
      if(value.importMap !== undefined || value.workspace !== undefined || value.links !== undefined) report("deno-config-import-map-unverified");
      return {value,base:directoryOf(path),file:path};
    }
    return {files,directories,read,source,members,importMap};
  }
  function discoverLocks(records) {
    const context=createContext(records),plans=[],gaps=[],owners=new Map(),configuredDirectories=new Set(),memberOwners=new Map(),importMapConfigs=[];
    for(const directory of context.directories) {
      const source=context.source(directory,"deno"); if(!source) continue;
      const members=context.members(directory,reason=>gaps.push({path:source.file,reason}));
      for(const member of members) {
        if(!memberOwners.has(member)) memberOwners.set(member,[]);
        memberOwners.get(member).push(directory);
      }
    }
    for(const record of records) {
      if(!/(^|\/)deno\.jsonc?$/.test(record.path)) continue;
      const directory=directoryOf(record.path),plain=directory.replace(/\/$/, ""),data=context.read(record.path);
      if(!data) {gaps.push({path:record.path,reason:"invalid-deno-lock-configuration"});continue;}
      configuredDirectories.add(directory);
      validateMap(data,reason=>gaps.push({path:record.path,reason}));
      if(data.importMap !== undefined) {
        importMapConfigs.push(record.path);
        context.importMap({file:record.path,value:data},reason=>gaps.push({path:record.path,reason}));
      }
      if(memberOwners.has(plain)) {
        if(data.workspace !== undefined || data.lock !== undefined) gaps.push({path:record.path,reason:"nested-deno-workspace-root-setting"});
        if(memberOwners.get(plain).length > 1) gaps.push({path:record.path,reason:"ambiguous-deno-workspace-owner"});
        continue;
      }
      let target="deno.lock";
      if(data.lock === false) continue;
      if(typeof data.lock === "string") target=data.lock;
      else if(object(data.lock) && (data.lock.path === undefined || typeof data.lock.path === "string")) target=data.lock.path ?? "deno.lock";
      else if(data.lock !== undefined && data.lock !== true) {gaps.push({path:record.path,reason:"invalid-deno-lock-configuration"});continue;}
      const lockfile=relativePath(directory,target);
      if(!lockfile || protectedTarget(lockfile)) {gaps.push({path:record.path,reason:"unsafe-deno-lock-path"});continue;}
      const plan={lockfile,directory,config:record.path};plans.push(plan);
      if(!owners.has(lockfile)) owners.set(lockfile,[]);owners.get(lockfile).push(plan);
    }
    for(const plans of owners.values()) if(plans.length > 1) for(const plan of plans) {plan.ambiguous=true;gaps.push({path:plan.config,reason:"ambiguous-deno-lock-owner"});}
    return {plans,gaps,configuredDirectories:[...configuredDirectories],importMapConfigs};
  }
  function discoverInputs(records) {
    const discovery=discoverLocks(records), paths=new Set(discovery.plans.map(plan=>plan.lockfile));
    for(const record of records) if(/(^|\/)deno\.jsonc?$/.test(record.path)) {
      try {
        const value=parser.parseJSONC(record.content);
        if(value.importMap === undefined) continue;
        const path=relativePath(directoryOf(record.path),value.importMap);
        if(path && !protectedTarget(path)) paths.add(path);
      } catch { /* The analysis reports malformed configuration. */ }
    }
    return [...paths];
  }
  const api=Object.freeze({relativePath,directoryPath,protectedTarget,expandPaths,createContext,discoverLocks,discoverInputs});
  if(typeof module !== "undefined" && module.exports) module.exports=api;
  if(typeof globalThis !== "undefined") globalThis.FrontendDenoResolution=api;
})();
