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
  function discoverLocks(records) {
    const plans = [], gaps = [], owners = new Map(), configuredDirectories = new Set();
    for (const record of records) {
      if (!/(^|\/)deno\.jsonc?$/.test(record.path)) continue;
      const directory = record.path.replace(/[^/]+$/, "");
      let data;
      try { data = parser.parseJSONC(record.content); } catch { gaps.push({path:record.path, reason:"invalid-deno-lock-configuration"}); continue; }
      configuredDirectories.add(directory);
      let target = "deno.lock";
      if (data.lock === false) continue;
      if (typeof data.lock === "string") target = data.lock;
      else if (object(data.lock) && (data.lock.path === undefined || typeof data.lock.path === "string")) target = data.lock.path ?? "deno.lock";
      else if (data.lock !== undefined && data.lock !== true) { gaps.push({path:record.path, reason:"invalid-deno-lock-configuration"}); continue; }
      const lockfile = relativePath(directory, target);
      if (!lockfile || protectedTarget(lockfile)) { gaps.push({path:record.path, reason:"unsafe-deno-lock-path"}); continue; }
      const plan = {lockfile, directory, config:record.path};
      plans.push(plan);
      if (!owners.has(lockfile)) owners.set(lockfile, []);
      owners.get(lockfile).push(plan);
    }
    for (const plans of owners.values()) if (plans.length > 1) for (const plan of plans) { plan.ambiguous = true; gaps.push({path:plan.config, reason:"ambiguous-deno-lock-owner"}); }
    return {plans, gaps, configuredDirectories:[...configuredDirectories]};
  }
  function readDenoLock(record, records, options = {}) {
    const graph = {lockfile:record.path, format:"deno", complete:true, nodes:[], edges:[], roots:[]};
    const gaps = [], inventory = [], coveredImports = [], nodes = new Map(), raw = new Map(), aliases = new Map(), names = new Map();
    const gap = reason => { graph.complete = false; if (!gaps.some(item => item.reason === reason)) gaps.push({path:record.path, reason}); };
    const directory = options.directory ?? record.path.replace(/[^/]+$/, "");
    const files = new Map(records.map(item => [item.path, item]));
    const configs = new Map(), locals = new Map(), localSources = [];
    const canonical = req => req.ecosystem + ":" + req.name + "@" + (req.key.slice((req.ecosystem + ":" + req.name).length + 1) || "*");
    const resolveAlias = (key, target) => {
      if (aliases.has(key) && aliases.get(key) !== target) aliases.set(key, null); else if (!aliases.has(key)) aliases.set(key, target);
    };
    function edge(from, to, dependency, scope = "runtime") {
      if (!nodes.has(from) || !nodes.has(to) || !nameOK(dependency)) { gap("unresolved-deno-dependency-edge"); return; }
      if (graph.edges.length >= 40000) { gap("deno-graph-edge-budget"); return; }
      graph.edges.push({from, to, dependency, scope});
    }
    function resolveReq(value) {
      const req = requirement(value); if (!req) return null;
      return locals.get(req.ecosystem + ":" + req.name)?.node || aliases.get(req.key) || (req.key === req.ecosystem + ":" + req.name ? aliases.get(req.key + "@*") : null) || null;
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
        const candidates = kind === "deno" ? ["deno.json", "deno.jsonc"].map(name => prefix + name).filter(name => files.has(name)) : [prefix + "package.json"].filter(name => files.has(name));
        if (candidates.length !== 1) { gap("deno-workspace-manifest-unavailable-or-ambiguous"); return null; }
        const file = candidates[0];
        if (!configs.has(file)) {
          try { configs.set(file, parser.parseJSONC(files.get(file).content)); } catch { configs.set(file, null); gap("invalid-deno-workspace-configuration"); }
        }
        const value = configs.get(file);
        if (!object(value)) return null;
        if (kind === "npm" && value.overrides !== undefined && (!object(value.overrides) || Object.keys(value.overrides).length)) gap("deno-local-links-or-overrides-unverified");
        if (kind === "deno" && value.importMap !== undefined) gap("deno-external-import-map-unverified");
        if (!prefixOverride && kind === "deno" && (value.lock === false || (typeof value.lock === "string" || object(value.lock) && value.lock.path !== undefined) && relativePath(sourceDirectory(file), typeof value.lock === "string" ? value.lock : value.lock.path) !== record.path)) { gap("deno-lock-configuration-mismatch"); return null; }
        return {file, value};
      }
      const lockedLinks = data.workspace?.links ?? data.workspace?.patches ?? {};
      const rootConfig = ["deno.json", "deno.jsonc"].some(name => files.has(directory + name)) && !options.ambiguous ? config("", "deno") : null;
      const paths = rootConfig?.value.links ?? rootConfig?.value.patch ?? [];
      if (!object(lockedLinks) || !Array.isArray(paths) || rootConfig?.value.links !== undefined && rootConfig.value.patch !== undefined || data.workspace?.links !== undefined && data.workspace?.patches !== undefined) gap("deno-local-links-or-overrides-unverified");
      const matchedLinks = new Set();
      for (const path of Array.isArray(paths) ? paths : []) {
        const target = relativePath(directory, path);
        if (!target || protectedTarget(target) || target === directory.replace(/\/$/, "")) { gap("unsafe-or-unsupported-deno-local-path"); continue; }
        const kind = ["deno.json", "deno.jsonc"].some(name => files.has(target + "/" + name)) ? "deno" : "npm";
        const source = config("", kind, target + "/");
        if (!source || !nameOK(source.value.name) || kind === "deno" && !source.value.name.startsWith("@")) { gap("deno-local-manifest-identity-unavailable"); continue; }
        const key = (kind === "deno" ? "jsr:" : "npm:") + source.value.name;
        if (matchedLinks.has(key)) { locals.set(key, null); gap("ambiguous-deno-local-name"); continue; }
        matchedLinks.add(key);
        const metadata = object(lockedLinks) && lockedLinks[key];
        if (!object(metadata)) gap("deno-local-lock-metadata-unavailable");
        if (["links", "patch", "workspace"].some(field => source.value[field] !== undefined)) gap("nested-deno-local-configuration-unverified");
        const id = "local/" + target + "/" + kind;
        if (record.path.length + id.length > 1700 || nodes.size >= 20000) { gap("deno-graph-node-budget"); continue; }
        if (nodes.has(id)) { gap("ambiguous-deno-local-name"); continue; }
        nodes.set(id, {id, name:source.value.name, version:versionOK(source.value.version || "") ? source.value.version : "unknown", kind:"local", manifest:source.file});
        graph.nodes.push(nodes.get(id));
        const local = {node:id, source, kind, metadata};
        locals.set(key, local); localSources.push(local);
      }
      for (const key of Object.keys(object(lockedLinks) ? lockedLinks : {})) if (!matchedLinks.has(key)) gap("deno-local-links-or-overrides-unverified");
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
            else if (typeof value === "string" && !/^\.\.?\//.test(value)) gap("unsupported-deno-import-reference");
          }
        } else for (const [field, scope] of [["dependencies", "runtime"], ["optionalDependencies", "optional"], ["devDependencies", "development"], ["peerDependencies", "peer"]]) {
          if (!includeDev && scope === "development") continue;
          if (source.value[field] !== undefined && !object(source.value[field])) gap("malformed-deno-package-json-declaration");
          for (const [name, value] of entries(source.value[field])) {
            if (typeof value !== "string") { gap("malformed-deno-package-json-declaration"); continue; }
            const req = requirement(typeof value === "string" && value.startsWith("npm:") ? value : "npm:" + name + "@" + value);
            if (req) { if (!declared.has(canonical(req))) declared.set(canonical(req), []); declared.get(canonical(req)).push({scope, dependency:name, req}); }
            else gap("unsupported-deno-package-json-declaration");
          }
        }
        return declared;
      }
      for (const local of localSources) {
        const declared = declarations(local.source, local.kind, false), locked = new Set();
        for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
          const values = local.metadata?.[field] ?? [];
          if (!Array.isArray(values)) { gap("malformed-deno-local-lock-dependencies"); continue; }
          for (const value of values) {
            const req = requirement(value), target = resolveReq(value);
            if (!req || !target || !declared.has(canonical(req))) { gap("stale-deno-local-declaration"); continue; }
            locked.add(canonical(req));
            for (const item of declared.get(canonical(req))) edge(local.node, target, item.dependency, item.scope);
          }
        }
        for (const key of declared.keys()) if (!locked.has(key)) gap("stale-deno-local-declaration");
        gaps.push({path:local.source.file, reason:"deno-local-package-content-unverified"});
        if (local.kind === "deno") coveredImports.push(local.source.file);
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
          if (!deps.length && !(kind === "deno" && ["deno.json", "deno.jsonc"].some(name => files.has(directory + (location ? location + "/" : "") + name)))) continue;
          const source = config(location, kind); if (!source) continue;
          const id = location ? "workspaces/" + location + "/" + kind : "workspace:./" + kind;
          if (nodes.size >= 20000) { gap("deno-graph-node-budget"); return; }
          const root = {id, name:nameOK(source.value.name) ? source.value.name : "workspace", version:"unknown", kind:"workspace", manifest:source.file};
          nodes.set(id, root); graph.nodes.push(root); graph.roots.push({manifest:source.file, node:id});
          const declared = declarations(source, kind);
          const locked = new Set();
          for (const value of deps) {
            const req = requirement(value), target = resolveReq(value);
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
        for (const [location, item] of entries(data.workspace.members)) workspace(location, item);
      }
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
  const api = Object.freeze({readDenoLock, discoverLocks, relativePath, protectedTarget});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.FrontendDenoLock = api;
})();
