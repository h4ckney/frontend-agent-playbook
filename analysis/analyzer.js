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
const analysisLimits = Object.freeze({
  maxFileSize: 500_000,
  maxFileCount: 4_000,
  maxTotalBytes: 25_000_000,
  readConcurrency: 8
});

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
const decisionLabels = {
  "act-now": "즉시 조치",
  "verify-first": "먼저 검증",
  observe: "관찰",
  "information-gap": "정보 부족"
};
const seoScopeLabels = {
  unknown: "미확인",
  public: "공개·검색 노출",
  mixed: "공개·내부 혼합",
  internal: "내부·비공개 전용"
};
const riskNarratives = {
  "rules.package-json-invalid": {
    clusterId: "context.package-integrity",
    clusterTitle: "프로젝트 패키지 정보 복구",
    whyRisky: "패키지 정보를 읽지 못하면 프레임워크 버전과 사용 가능한 검증 명령을 잘못 판단할 수 있습니다.",
    possibleImpact: "잘못된 버전 규칙 적용, 설치·빌드 실패 또는 감사 범위 누락으로 이어질 수 있습니다.",
    riskFactors: "실제 package.json 구문 오류이거나 이 파일이 활성 workspace package인 경우",
    mitigatingControls: "다른 유효한 workspace package가 분석 대상이고 손상된 파일이 비활성 fixture인 경우",
    verification: "해당 파일을 JSON parser와 프로젝트 package manager로 확인합니다.",
    decision: "act-now"
  },
  "security.html-sink-boundary": {
    clusterId: "security.html-rendering-boundary",
    clusterTitle: "HTML 렌더링 신뢰경계 확인",
    whyRisky: "정제되지 않은 외부 HTML이 애플리케이션 origin에서 DOM으로 해석되면 공격자 제어 마크업이 실행 문맥에 들어올 수 있습니다.",
    possibleImpact: "사용자 화면 변조, 사용자 권한으로의 요청 유도 또는 브라우저에서 접근 가능한 데이터 노출 가능성이 있습니다.",
    riskFactors: "사용자·광고·외부 CMS 입력, 서버 정제 계약 부재, CSP 또는 Trusted Types 부재",
    mitigatingControls: "고정된 신뢰 콘텐츠, 검증된 서버 정제, 단일 SafeHtml 경계, 효과적인 CSP 또는 Trusted Types",
    verification: "대표 입력 경로를 출처부터 sink까지 추적하고 악성 마크업 fixture와 응답 보안 헤더를 확인합니다.",
    decision: "verify-first"
  },
  "security.html-trust-boundary-unknown": {
    clusterId: "security.html-rendering-boundary",
    clusterTitle: "HTML 렌더링 신뢰경계 확인",
    whyRisky: "입력 출처와 서버 정제 여부를 모르면 HTML sink의 실제 노출도를 판단할 수 없습니다.",
    possibleImpact: "위험한 경로를 안전하다고 넘기거나 신뢰된 콘텐츠까지 불필요하게 긴급 수정할 수 있습니다.",
    riskFactors: "제3자·사용자 입력 여부와 backend contract가 문서화되지 않은 경우",
    mitigatingControls: "소유자가 확인한 신뢰경계와 반복 가능한 정제 검증이 있는 경우",
    verification: "콘텐츠 소유자, backend contract와 대표 runtime payload의 정제 상태를 확인합니다.",
    decision: "information-gap"
  },
  "security.browser-auth-storage": {
    clusterId: "security.browser-auth-storage",
    clusterTitle: "브라우저 인증정보 저장 경계 확인",
    whyRisky: "JavaScript가 읽을 수 있는 장기 인증정보는 같은 origin에서 실행된 악성 코드나 XSS에 노출될 수 있습니다.",
    possibleImpact: "세션 탈취, 사용자 사칭 또는 인증정보 재사용 가능성이 있습니다.",
    riskFactors: "실제 access·refresh token 저장, 긴 만료, 광범위한 script 실행 권한",
    mitigatingControls: "UI 상태용 이름만 유사한 값, 짧은 수명, 서버 관리 세션과 제한된 cookie 정책",
    verification: "저장되는 실제 값의 의미와 수명, 소비 지점, 로그아웃·계정 전환 동작을 확인합니다.",
    decision: "verify-first"
  },
  "security.postmessage-wildcard-origin": {
    clusterId: "security.cross-window-origin",
    clusterTitle: "교차 window 메시지 origin 제한",
    whyRisky: "와일드카드 대상은 의도하지 않은 window가 메시지를 받을 가능성을 넓힙니다.",
    possibleImpact: "메시지에 포함된 상태나 식별자가 다른 origin으로 전달될 수 있습니다.",
    riskFactors: "민감한 payload, opener·iframe 교체 가능성, 수신 측 origin 검증 부재",
    mitigatingControls: "비민감 broadcast와 수신 측의 엄격한 origin·schema 검증",
    verification: "발신 payload와 대상 window lifecycle을 확인하고 송수신 양쪽 origin 검증을 테스트합니다.",
    decision: "verify-first"
  },
  "rules.mixed-next-router": {
    clusterId: "context.router-model",
    clusterTitle: "혼합 Router 운영 경계 확인",
    whyRisky: "App Router와 Pages Router는 metadata, data fetching, cache와 rendering 규칙이 다릅니다.",
    possibleImpact: "한 route tree의 규칙을 다른 tree에 적용해 동작·SEO·cache 회귀를 만들 수 있습니다.",
    riskFactors: "공유 모듈이 두 tree의 server/client 가정을 섞거나 migration ownership이 없는 경우",
    mitigatingControls: "route tree별 소유권, 테스트와 명시된 migration 경계",
    verification: "변경 대상 URL을 route tree에 매핑하고 해당 tree의 build·rendering·metadata 동작을 확인합니다.",
    decision: "verify-first"
  },
  "rules.pre-react-18-version-branch": {
    clusterId: "context.react-version",
    clusterTitle: "React 버전별 규칙 분기",
    whyRisky: "새 렌더링 모델과 API를 이전 React 환경에 적용하면 지원되지 않는 동작을 전제할 수 있습니다.",
    possibleImpact: "빌드 실패, hydration 차이 또는 불필요한 마이그레이션이 발생할 수 있습니다.",
    riskFactors: "framework integration 확인 없이 RSC·concurrent API를 권고하는 경우",
    mitigatingControls: "현재 렌더링 모델을 유지하고 호환되는 규칙 subset만 선택한 경우",
    verification: "React와 renderer 버전, framework integration, 실제 root API를 확인합니다.",
    decision: "verify-first"
  },
  "testing.test-foundation-missing": {
    clusterId: "testing.regression-safety-net",
    clusterTitle: "회귀 검증 기반 확인",
    whyRisky: "자동 회귀 검증이 없으면 중요한 상태 전이나 순수 로직 변경의 실패를 반복 가능하게 탐지하기 어렵습니다.",
    possibleImpact: "변경 후 회귀가 늦게 발견되고 수동 검증 비용이 누적될 수 있습니다.",
    riskFactors: "빈번한 변경, 복잡한 상태 전이, 성숙한 CI 대비 test command 부재",
    mitigatingControls: "상위 workspace나 외부 CI에서 검증하며 선택 폴더만으로는 보이지 않는 경우",
    verification: "workspace root, CI와 실제 변경 경로의 test command 및 최근 실행 결과를 확인합니다.",
    decision: "verify-first"
  },
  "testing.e2e-path-missing": {
    clusterId: "testing.critical-journeys",
    clusterTitle: "고위험 사용자 여정 검증",
    whyRisky: "여러 경계를 통과하는 핵심 여정은 단위 테스트만으로 routing, auth, 결제 또는 제출 실패를 포착하기 어렵습니다.",
    possibleImpact: "가입·결제·제출 같은 전환 여정이 배포 후 중단될 수 있습니다.",
    riskFactors: "고위험 다단계 여정이 존재하고 대체 integration 또는 synthetic 검증도 없는 경우",
    mitigatingControls: "해당 제품에 고위험 여정이 없거나 다른 계층의 반복 가능한 전체 경로 검증이 있는 경우",
    verification: "실패 비용이 큰 사용자 여정을 나열하고 현재 자동화가 각 경계를 실제로 통과하는지 확인합니다.",
    decision: "verify-first"
  },
  "seo.next-metadata-missing": {
    clusterId: "seo.indexability-baseline",
    clusterTitle: "공개 URL의 검색 노출 계약 확인",
    whyRisky: "렌더링된 metadata를 찾지 못하면 검색 엔진과 공유 미리보기가 페이지 의도를 일관되게 해석하지 못할 수 있습니다.",
    possibleImpact: "잘못된 title·canonical, 중복 URL 또는 검색 노출 저하 가능성이 있습니다.",
    riskFactors: "공개 indexable route이며 metadata가 runtime 외부에서 주입되지 않는 경우",
    mitigatingControls: "비공개 route, upstream rendering 또는 별도 검증된 metadata 계층",
    verification: "대표 공개 URL의 최종 HTML에서 title, description, canonical과 status를 확인합니다.",
    decision: "verify-first"
  },
  "seo.sitemap-missing": {
    clusterId: "seo.indexability-baseline",
    clusterTitle: "공개 URL의 검색 노출 계약 확인",
    whyRisky: "대규모 또는 깊은 공개 URL은 sitemap 부재 시 발견과 갱신 신호가 약해질 수 있습니다.",
    possibleImpact: "일부 공개 URL의 발견 또는 갱신이 지연될 수 있습니다.",
    riskFactors: "동적·대규모 URL, 내부 링크가 약한 페이지, 잦은 URL 변경",
    mitigatingControls: "작고 강하게 연결된 사이트이거나 외부 sitemap 서비스가 있는 경우",
    verification: "공개 URL inventory와 실제 배포된 sitemap 위치·내용을 확인합니다.",
    decision: "verify-first"
  },
  "seo.robots-missing": {
    clusterId: "seo.indexability-baseline",
    clusterTitle: "공개 URL의 검색 노출 계약 확인",
    whyRisky: "환경별 crawling 의도가 명시되지 않으면 preview 또는 제한 URL이 예상과 다르게 노출될 수 있습니다.",
    possibleImpact: "불필요한 crawling, preview 노출 또는 운영 URL의 차단 가능성이 있습니다.",
    riskFactors: "preview·production host가 분리되고 별도 edge 설정이 확인되지 않은 경우",
    mitigatingControls: "플랫폼이나 edge 계층에서 검증된 robots 정책을 제공하는 경우",
    verification: "production과 preview host의 실제 robots 응답과 meta robots를 확인합니다.",
    decision: "verify-first"
  },
  "seo.indexing-intent-unknown": {
    clusterId: "seo.indexing-intent",
    clusterTitle: "검색 노출 범위 확인",
    whyRisky: "공개 URL이 있는지 모르면 metadata·sitemap 부재를 결함으로 판단할 수도, 필요한 검색 노출 검증을 누락할 수도 없습니다.",
    possibleImpact: "내부 서비스에 불필요한 SEO 작업을 만들거나 공개 서비스의 검색 노출 계약을 검토하지 못할 수 있습니다.",
    riskFactors: "공개·내부 route가 섞여 있거나 배포 환경과 인증 경계가 문서화되지 않은 경우",
    mitigatingControls: "제품 소유자가 검색 노출 대상 URL과 내부 전용 경계를 명시한 경우",
    verification: "공개 검색 유입이 필요한 URL과 인증·네트워크로 제한된 URL을 구분합니다.",
    decision: "information-gap"
  },
  "dead-code.marked-removal-candidate": {
    clusterId: "dead-code.removal-candidates",
    clusterTitle: "표시된 제거 후보 검증",
    whyRisky: "오래된 코드 표시는 유지보수 비용 신호지만 실제 참조와 부작용을 증명하지 않습니다.",
    possibleImpact: "방치하면 탐색 비용이 늘고, 성급히 삭제하면 동적 경로나 공개 API가 깨질 수 있습니다.",
    riskFactors: "만료된 flag·adapter이며 owner와 runtime 사용이 확인되지 않는 경우",
    mitigatingControls: "호환성 계약이나 예정된 migration 때문에 의도적으로 유지되는 경우",
    verification: "정적·동적 참조, export, side effect, telemetry와 owner를 확인합니다.",
    decision: "observe"
  },
  "observability.console-only-catch": {
    clusterId: "observability.error-recovery",
    clusterTitle: "오류 복구와 진단 경로 확인",
    whyRisky: "console 출력만으로 끝나는 오류는 사용자 복구 상태와 운영 진단에 연결되지 않을 수 있습니다.",
    possibleImpact: "사용자는 실패 이유나 재시도 경로를 잃고 운영자는 반복 장애를 추적하지 못할 수 있습니다.",
    riskFactors: "중요 mutation·결제·인증 경로이며 상위 error boundary나 logger가 없는 경우",
    mitigatingControls: "상위 계층이 오류를 처리하고 기존 telemetry가 자동 수집하는 경우",
    verification: "호출 계층의 error boundary, 사용자 상태, logger와 alert 연결을 확인합니다.",
    decision: "verify-first"
  },
  "rules.framework-version-unknown": {
    clusterId: "context.framework-version",
    clusterTitle: "프레임워크 컨텍스트 확보",
    whyRisky: "버전과 실행 모델을 모르면 적용 가능한 규칙과 API를 신뢰성 있게 선택할 수 없습니다.",
    possibleImpact: "잘못된 router·RSC·TypeScript 가정을 바탕으로 과도하거나 호환되지 않는 권고가 나올 수 있습니다.",
    riskFactors: "모노레포 하위 폴더만 선택했거나 package 정보가 별도 위치에 있는 경우",
    mitigatingControls: "사용자가 버전과 실행 모델을 별도 근거로 제공한 경우",
    verification: "활성 workspace package와 lockfile, framework config를 포함해 다시 선택합니다.",
    decision: "information-gap"
  }
};

function fileExclusionReason(file) {
  const path = "/" + (file.webkitRelativePath || file.path || file.name || "");
  const name = file.name || path.split("/").pop() || "";
  const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";

  if (ENV_FILE_PATTERN.test(path)) return "environment";
  if (GENERATED_FILE_PATTERN.test(path)) return "generated";
  if (SKIPPED_SEGMENTS.some((segment) => path.includes(segment))) return "excluded-path";
  if (!TEXT_EXTENSIONS.has(extension)) return "unsupported-type";
  if (file.size > analysisLimits.maxFileSize) return "oversized";
  return null;
}

function isAnalyzableFile(file) {
  return fileExclusionReason(file) === null;
}

function selectFilesWithinBudget(files) {
  const accepted = [];
  const excludedByReason = {};
  let acceptedBytes = 0;

  for (const file of files) {
    let reason = fileExclusionReason(file);
    if (!reason && accepted.length >= analysisLimits.maxFileCount) reason = "input-budget";
    if (!reason && acceptedBytes + file.size > analysisLimits.maxTotalBytes) reason = "input-budget";

    if (reason) {
      excludedByReason[reason] = (excludedByReason[reason] || 0) + 1;
      continue;
    }
    accepted.push(file);
    acceptedBytes += file.size;
  }

  return {
    accepted,
    acceptedBytes,
    excludedByReason,
    budgetExceeded: Boolean(excludedByReason["input-budget"]),
    coverageIncomplete: Boolean(
      excludedByReason["input-budget"] || excludedByReason.oversized
    )
  };
}

function analyzeRecords(inputRecords, options = {}) {
  const records = inputRecords.filter((record) => !isGeneratedRecord(record));
  const seoScope = seoScopeLabels[options.seoScope] ? options.seoScope : "unknown";
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

  if (nextVersion && (seoScope === "public" || seoScope === "mixed")) {
    const metadata = source.some((record) => /(?:metadata\s*=|generateMetadata|<Head|next\/head)/.test(record.content));
    const sitemap = paths.some((path) => /(^|\/)sitemap\.(?:xml|js|ts)$/.test(path));
    const robots = paths.some((path) => /(^|\/)robots\.(?:txt|js|ts)$/.test(path));
    const conditional = seoScope === "mixed";
    if (!metadata) findings.push(missingConfig("seo.next-metadata-missing", conditional ? "medium" : "high", "Next.js 메타데이터 구성을 찾지 못함", "인덱싱 대상 페이지의 title, description, canonical을 렌더링 결과로 확인합니다."));
    if (!sitemap) findings.push(missingConfig("seo.sitemap-missing", conditional ? "low" : "medium", "sitemap 구성을 찾지 못함", "공개 인덱싱 URL이 있다면 해당 URL만 포함하는 sitemap을 제공합니다."));
    if (!robots) findings.push(missingConfig("seo.robots-missing", "low", "robots 구성을 찾지 못함", "프로덕션과 프리뷰 환경의 크롤링 의도를 분리해 명시합니다."));
  } else if (nextVersion && seoScope === "unknown") {
    findings.push(finding({
      id: "seo.indexing-intent-unknown",
      severity: "low",
      area: "seo",
      type: "gap",
      evidenceLevel: "unknown",
      title: "프로젝트의 검색 노출 범위가 지정되지 않음",
      evidence: ["사용자 입력: 검색 노출 범위 미확인"],
      recommendation: "공개 검색 유입이 필요한 URL이 있는지 확인한 뒤 SEO 감사를 적용하거나 제외합니다."
    }));
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

function createAuditResult(name, findings, fileCount, meta, inputScope = {}, inputContext = {}) {
  const findingIds = findings.map((finding) => finding.id);
  if (new Set(findingIds).size !== findingIds.length) {
    throw new Error("audit findings require unique stable IDs");
  }

  const summary = Object.keys(evidenceLevels).reduce((counts, level) => {
    counts[level] = findings.filter((finding) => finding.evidenceLevel === level).length;
    return counts;
  }, {});
  const areas = ["rules", "testing", "seo", "security", "dead-code", "observability"];
  const hasPublicSeoFindings = findings.some((item) =>
    item.area === "seo" && item.id !== "seo.indexing-intent-unknown"
  );
  const seoScope = seoScopeLabels[inputContext.seoScope]
    ? inputContext.seoScope
    : hasPublicSeoFindings
      ? "public"
      : "unknown";
  const areaCounts = areas.map((area) => {
    let status = "active";
    if (area === "seo" && seoScope === "internal") status = "not-applicable";
    if (area === "seo" && (seoScope === "unknown" || seoScope === "mixed")) status = "conditional";
    return {
      area,
      count: findings.filter((finding) => finding.area === area).length,
      status
    };
  });
  const analyzed = Number.isFinite(inputScope.analyzed) ? inputScope.analyzed : fileCount;
  const selected = Number.isFinite(inputScope.selected) ? inputScope.selected : analyzed;
  const excluded = Number.isFinite(inputScope.excluded)
    ? inputScope.excluded
    : Math.max(0, selected - analyzed);
  const scope = {
    selected,
    analyzed,
    excluded,
    analyzedBytes: inputScope.analyzedBytes || 0,
    excludedByReason: { ...(inputScope.excludedByReason || {}) },
    partial: Boolean(inputScope.partial)
  };
  const riskClusters = createRiskClusters(findings);
  const context = { seoScope };
  return { name, findings, riskClusters, fileCount: analyzed, meta, summary, areaCounts, scope, context };
}

function createRiskClusters(findings) {
  const severityOrder = ["critical", "high", "medium", "low"];
  const groups = new Map();

  for (const item of findings) {
    if (!groups.has(item.clusterId)) groups.set(item.clusterId, []);
    groups.get(item.clusterId).push(item);
  }

  return [...groups.entries()].map(([id, rows]) => {
    const primary = rows.slice().sort(
      (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
    )[0];
    const decisions = rows.map((row) => row.decision);
    const decision = decisions.includes("act-now")
      ? "act-now"
      : decisions.includes("verify-first")
        ? "verify-first"
        : decisions.includes("information-gap")
          ? "information-gap"
          : "observe";

    return {
      id,
      title: primary.clusterTitle,
      severity: primary.severity,
      type: rows.some((row) => row.type === "risk") ? "risk" : "gap",
      types: [...new Set(rows.map((row) => row.type))],
      decision,
      whyRisky: primary.whyRisky,
      possibleImpact: primary.possibleImpact,
      riskFactors: uniqueText(rows.map((row) => row.riskFactors)),
      mitigatingControls: uniqueText(rows.map((row) => row.mitigatingControls)),
      verification: uniqueText(rows.map((row) => row.verification)),
      recommendation: uniqueText(rows.map((row) => row.recommendation)),
      findingIds: rows.map((row) => row.id),
      evidence: [...new Set(rows.flatMap((row) => row.evidence))].slice(0, 5),
      occurrenceCount: Math.max(...rows.map((row) => row.occurrenceCount))
    };
  });
}

function selectPriorityCandidates(findings, type = "all") {
  const decisionOrder = ["act-now", "verify-first"];
  const severityOrder = ["critical", "high", "medium", "low"];
  return createRiskClusters(findings)
    .filter((cluster) => decisionOrder.includes(cluster.decision))
    .filter((cluster) => type === "all" || cluster.types.includes(type))
    .slice()
    .sort((a, b) => {
      const decisionDifference = decisionOrder.indexOf(a.decision) - decisionOrder.indexOf(b.decision);
      return decisionDifference || severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
    })
    .slice(0, 3);
}

function buildMarkdown(state) {
  const priorityCandidates = selectPriorityCandidates(state.findings);
  const seoScope = state.context?.seoScope || "unknown";
  const sections = {
    security: "Security Or Privacy Risks",
    testing: "Testing Gaps",
    seo: "SEO Risks",
    "dead-code": "Dead Code Candidates",
    rules: "Project Context Findings",
    observability: "Error Handling Or Observability Risks"
  };
  const lines = [
    "# Frontend Audit: " + safeMarkdownText(state.name),
    "",
    "> This report uses static heuristics. No finding does not mean safe. Do not use it as quality assurance, security certification, or deployment approval.",
    "",
    "- Files selected: " + state.scope.selected,
    "- Files inspected: " + state.scope.analyzed,
    "- Files excluded: " + state.scope.excluded,
    "- Bytes inspected: " + state.scope.analyzedBytes,
    "- Exclusions by reason: " + formatExcludedReasons(state.scope.excludedByReason),
    "- Analysis completeness: " + (state.scope.partial ? "partial; input limits or read failures affected coverage" : "within configured static-analysis limits"),
    "- Search exposure scope: " + seoScopeLabels[seoScope],
    "- SEO applicability: " + (
      seoScope === "internal"
        ? "not applicable to search optimization; access control and unintended exposure remain security and deployment concerns"
        : seoScope === "unknown"
          ? "undetermined; only indexing intent is reported until scope is confirmed"
          : seoScope === "mixed"
            ? "conditional; findings apply only to public, indexable URLs"
            : "applicable to public, indexable URLs"
    ),
    "- Automated detection areas: framework version and router context, testing, "
      + (seoScope === "internal" ? "SEO excluded by context, " : "context-aware SEO, ")
      + "security, dead-code markers, error handling and observability",
    "- Manual review remains required: accessibility, performance, forms, state ownership, data fetching, design systems, i18n, and bundle architecture",
    "- Evidence model: observed fact, risk inference, information gap, removal candidate",
    "- Evidence counts: " + Object.keys(evidenceLevels)
      .map((level) => evidenceLevels[level] + " " + state.summary[level])
      .join(", "),
    "- Privacy: source contents and environment values are not included",
    "",
    "## Priority Review Candidates",
    ""
  ];

  if (!priorityCandidates.length) lines.push("No priority candidate was detected. Manual review remains required.", "");
  priorityCandidates.forEach((cluster, index) => {
    lines.push(
      (index + 1) + ". **[" + decisionLabels[cluster.decision] + "] " + cluster.title + "**",
      "   - Risk cluster ID: `" + cluster.id + "`",
      "   - Source finding IDs: " + cluster.findingIds.map((id) => "`" + id + "`").join(", "),
      "   - Why it may matter: " + cluster.whyRisky,
      "   - Possible impact: " + cluster.possibleImpact,
      "   - Risk-increasing conditions: " + cluster.riskFactors,
      "   - Existing controls that could lower risk: " + cluster.mitigatingControls,
      "   - Cheapest next verification: " + cluster.verification,
      "   - Evidence paths: " + safeEvidence(cluster),
      "   - Candidate action: " + cluster.recommendation,
      "   - Boundary: This is a static review candidate, not a confirmed urgent defect.",
      ""
    );
  });

  for (const [area, heading] of Object.entries(sections)) {
    const rows = state.findings.filter((finding) => finding.area === area);
    lines.push("## " + heading, "");
    if (area === "seo" && seoScope === "internal") {
      lines.push("Not assessed: this project was classified as internal/private only. Search optimization is not required; verify access control and unintended external exposure under security and deployment review.", "");
    } else if (!rows.length) {
      lines.push("No automated finding. Manual review remains required.", "");
    }
    rows.forEach((finding) => {
      lines.push(
        "- **[" + finding.severity.toUpperCase() + "] " + finding.title + "**",
        "  - Finding ID: `" + finding.id + "`",
        "  - Evidence level: " + evidenceLevels[finding.evidenceLevel],
        "  - Evidence: " + safeEvidence(finding),
        "  - Why it may matter: " + finding.whyRisky,
        "  - Possible impact: " + finding.possibleImpact,
        "  - Risk-increasing conditions: " + finding.riskFactors,
        "  - Mitigating controls: " + finding.mitigatingControls,
        "  - Verification: " + finding.verification,
        "  - Decision: " + decisionLabels[finding.decision],
        "  - Risk cluster ID: `" + finding.clusterId + "`",
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
    "| Finding ID | Risk cluster | Decision | Area | Severity | Evidence level | Evidence paths | Limitation |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  state.findings.forEach((finding) => {
    lines.push("| `" + finding.id + "` | `" + safeMarkdownCell(finding.clusterId) + "` | "
      + safeMarkdownCell(decisionLabels[finding.decision]) + " | " + safeMarkdownCell(finding.area) + " | " + safeMarkdownCell(finding.severity) + " | "
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
  const narrative = riskNarratives[value.id];
  if (!narrative) {
    throw new Error("finding requires a risk narrative: " + value.id);
  }
  const allEvidence = [...new Set(value.evidence)];
  return {
    occurrenceCount: value.occurrenceCount || value.evidence.length,
    limitation: evidenceLimitations[value.evidenceLevel],
    observedFact: value.title,
    ...narrative,
    ...value,
    allEvidence,
    evidence: allEvidence.slice(0, 5)
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

function isGeneratedRecord(record) {
  return /(?:@generated|generated file|do not edit)/i.test(
    record.content.split("\n").slice(0, 5).join("\n")
  );
}

function safeEvidence(finding) {
  const suffix = finding.occurrenceCount > finding.evidence.length
    ? " 외 " + (finding.occurrenceCount - finding.evidence.length) + "건"
    : "";
  return finding.evidence.map(safeMarkdownText).join(", ") + suffix;
}

function safeMarkdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function safeMarkdownText(value) {
  return String(value).replace(/[\r\n]+/g, " ");
}

function uniqueText(values) {
  return [...new Set(values.filter(Boolean))].join(" / ");
}

function formatExcludedReasons(reasons) {
  const entries = Object.entries(reasons || {});
  return entries.length
    ? entries.map(([reason, count]) => reason + " " + count).join(", ")
    : "none";
}

const analyzerApi = {
  analysisLimits,
  analyzeRecords,
  buildMarkdown,
  createRiskClusters,
  createAuditResult,
  decisionLabels,
  evidenceLevels,
  fileExclusionReason,
  isGeneratedRecord,
  isAnalyzableFile,
  seoScopeLabels,
  selectFilesWithinBudget,
  selectPriorityCandidates
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = analyzerApi;
}
if (typeof globalThis !== "undefined") {
  globalThis.FrontendAnalyzer = analyzerApi;
}
