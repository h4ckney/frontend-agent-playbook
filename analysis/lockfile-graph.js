(function () {
  "use strict";
  const yaml = typeof module !== "undefined" && module.exports ? require("./vendor/js-yaml-5.5.0.js") : globalThis.jsyaml;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const entries = value => object(value) ? Object.entries(value) : [];
  const exact = value => typeof value === "string" && /^v?\d+\.\d+\.\d+$/.test(value) && value.replace(/^v/, "").split(".").every(part => Number.isSafeInteger(Number(part)));
  const nameOK = name => typeof name === "string" && name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
  const pathOK = path => typeof path === "string" && path.length <= 1200 && !/[\\\x00-\x1f:?#]/.test(path) && !path.startsWith("/") && path.split("/").every(part => part && part !== "." && part !== "..");
  const scopes = [["dependencies", "runtime"], ["optionalDependencies", "optional"], ["devDependencies", "development"], ["peerDependencies", "peer"]];
  const buildTools = new Set(["vite", "webpack", "rollup", "esbuild", "typescript", "@swc/core", "@babel/core", "parcel"]);
  function displayVersion(value) {
    if (typeof value !== "string") return null;
    if (/(?:https?|ssh|git\+[a-z]+):\/\//i.test(value)) return "custom-source:<source-redacted>";
    if (/^(?:npm|workspace):/.test(value) && !/(?:https?|ssh|git|file|portal|patch|exec):/.test(value)) return value;
    const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1];
    return protocol || /^git@/.test(value) ? (protocol || "git") + ":<source-redacted>" : value;
  }
  function join(base, relative) {
    if (typeof relative !== "string" || /[\\\x00-\x1f:?#]/.test(relative) || relative.startsWith("/")) return null;
    const parts = base ? base.split("/") : [];
    for (const part of relative.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part);
    }
    return parts.join("/");
  }
  function packageRef(ref) {
    const match = typeof ref === "string" && /^((?:@[^/]+\/)?[^@/]+)@(\d+\.\d+\.\d+)(\([^\r\n]*\))?$/.exec(ref);
    return match && nameOK(match[1]) && exact(match[2]) ? { name: match[1], version: match[2] } : null;
  }
  function contextHash(text) {
    let hash = 14695981039346656037n;
    for (let index = 0; index < text.length; index += 1) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * 1099511628211n);
    return hash.toString(16);
  }
  function yarnRegistry(locator, depth = 0) {
    if (depth > 4 || typeof locator !== "string" || locator.length > 8000) return null;
    const parts = /^((?:@[^/]+\/)?[^@/]+)@(.+)$/.exec(locator);
    if (!parts || !nameOK(parts[1])) return null;
    const direct = /^npm:(\d+\.\d+\.\d+)$/.exec(parts[2]);
    if (direct && exact(direct[1])) return { name: parts[1], version: direct[1], modifications: [] };
    const patch = /^patch:([^#]+)#/.exec(parts[2]);
    if (patch) {
      let inner; try { inner = yarnRegistry(decodeURIComponent(patch[1]), depth + 1); } catch { return null; }
      if (!inner || inner.name !== parts[1]) return null;
      return { ...inner, modifications: [...new Set([...inner.modifications, "patch"])] };
    }
    const virtual = /^virtual:[a-zA-Z0-9_-]+#(.+)$/.exec(parts[2]);
    if (virtual) {
      const inner = yarnRegistry(parts[1] + "@" + virtual[1], depth + 1);
      return inner && { ...inner, modifications: [...new Set([...inner.modifications, "virtual"])] };
    }
    return null;
  }
  // Bun is JSONC, not executable JavaScript. Remove comments/trailing commas only
  // outside quoted strings, then require both valid JSON and unique mapping keys.
  function jsonc(text) {
    let clean = "", quoted = false, escaped = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i], next = text[i + 1];
      if (quoted) { clean += ch; if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; continue; }
      if (ch === '"') { quoted = true; clean += ch; }
      else if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; clean += "\n"; }
      else if (ch === "/" && next === "*") { const end = text.indexOf("*/", i + 2); if (end < 0) throw Error("comment"); clean += " "; i = end + 1; }
      else clean += ch;
    }
    let result = ""; quoted = false; escaped = false;
    for (let i = 0; i < clean.length; i += 1) {
      const ch = clean[i];
      if (quoted) { result += ch; if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') quoted = false; continue; }
      if (ch === '"') quoted = true;
      if (ch === ",") {
        let next = i + 1;
        while (next < clean.length && /\s/.test(clean[next])) next += 1;
        if (clean[next] === "}" || clean[next] === "]") continue;
      }
      result += ch;
    }
    JSON.parse(result);
    return result;
  }
  function load(text, bun = false) {
    if (text.length > 500 * 1024) throw Error("size");
    const value = yaml.load(bun ? jsonc(text) : text, { schema: yaml.FAILSAFE_SCHEMA, maxDepth: 48, maxAliases: 0, maxTotalMergeKeys: 0 });
    if (!object(value)) throw Error("object");
    return value;
  }

  function readLockGraph(record, manifests, options = {}) {
    const format = /pnpm-lock\.yaml$/.test(record.path) ? "pnpm" : /bun\.lock$/.test(record.path) ? "bun" : /yarn\.lock$/.test(record.path) ? "yarn-berry" : "npm";
    const graph = { lockfile: record.path, format, ...(options.document ? { document: options.document } : {}), complete: true, nodes: [], edges: [], roots: [] };
    const inventory = [], gaps = [], nodes = new Map(), raw = new Map(), aliases = new Map(), workspaces = new Map(), locations = new Map();
    const directory = record.path.replace(/[^/]+$/, "");
    const gap = reason => { graph.complete = false; if (!gaps.some(item => item.reason === reason)) gaps.push({ path: record.path, reason }); };
    const fullManifest = location => directory + (location ? location + "/" : "") + "package.json";
    const manifestAt = location => manifests.get("npm:" + directory + (location ? location + "/" : ""));
    function node(id, name, version, kind = "package", location) {
      if ((!pathOK(id) && id !== "workspace:.") || record.path.length + id.length > 1800 || !nameOK(name) || typeof version !== "string" || version.length > 200) { gap("malformed-graph-node"); return null; }
      if (options.document === "boot") id = "boot/" + id;
      if (nodes.size >= 20000) { gap("graph-node-budget"); return null; }
      if (nodes.has(id)) { gap("conflicting-graph-node"); return null; }
      const item = { id, name, version: displayVersion(version), kind, ...(["workspace", "local"].includes(kind) ? { manifest: fullManifest(location) } : {}) };
      nodes.set(id, item); graph.nodes.push(item);
      if (kind === "workspace") {
        workspaces.set(location, id);
        locations.set(id, location);
        if (manifestAt(location)) graph.roots.push({ manifest: fullManifest(location), node: id, ...(options.document === "boot" ? { phase: "build" } : {}) });
        else gap("workspace-manifest-unavailable");
      }
      return id;
    }
    function workspace(location, data) {
      if (location && !pathOK(location)) { gap("invalid-workspace-path"); return null; }
      const manifest = manifestAt(location);
      // A lockfile can describe the root without declaring a package name.
      const id = node(location ? "workspaces/" + location : "workspace:.", nameOK(data?.name) ? data.name : nameOK(manifest?.name) ? manifest.name : "workspace", typeof data?.version === "string" ? data.version : "unknown", "workspace", location);
      return id;
    }
    function edge(from, to, dependency, scope) {
      if (!nodes.has(from) || !nodes.has(to) || !nameOK(dependency)) { gap("unresolved-dependency-edge"); return; }
      if (graph.edges.length >= 40000) { gap("graph-edge-budget"); return; }
      graph.edges.push({ from, to, dependency, scope });
    }
    function groups(data, callback, includeDev = false, includePeer = true) {
      const fields = options.document === "boot" ? [...scopes, ["configDependencies", "build"], ["packageManagerDependencies", "build"]] : scopes;
      for (const [key, scope] of fields) {
        if (key === "devDependencies" && !includeDev || key === "peerDependencies" && !includePeer) continue;
        if (data?.[key] !== undefined && !object(data[key])) { gap("malformed-dependency-map"); continue; }
        for (const [name, ref] of entries(data?.[key])) {
          if (key === "dependencies" && Object.hasOwn(data.optionalDependencies || {}, name)) continue;
          if (!nameOK(name)) { gap("malformed-dependency-name"); continue; }
          callback(name, ref, scope, key);
        }
      }
    }
    function checkDeclarations(location, locked, normalize = value => value) {
      const manifest = manifestAt(location);
      if (!manifest) return;
      for (const [key] of scopes) {
        for (const [name, value] of entries(manifest[key])) {
          if (typeof value !== "string" || normalize(locked?.[key]?.[name]) !== normalize(value)) gap("stale-workspace-declaration");
        }
      }
    }
    function assignAlias(key, id) {
      if (aliases.has(key) && aliases.get(key) !== id) { aliases.set(key, null); gap("ambiguous-dependency-selector"); }
      else if (!aliases.has(key)) aliases.set(key, id);
    }
    try {
      // JSON.parse silently overwrites duplicate npm keys. Validate structure and
      // unique keys with the same bounded parser before retaining JSON types.
      if (format === "npm") load(record.content);
      const data = options.data || (format === "npm" ? JSON.parse(record.content) : load(record.content, format === "bun"));
      if (!object(data)) throw Error("object");
      if (format === "pnpm") {
        const major = String(data.lockfileVersion).split(".")[0];
        const legacy = major === "5" && /^(?:5|5\.[0-4])$/.test(String(data.lockfileVersion));
        if (!legacy && !["6", "9"].includes(major) || data.packages !== undefined && !object(data.packages)) { gap("unsupported-pnpm-lock-format"); return { graph, inventory, gaps }; }
        data.packages ||= {};
        const snapshots = major === "9" ? data.snapshots === undefined && !Object.keys(data.packages).length ? {} : data.snapshots : data.packages;
        if (!object(snapshots)) { gap("missing-pnpm-snapshots"); return { graph, inventory, gaps }; }
        for (const [key, item] of entries(snapshots)) {
          const identity = key.replace(/^\//, "");
          const old = legacy && /^((?:@[^/]+\/)?[^/]+)\/(\d+\.\d+\.\d+)(?:_[^\s:#?\\]+)?$/.exec(identity);
          const ref = legacy ? old && nameOK(old[1]) && exact(old[2]) ? { name: old[1], version: old[2] } : null : packageRef(identity);
          if (!ref || !object(item)) { gap("unsupported-pnpm-package"); continue; }
          const base = identity.replace(/\(.*/, "");
          if (major === "9" && !object(data.packages[base])) gap("missing-pnpm-package-metadata");
          const id = node("packages/" + identity, ref.name, ref.version);
          if (id) {
            assignAlias(identity, id);
            if (old) assignAlias(old[1] + "@" + identity.slice(old[1].length + 1), id);
            raw.set(id, item);
            const metadata = major === "9" ? data.packages[base] : item;
            const revision = metadata?.resolution?.revision;
            if (revision !== undefined) {
              if (!/^\d+$/.test(String(revision)) || !Number.isSafeInteger(Number(revision))) gap("invalid-registry-revision");
              else if (Number(revision) > 0) Object.assign(nodes.get(id), { modifications: ["registry-revision"], registryRevision: Number(revision) });
            }
            if (/(?:\(|_)patch_hash=/.test(identity)) nodes.get(id).modifications = [...new Set([...(nodes.get(id).modifications || []), "patch"])];
          }
        }
        // Older single-project v6 files keep the importer at the document root.
        const importers = object(data.importers) ? data.importers : ["5", "6"].includes(major) && data.importers === undefined ? { ".": data } : null;
        if (!importers) gap("missing-pnpm-importers");
        for (const [key, item] of entries(importers)) {
          const location = key === "." ? "" : key;
          if (!object(item)) { gap("malformed-workspace-entry"); continue; }
          const id = workspace(location, item); if (!id) continue;
          const locked = {};
          groups(item, (name, ref, scope, field) => { (locked[field] ||= {})[name] = object(ref) ? ref.specifier : legacy ? item.specifiers?.[name] : ref; }, true, false);
          if (options.document !== "boot") checkDeclarations(location, locked);
          raw.set(id, item);
        }
        for (const [id, item] of raw) groups(item, (name, reference, scope) => {
          const ref = object(reference) ? reference.version : reference;
          let target = null;
          if (typeof ref === "string" && ref.startsWith("link:")) {
            if (options.document === "boot") gap("unsupported-pnpm-boot-local-reference");
            const from = locations.has(id) ? locations.get(id) : "";
            const relative = from === null ? null : join(from, ref.slice(5));
            if (relative !== null) target = workspaces.get(relative);
          } else if (typeof ref === "string") target = aliases.get(name + "@" + ref) || aliases.get(ref.replace(/^\//, ""));
          if (!target) gap("unresolved-dependency-edge"); else edge(id, target, name, scope);
        }, nodes.get(id).kind === "workspace", false);
        // Keep orphan version evidence as well: a missing edge must not hide a CVE.
        const identities = new Set([...nodes.values()].map(n => n.name + "@" + n.version));
        if (major === "9") for (const [key, item] of entries(data.packages)) {
          const ref = packageRef(key);
          if (ref && !identities.has(ref.name + "@" + ref.version)) {
            node("unlinked/" + key, ref.name, ref.version); gap("pnpm-package-without-snapshot");
          } else if (!ref || !object(item)) gap("unsupported-pnpm-package");
        }
      } else if (format === "yarn-berry") {
        if (!object(data.__metadata) || !/^(?:[4-9]|10)$/.test(data.__metadata.version)) { gap("unsupported-yarn-lock-format"); return { graph, inventory, gaps }; }
        const pendingLocal = [], localParents = new Map();
        const manifestRange = ref => typeof ref !== "string" ? ref : /^(?:portal|file):/.test(ref) ? ref.split("::")[0] : ref.replace(/^npm:/, "");
        for (const [header, item] of entries(data)) {
          if (header === "__metadata") continue;
          if (!object(item) || typeof item.resolution !== "string") { gap("malformed-yarn-entry"); continue; }
          const local = /^((?:@[^/]+\/)?[^@]+)@workspace:(.*)$/.exec(item.resolution);
          const npm = yarnRegistry(item.resolution);
          if (/^((?:@[^/]+\/)?[^@]+)@(?:portal|file):/.test(item.resolution)) { pendingLocal.push([header, item]); continue; }
          let id;
          if (local) id = workspace(local[2] === "." ? "" : local[2], { ...item, name: local[1] });
          else if (npm && exact(item.version) && item.version === npm.version) {
            id = node("packages/" + npm.name + "@" + npm.version + (npm.modifications.length ? "/context-" + contextHash(item.resolution) : ""), npm.name, npm.version);
            if (id && npm.modifications.length) nodes.get(id).modifications = npm.modifications;
            if (npm.modifications.includes("virtual")) gap("yarn-virtual-peer-context-unverified");
          }
          else { gap("unsupported-yarn-resolution"); continue; }
          if (!id) continue;
          raw.set(id, item);
          assignAlias(item.resolution, id);
          for (const descriptor of header.split(/,\s+/)) assignAlias(descriptor, id);
        }
        for (const [header, item] of pendingLocal) {
          try {
            const match = /^((?:@[^/]+\/)?[^@]+)@(portal|file):([^:]+)::(.+)$/.exec(item.resolution);
            if (!match || !nameOK(match[1])) { gap("unsupported-yarn-local-binding"); continue; }
            const params = new Map();
            for (const field of match[4].split("&")) {
              const equals = field.indexOf("=");
              if (equals < 1) throw Error("binding");
              const key = decodeURIComponent(field.slice(0, equals));
              if (params.has(key)) throw Error("duplicate binding");
              params.set(key, decodeURIComponent(field.slice(equals + 1)));
            }
            const parent = aliases.get(params.get("locator"));
            if (!parent || nodes.get(parent).kind !== "workspace") { gap("unresolved-yarn-local-parent"); continue; }
            const relative = decodeURIComponent(match[3]);
            if (/\.(?:tgz|tar|tar\.gz|zip)$/i.test(relative)) { gap("unsupported-local-archive"); continue; }
            const location = join(locations.get(parent), relative), manifest = location !== null && manifestAt(location);
            if (!manifest || location && !pathOK(location)) { gap("local-package-manifest-unavailable"); continue; }
            if (typeof item.version !== "string" || item.version !== manifest.version) { gap("stale-local-package-version"); continue; }
            const id = node("locals/" + match[2] + "-" + contextHash(item.resolution), match[1], item.version, "local", location);
            if (!id) continue;
            locations.set(id, location); localParents.set(id, parent); raw.set(id, item);
            gap("local-package-registry-origin-unverified");
            if (match[2] === "file") gap("local-package-copy-unverified");
            groups(manifest, (name, ref, scope) => {
              if (scope !== "peer" && manifestRange(item.dependencies?.[name] || item.optionalDependencies?.[name]) !== manifestRange(ref)) gap("stale-local-package-declaration");
            });
            assignAlias(item.resolution, id);
            for (const selector of header.split(/,\s+/)) {
              assignAlias(selector, id);
              assignAlias(parent + "::" + selector.split("::")[0], id);
            }
          } catch { gap("unsupported-yarn-local-binding"); }
        }
        if (!raw.size) gap("missing-yarn-entries");
        const descriptor = (name, ref) => name + "@" + (/^[a-z][a-z0-9+.-]*:/i.test(ref) ? ref : "npm:" + ref);
        const checkedLocalParent = (from, target) => {
          if (target && nodes.get(target).kind === "local" && localParents.get(target) !== from) { gap("unresolved-yarn-local-parent"); return null; }
          return target;
        };
        for (const [id, item] of raw) {
          const local = nodes.get(id).kind === "workspace", location = local ? locations.get(id) : null;
          const manifest = local && manifestAt(location);
          if (manifest) {
            // Berry combines workspace dev and prod dependencies in the lock.
            groups(manifest, (name, ref, scope) => {
              if (scope === "peer") { gap("unresolved-workspace-peer"); return; }
              const lockedRef = item.dependencies?.[name];
              if (typeof ref !== "string" || typeof lockedRef !== "string" || descriptor(name, manifestRange(ref)) !== descriptor(name, manifestRange(lockedRef))) { gap("stale-workspace-declaration"); return; }
              const target = checkedLocalParent(id, aliases.get(id + "::" + descriptor(name, manifestRange(lockedRef))) || aliases.get(descriptor(name, lockedRef)));
              if (target) edge(id, target, name, scope); else gap("unresolved-dependency-edge");
            }, true);
          } else if (!local) groups(item, (name, ref, scope) => {
            // Peer ranges do not identify a concrete Yarn virtual instance.
            if (scope === "peer") { gap("unresolved-package-peer"); return; }
            const target = typeof ref === "string" && checkedLocalParent(id, aliases.get(descriptor(name, ref)));
            if (target) edge(id, target, name, scope); else gap("unresolved-dependency-edge");
          });
        }
      } else if (format === "bun") {
        if (data.lockfileVersion !== "1" || !object(data.packages) || !object(data.workspaces)) { gap("unsupported-bun-lock-format"); return { graph, inventory, gaps }; }
        for (const [location, item] of entries(data.workspaces)) {
          if (!object(item)) { gap("malformed-workspace-entry"); continue; }
          const id = workspace(location, item);
          if (id) { raw.set(id, item); checkDeclarations(location, item); }
        }
        for (const [key, item] of entries(data.packages)) {
          if (!pathOK(key) || !Array.isArray(item) || typeof item[0] !== "string") { gap("malformed-bun-entry"); continue; }
          const local = /^((?:@[^/]+\/)?[^@]+)@workspace:(.*)$/.exec(item[0]);
          if (local) { const target = workspaces.get(local[2] === "." ? "" : local[2]); if (target && nodes.get(target).name === local[1]) assignAlias(key, target); else gap("unresolved-workspace-link"); continue; }
          const ref = packageRef(item[0]);
          if (!ref || !object(item[2])) { gap("unsupported-bun-resolution"); continue; }
          const id = node("packages/" + key, ref.name, ref.version);
          if (id) { assignAlias(key, id); raw.set(id, item[2]); }
        }
        function bunResolve(id, name) {
          // Bun keys encode nested resolutions as parent/child, including scopes.
          const current = nodes.get(id);
          let parent = current.kind === "workspace" ? current.manifest === fullManifest("") ? "" : current.name : id.slice(9);
          for (;;) {
            if (aliases.has((parent ? parent + "/" : "") + name)) return aliases.get((parent ? parent + "/" : "") + name);
            if (!parent) break;
            parent = parent.replace(/(?:^|\/)(?:@[^/]+\/)?[^/]+$/, "");
          }
          return null;
        }
        for (const [id, item] of raw) groups(item, (name, ref, scope) => {
          if (typeof ref !== "string") { gap("malformed-dependency-reference"); return; }
          const target = bunResolve(id, name);
          if (target) edge(id, target, name, scope); else gap("unresolved-dependency-edge");
        }, nodes.get(id).kind === "workspace");
      } else {
        if (![2, 3].includes(data.lockfileVersion) || !object(data.packages)) { gap("unsupported-npm-lock-format"); return { graph, inventory, gaps }; }
        for (const [location, item] of entries(data.packages)) {
          if (!object(item) || item.link) continue;
          const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(location);
          if (match) {
            if (!pathOK(location) || !nameOK(match[1])) { gap("malformed-npm-lock-entry"); continue; }
            const version = typeof item.version === "string" ? item.version : "unknown";
            const id = node(location, typeof item.name === "string" ? item.name : match[1], version);
            if (id) raw.set(id, item);
          } else {
            const id = workspace(location, item);
            if (id) { raw.set(id, item); checkDeclarations(location, item); }
          }
        }
        for (const [location, item] of entries(data.packages)) if (object(item) && item.link) {
          const target = typeof item.resolved === "string" ? join("", item.resolved.replace(/^file:/, "")) : null;
          if (pathOK(location) && target !== null && workspaces.has(target)) assignAlias(location, workspaces.get(target));
          else gap("unresolved-workspace-link");
        }
        function npmResolve(id, name) {
          let location = locations.has(id) ? locations.get(id) : id;
          for (;;) {
            const candidate = (location ? location + "/" : "") + "node_modules/" + name;
            if (aliases.has(candidate)) return aliases.get(candidate);
            if (nodes.has(candidate)) return candidate;
            if (!location) break;
            location = location.includes("/") ? location.slice(0, location.lastIndexOf("/")) : "";
          }
          return null;
        }
        for (const [id, item] of raw) groups(item, (name, ref, scope) => {
          if (typeof ref !== "string") { gap("malformed-dependency-reference"); return; }
          const target = npmResolve(id, name);
          if (target) edge(id, target, name, scope); else gap("unresolved-dependency-edge");
        }, nodes.get(id).kind === "workspace");
      }
    } catch { gap("invalid-or-unsupported-lock-syntax"); }

    const outgoing = new Map(), usage = new Map();
    for (const edge of graph.edges) { if (!outgoing.has(edge.from)) outgoing.set(edge.from, []); outgoing.get(edge.from).push(edge); }
    let work = 0;
    for (const root of graph.roots) {
      const queue = [{ id: root.node, phase: root.phase || "runtime", root: true }], visited = new Set();
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index], key = current.id + ":" + current.phase + ":" + current.root;
        if (visited.has(key)) continue; visited.add(key);
        for (const link of outgoing.get(current.id) || []) {
          if (++work > 100000) { gap("graph-traversal-budget"); break; }
          if (!current.root && link.scope === "development") continue;
          const phase = link.scope === "peer" ? "unknown" : current.root && link.scope === "development" ? "development" : current.phase;
          const target = nodes.get(link.to);
          if (target.kind === "package") {
            const entry = { manifest: root.manifest, phase: phase === "development" && buildTools.has(target.name) ? "build" : phase, direct: current.root, ...(current.root ? { dependency: link.dependency } : {}) };
            if (!usage.has(link.to)) usage.set(link.to, new Map());
            const map = usage.get(link.to), identity = entry.manifest + ":" + entry.phase + ":" + (entry.dependency || "");
            map.set(identity, entry);
          }
          queue.push({ id: link.to, phase, root: false });
        }
        if (work > 100000) break;
      }
      if (work > 100000) break;
    }
    for (const item of graph.nodes) if (item.kind === "package") {
      const workspaceUsage = [...(usage.get(item.id)?.values() || [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const phases = new Set(workspaceUsage.map(entry => entry.phase));
      const npmDev = raw.get(item.id)?.dev === true;
      const phase = workspaceUsage.length ? phases.size === 1 ? [...phases][0] : "unknown" : options.document === "boot" ? "build" : format === "npm" ? npmDev ? buildTools.has(item.name) ? "build" : "development" : "runtime" : "unknown";
      inventory.push({ ecosystem: "npm", name: item.name, version: item.version, versionKind: exact(item.version) ? "locked-exact" : "unresolved-lock-version",
        manifest: record.path, path: item.id, phase, phaseEvidence: (workspaceUsage.length ? "workspace lock graph; declared role only, installation/deployment and executable reachability not verified" : format === "npm" ? "npm lock dev flag; package install/deployment and runtime reachability not verified" : "lock version only; no verified workspace path")
          + (options.document === "boot" ? "; pnpm boot/config package, not an application declaration" : "")
          + (item.modifications?.length ? "; " + item.modifications.join(",") + (item.registryRevision ? "=" + item.registryRevision : "") + "; original registry version only; modified contents/fix not verified" : ""),
        direct: workspaceUsage.some(entry => entry.direct), provenance: "lockfile", workspaceUsage,
        ...(options.document === "boot" ? { lockContext: "boot" } : {}),
        ...(item.modifications?.length ? { modifications: item.modifications, ...(item.registryRevision ? { registryRevision: item.registryRevision } : {}) } : {}) });
    }
    graph.nodes.sort((a, b) => a.id.localeCompare(b.id));
    graph.edges = [...new Map(graph.edges.map(edge => [JSON.stringify(edge), edge])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    graph.roots.sort((a, b) => a.manifest.localeCompare(b.manifest));
    return { graph, inventory, gaps };
  }
  function readLockGraphs(record, manifests) {
    if (!/(^|\/)pnpm-lock\.yaml$/.test(record.path)) {
      const result = readLockGraph(record, manifests);
      return { graphs: [result.graph], inventory: result.inventory, gaps: result.gaps };
    }
    try {
      if (record.content.length > 500 * 1024) throw Error("size");
      const docs = yaml.loadAll(record.content, { schema: yaml.FAILSAFE_SCHEMA, maxDepth: 48, maxAliases: 0, maxTotalMergeKeys: 0 });
      if (!docs.length || docs.length > 2 || docs.some(doc => !object(doc))) throw Error("documents");
      const boot = doc => object(doc.importers?.["."]) && ["configDependencies", "packageManagerDependencies"].some(key => Object.hasOwn(doc.importers["."], key));
      if (docs.length === 2 && (String(docs[0].lockfileVersion).split(".")[0] !== "9" || !boot(docs[0]) || boot(docs[1]) || docs[0].lockfileVersion !== docs[1].lockfileVersion
        || Object.keys(docs[0].importers).some(key => key !== ".") || scopes.some(([key]) => Object.keys(docs[0].importers["."][key] || {}).length))) throw Error("layout");
      const results = docs.map(doc => readLockGraph(record, manifests, { data: doc, ...(boot(doc) ? { document: "boot" } : docs.length > 1 ? { document: "project" } : {}) }));
      const gaps = results.flatMap(result => result.gaps);
      if (docs.length === 1 && boot(docs[0])) gaps.push({ path: record.path, reason: "pnpm-project-document-unavailable" });
      return { graphs: results.map(result => result.graph), inventory: results.flatMap(result => result.inventory), gaps };
    } catch {
      return { graphs: [], inventory: [], gaps: [{ path: record.path, reason: "invalid-or-unsupported-pnpm-documents" }] };
    }
  }
  function parseJSONC(text) { load(text, true); return JSON.parse(jsonc(text)); }
  const api = Object.freeze({ readLockGraph, readLockGraphs, displayVersion, parseJSONC, parseYamlConfig: load });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.FrontendLockGraph = api;
})();
