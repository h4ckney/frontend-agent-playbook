(function () {
  "use strict";
  const parser = typeof module !== "undefined" && module.exports ? require("./lockfile-graph.js") : globalThis.FrontendLockGraph;
  const resolution = typeof module !== "undefined" && module.exports ? require("./deno-resolution.js") : globalThis.FrontendDenoResolution;
  const CHECKED_AT = "2026-11-02";
  const SOURCES = Object.freeze({
    node: "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json",
    php: "https://www.php.net/supported-versions.php",
    phpEol: "https://www.php.net/eol.php",
    deno: "https://deno.com/blog/cloudflare",
    denoChannels: "https://docs.deno.com/runtime/fundamentals/stability_and_releases/",
    classic: "https://docs.deno.com/deploy/",
    deployctl: "https://github.com/denoland/deployctl/blob/main/README.md",
    bun: "https://github.com/oven-sh/bun/blob/main/SECURITY.md"
  });
  const NODE = {"v0.8":{"start":"2012-06-25","end":"2014-07-31"},"v0.10":{"start":"2013-03-11","end":"2016-10-31"},"v0.12":{"start":"2015-02-06","end":"2016-12-31"},"v4":{"start":"2015-09-08","lts":"2015-10-12","maintenance":"2017-04-01","end":"2018-04-30","codename":"Argon"},"v5":{"start":"2015-10-29","maintenance":"2016-04-30","end":"2016-06-30"},"v6":{"start":"2016-04-26","lts":"2016-10-18","maintenance":"2018-04-30","end":"2019-04-30","codename":"Boron"},"v7":{"start":"2016-10-25","maintenance":"2017-04-30","end":"2017-06-30"},"v8":{"start":"2017-05-30","lts":"2017-10-31","maintenance":"2019-01-01","end":"2019-12-31","codename":"Carbon"},"v9":{"start":"2017-10-01","maintenance":"2018-04-01","end":"2018-06-30"},"v10":{"start":"2018-04-24","lts":"2018-10-30","maintenance":"2020-05-19","end":"2021-04-30","codename":"Dubnium"},"v11":{"start":"2018-10-23","maintenance":"2019-04-22","end":"2019-06-01"},"v12":{"start":"2019-04-23","lts":"2019-10-21","maintenance":"2020-11-30","end":"2022-04-30","codename":"Erbium"},"v13":{"start":"2019-10-22","maintenance":"2020-04-01","end":"2020-06-01"},"v14":{"start":"2020-04-21","lts":"2020-10-27","maintenance":"2021-10-19","end":"2023-04-30","codename":"Fermium"},"v15":{"start":"2020-10-20","maintenance":"2021-04-01","end":"2021-06-01"},"v16":{"start":"2021-04-20","lts":"2021-10-26","maintenance":"2022-10-18","end":"2023-09-11","codename":"Gallium"},"v17":{"start":"2021-10-19","maintenance":"2022-04-01","end":"2022-06-01"},"v18":{"start":"2022-04-19","lts":"2022-10-25","maintenance":"2023-10-18","end":"2025-04-30","codename":"Hydrogen"},"v19":{"start":"2022-10-18","maintenance":"2023-04-01","end":"2023-06-01"},"v20":{"start":"2023-04-18","lts":"2023-10-24","maintenance":"2024-10-22","end":"2026-04-30","codename":"Iron"},"v21":{"start":"2023-10-17","maintenance":"2024-04-01","end":"2024-06-01"},"v22":{"start":"2024-04-24","lts":"2024-10-29","maintenance":"2025-10-21","end":"2027-04-30","codename":"Jod"},"v23":{"start":"2024-10-16","maintenance":"2025-04-01","end":"2025-06-01"},"v24":{"start":"2025-05-06","lts":"2025-10-28","maintenance":"2026-10-20","end":"2028-04-30","codename":"Krypton"},"v25":{"start":"2025-10-15","maintenance":"2026-04-01","end":"2026-06-01"},"v26":{"start":"2026-05-05","lts":"2026-10-28","maintenance":"2027-10-20","end":"2029-04-30","codename":"Lithium"},"v27":{"alpha":"2026-10-28","start":"2027-04-22","lts":"2027-10-20","end":"2030-04-30","codename":""}};
  const PHP = {
    "3.0": { end: "2000-10-20" }, "4.0": { end: "2001-06-23" }, "4.1": { end: "2002-03-12" },
    "4.2": { end: "2002-09-06" }, "4.3": { end: "2005-03-31" }, "4.4": { end: "2008-08-07" },
    "5.0": { end: "2005-09-05" }, "5.1": { end: "2006-08-24" }, "5.2": { end: "2011-01-06" },
    "5.3": { end: "2014-08-14" }, "5.4": { end: "2015-09-03" }, "5.5": { end: "2016-07-21" },
    "5.6": { end: "2018-12-31" }, "7.0": { end: "2019-01-10" }, "7.1": { end: "2019-12-01" },
    "7.2": { end: "2020-11-30" }, "7.3": { end: "2021-12-06" }, "7.4": { end: "2022-11-28" },
    "8.0": { end: "2023-11-26" }, "8.1": { end: "2025-12-31" },
    "8.2": { start: "2022-12-08", maintenance: "2024-12-31", end: "2026-12-31" },
    "8.3": { start: "2023-11-23", maintenance: "2025-12-31", end: "2027-12-31" },
    "8.4": { start: "2024-11-21", maintenance: "2026-12-31", end: "2028-12-31" },
    "8.5": { start: "2025-11-20", maintenance: "2027-12-31", end: "2029-12-31" }
  };
  const DENO_LTS = [{line:"2.1", start:"2025-02-01", end:"2025-04-30"}, {line:"2.2", start:"2025-05-01", end:"2025-10-31"}, {line:"2.5", start:"2025-11-01", end:"2026-04-30"}, {line:"2.9", start:"2026-07-01", end:"2027-01-31"}];
  const COMPONENTS = Object.freeze({ node: "Node.js", php: "PHP", bun: "Bun", "deno-runtime": "Deno Runtime",
    "deno-deploy": "Deno Deploy", "deno-deploy-classic": "Deno Deploy Classic", jsr: "JSR", "deno-lts": "Deno LTS" });
  const STATES = Object.freeze({ supported: "지원 중", maintenance: "유지보수 지원", "security-only": "보안 수정 지원",
    "end-announced": "종료 예정 공지", ended: "공식 일정상 지원 종료", continuing: "계속 운영 공지",
    unknown: "지원 상태 미확인", "not-released": "정식 출시 예정" });
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const entries = value => object(value) ? Object.entries(value) : [];
  const SETUPS = { "actions/setup-node": "node", "denoland/setup-deno": "deno", "oven-sh/setup-bun": "bun" };
  const runtimeName = name => name === "deno" ? "deno-runtime" : name;
  const versionKind = version => /^v?\d+\.\d+\.\d+$/.test(version) && version.replace(/^v/, "").split(".").every(part => Number.isSafeInteger(Number(part))) ? "runtime-pin" : "runtime-selector";
  function commandSegments(text) {
    const result = [];
    let start = 0, quote = "", escaped = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ""; continue; }
      if (["'", '"', "`"].includes(char)) { quote = char; continue; }
      if (char === "#" && (index === start || /\s/.test(text[index - 1]))) {
        result.push(text.slice(start, index).trim());
        while (index < text.length && text[index] !== "\n") index += 1;
        start = index + 1;
      } else if (/[;&|\n]/.test(char)) { result.push(text.slice(start, index).trim()); start = index + 1; }
    }
    if (!quote) result.push(text.slice(start).trim());
    return result.filter(Boolean);
  }

  function readSetupWorkflow(record) {
    const inventory = [], usage = [], gaps = [];
    const gap = reason => gaps.push({ path: record.path, reason });
    const known = /(?:actions\/setup-node|denoland\/setup-deno|oven-sh\/setup-bun|denoland\/deployctl)@/.test(record.content);
    if (!known) return { inventory, usage, gaps };
    let data;
    try { data = parser.parseYamlConfig(record.content);
      if (!object(data)) throw new Error("workflow root must be an object"); }
    catch {
      for (const [action, runtime] of Object.entries(SETUPS)) if (record.content.includes(action + "@")) gap("unresolved-ci-" + runtime + "-version");
      if (record.content.includes("denoland/deployctl@")) gap("unresolved-ci-deploy-configuration");
      return { inventory, usage, gaps };
    }
    const jobs = Array.isArray(data.steps) ? [["root", data]] : entries(data.jobs);
    for (const [job, config] of jobs) {
      if (!Array.isArray(config?.steps)) continue;
      config.steps.forEach((step, index) => {
        if (!object(step) || typeof step.uses !== "string") return;
        const action = /^(actions\/setup-node|denoland\/setup-deno|oven-sh\/setup-bun|denoland\/deployctl)@[^\s]+$/.exec(step.uses)?.[1];
        if (!action) return;
        const path = "jobs/" + job + "/steps/" + index;
        if (action === "denoland/deployctl") { usage.push({ component: "deno-deploy-classic", manifest: record.path, path, phase: "runtime", sourceKind: "ci-deployment-configuration", version: null }); return; }
        const name = SETUPS[action], field = name + "-version", value = step.with?.[field];
        if (typeof value !== "string" || !/^[a-zA-Z0-9v.*+-]+$/.test(value) || step.with?.[field + "-file"] !== undefined) {
          gap(value === undefined && step.with?.[field + "-file"] === undefined ? "ci-" + name + "-version-unavailable" : "unresolved-ci-" + name + "-version");
          usage.push({ component: runtimeName(name), manifest: record.path, path, phase: "build", sourceKind: "ci-configuration", version: null });
          return;
        }
        inventory.push({ ecosystem: "runtime", name, version: value, versionKind: versionKind(value),
          manifest: record.path, path: path + "/" + field, phase: "build", phaseEvidence: "literal CI " + action + " step; execution and production deployment not verified", direct: true, provenance: "ci-configuration" });
      });
    }
    return { inventory, usage, gaps };
  }

  function inspectLifecycle(records, inventory, options = {}) {
    const instant = options.now == null ? Date.now() : new Date(options.now).getTime();
    const local = new Date(instant + 9 * 3600000);
    const asOf = Number.isFinite(local.getTime()) && local.getUTCFullYear() >= 0 && local.getUTCFullYear() <= 9999 ? local.toISOString().slice(0, 10) : null;
    const age = asOf === null ? NaN : (Date.parse(asOf) - Date.parse(CHECKED_AT)) / 86400000;
    const freshness = !Number.isFinite(age) || age < 0 ? "unverified-clock" : age > 30 ? "stale" : "within-30-days";
    const candidates = [], gaps = [], dependencyGaps = [];
    const configContext = resolution.createContext(records);
    const add = item => {
      if (item.manifest.length + item.path.length > 1700 || candidates.length >= 20000) { gaps.push({ path: item.manifest, reason: "lifecycle-evidence-budget" }); return; }
      candidates.push(item);
    };
    for (const item of inventory) if (item.ecosystem === "runtime" && Object.hasOwn(COMPONENTS, runtimeName(item.name))) {
      add({ component: runtimeName(item.name), manifest: item.manifest, path: item.path, version: item.version,
        phase: item.phase, sourceKind: item.provenance, versionKind: item.versionKind });
      if (item.name === "deno" && item.version === "lts" && ["version-file", "ci-configuration"].includes(item.provenance)) {
        add({component:"deno-lts", manifest:item.manifest, path:item.path, version:"lts", phase:item.phase, sourceKind:item.provenance});
      }
    }
    for (const item of inventory) if (item.ecosystem === "jsr") add({component:"jsr", manifest:item.manifest, path:"registry", version:null, phase:"unknown", sourceKind:"lockfile"});
    const commandUsage = (commands, record, prefix) => {
      for (const [name, command] of entries(commands)) {
        const text = typeof command === "string" ? command : typeof command?.command === "string" ? command.command : "";
        for (const segment of commandSegments(text)) {
          if (/(?:^|\s)--(?:help|version)(?:\s|$)/.test(segment)) continue;
          if (/^deno\s+deploy(?:\s|$)/.test(segment)) add({ component: "deno-deploy", manifest: record.path, path: prefix + "/" + name, phase: "runtime", sourceKind: "deployment-command", version: null });
          if (/^(?:deployctl\s+(?:deploy|projects)(?:\s|$)|deno\s+(?:run|install)\s+[^\r\n]*jsr:@deno\/deployctl)/.test(segment)) add({ component: "deno-deploy-classic", manifest: record.path, path: prefix + "/" + name, phase: "runtime", sourceKind: "deployment-command", version: null });
        }
      }
    };
    for (const record of records) {
      if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(record.path)) {
        const workflow = readSetupWorkflow(record);
        workflow.usage.forEach(add);
        // Inventory/gaps from setup steps are collected by the security context.
        continue;
      }
      if (!/(^|\/)(?:deno\.jsonc?|jsr\.jsonc?|package\.json)$/.test(record.path)) continue;
      let data;
      try { data = parser.parseJSONC(record.content);
        if (!object(data)) throw new Error("configuration root must be an object"); }
      catch { gaps.push({ path: record.path, reason: "invalid-lifecycle-configuration" }); continue; }
      if (/(^|\/)deno\.jsonc?$/.test(record.path)) {
        // Avoid repeating a presence-only row when this package already has a
        // configured Deno pin. A sibling pin is never inherited.
        const directory = record.path.replace(/[^/]+$/, "");
        if (!candidates.some(item => item.component === "deno-runtime" && item.manifest.replace(/[^/]+$/, "") === directory && item.sourceKind !== "manifest-declaration")) {
          add({ component: "deno-runtime", manifest: record.path, path: "configuration", phase: "unknown", sourceKind: "project-configuration", version: null });
        }
        if (object(data.deploy)) add({ component: "deno-deploy", manifest: record.path, path: "deploy", phase: "runtime", sourceKind: "deployment-configuration", version: null });
        else if (data.deploy !== undefined) gaps.push({ path: record.path, reason: "invalid-deploy-configuration" });
        const hasJsr = value => typeof value === "string" && /^(?:jsr:|https:\/\/jsr\.io\/)/.test(value);
        const external = value => typeof value === "string" && /^(?:npm:|jsr:|https?:\/\/|\.\.?\/)/.test(value);
        if (Object.values(data.imports || {}).some(external) || Object.values(data.scopes || {}).some(scope => Object.values(scope || {}).some(external))) {
          dependencyGaps.push({ path: record.path, reason: "deno-dependency-lock-coverage-unavailable" });
        }
        const mapped = data.importMap !== undefined ? configContext.importMap({file:record.path,value:data}, reason=>gaps.push({path:record.path,reason})) : null;
        const registryData = mapped?.value || data;
        if (Object.values(registryData.imports || {}).some(hasJsr) || Object.values(registryData.scopes || {}).some(scope => Object.values(scope || {}).some(hasJsr))) {
          add({ component: "jsr", manifest: mapped?.file || record.path, path: "imports", phase: "unknown", sourceKind: "registry-configuration", version: null });
        }
        commandUsage(data.tasks, record, "tasks");
      } else if (/(^|\/)jsr\.jsonc?$/.test(record.path)) {
        add({ component: "jsr", manifest: record.path, path: "configuration", phase: "unknown", sourceKind: "registry-configuration", version: null });
      } else {
        if (["dependencies", "devDependencies", "optionalDependencies"].some(key => Object.keys(data[key] || {}).some(name => name.startsWith("@jsr/")))) {
          add({ component: "jsr", manifest: record.path, path: "dependencies/@jsr", phase: "unknown", sourceKind: "registry-configuration", version: null });
        }
        commandUsage(data.scripts, record, "scripts");
        if (typeof data.packageManager === "string" && /^bun@/.test(data.packageManager)) add({ component: "bun", manifest: record.path, path: "packageManager", phase: "build", sourceKind: "package-manager-configuration", version: data.packageManager.slice(4), versionKind: "runtime-selector" });
      }
    }
    const rows = candidates.map(item => {
      const row = { component: item.component, category: item.component === "jsr" ? "registry" : item.component.startsWith("deno-deploy") ? "hosting" : "runtime",
        supportScope: ["node", "php", "deno-lts"].includes(item.component) ? "release-line" : item.component === "bun" ? "major-family" : "product",
        manifest: item.manifest, path: item.path, phase: item.phase, version: item.version == null ? null : parser.displayVersion(item.version),
        sourceKind: item.sourceKind, state: "unknown", supportEnds: null, datePrecision: "none", dateBasis: "not-published",
        endingSoon: false, reason: "branch-not-in-reviewed-policy", sources: [] };
      if (["engine-constraint", "platform-override", "declared-range", "declared-exact"].includes(item.versionKind)) { row.reason = "constraint-is-not-an-executed-version"; return row; }
      if (item.component === "deno-lts") {
        const policy = asOf && DENO_LTS.find(item => asOf >= item.start && asOf <= item.end);
        Object.assign(row, {sources:[SOURCES.denoChannels], reason:"explicit-lts-selector-current-line-unverified"});
        if (policy) Object.assign(row, {state:"maintenance", releaseLine:policy.line, supportEnds:policy.end, datePrecision:"day", dateBasis:"official-date", endingSoon:(Date.parse(policy.end)-Date.parse(asOf))/86400000 <= 180,
          reason:"explicit-moving-lts-selector-reviewed-line-not-installed-patch"});
      } else if (item.component === "deno-runtime" || item.component === "deno-deploy") {
        Object.assign(row, { state: "end-announced", supportEnds: item.component === "deno-runtime" ? "2027-10" : "2027-04",
          datePrecision: "month", dateBasis: "announcement-relative", endingSoon: true, reason: "official-team-announcement-not-branch-or-deployment-verification", sources: [SOURCES.deno, ...(item.component === "deno-runtime" ? [SOURCES.denoChannels] : [])] });
        if (asOf && asOf.slice(0, 7) > row.supportEnds) Object.assign(row, { state: "unknown", endingSoon: false, reason: "announced-window-elapsed-needs-current-verification" });
      } else if (item.component === "jsr") {
        Object.assign(row, { state: "continuing", reason: "continued-operation-announced-no-retirement-date", sources: [SOURCES.deno] });
      } else if (item.component === "deno-deploy-classic") {
        Object.assign(row, { state: asOf && asOf >= "2026-07-20" ? "ended" : "end-announced", supportEnds: "2026-07-20",
          datePrecision: "day", dateBasis: "official-date", reason: "classic-shutdown-date-not-new-deploy", sources: [SOURCES.classic, SOURCES.deployctl] });
        row.endingSoon = row.state === "end-announced";
      } else {
        let value = item.version;
        if (typeof value === "string" && item.versionKind === "image-selector") value = imageBranch(value);
        const numeric = typeof value === "string" && /^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(value.trim());
        if (!numeric || numeric.slice(1).filter(part => part && part !== "x" && part !== "*").some(part => !Number.isSafeInteger(Number(part)))) { row.reason = "selector-channel-or-prerelease-not-a-known-branch"; return row; }
        if (item.component === "bun") {
          Object.assign(row, { state: numeric[1] === "1" ? "supported" : "unknown", reason: "published-bun-1x-policy-no-eol-date-no-patch-safety-claim", sources: [SOURCES.bun] });
        } else {
          const branch = item.component === "node" ? "v" + numeric[1] + (numeric[1] === "0" && /^\d+$/.test(numeric[2] || "") ? "." + numeric[2] : "") : /^\d+$/.test(numeric[2] || "") ? numeric[1] + "." + numeric[2] : null;
          const policy = branch && (item.component === "node" ? NODE[branch] : PHP[branch]);
          row.sources = item.component === "node" ? [SOURCES.node] : [SOURCES.php, SOURCES.phpEol];
          if (policy) {
            Object.assign(row, { state: policy.start && asOf && asOf < policy.start ? "not-released" : asOf && asOf > policy.end ? "ended"
              : policy.maintenance && asOf && (item.component === "php" ? asOf > policy.maintenance : asOf >= policy.maintenance) ? item.component === "php" ? "security-only" : "maintenance" : "supported",
              supportEnds: policy.end, datePrecision: "day", dateBasis: "official-date", reason: "published-release-line-calendar-not-installed-patch-or-vendor-support" });
            const remaining = asOf ? (Date.parse(policy.end) - Date.parse(asOf)) / 86400000 : NaN;
            row.endingSoon = ["supported", "maintenance", "security-only"].includes(row.state) && remaining >= 0 && remaining <= 180;
          }
        }
      }
      if (freshness === "unverified-clock") Object.assign(row, { state: "unknown", endingSoon: false, reason: "clock-before-policy-review-or-invalid" });
      return row;
    });
    const unique = [...new Map(rows.map(row => [row.component + ":" + row.manifest + "#" + row.path, row])).values()]
      .sort((a, b) => (a.component + a.manifest + a.path).localeCompare(b.component + b.manifest + b.path));
    return { schemaVersion: "1", asOf, policy: { id: "runtime-lifecycle-2026-11-02", checkedAt: CHECKED_AT, timeZone: "Asia/Seoul", freshness,
      warningWindowDays: 180, sources: Object.values(SOURCES) }, entries: unique,
      gaps: [...new Map(gaps.map(gap => [gap.path + ":" + gap.reason, gap])).values()], dependencyGaps };
  }

  function imageBranch(tag) {
    const match = /^(?:alpine-|debian-|distroless-)?(v?\d+(?:\.\d+){0,2})(?:-(?:alpine[\d.]*|bookworm(?:-slim)?|bullseye(?:-slim)?|slim|fpm(?:-alpine[\d.]*)?|cli(?:-alpine[\d.]*)?|apache|zts|debian|distroless))?$/.exec(tag);
    return match?.[1] || null;
  }
  const api = Object.freeze({ inspectLifecycle, readSetupWorkflow, imageBranch, COMPONENTS, STATES });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.FrontendRuntimeLifecycle = api;
})();

