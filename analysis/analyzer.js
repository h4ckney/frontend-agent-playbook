const TEXT_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "md", "mdx",
  "css", "scss", "html", "yml", "yaml"
]);
const SKIPPED_SEGMENTS = [
  "/node_modules/", "/.git/", "/.next/", "/dist/", "/build/",
  "/coverage/", "/vendor/", "/generated/"
];
const GENERATED_FILE_PATTERN = /(^|\/)(?:__generated__|generated)(\/|$)|\.(?:generated|gen)\.[^.]+$/i;
const ENV_FILE_PATTERN = /(^|\/)\.env(?:\..+)?$/i;
const SOURCE_FILE_PATTERN = /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;
const MAX_FILE_SIZE = 500_000;

const evidenceLevels = {
  observed: "관찰된 사실",
  inferred: "위험 추론",
  unknown: "정보 부족",
  candidate: "삭제 후보"
};
const evidenceLimitations = {
  observed: "패턴 존재만 확인하며 실제 악용 가능성이나 런타임 영향은 확정하지 않음",
  inferred: "정적 근거에 기반한 검토 우선순위이며 결함 확정이 아님",
  unknown: "정적 분석 범위 밖의 설정, 데이터 출처 또는 런타임 확인이 필요함",
  candidate: "참조와 부작용 검증 전에는 삭제할 수 없음"
};

function isAnalyzableFile(file) {
  const path = "/" + (file.webkitRelativePath || file.path || file.name || "");
  const name = file.name || path.split("/").pop() || "";
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";

  return file.size <= MAX_FILE_SIZE
    && TEXT_EXTENSIONS.has(extension)
    && !ENV_FILE_PATTERN.test(path)
    && !GENERATED_FILE_PATTERN.test(path)
    && !SKIPPED_SEGMENTS.some((segment) => path.includes(segment));
}

function analyzeRecords(inputRecords) {
  const records = inputRecords.filter((record) => !looksGenerated(record.content));
  const paths = records.map((record) => record.path.toLowerCase());
  const source = records.filter((record) => SOURCE_FILE_PATTERN.test(record.path));
  const findings = [];
  const packageFile = records.find((record) => /(^|\/)package\.json$/i.test(record.path));
  let pkg = {};

  if (packageFile) {
    try {
      pkg = JSON.parse(packageFile.content);
    } catch {
      findings.push(finding({
        id: "rules.package-json-invalid",
        severity: "high",
        area: "rules",
        type: "risk",
        evidenceLevel: "observed",
        title: "package.json을 해석할 수 없음",
        evidence: [packageFile.path],
        recommendation: "JSON 구문을 수정한 뒤 버전 판별을 다시 실행합니다."
      }));
    }
  }

  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts || {};
  const nextVersion = dependencies.next;
  const reactVersion = dependencies.react;
  const appRouter = paths.some((path) => /(^|\/)app\//.test(path));
  const pagesRouter = paths.some((path) => /(^|\/)pages\//.test(path));
  const tests = paths.some((path) => /(__tests__\/|\.(?:test|spec)\.[jt]sx?$)/.test(path));
  const e2e = paths.some((path) => /(?:playwright|cypress|e2e)/.test(path));

  const htmlSinkMatches = source.flatMap((record) => {
    const count = countMatches(record.content, /dangerouslySetInnerHTML|\.innerHTML\s*=/g);
    return count ? [{ path: record.path, count }] : [];
  });
  const htmlSinkCount = htmlSinkMatches.reduce((sum, match) => sum + match.count, 0);
  const sanitizerPackages = ["dompurify", "isomorphic-dompurify", "sanitize-html", "xss"];
  const sanitizerDependency = sanitizerPackages.find((name) => dependencies[name]);
  const sanitizerImport = source.find((record) =>
    /(?:from\s*['"](?:dompurify|isomorphic-dompurify|sanitize-html|xss)['"]|require\s*\(\s*['"](?:dompurify|isomorphic-dompurify|sanitize-html|xss)['"]\s*\))/i.test(record.content)
  );

  if (htmlSinkCount) {
    const sanitizerEvidence = sanitizerDependency || sanitizerImport?.path;
    findings.push(finding({
      id: "security.html-sink-boundary",
      severity: "high",
      area: "security",
      type: "risk",
      evidenceLevel: "observed",
      title: sanitizerEvidence
        ? "HTML 삽입 지점 " + htmlSinkCount + "곳, sanitizer 흔적은 있으나 지점별 적용 미확인"
        : "HTML 삽입 지점 " + htmlSinkCount + "곳, sanitizer 의존성·import 미발견",
      evidence: htmlSinkMatches.map((match) => match.path),
      occurrenceCount: htmlSinkCount,
      recommendation: sanitizerEvidence
        ? "각 삽입 지점이 승인된 정제 경계를 통과하는지 확인합니다."
        : "콘텐츠 출처별 신뢰경계를 문서화하고 검증된 SafeHtml 경계에서 정제를 통일합니다."
    }));
    findings.push(finding({
      id: "security.html-trust-boundary-unknown",
      severity: "medium",
      area: "security",
      type: "gap",
      evidenceLevel: "unknown",
      title: "HTML 콘텐츠의 서버 정제와 신뢰경계는 자동 확인 불가",
      evidence: htmlSinkMatches.map((match) => match.path),
      occurrenceCount: htmlSinkCount,
      recommendation: "백엔드 정제, 제3자 콘텐츠, 사용자 입력 경계를 담당자와 런타임 검증으로 확인합니다."
    }));
  }

  addPatternFinding(findings, source, {
    id: "security.browser-auth-storage",
    pattern: /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(\s*['"`](?:token|access[_-]?token|refresh[_-]?token|auth|session)/i,
    severity: "critical",
    area: "security",
    type: "risk",
    evidenceLevel: "inferred",
    title: "민감한 인증 정보로 보이는 브라우저 저장소 키 사용",
    recommendation: "실제 저장값과 위협 모델을 확인하고 서버 관리 세션 또는 더 제한적인 보관 방식으로 전환합니다."
  });

  addPatternFinding(findings, source, {
    id: "security.postmessage-wildcard-origin",
    pattern: /postMessage\s*\([^,]+,\s*['"`]\*['"`]/,
    severity: "high",
    area: "security",
    type: "risk",
    evidenceLevel: "observed",
    title: "postMessage 대상 origin이 와일드카드",
    recommendation: "허용 origin을 명시하고 수신 측에서도 origin과 메시지 형태를 검증합니다."
  });

  if (nextVersion && appRouter && pagesRouter) {
    findings.push(finding({
      id: "rules.mixed-next-router",
      severity: "medium",
      area: "rules",
      type: "risk",
      evidenceLevel: "observed",
      title: "App Router와 Pages Router가 함께 사용됨",
      evidence: ["app/", "pages/"],
      recommendation: "라우트 트리별 Next.js 규칙과 마이그레이션 경계를 기록합니다."
    }));
  }

  if (reactVersion && /^\D*(?:16|17)\./.test(reactVersion)) {
    findings.push(finding({
      id: "rules.pre-react-18-version-branch",
      severity: "medium",
      area: "rules",
      type: "risk",
      evidenceLevel: "observed",
      title: "React 버전에 맞춘 규칙 분기 필요",
      evidence: ["package.json"],
      recommendation: "RSC 이전 렌더링 모델에 맞는 규칙을 적용하고 업그레이드는 별도로 판단합니다."
    }));
  }

  if (!tests && !scripts.test) {
    findings.push(finding({
      id: "testing.test-foundation-missing",
      severity: "high",
      area: "testing",
      type: "gap",
      evidenceLevel: "inferred",
      title: "테스트 기반을 찾지 못함",
      evidence: ["test script 및 test/spec 파일 미발견"],
      recommendation: "변경 위험이 큰 순수 로직이나 상태 전이부터 좁은 회귀 테스트를 추가합니다."
    }));
  }

  if (!e2e) {
    findings.push(finding({
      id: "testing.e2e-path-missing",
      severity: "medium",
      area: "testing",
      type: "gap",
      evidenceLevel: "inferred",
      title: "E2E 테스트 도구 또는 경로를 찾지 못함",
      evidence: ["Playwright, Cypress, e2e 경로 미발견"],
      recommendation: "고위험 사용자 여정이 존재하는지 확인한 뒤 우선순위가 높은 하나부터 추가합니다."
    }));
  }

  if (nextVersion) {
    const metadata = records.some((record) => /(?:metadata\s*=|generateMetadata|<Head|next\/head)/.test(record.content));
    const sitemap = paths.some((path) => /(^|\/)sitemap\.(?:xml|js|ts)$/.test(path));
    const robots = paths.some((path) => /(^|\/)robots\.(?:txt|js|ts)$/.test(path));
    if (!metadata) findings.push(missingConfig("seo.next-metadata-missing", "high", "Next.js 메타데이터 구성을 찾지 못함", "인덱싱 대상 페이지의 title, description, canonical을 렌더링 결과로 확인합니다."));
    if (!sitemap) findings.push(missingConfig("seo.sitemap-missing", "medium", "sitemap 구성을 찾지 못함", "공개 인덱싱 URL이 있다면 해당 URL만 포함하는 sitemap을 제공합니다."));
    if (!robots) findings.push(missingConfig("seo.robots-missing", "low", "robots 구성을 찾지 못함", "프로덕션과 프리뷰 환경의 크롤링 의도를 분리해 명시합니다."));
  }

  const deadCandidates = records.filter((record) => /TODO:?\s*(?:remove|delete)|@deprecated/i.test(record.content));
  if (deadCandidates.length) {
    findings.push(finding({
      id: "dead-code.marked-removal-candidate",
      severity: "low",
      area: "dead-code",
      type: "risk",
      evidenceLevel: "candidate",
      title: "삭제 가능성이 표시된 코드 후보 " + deadCandidates.length + "개 파일",
      evidence: deadCandidates.map((record) => record.path),
      occurrenceCount: deadCandidates.length,
      recommendation: "참조, 동적 import, 공개 export와 부작용을 확인합니다. 이 결과는 삭제 승인이 아닙니다."
    }));
  }

  const consoleOnly = source.filter((record) => /catch\s*\([^)]*\)\s*\{[^}]*console\.(?:log|error)/s.test(record.content));
  if (consoleOnly.length) {
    findings.push(finding({
      id: "observability.console-only-catch",
      severity: "medium",
      area: "observability",
      type: "gap",
      evidenceLevel: "inferred",
      title: "오류 처리가 console 출력에 머무를 가능성",
      evidence: consoleOnly.map((record) => record.path),
      recommendation: "기존 로거와 오류 경계를 확인하고 사용자 복구 상태와 진단 정보를 함께 설계합니다."
    }));
  }

  if (!packageFile) {
    findings.push(finding({
      id: "rules.framework-version-unknown",
      severity: "low",
      area: "rules",
      type: "gap",
      evidenceLevel: "unknown",
      title: "프레임워크 버전을 자동 판별할 정보 부족",
      evidence: ["package.json 미발견"],
      recommendation: "모노레포 하위 패키지를 직접 선택하거나 보고서에 런타임 버전을 명시합니다."
    }));
  }

  return findings;
}

function createAuditResult(name, findings, fileCount, meta) {
  const findingIds = findings.map((finding) => finding.id);
  if (new Set(findingIds).size !== findingIds.length) {
    throw new Error("audit findings require unique stable IDs");
  }

  const summary = Object.keys(evidenceLevels).reduce((counts, level) => {
    counts[level] = findings.filter((finding) => finding.evidenceLevel === level).length;
    return counts;
  }, {});
  const areas = ["rules", "testing", "seo", "security", "dead-code", "observability"];
  const areaCounts = areas.map((area) => ({
    area,
    count: findings.filter((finding) => finding.area === area).length
  }));
  return { name, findings, fileCount, meta, summary, areaCounts };
}

function selectUrgentFindings(findings, type = "all") {
  const order = ["critical", "high"];
  return findings
    .filter((finding) => finding.evidenceLevel !== "candidate")
    .filter((finding) => order.includes(finding.severity))
    .filter((finding) => type === "all" || finding.type === type)
    .slice()
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .slice(0, 3);
}

function buildMarkdown(state) {
  const urgent = selectUrgentFindings(state.findings);
  const sections = {
    security: "Security Or Privacy Risks",
    testing: "Testing Gaps",
    seo: "SEO Risks",
    "dead-code": "Dead Code Candidates",
    rules: "Conflicts",
    observability: "Error Handling Or Observability Risks"
  };
  const lines = [
    "# Frontend Audit: " + state.name,
    "",
    "> This report uses static heuristics. No finding does not mean safe. Do not use it as quality assurance, security certification, or deployment approval.",
    "",
    "- Files inspected: " + state.fileCount,
    "- Evidence model: observed fact, risk inference, information gap, removal candidate",
    "- Evidence counts: " + Object.keys(evidenceLevels)
      .map((level) => evidenceLevels[level] + " " + state.summary[level])
      .join(", "),
    "- Privacy: source contents and environment values are not included",
    "",
    "## Urgent Recommendations",
    ""
  ];

  if (!urgent.length) lines.push("No urgent recommendation was detected. Manual review remains required.", "");
  urgent.forEach((finding, index) => {
    lines.push(
      (index + 1) + ". **[" + finding.severity.toUpperCase() + "] " + finding.title + "**",
      "   - Finding ID: `" + finding.id + "`",
      "   - Evidence level: " + evidenceLevels[finding.evidenceLevel],
      "   - Evidence: " + safeEvidence(finding),
      "   - Change: " + finding.recommendation,
      ""
    );
  });

  for (const [area, heading] of Object.entries(sections)) {
    const rows = state.findings.filter((finding) => finding.area === area);
    lines.push("## " + heading, "");
    if (!rows.length) lines.push("No automated finding. Manual review remains required.", "");
    rows.forEach((finding) => {
      lines.push(
        "- **[" + finding.severity.toUpperCase() + "] " + finding.title + "**",
        "  - Finding ID: `" + finding.id + "`",
        "  - Evidence level: " + evidenceLevels[finding.evidenceLevel],
        "  - Evidence: " + safeEvidence(finding),
        "  - Limitation: " + finding.limitation,
        "  - Recommendation: " + finding.recommendation,
        ""
      );
    });
  }

  lines.push(
    "## Audit Handoff",
    "",
    "Use the stable finding IDs below as `Source finding IDs` in guidance proposals and Issue drafts. A finding ID is traceability, not write or publication approval.",
    "",
    "| Finding ID | Area | Severity | Evidence level | Evidence paths | Limitation |",
    "| --- | --- | --- | --- | --- | --- |"
  );
  state.findings.forEach((finding) => {
    lines.push("| `" + finding.id + "` | " + safeMarkdownCell(finding.area) + " | " + safeMarkdownCell(finding.severity) + " | "
      + safeMarkdownCell(evidenceLevels[finding.evidenceLevel]) + " | " + safeMarkdownCell(safeEvidence(finding)) + " | "
      + safeMarkdownCell(finding.limitation) + " |");
  });
  lines.push(
    "",
    "## Verification Notes",
    "",
    "- Confirm findings against runtime behavior and version-matched official documentation.",
    "- Treat dead-code results as candidates, not deletion authorization.",
    "- Run typecheck, lint, tests, build, and critical user journeys after changes.",
    ""
  );
  return lines.join("\n");
}

function finding(value) {
  if (!value.id || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value.id)) {
    throw new Error("finding requires a stable lowercase ID");
  }
  return {
    occurrenceCount: value.occurrenceCount || value.evidence.length,
    limitation: evidenceLimitations[value.evidenceLevel],
    ...value,
    evidence: [...new Set(value.evidence)].slice(0, 5)
  };
}

function missingConfig(id, severity, title, recommendation) {
  return finding({
    id,
    severity,
    area: "seo",
    type: "gap",
    evidenceLevel: "inferred",
    title,
    evidence: ["관련 파일 또는 설정 패턴 미발견"],
    recommendation
  });
}

function addPatternFinding(findings, records, config) {
  const matches = records.filter((record) => config.pattern.test(record.content));
  if (!matches.length) return;
  findings.push(finding({
    ...config,
    evidence: matches.map((record) => record.path),
    occurrenceCount: matches.length
  }));
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function looksGenerated(content) {
  return /(?:@generated|generated file|do not edit)/i.test(content.split("\n").slice(0, 5).join("\n"));
}

function safeEvidence(finding) {
  const suffix = finding.occurrenceCount > finding.evidence.length
    ? " 외 " + (finding.occurrenceCount - finding.evidence.length) + "건"
    : "";
  return finding.evidence.join(", ") + suffix;
}

function safeMarkdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

const analyzerApi = {
  analyzeRecords,
  buildMarkdown,
  createAuditResult,
  evidenceLevels,
  isAnalyzableFile,
  selectUrgentFindings
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = analyzerApi;
}
if (typeof globalThis !== "undefined") {
  globalThis.FrontendAnalyzer = analyzerApi;
}
