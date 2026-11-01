(function () {
  "use strict";

  // Deliberately finite, offline advisory snapshot. Presence/version is evidence;
  // deployment, vendor backports and vulnerable data flow remain unverified.
  const CHECKED_AT = "2026-10-30";
  const SNAPSHOT_ID = "security-context-2026-10-30-v1";
  const MAX_INVENTORY = 20_000;
  const RSC = ["react-server-dom-webpack", "react-server-dom-parcel", "react-server-dom-turbopack"];
  const SOURCES = {
    node: "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
    nodeSupport: "https://nodejs.org/en/about/previous-releases",
    phpOom: "https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w",
    phpState: "https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp",
    phpSupport: "https://www.php.net/supported-versions.php",
    phpUpdate: "https://www.php.net/archive/2026.php",
    react2shell: "https://github.com/react/react/security/advisories/GHSA-fv66-9v8q-g76r",
    rscTyped: "https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3",
    nextTyped: "https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr",
    nextImage: "https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw"
  };
  const DETECTOR_IDS = Object.freeze([
    "security.node-brotli-2026", "security.php-oom-2026", "security.php-stale-state-2026",
    "security.react2shell", "security.rsc-typed-array-rce", "security.next-image-svg-rce",
    "security.runtime-eol", "security.dependency-coverage"
  ]);
  const BUILD_TOOLS = new Set(["vite", "webpack", "rollup", "esbuild", "typescript", "@swc/core", "@babel/core", "parcel"]);
  const ADVISORIES = [
    {
      id: "security.node-brotli-2026", aliases: ["CVE-2026-111497"], severity: "high",
      title: "Node.js Brotli 보안 권고와 버전이 일치함",
      sources: [SOURCES.node], fixed: "22.23.4 / 24.22.1 / 26.12.1 이상인 해당 지원 계열",
      conditions: "공격자가 제공한 Brotli 데이터를 node:zlib로 압축 해제하는 실행 경로",
      matches: (item, v) => item.ecosystem === "runtime" && item.name === "node"
        && belowBranch(v, { "22": "22.23.4", "24": "24.22.1", "26": "26.12.1" }, 1)
    },
    {
      id: "security.php-oom-2026", aliases: ["CVE-2026-109618", "GHSA-w8hw-w9fx-j79w"], severity: "critical",
      title: "PHP 요청 메모리 처리 보안 권고와 버전이 일치함",
      sources: [SOURCES.phpOom], fixed: "8.2.35 / 8.3.36 / 8.4.27 / 8.5.12 이상인 해당 지원 계열",
      conditions: "웹 요청을 처리하는 PHP SAPI와 OOM 경로. SAPI별 도달 가능성과 공급업체 백포트 확인 필요",
      matches: (item, v) => item.ecosystem === "runtime" && item.name === "php" && phpAffected(v)
    },
    {
      id: "security.php-stale-state-2026", aliases: ["CVE-2026-109619", "GHSA-6wmf-4rv5-p3rp"], severity: "critical",
      title: "PHP 요청 사이 상태 처리 보안 권고와 버전이 일치함",
      sources: [SOURCES.phpState, SOURCES.phpUpdate], fixed: "8.2.35 / 8.3.36 / 8.4.27 / 8.5.12 이상인 해당 지원 계열",
      conditions: "동일 worker의 여러 웹 요청과 초기화 전 상태 소비 경로. PHP 8.5.12 등 패치 후에도 10월 23일 session upload progress 추가 권고를 별도 확인",
      matches: (item, v) => item.ecosystem === "runtime" && item.name === "php" && phpAffected(v)
    },
    {
      id: "security.react2shell", aliases: ["CVE-2025-55182", "GHSA-fv66-9v8q-g76r"], severity: "critical",
      title: "React2Shell 대상 RSC 패키지 버전이 확인됨",
      sources: [SOURCES.react2shell], fixed: "이 권고의 최초 패치는 19.0.1 / 19.1.2 / 19.2.1; 후속 권고까지 반영한 최신 패치 사용",
      conditions: "서버에서 React Server Components를 지원하는 프레임워크·번들러 사용. react 또는 react-dom만으로 영향 확정 불가",
      matches: (item, v) => item.ecosystem === "npm" && RSC.includes(item.name)
        && ["19.0.0", "19.1.0", "19.1.1", "19.2.0"].includes(v)
    },
    {
      id: "security.rsc-typed-array-rce", aliases: ["GHSA-xqc2-xf4c-x3h3", "GHSA-673q-mjm6-r5xr"], severity: "critical",
      title: "RSC typed array 보안 권고와 버전이 일치함",
      sources: [SOURCES.rscTyped, SOURCES.nextTyped], fixed: "RSC: 19.0.9 / 19.1.10 / 19.2.9 / 19.3.1; Next.js: 16.4.1 이상",
      conditions: "RSC 응답의 여러 typed array와 공격자 제어 값. Next.js는 App Router·Cache Components의 use cache 반환 경로 확인 필요",
      matches: (item, v) => item.ecosystem === "npm" && (
        (RSC.includes(item.name) && belowBranch(v, { "19.0": "19.0.9", "19.1": "19.1.10", "19.2": "19.2.9", "19.3": "19.3.1" }))
        || (item.name === "next" && compare(v, "16.0.0") >= 0 && compare(v, "16.4.0") <= 0))
    },
    {
      id: "security.next-image-svg-rce", aliases: ["CVE-2026-96889", "GHSA-2464-fhr4-w9xw"], severity: "critical",
      title: "Next.js 이미지 처리 보안 권고와 버전이 일치함",
      sources: [SOURCES.nextImage], fixed: "Next.js 15.5.28 / 16.4.1; 권고의 우회 조건은 실제 사용 sharp >=0.35.5",
      conditions: "glibc Linux에서 SVG를 사용하는 Image Optimization API와 실제 sharp 버전·선택 경로 확인 필요",
      matches: (item, v) => item.ecosystem === "npm" && item.name === "next" && (
        (compare(v, "10.0.0") >= 0 && compare(v, "15.5.27") <= 0)
        || (compare(v, "16.0.0") > 0 && compare(v, "16.4.0") <= 0))
    }
  ];

  function exactVersion(value) {
    if (typeof value !== "string") return null;
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
    return match ? match.slice(1).map(Number).join(".") : null;
  }

  function compare(a, b) {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] - right[index];
    return 0;
  }

  function belowBranch(version, fixed, parts = 2) {
    const branch = version.split(".").slice(0, parts).join(".");
    return Object.hasOwn(fixed, branch) && compare(version, fixed[branch]) < 0;
  }

  function phpAffected(version) {
    return belowBranch(version, { "8.2": "8.2.35", "8.3": "8.3.36", "8.4": "8.4.27", "8.5": "8.5.12" });
  }

  function inspectSecurityContext(inputRecords, options = {}) {
    const records = Array.isArray(inputRecords) ? inputRecords.filter((item) => item && typeof item.path === "string" && typeof item.content === "string") : [];
    const inventory = [];
    const gaps = [];
    const manifests = new Map();
    const addGap = (path, reason) => gaps.push({ path, reason });
    const add = (item) => {
      // JSON-internal package locations are untrusted, unlike filesystem paths.
      // Keep occurrence fingerprints within the review-state contract's limit.
      if (item.name.length > 214 || item.version.length > 200 || item.manifest.length + item.path.length > 1800) {
        addGap(item.manifest, "oversized-inventory-entry"); return;
      }
      if (inventory.length < MAX_INVENTORY) inventory.push(item);
      else if (!gaps.some((gap) => gap.reason === "inventory-budget")) addGap(item.manifest, "inventory-budget");
    };
    const parse = (record) => {
      try {
        const value = JSON.parse(record.content);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
        return value;
      } catch { addGap(record.path, "invalid-json"); return null; }
    };

    for (const record of records.filter((item) => /(^|\/)(package|composer)\.json$/.test(item.path))) {
      const value = parse(record);
      if (!value) continue;
      const composer = /(^|\/)composer\.json$/.test(record.path);
      const directory = record.path.replace(/[^/]+$/, "");
      manifests.set((composer ? "composer:" : "npm:") + directory, value);
      const scopes = composer ? [["require", "runtime"], ["require-dev", "development"]]
        : [["dependencies", "runtime"], ["optionalDependencies", "runtime"], ["devDependencies", "development"], ["peerDependencies", "unknown"]];
      for (const [key, phase] of scopes) {
        if (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) continue;
        for (const [name, version] of Object.entries(value[key])) {
          if (typeof version !== "string") continue;
          const runtime = composer && name === "php";
          add({ ecosystem: runtime ? "runtime" : composer ? "composer" : "npm", name,
            version, versionKind: exactVersion(version) ? "declared-exact" : "declared-range",
            manifest: record.path, path: key + "/" + name, phase: phase === "development" && BUILD_TOOLS.has(name) ? "build" : phase,
            phaseEvidence: "manifest:" + key + "; deployment not verified", direct: true, provenance: "manifest-declaration" });
        }
      }
      if (!composer && typeof value.engines?.node === "string") add({ ecosystem: "runtime", name: "node", version: value.engines.node,
        versionKind: "engine-constraint", manifest: record.path, path: "engines/node", phase: "unknown",
        phaseEvidence: "engine constraint applies to tools and/or server; no executed version", direct: true, provenance: "manifest-declaration" });
      if (composer && typeof value.config?.platform?.php === "string") add({ ecosystem: "runtime", name: "php", version: value.config.platform.php,
        versionKind: "platform-override", manifest: record.path, path: "config/platform/php", phase: "unknown",
        phaseEvidence: "Composer dependency-resolution simulation; not the running PHP version", direct: true, provenance: "manifest-declaration" });
    }

    for (const record of records) {
      if (/(^|\/)(package-lock|npm-shrinkwrap)\.json$/.test(record.path)) {
        const value = parse(record);
        if (!value) continue;
        const directory = record.path.replace(/[^/]+$/, "");
        if (![2, 3].includes(value.lockfileVersion) || !value.packages || typeof value.packages !== "object" || Array.isArray(value.packages)) {
          addGap(record.path, "unsupported-npm-lock-format"); continue;
        }
        const manifest = manifests.get("npm:" + directory) || value.packages[""] || {};
        for (const [location, item] of Object.entries(value.packages)) {
          if (!location || !item || typeof item !== "object" || item.link) continue;
          const pathName = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(location)?.[1];
          if (!pathName) continue;
          const name = typeof item.name === "string" ? item.name : pathName;
          if (!validNpmName(pathName) || !validNpmName(name) || location.startsWith("/") || location.includes("\\")
            || location.split("/").some((part) => !part || part === "." || part === "..")) {
            addGap(record.path, "malformed-npm-lock-entry"); continue;
          }
          const declared = ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"].some((key) => Object.hasOwn(manifest[key] || {}, pathName));
          const direct = location === "node_modules/" + pathName && declared;
          const scope = item.dev === true ? "development" : "runtime";
          add({ ecosystem: "npm", name, version: typeof item.version === "string" ? item.version : "unknown",
            versionKind: exactVersion(item.version) ? "locked-exact" : "unresolved-lock-version",
            manifest: record.path, path: location, phase: scope === "development" && BUILD_TOOLS.has(name) ? "build" : scope,
            phaseEvidence: "npm lock dev flag; package install/deployment and runtime reachability not verified", direct,
            provenance: "lockfile" });
        }
      } else if (/(^|\/)composer\.lock$/.test(record.path)) {
        const value = parse(record);
        if (!value) continue;
        if (!Array.isArray(value.packages) || (value["packages-dev"] != null && !Array.isArray(value["packages-dev"]))) {
          addGap(record.path, "unsupported-composer-lock-format"); continue;
        }
        const directory = record.path.replace(/[^/]+$/, "");
        const manifest = manifests.get("composer:" + directory) || {};
        for (const key of ["packages", "packages-dev"]) for (const item of value[key] || []) {
          if (!item || typeof item.name !== "string") continue;
          add({ ecosystem: "composer", name: item.name, version: typeof item.version === "string" ? item.version : "unknown",
            versionKind: exactVersion(item.version) ? "locked-exact" : "unresolved-lock-version", manifest: record.path,
            path: key + "/" + item.name, phase: key === "packages-dev" ? "development" : "runtime",
            phaseEvidence: "Composer lock package group; production installation not verified",
            direct: Object.hasOwn(manifest.require || {}, item.name) || Object.hasOwn(manifest["require-dev"] || {}, item.name), provenance: "lockfile" });
        }
      } else if (/(^|\/)(?:\.nvmrc|\.node-version|\.php-version)$/.test(record.path)) {
        const version = record.content.trim();
        add({ ecosystem: "runtime", name: record.path.endsWith(".php-version") ? "php" : "node", version,
          versionKind: exactVersion(version) ? "runtime-pin" : "runtime-selector", manifest: record.path, path: "version",
          phase: "unknown", phaseEvidence: "version-manager configuration; build/server usage and execution not verified", direct: true, provenance: "version-file" });
      } else if (/(^|\/)Dockerfile(?:\.[^/]+)?$/.test(record.path)) {
        readDockerfile(record, add, addGap);
      } else if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(record.path)) {
        // Literal setup-node values only. Expressions/matrices/YAML aliases are deliberately unresolved.
        if (/uses:\s*actions\/setup-node@/.test(record.content)) {
          const fields = [...record.content.matchAll(/^[\t ]*(node-version|node-version-file):[\t ]*([^\r\n]*)/gm)];
          if (!fields.length) addGap(record.path, "ci-node-version-unavailable");
          for (const field of fields) {
            const literal = /^(?:"([\dv.]+)"|'([\dv.]+)'|([\dv.]+))\s*(?:#.*)?$/.exec(field[2]);
            if (field[1] !== "node-version" || !literal) {
              addGap(record.path, "unresolved-ci-node-version");
              continue;
            }
            const version = literal[1] || literal[2] || literal[3];
            add({ ecosystem: "runtime", name: "node", version, versionKind: exactVersion(version) ? "runtime-pin" : "runtime-selector",
              manifest: record.path, path: "node-version@" + (record.content.slice(0, field.index).split("\n").length), phase: "build",
              phaseEvidence: "literal CI setup-node configuration; not production runtime", direct: true, provenance: "ci-configuration" });
          }
        }
      } else if (/(^|\/)(?:yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Gemfile\.lock)$/.test(record.path)) {
        addGap(record.path, "unsupported-lock-format");
      }
    }

    // Manifest declarations are retained, but a matching lock entry is the version
    // evidence used for matching. No range solving or registry access occurs here.
    const matchable = inventory.filter((item) => ["locked-exact", "runtime-pin", "image-pin"].includes(item.versionKind));
    const findings = [];
    const matched = new Set();
    for (const advisory of ADVISORIES) {
      const occurrences = matchable.filter((item) => advisory.matches(item, exactVersion(item.version)));
      if (!occurrences.length) continue;
      occurrences.forEach((item) => matched.add(item));
      findings.push(advisoryFinding(advisory, occurrences));
    }
    const eol = inventory.filter((item) => runtimeEol(item));
    if (eol.length) findings.push(makeFinding({ id: "security.runtime-eol", severity: "medium", title: "지원 종료된 런타임 계열이 설정에 남아 있음",
      occurrences: eol, sources: [SOURCES.nodeSupport, SOURCES.phpSupport],
      observedFact: listVersions(eol), whyRisky: "지원 종료 계열은 프로젝트의 정기 보안 수정을 받지 못합니다.",
      possibleImpact: "미수정 취약점이나 지원 도구와의 호환성 문제에 노출될 수 있습니다.",
      riskFactors: "해당 설정으로 실제 빌드·서버가 실행되고 별도 공급업체 지원도 없는 경우",
      recommendation: "실행 환경을 확인하고 지원 계열로 이동합니다. 배포업체 백포트 여부와 지원 계약을 별도로 확인합니다." }));

    const lockKey = (item) => item.ecosystem + ":" + item.manifest.replace(/[^/]+$/, "") + ":" + item.name;
    const lockedNames = new Set(inventory.filter((item) => item.provenance === "lockfile" && item.versionKind === "locked-exact").map(lockKey));
    const hasLockEvidence = (item) => lockedNames.has(lockKey(item));
    const unresolved = inventory.filter((item) => {
      if (item.provenance === "manifest-declaration" && item.ecosystem !== "runtime" && hasLockEvidence(item)) return false;
      return !exactVersion(item.version) || ["engine-constraint", "platform-override"].includes(item.versionKind);
    });
    for (const item of inventory.filter((entry) => entry.provenance === "manifest-declaration" && entry.ecosystem !== "runtime")) {
      if (!hasLockEvidence(item)) {
        addGap(item.manifest, "dependency-without-supported-lock-entry");
      }
    }
    const phpSources = records.filter((item) => /\.php$/i.test(item.path));
    const hasPhpVersion = matchable.some((item) => item.ecosystem === "runtime" && item.name === "php");
    if (phpSources.length && !hasPhpVersion) addGap(phpSources[0].path, "php-runtime-version-unavailable");
    const hasPhpContext = phpSources.length > 0 || inventory.some((item) => item.ecosystem === "runtime" && item.name === "php");
    const now = options.now == null ? Date.now() : new Date(options.now).getTime();
    // checkedAt is the review's Korean calendar date, not a UTC midnight.
    const ageDays = Math.floor((now - Date.parse(CHECKED_AT + "T00:00:00+09:00")) / 86_400_000);
    const freshness = !Number.isFinite(ageDays) || ageDays < 0 ? "unverified-clock" : ageDays > 30 ? "stale" : "within-30-days";
    const dedupedGaps = [...new Map(gaps.map((gap) => [gap.path + ":" + gap.reason, gap])).values()];
    if (inventory.length && (dedupedGaps.length || unresolved.length || freshness !== "within-30-days")) {
      const evidencePaths = [...new Set([...dedupedGaps.map((item) => item.path), ...unresolved.map((item) => item.manifest)])];
      findings.push(makeFinding({ id: "security.dependency-coverage", severity: "low", title: "보안 버전 점검에 미확인 범위가 있음",
        evidencePaths, evidenceLevel: "unknown", decision: "information-gap", sources: [],
        observedFact: "해석하지 못한 범위 " + dedupedGaps.length + "개; 미확정 버전·제약 " + unresolved.length + "개; 스냅샷 " + CHECKED_AT + " (" + freshness + ")",
        whyRisky: "버전 범위, 지원하지 않는 lock 형식과 오래된 권고 목록은 현재 설치·배포된 모듈의 보안 상태를 확정하지 못합니다.",
        possibleImpact: "확인되지 않은 의존성이나 런타임을 안전한 것으로 오해할 수 있습니다.",
        riskFactors: "고정 버전·실제 설치 내역·최신 외부 권고 비교가 없는 경우",
        recommendation: "지원 lockfile과 실행 버전, 최신 npm/Composer 감사 또는 SBOM 결과를 별도로 확보합니다. 이 분석기는 해당 명령을 자동 실행하지 않습니다." }));
    } else if (!inventory.length && dedupedGaps.length) {
      findings.push(makeFinding({ id: "security.dependency-coverage", severity: "low", title: "보안 점검에 필요한 버전 근거가 없음",
        evidencePaths: dedupedGaps.map((item) => item.path), evidenceLevel: "unknown", decision: "information-gap", sources: [],
        observedFact: dedupedGaps.map((item) => item.reason).join(", "), whyRisky: "선택한 파일만으로 비교 가능한 의존성·실행 버전을 확보하지 못했습니다.",
        possibleImpact: "보안 점검 누락", riskFactors: "런타임 버전 정보 부재, 지원하지 않는 형식 또는 잘못된 JSON", recommendation: "실행 버전과 유효한 지원 lockfile 또는 별도 감사 결과를 확보합니다." }));
    }
    return {
      schemaVersion: "1", snapshot: { id: SNAPSHOT_ID, checkedAt: CHECKED_AT, timeZone: "Asia/Seoul", freshness, advisoryCount: ADVISORIES.length, sources: Object.values(SOURCES), liveLookup: false },
      inventory, findings, coverage: { complete: false, inventoryCount: inventory.length, exactVersionCount: matchable.length,
        advisoryMatchedOccurrences: matched.size, unresolvedVersionCount: unresolved.length, gaps: dedupedGaps,
        limitations: ["Finite advisory snapshot, not a universal or live CVE database", "No installed package, deployed image, SAPI, OS, vendor backport or vulnerable data-flow verification", "npm lock v2/v3 and Composer lock only; yarn/pnpm/bun and OS packages require external tools", "Build/development phase can still expose CI credentials, artifacts and developer machines",
          ...(hasPhpContext ? ["PHP: 2026-10-23 session upload progress configuration advisory and 2026-10-26 Windows Brotli package rebuild (-1) are not auto-matched by the runtime number; verify applicable settings, OS and package revision: " + SOURCES.phpUpdate] : [])] }
    };
  }

  function readDockerfile(record, add, addGap) {
    const stages = [];
    for (const match of record.content.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*(?:#.*)?$/gmi)) {
      stages.push({ image: match[1], alias: match[2]?.toLowerCase(), line: record.content.slice(0, match.index).split("\n").length });
    }
    if (!stages.length) { addGap(record.path, "unresolved-docker-stages"); return; }
    const runtimeAncestors = new Set([stages.length - 1]);
    let index = stages.length - 1;
    while (index >= 0) {
      const parent = stages.slice(0, index).findIndex((stage) => stage.alias === stages[index].image.toLowerCase());
      if (parent < 0) break;
      runtimeAncestors.add(parent); index = parent;
    }
    stages.forEach((stage, stageIndex) => {
      const image = /^(?:docker\.io\/)?(?:library\/)?(node|php)(?::([^@]+))?(?:@sha256:[a-f\d]+)?$/i.exec(stage.image);
      if (!image) {
        if (/\$/.test(stage.image)) addGap(record.path, "unresolved-docker-image-variable");
        return;
      }
      const tag = image[2] || "unversioned-image";
      const version = /^v?(\d+\.\d+\.\d+)(?:-[A-Za-z][\w.-]*)?$/.exec(tag)?.[1] || tag;
      add({ ecosystem: "runtime", name: image[1].toLowerCase(), version,
        versionKind: exactVersion(version) ? "image-pin" : "image-selector", manifest: record.path,
        path: "FROM@" + stage.line + (stage.alias ? ":" + stage.alias : ""), phase: runtimeAncestors.has(stageIndex) ? "runtime" : "build",
        phaseEvidence: runtimeAncestors.has(stageIndex) ? "default final Docker stage or its FROM ancestor; custom --target not assessed"
          : "non-final Docker stage; may be used during build; custom --target not assessed", direct: true, provenance: "container-configuration" });
    });
  }

  function validNpmName(name) {
    return name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
  }

  function runtimeEol(item) {
    if (item.ecosystem !== "runtime" || ["declared-range", "engine-constraint", "platform-override"].includes(item.versionKind)) return false;
    const branch = /^v?(\d+)(?:\.(\d+))?(?:\.|$|-)/.exec(item.version);
    if (!branch) return false;
    const major = Number(branch[1]);
    if (item.name === "node") return major <= 26 && ![22, 24, 26].includes(major);
    return item.name === "php" && (major < 8 || (major === 8 && branch[2] != null && Number(branch[2]) < 2));
  }

  function listVersions(occurrences) {
    return occurrences.map((item) => item.name + "@" + item.version + " [" + item.phase + "; " + item.versionKind + "; " + item.manifest + ":" + item.path + "]").join("; ");
  }

  function advisoryFinding(advisory, occurrences) {
    return makeFinding({ ...advisory, occurrences,
      observedFact: advisory.aliases.join(" / ") + ": " + listVersions(occurrences),
      whyRisky: "명시된 버전 정보가 공개 보안 권고의 대상 범위와 일치합니다.",
      possibleImpact: advisory.severity === "critical" ? "실행 조건이 충족되면 원격 코드 실행 등 심각한 서버 영향 가능성" : "공격자 제어 Brotli 입력을 해석하면 메모리 손상·정보 노출·코드 실행 가능성",
      riskFactors: advisory.conditions,
      recommendation: "공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. " + advisory.fixed });
  }

  function makeFinding(value) {
    const allEvidence = [...new Set(value.evidencePaths || value.occurrences?.map((item) => item.manifest) || [])];
    return { id: value.id, severity: value.severity, area: "security", type: value.evidenceLevel === "unknown" ? "gap" : "risk",
      evidenceLevel: value.evidenceLevel || "inferred", title: value.title,
      clusterId: value.id, clusterTitle: value.title, decision: value.decision || "verify-first",
      securityOccurrences: value.occurrences || [], advisoryIds: value.aliases || [],
      evidence: allEvidence.slice(0, 5), allEvidence, occurrenceCount: value.occurrences?.length || allEvidence.length || 1,
      observedFact: value.observedFact, whyRisky: value.whyRisky, possibleImpact: value.possibleImpact,
      riskFactors: value.riskFactors, mitigatingControls: "미배포·빌드 전용 경로, 공급업체 백포트, 해당 API 비사용 여부를 별도로 검증해야 합니다. 개발 도구도 비밀정보와 산출물에 접근할 수 있습니다.",
      verification: "버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.",
      recommendation: value.recommendation,
      limitation: "오프라인 권고 스냅샷 " + CHECKED_AT + "; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. " + (value.sources || []).join(" ") };
  }

  const api = Object.freeze({ inspectSecurityContext, DETECTOR_IDS });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof globalThis !== "undefined") globalThis.FrontendSecurityContext = api;
})();
