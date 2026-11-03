(function () {
  "use strict";
  const parser = typeof module !== "undefined" && module.exports ? require("./lockfile-graph.js") : globalThis.FrontendLockGraph;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const entries = value => object(value) ? Object.entries(value) : [];
  const nameOK = value => typeof value === "string" && value.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value);
  const versionOK = value => /^\d+\.\d+\.\d+$/.test(value) && value.split(".").every(part => Number.isSafeInteger(Number(part)));
  const buildTools = new Set(["vite", "webpack", "rollup", "esbuild", "typescript", "@swc/core", "@babel/core", "parcel"]);
  const pathOK = value => typeof value === "string" && value.length <= 1000 && !/[\\\x00-\x1f:?#%]/.test(value) && !value.startsWith("/") && value.split("/").every(part => part && part !== "." && part !== "..");
  function identity(value, ecosystem) {
    const match = typeof value === "string" && /^((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)(_[a-zA-Z0-9@/_.+-]+)?$/.exec(value);
    return match && nameOK(match[1]) && versionOK(match[2]) && (ecosystem === "npm" || !match[3]) && value.length <= 1000 && !value.split("/").some(part => part === ".." || part === ".") ? {name:match[1], version:match[2]} : null;
  }
  function requirement(value) {
    const match = typeof value === "string" && /^(npm|jsr):((?:@[^/]+\/)?[^@/]+)(?:@([^/]+))?(?:\/[^\s]*)?$/.exec(value);
    if (!match || !nameOK(match[2]) || value.length > 1500 || /[\\\x00-\x20:?#%]/.test(match[3] || "")) return null;
    return {ecosystem:match[1], name:match[2], key:match[1] + ":" + match[2] + (match[3] ? "@" + match[3] : "")};
  }
  const resolution = typeof module !== "undefined" && module.exports ? require("./deno-resolution.js") : globalThis.FrontendDenoResolution;
  const {relativePath, protectedTarget, discoverLocks} = resolution;
  function readDenoLock(record, records, options = {}) {
    const graph = {lockfile:record.path, format:"deno", complete:true, nodes:[], edges:[], roots:[]};
    const gaps = [], inventory = [], coveredImports = [], nodes = new Map(), raw = new Map(), aliases = new Map(), names = new Map();
    const gap = reason => { graph.complete = false; if (!gaps.some(item => item.reason === reason)) gaps.push({path:record.path, reason}); };
    const directory = options.directory ?? record.path.replace(/[^/]+$/, "");
    const files = new Map(records.map(item => [item.path, item]));
    const configs = new Map(), locals = new Map(), localSources = [], localByFile = new Map();
    const context = resolution.createContext(records), patternBudget = {work:0};
    const familyMembers = new Map(), workspaceCandidates = new Map();
    graph.importMaps = []; graph.localMappings = [];
    function members(family) {
      if (!familyMembers.has(family)) {
        const targets=context.members(family, gap).filter(target => {if(target !== family)return true;gap("self-deno-workspace-member");return false;});
        const owner=context.source(family,"deno");
        for(const target of targets) {
          const member=context.source(target,"deno");
          if(member && ["workspace","importMap","scopes","links","patch","lock"].some(field=>member.value[field] !== undefined)) gap("deno-member-root-setting");
          if(member?.value.workspace !== undefined) gap("nested-deno-workspace-unsupported");
          if(owner?.value.importMap !== undefined && member?.value.imports !== undefined) gap("deno-root-map-member-imports-conflict");
        }
        familyMembers.set(family,targets);
      }
      return familyMembers.get(family);
    }
    function workspaceCandidate(source, name) {
      const family = source.family ?? directory.replace(/\/$/, "");
      if (!workspaceCandidates.has(family)) {
        const map = new Map();
        for (const target of members(family)) for (const kind of ["deno", "npm"]) {
          const item = context.source(target, kind);
          if (!item || !nameOK(item.value.name)) continue;
          const key = (kind === "deno" ? "jsr:" : "npm:") + item.value.name;
          if (map.has(key)) { map.set(key, null); gap("ambiguous-deno-workspace-name"); }
          else map.set(key, {target, kind, family, file:item.file});
        }
        workspaceCandidates.set(family, map);
      }
      return workspaceCandidates.get(family).get(name);
    }
    const canonical = req => req.ecosystem + ":" + req.name + "@" + (req.key.slice((req.ecosystem + ":" + req.name).length + 1) || "*");
    const resolveAlias = (key, target) => {
      if (aliases.has(key) && aliases.get(key) !== target) aliases.set(key, null); else if (!aliases.has(key)) aliases.set(key, target);
    };
    function edge(from, to, dependency, scope = "runtime") {
      if (!nodes.has(from) || !nodes.has(to) || !nameOK(dependency)) { gap("unresolved-deno-dependency-edge"); return; }
      if (graph.edges.length >= 40000) { gap("deno-graph-edge-budget"); return; }
      graph.edges.push({from, to, dependency, scope});
    }
    function resolveReq(value, source) {
      const req = requirement(value); if (!req) return null;
      const candidate = source && workspaceCandidate(source, req.ecosystem + ":" + req.name);
      const explicit = locals.get(req.ecosystem + ":" + req.name);
      if(explicit && candidate && explicit.source.file !== candidate.file) {gap("ambiguous-deno-workspace-link-name");return null;}
      if(candidate) {
        const requested=req.key.slice((req.ecosystem+":"+req.name).length+1);
        const version=context.source(candidate.target,candidate.kind)?.value.version;
        if(requested && requested !== "*" && requested !== version) gap("deno-workspace-version-compatibility-unverified");
      }
      const workspaceNode = candidate && ensureLocal(candidate.target, candidate.kind, "workspace", candidate.family);
      return workspaceNode || locals.get(req.ecosystem + ":" + req.name)?.node || aliases.get(req.key) || (req.key === req.ecosystem + ":" + req.name ? aliases.get(req.key + "@*") : null) || null;
    }
    function npmDependency(value) {
      if (typeof value !== "string") return null;
      const alias = /^((?:@[^/]+\/)?[^@/]+)@npm:(.+)$/.exec(value);
      const key = alias ? alias[2] : value;
      const local = locals.get("npm:" + (identity(key, "npm")?.name || key));
      const id = local?.node || (nodes.has("npm/" + key) ? "npm/" + key : names.get("npm:" + key));
      const name = alias ? alias[1] : nodes.get(id)?.name;
      return id && nameOK(name) ? {id, name} : null;
    }
    try {
      let data = parser.parseJSONC(record.content);
      // deno.lock is strict JSON. JSONC is accepted for configuration only.
      JSON.parse(record.content);
      const originalVersion = data.version === undefined ? "1" : data.version;
      graph.lockVersion = typeof originalVersion === "string" && /^[1-5]$/.test(originalVersion) ? originalVersion : "unknown";
      if (originalVersion === "1") {
        const remote = entries(data);
        if (remote.some(([url, hash]) => !/^https?:\/\//.test(url) || typeof hash !== "string" || !/^[a-fA-F0-9]{64}$/.test(hash))) throw Error("v1 remote map");
        graph.remoteIntegrityCount = remote.length;
        if (remote.length) gap("deno-remote-url-coverage-unavailable");
        gap("deno-v1-package-versions-unavailable");
        return {graph, inventory, gaps, coveredImports};
      }
      if (originalVersion === "2") {
        if (data.packages !== undefined || data.jsr !== undefined || data.specifiers !== undefined || data.npm !== undefined && !object(data.npm)) throw Error("mixed v2");
        const npm = data.npm || {};
        if (npm.packages !== undefined && !object(npm.packages) || npm.specifiers !== undefined && !object(npm.specifiers)) throw Error("v2 npm");
        const specifiers = {};
        for (const [key, value] of entries(npm.specifiers)) {
          if (typeof value !== "string") { gap("unsupported-deno-specifier"); continue; }
          Object.defineProperty(specifiers, "npm:" + key, {value:"npm:" + value, enumerable:true});
        }
        data = {...data, version:"3", packages:{npm:npm.packages || {}, specifiers}};
        delete data.npm;
      }
      if (!["3", "4", "5"].includes(data.version)) { gap("unsupported-deno-lock-version"); return {graph, inventory, gaps, coveredImports}; }
      if (data.version === "3" && ["npm", "jsr", "specifiers"].some(field => data[field] !== undefined) || data.version !== "3" && data.packages !== undefined) gap("unsupported-deno-lock-section");
      const body = data.version === "3" ? data.packages : data;
      if (!object(body)) throw Error("packages");
      for (const field of ["npm", "jsr", "specifiers"]) if (body[field] !== undefined && !object(body[field])) throw Error("map");
      graph.remoteIntegrityCount = object(data.remote) ? Object.keys(data.remote).length : 0;
      for (const field of ["remote", "redirects"]) if (data[field] !== undefined && (!object(data[field]) || Object.keys(data[field]).length)) gap("deno-remote-url-coverage-unavailable");
      if (object(data.workspace) && data.workspace.npmOverrides !== undefined && (!object(data.workspace.npmOverrides) || Object.keys(data.workspace.npmOverrides).length)) gap("deno-local-links-or-overrides-unverified");
      if (data.workspace?.packageJson?.overrides !== undefined && (!object(data.workspace.packageJson.overrides) || Object.keys(data.workspace.packageJson.overrides).length)) gap("deno-local-links-or-overrides-unverified");
      const modified = gaps.some(item => item.reason === "deno-local-links-or-overrides-unverified");
      for (const ecosystem of ["npm", "jsr"]) for (const [key, item] of entries(body[ecosystem])) {
        const ref = identity(key, ecosystem), id = ecosystem + "/" + key;
        if (!ref || !object(item) || record.path.length + id.length > 1700) { gap("unsupported-deno-package-identity"); continue; }
        if (nodes.size >= 20000) { gap("deno-graph-node-budget"); break; }
        const node = {id, ...ref, ecosystem, kind:"package"};
        nodes.set(id, node); graph.nodes.push(node); raw.set(id, item);
        const nameKey = ecosystem + ":" + ref.name;
        if (names.has(nameKey)) names.set(nameKey, null); else names.set(nameKey, id);
        if (ecosystem === "npm" && (typeof item.integrity !== "string" || item.tarball !== undefined || modified)) gap("deno-package-source-unverified");
        if (ecosystem === "jsr" && typeof item.integrity !== "string") gap("deno-package-integrity-unavailable");
      }
      // Older versions omit optional package metadata; reconstructing v5 would
      // require registry access. Keep the offline graph explicitly incomplete.
      if (data.version !== "5" && entries(body.npm).length) gap("deno-legacy-optional-metadata-unavailable");
      for (const [key, value] of entries(body.specifiers)) {
        const req = requirement(key);
        if (!req || req.key !== key || typeof value !== "string") { gap("unsupported-deno-specifier"); continue; }
        let target;
        if (data.version === "3") {
          const full = /^(npm|jsr):(.+)$/.exec(value);
          if (full?.[1] === req.ecosystem) target = full[1] + "/" + full[2];
        } else target = req.ecosystem + "/" + req.name + "@" + value;
        if (!target || !nodes.has(target)) { gap("unresolved-deno-specifier"); continue; }
        resolveAlias(key, target);
        resolveAlias(req.ecosystem + ":" + req.name, target);
      }
      const sourceDirectory = file => file.replace(/[^/]+$/, "");
      function config(location, kind, prefixOverride) {
        const prefix = prefixOverride ?? directory + (location ? location + "/" : "");
        if(kind === "npm" && files.has(prefix+"deno.json") && files.has(prefix+"deno.jsonc")) {gap("ambiguous-deno-local-configuration");return null;}
        const candidates = kind === "deno" ? ["deno.json", "deno.jsonc"].map(name => prefix + name).filter(name => files.has(name)) : [prefix + "package.json"].filter(name => files.has(name));
        if (candidates.length !== 1) { gap("deno-workspace-manifest-unavailable-or-ambiguous"); return null; }
        const file = candidates[0];
        if (!configs.has(file)) {
          try { configs.set(file, parser.parseJSONC(files.get(file).content)); } catch { configs.set(file, null); gap("invalid-deno-workspace-configuration"); }
        }
        let value = configs.get(file);
        if (!object(value)) return null;
        if (kind === "npm" && value.overrides !== undefined && (!object(value.overrides) || Object.keys(value.overrides).length)) gap("deno-local-links-or-overrides-unverified");
        let mapFile = file, mapBase = sourceDirectory(file);
        if (kind === "deno" && value.importMap !== undefined) {
          const declaredPath = relativePath(sourceDirectory(file), value.importMap);
          if (declaredPath && !protectedTarget(declaredPath) && files.has(declaredPath) && !graph.importMaps.includes(declaredPath)) graph.importMaps.push(declaredPath);
          const map = context.importMap({file, value}, reason => {
            gap(reason);
            if (declaredPath && !protectedTarget(declaredPath)) gaps.push({path:declaredPath,reason});
          });
          if (map) { mapFile=map.file; mapBase=map.base; value={...value,imports:map.value.imports,scopes:map.value.scopes}; }
        }
        if (!prefixOverride && kind === "deno" && (value.lock === false || (typeof value.lock === "string" || object(value.lock) && value.lock.path !== undefined) && relativePath(sourceDirectory(file), typeof value.lock === "string" ? value.lock : value.lock.path) !== record.path)) { gap("deno-lock-configuration-mismatch"); return null; }
        return {file, value, mapFile, mapBase, family:directory.replace(/\/$/, "")};
      }
      const lockedLinks = data.workspace?.links ?? data.workspace?.patches ?? {};
      const matchedLinks = new Set();
      const rootFamily = directory.replace(/\/$/, "");
      members(rootFamily);
      const rootConfig = ["deno.json", "deno.jsonc"].some(name => files.has(directory + name)) && !options.ambiguous ? config("", "deno") : null;
      if (!object(lockedLinks) || data.workspace?.links !== undefined && data.workspace?.patches !== undefined) gap("deno-local-links-or-overrides-unverified");
      function ensureLocal(target, kind, mode, family = rootFamily) {
        if (target === null || protectedTarget(target)) { gap("unsafe-or-unsupported-deno-local-path"); return null; }
        const source = config("", kind, target ? target + "/" : "");
        if (!source || !nameOK(source.value.name) || kind === "deno" && !source.value.name.startsWith("@")) { gap("deno-local-manifest-identity-unavailable"); return null; }
        source.family = family;
        const original=context.read(source.file);
        if(target !== family && members(family).includes(target) && kind === "deno" && ["workspace","importMap","scopes","links","patch","lock"].some(field=>original[field] !== undefined)) gap("deno-member-root-setting");
        const key = (kind === "deno" ? "jsr:" : "npm:") + source.value.name;
        const id = "local/" + target + "/" + kind;
        if (mode === "override" && locals.has(key) && locals.get(key)?.node !== id) { locals.set(key, null); gap("ambiguous-deno-local-name"); return null; }
        if (localByFile.has(source.file)) {
          const old=localByFile.get(source.file);
          if(old.family !== family) gap("ambiguous-deno-local-workspace-owner");
          if(mode === "override") locals.set(key,old);
          return old.node;
        }
        let metadata;
        if (mode === "workspace" && family === rootFamily) {
          const location = target.slice(directory.length);
          const item = data.workspace?.members?.[location];
          metadata = kind === "npm" ? item?.packageJson : item;
          if (source.value.workspace !== undefined) gap("nested-deno-workspace-unsupported");
        } else {
          const keys = [key, ...(versionOK(source.value.version || "") ? [key + "@" + source.value.version] : [])].filter(value => Object.hasOwn(lockedLinks || {}, value));
          if (keys.length !== 1) gap("deno-local-lock-metadata-unavailable");
          else { metadata=lockedLinks[keys[0]]; matchedLinks.add(keys[0]); }
        }
        if (!object(metadata)) gap("deno-local-lock-metadata-unavailable");
        if (source.value.links !== undefined || source.value.patch !== undefined) gap("nested-deno-local-links-unverified");
        if (record.path.length + id.length > 1700 || nodes.size >= 20000) { gap("deno-graph-node-budget"); return null; }
        const node={id,name:source.value.name,version:versionOK(source.value.version || "") ? source.value.version : "unknown",kind:"local",manifest:source.file};
        nodes.set(id,node); graph.nodes.push(node);
        const local={node:id,source,kind,metadata,mode,family};localByFile.set(source.file,local);localSources.push(local);
        if(mode === "override") locals.set(key,local);
        return id;
      }
      const paths=rootConfig?.value.links ?? rootConfig?.value.patch ?? [];
      if(rootConfig?.value.links !== undefined && rootConfig.value.patch !== undefined) gap("deno-local-links-or-overrides-unverified");
      const targets=resolution.expandPaths(directory,paths,context.directories,gap,patternBudget);
      for(const target of targets) {
        if(target === rootFamily) {gap("self-deno-local-link");continue;}
        const own=context.source(target,"deno") || context.source(target,"npm");
        const family = own?.value.workspace !== undefined || own?.value.workspaces !== undefined ? target : rootFamily;
        const linkedTargets=new Set([target,...(family === target ? members(target) : [])]);
        for(const child of linkedTargets) {
          const kind=files.has(child+"/deno.json") || files.has(child+"/deno.jsonc") ? "deno" : "npm";
          const source=context.source(child,kind);
          if(!source?.value.name && child === target && linkedTargets.size > 1) continue;
          ensureLocal(child,kind,"override",family);
        }
      }
      function declarations(source, kind, includeDev = true) {
        const declared = new Map();
        if (kind === "deno") {
          if (source.value.imports !== undefined && !object(source.value.imports) || source.value.scopes !== undefined && !object(source.value.scopes)) gap("malformed-deno-import-map");
          const values = Object.values(object(source.value.imports) ? source.value.imports : {});
          for (const scope of Object.values(object(source.value.scopes) ? source.value.scopes : {})) {
            if (!object(scope)) gap("malformed-deno-import-map"); else values.push(...Object.values(scope));
          }
          for (const value of values) {
            if (value === null) continue; // Import maps may explicitly block a mapping.
            if (typeof value !== "string") { gap("malformed-deno-import-map"); continue; }
            const req = requirement(value);
            if (req) declared.set(canonical(req), [{scope:"runtime", dependency:req.name, req}]);
            else if (/^\.\.?\//.test(value)) {
              const prefix=value.endsWith("/"), target=prefix ? resolution.directoryPath(source.mapBase ?? sourceDirectory(source.file),value) : relativePath(source.mapBase ?? sourceDirectory(source.file),value);
              const exists=target !== null && !protectedTarget(target) && (prefix ? [...files.keys()].some(path=>!target || path.startsWith(target+"/")) : files.has(target));
              if(target === null || protectedTarget(target)) gap("unsafe-deno-local-module-map");
              else if(graph.localMappings.length >= 20000) gap("deno-graph-node-budget");
              else graph.localMappings.push({source:source.mapFile || source.file,target:target || ".",prefix,exists});
              if(!exists) gap("deno-local-module-map-unavailable");
              gaps.push({path:source.mapFile || source.file,reason:"deno-local-module-content-unverified"});
            } else gap("unsupported-deno-import-reference");
          }
        } else for (const [field, scope] of [["dependencies", "runtime"], ["optionalDependencies", "optional"], ["devDependencies", "development"], ["peerDependencies", "peer"]]) {
          if (!includeDev && scope === "development") continue;
          if (source.value[field] !== undefined && !object(source.value[field])) gap("malformed-deno-package-json-declaration");
          for (const [name, value] of entries(source.value[field])) {
            if (typeof value !== "string") { gap("malformed-deno-package-json-declaration"); continue; }
            if (value.startsWith("file:") || value.startsWith("workspace:")) {
              let target;
              if(value.startsWith("file:")) {
                const path=resolution.directoryPath(sourceDirectory(source.file),value.slice(5));
                if(path === null || protectedTarget(path)) gap("unsafe-deno-file-dependency");
                else target=ensureLocal(path,"npm","file",source.family);
              } else {
                if(!["workspace:*","workspace:^","workspace:~"].includes(value)) gap("unsupported-deno-workspace-protocol");
                else {const item=workspaceCandidate(source,"npm:"+name);if(item) target=ensureLocal(item.target,item.kind,"workspace",item.family);else gap("deno-workspace-target-unavailable");}
              }
              const req={ecosystem:"npm",name,key:"npm:"+name+"@*"};
              if (!declared.has(canonical(req))) declared.set(canonical(req),[]);
              declared.get(canonical(req)).push({scope,dependency:name,req,localTarget:target || null,localProtocol:true});
              continue;
            }
            const req = requirement(value.startsWith("npm:") ? value : "npm:" + name + "@" + value);
            if (req) { if (!declared.has(canonical(req))) declared.set(canonical(req), []); declared.get(canonical(req)).push({scope, dependency:name, req}); }
            else gap("unsupported-deno-package-json-declaration");
          }
        }
        return declared;
      }
      function directLocalTarget(declared, req) {
        if(!req) return undefined;
        const items=(declared.get(canonical(req)) || []).filter(item=>item.localProtocol);
        if(!items.length) return undefined;
        const targets=new Set(items.map(item=>item.localTarget));
        if(targets.size !== 1 || targets.has(null)) {gap("ambiguous-deno-local-protocol-target");return null;}
        return [...targets][0];
      }
      for (const [id, item] of raw) {
        if (nodes.get(id).ecosystem === "jsr") {
          if (item.dependencies !== undefined && !Array.isArray(item.dependencies)) { gap("malformed-deno-dependency-map"); continue; }
          for (const value of item.dependencies || []) {
            const req = requirement(value), target = resolveReq(value);
            if (req && target) edge(id, target, req.name); else gap("unresolved-deno-dependency-edge");
          }
        } else for (const [field, scope] of [["dependencies", "runtime"], ["optionalDependencies", "optional"], ["optionalPeers", "peer"]]) {
          if (item[field] === undefined) continue;
          if (data.version === "3" && field === "dependencies" && object(item[field])) {
            for (const [name, value] of entries(item[field])) edge(id, typeof value === "string" ? "npm/" + value : null, name, scope);
          } else if (Array.isArray(item[field])) for (const value of item[field]) {
            const dep = npmDependency(value);
            if (dep) edge(id, dep.id, dep.name, scope); else gap("unresolved-deno-dependency-edge");
          } else gap("malformed-deno-dependency-map");
        }
      }
      function workspace(location, item) {
        if (location && !pathOK(location) || !object(item)) { gap("invalid-deno-workspace-entry"); return; }
        for (const [kind, section] of [["deno", item], ["npm", item.packageJson]]) {
          if (section === undefined) continue;
          if (!object(section) || section.dependencies !== undefined && !Array.isArray(section.dependencies)) { gap("malformed-deno-workspace-dependencies"); continue; }
          const deps = section.dependencies || [];
          if (!deps.length && !(kind === "deno" ? ["deno.json", "deno.jsonc"].some(name => files.has(directory + (location ? location + "/" : "") + name)) : files.has(directory + (location ? location + "/" : "") + "package.json"))) continue;
          const source = config(location, kind); if (!source) continue;
          const original=context.read(source.file);
          if(location && kind === "deno" && ["workspace","importMap","scopes","links","patch","lock"].some(field=>original[field] !== undefined)) gap("deno-member-root-setting");
          if(location && source.value.workspace !== undefined) gap("nested-deno-workspace-unsupported");
          if(location && rootConfig?.value.importMap !== undefined && original.imports !== undefined) gap("deno-root-map-member-imports-conflict");
          const id = location ? "workspaces/" + location + "/" + kind : "workspace:./" + kind;
          if (nodes.size >= 20000) { gap("deno-graph-node-budget"); return; }
          const root = {id, name:nameOK(source.value.name) ? source.value.name : "workspace", version:"unknown", kind:"workspace", manifest:source.file};
          nodes.set(id, root); graph.nodes.push(root); graph.roots.push({manifest:source.file, node:id});
          const declared = declarations(source, kind);
          const locked = new Set();
          for(const [key,items] of declared) for(const item of items) if(item.localProtocol) {
            if(item.localTarget) {edge(id,item.localTarget,item.dependency,item.scope);locked.add(key);}else gap("unresolved-deno-local-protocol");
          }
          for (const value of deps) {
            const req = requirement(value), direct = directLocalTarget(declared,req), target = direct === undefined ? resolveReq(value,source) : direct;
            if (!req || !target) { gap("unresolved-deno-workspace-dependency"); continue; }
            locked.add(canonical(req));
            if (!declared.has(canonical(req))) { gap("stale-deno-workspace-declaration"); continue; }
            for (const declaration of declared.get(canonical(req))) edge(id, target, declaration.dependency, declaration.scope);
          }
          for (const key of declared.keys()) if (!locked.has(key)) gap("stale-deno-workspace-declaration");
          if (kind === "deno") coveredImports.push(source.file);
        }
      }
      if (options.ambiguous) gap("ambiguous-deno-lock-owner");
      else if (!object(data.workspace)) { if (raw.size || body.specifiers && Object.keys(body.specifiers).length) gap("deno-workspace-evidence-unavailable"); }
      else {
        workspace("", data.workspace);
        if (data.workspace.members !== undefined && !object(data.workspace.members)) gap("invalid-deno-workspace-entry");
        for (const [location, item] of entries(data.workspace.members)) {
          if (!members(rootFamily).includes(directory + location)) { gap("unconfirmed-deno-workspace-member"); continue; }
          workspace(location, item);
        }
      }
      for (const local of localSources) {
        const all = declarations(local.source, local.kind), declared = new Map([...all].map(([key,items])=>[key,items.filter(item=>item.scope !== "development")]).filter(([,items])=>items.length)), locked = new Set();
        for(const [key,items] of declared) for(const item of items) if(item.localProtocol) {
          if(item.localTarget) {edge(local.node,item.localTarget,item.dependency,item.scope);locked.add(key);}else gap("unresolved-deno-local-protocol");
        }
        for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
          const values = local.metadata?.[field] ?? [];
          if (!Array.isArray(values)) { gap("malformed-deno-local-lock-dependencies"); continue; }
          for (const value of values) {
            const req = requirement(value), direct = directLocalTarget(declared,req), target = direct === undefined ? resolveReq(value,local.source) : direct;
            if(req && all.has(canonical(req)) && !declared.has(canonical(req))) continue;
            if (!req || !target || !declared.has(canonical(req))) { gap("stale-deno-local-declaration"); continue; }
            locked.add(canonical(req));
            for (const item of declared.get(canonical(req))) edge(local.node, target, item.dependency, item.scope);
          }
        }
        for (const key of declared.keys()) if (!locked.has(key)) gap("stale-deno-local-declaration");
        gaps.push({path:local.source.file, reason:"deno-local-package-content-unverified"});
        if (local.kind === "deno") coveredImports.push(local.source.file);
      }
      for (const key of Object.keys(object(lockedLinks) ? lockedLinks : {})) if (!matchedLinks.has(key)) gap("deno-local-links-or-overrides-unverified");
      graph.importMaps.sort();
      graph.localMappings=[...new Map(graph.localMappings.map(item=>[JSON.stringify(item),item])).values()];
    } catch { gap("invalid-or-unsupported-deno-lock-syntax"); }
    const outgoing = new Map(), usage = new Map();
    for (const link of graph.edges) { if (!outgoing.has(link.from)) outgoing.set(link.from, []); outgoing.get(link.from).push(link); }
    let work = 0;
    for (const root of graph.roots) {
      const queue = [{id:root.node, phase:"runtime", direct:true}], visited = new Set();
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index], visit = current.id + ":" + current.phase + ":" + current.direct;
        if (visited.has(visit)) continue; visited.add(visit);
        for (const link of outgoing.get(current.id) || []) {
          if (++work > 100000) { gap("deno-graph-traversal-budget"); break; }
          if (!current.direct && link.scope === "development") continue;
          const target = nodes.get(link.to), phase = link.scope === "peer" ? "unknown" : current.direct && link.scope === "development" ? "development" : current.phase;
          if (!usage.has(link.to)) usage.set(link.to, new Map());
          const entry = {manifest:root.manifest, phase:phase === "development" && buildTools.has(target.name) ? "build" : phase, direct:current.direct, ...(current.direct ? {dependency:link.dependency} : {})};
          usage.get(link.to).set(JSON.stringify(entry), entry);
          queue.push({id:target.id, phase, direct:false});
        }
        if (work > 100000) break;
      }
      if (work > 100000) break;
    }
    for (const [id, item] of raw) {
      const node = nodes.get(id), workspaceUsage = [...(usage.get(id)?.values() || [])].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const phases = new Set(workspaceUsage.map(item => item.phase));
      const untrusted = locals.has(node.ecosystem + ":" + node.name) || gaps.some(item => item.reason === "deno-local-links-or-overrides-unverified") || node.ecosystem === "npm" && (typeof item.integrity !== "string" || item.tarball !== undefined);
      inventory.push({ecosystem:node.ecosystem, name:node.name, version:node.version, versionKind:untrusted ? "unresolved-lock-source" : "locked-exact",
        manifest:record.path, path:id, phase:phases.size === 1 ? [...phases][0] : "unknown", phaseEvidence:"Deno lock-declared graph and configuration only; package content, installation, execution and deployment not verified",
        direct:workspaceUsage.some(item => item.direct), provenance:"lockfile", workspaceUsage});
    }
    if (inventory.some(item => item.ecosystem === "jsr")) gaps.push({path:record.path, reason:"jsr-advisory-coverage-unavailable"});
    graph.nodes.sort((a,b) => a.id.localeCompare(b.id));
    graph.edges = [...new Map(graph.edges.map(item => [JSON.stringify(item), item])).values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    graph.roots.sort((a,b) => a.manifest.localeCompare(b.manifest));
    return {graph, inventory, gaps, coveredImports:graph.complete ? coveredImports : []};
  }
  const api = Object.freeze({readDenoLock, discoverLocks, relativePath, protectedTarget, discoverInputs:resolution.discoverInputs});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.FrontendDenoLock = api;
})();
