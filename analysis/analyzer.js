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
  inferred: "위험 가능성",
  unknown: "정보 부족",
  candidate: "삭제 후보"
};
const evidenceLimitations = {
  observed: "코드 패턴의 존재만 확인했으며 실제 악용 가능성이나 실행 중 영향까지 확인한 것은 아님",
  inferred: "정적 근거를 바탕으로 위험 가능성을 추정한 것으로, 결함이 확인된 것은 아님",
  unknown: "정적 분석으로 확인할 수 없는 설정, 데이터 출처 또는 실행 결과를 추가로 확인해야 함",
  candidate: "참조 여부와 부수효과를 확인하기 전에는 삭제할 수 없음"
};
const decisionLabels = {
  "act-now": "즉시 조치",
  "verify-first": "먼저 확인",
  observe: "관찰",
  "information-gap": "정보 확인 필요"
};
const seoScopeLabels = {
  unknown: "미확인",
  public: "검색 노출",
  mixed: "공개·내부 혼합",
  internal: "내부 전용"
};
const riskNarratives = {
  "rules.package-json-invalid": {
    clusterId: "context.package-integrity",
    clusterTitle: "프로젝트 패키지 정보 복구",
    whyRisky: "패키지 정보를 읽지 못하면 프레임워크 버전과 사용 가능한 검증 명령을 잘못 판단할 수 있습니다.",
    possibleImpact: "잘못된 버전 규칙 적용, 설치·빌드 실패 또는 점검 범위 누락으로 이어질 수 있습니다.",
    riskFactors: "실제 package.json에 문법 오류가 있거나 이 파일이 현재 사용하는 workspace package인 경우",
    mitigatingControls: "다른 정상적인 workspace package를 분석했고 오류 파일이 테스트용 fixture인 경우",
    verification: "해당 파일을 JSON 파서와 프로젝트 패키지 매니저로 확인합니다.",
    decision: "act-now"
  },
  "security.html-sink-boundary": {
    clusterId: "security.html-rendering-boundary",
    clusterTitle: "HTML 콘텐츠의 출처·정제 여부 확인",
    whyRisky: "정제되지 않은 외부 HTML이 페이지의 DOM으로 해석되면 공격자가 제어한 마크업이 실행될 수 있습니다.",
    possibleImpact: "화면이 변조되거나 사용자 권한으로 원치 않는 요청이 전송되고, 브라우저에서 접근 가능한 데이터가 노출될 수 있습니다.",
    riskFactors: "사용자·광고·외부 CMS 입력, 서버 정제 계약 부재, CSP 또는 Trusted Types 부재",
    mitigatingControls: "고정된 신뢰 콘텐츠, 검증된 서버 정제, 단일 SafeHtml 경계, 효과적인 CSP 또는 Trusted Types",
    verification: "대표 입력이 들어오는 곳부터 HTML 출력 지점까지 추적하고, 테스트용 악성 마크업과 응답 보안 헤더를 확인합니다.",
    decision: "verify-first"
  },
  "security.html-trust-boundary-unknown": {
    clusterId: "security.html-rendering-boundary",
    clusterTitle: "HTML 콘텐츠의 출처·정제 여부 확인",
    whyRisky: "입력 출처와 서버 정제 여부를 모르면 HTML 직접 삽입 코드의 실제 위험을 판단할 수 없습니다.",
    possibleImpact: "위험한 경로를 안전하다고 넘기거나 신뢰된 콘텐츠까지 불필요하게 긴급 수정할 수 있습니다.",
    riskFactors: "제3자·사용자 입력 여부와 백엔드 정제 규칙이 문서화되지 않은 경우",
    mitigatingControls: "담당자가 확인한 신뢰 경계와 반복 가능한 정제 검증이 있는 경우",
    verification: "콘텐츠 담당자와 함께 서버 정제 규칙이 실제 응답에도 적용되는지 확인합니다.",
    decision: "information-gap"
  },
  "security.browser-auth-storage": {
    clusterId: "security.browser-auth-storage",
    clusterTitle: "브라우저 인증정보 저장 경계 확인",
    whyRisky: "JavaScript가 읽을 수 있는 장기 인증정보는 같은 페이지에서 실행된 악성 스크립트나 XSS에 노출될 수 있습니다.",
    possibleImpact: "세션 탈취, 사용자 사칭 또는 인증정보 재사용 가능성이 있습니다.",
    riskFactors: "실제 access/refresh token 저장, 긴 만료 시간, 페이지에 포함되는 스크립트 범위가 넓은 경우",
    mitigatingControls: "UI 상태와 이름만 비슷한 값, 짧은 수명, 서버가 관리하는 세션과 제한적인 쿠키 정책",
    verification: "저장되는 실제 값의 의미와 수명, 소비 지점, 로그아웃·계정 전환 동작을 확인합니다.",
    decision: "verify-first"
  },
  "security.postmessage-wildcard-origin": {
    clusterId: "security.cross-window-origin",
    clusterTitle: "창 사이 메시지의 origin 제한 확인",
    whyRisky: "대상 origin에 `*`를 사용하면 의도하지 않은 창이 메시지를 받을 가능성이 커집니다.",
    possibleImpact: "메시지에 포함된 상태나 식별자가 허용하지 않은 origin으로 전달될 수 있습니다.",
    riskFactors: "민감한 데이터, opener·iframe 교체 가능성, 수신 측 origin 검증 부재",
    mitigatingControls: "민감하지 않은 브로드캐스트와 수신 측의 엄격한 origin·메시지 형식 검증",
    verification: "보내는 데이터와 대상 창의 생성·교체 흐름을 확인하고, 송수신 양쪽의 origin 검증을 테스트합니다.",
    decision: "verify-first"
  },
  "rules.mixed-next-router": {
    clusterId: "context.router-model",
    clusterTitle: "혼합 Router 운영 경계 확인",
    whyRisky: "App Router와 Pages Router는 메타데이터, 데이터 패칭, 캐시와 렌더링 규칙이 다릅니다.",
    possibleImpact: "한 라우트 트리의 규칙을 다른 트리에 적용해 동작·SEO·캐시 회귀를 만들 수 있습니다.",
    riskFactors: "공유 모듈이 두 트리의 서버·클라이언트 전제를 섞거나 마이그레이션 담당자가 없는 경우",
    mitigatingControls: "라우트 트리별 담당 범위, 테스트와 명시된 마이그레이션 경계",
    verification: "변경 대상 URL이 어느 라우트 트리에 속하는지 확인하고 해당 트리의 빌드·렌더링·메타데이터 동작을 검증합니다.",
    decision: "verify-first"
  },
  "rules.pre-react-18-version-branch": {
    clusterId: "context.react-version",
    clusterTitle: "React 버전별 규칙 분기",
    whyRisky: "새 렌더링 모델과 API를 이전 React 환경에 적용하면 지원되지 않는 동작을 전제할 수 있습니다.",
    possibleImpact: "빌드 실패, hydration 차이 또는 불필요한 마이그레이션이 발생할 수 있습니다.",
    riskFactors: "프레임워크 호환성을 확인하지 않고 RSC·동시성 API를 권고하는 경우",
    mitigatingControls: "현재 렌더링 모델을 유지하고 호환되는 규칙만 골라 적용한 경우",
    verification: "React와 렌더러 버전, 프레임워크 호환성, 실제 root API를 확인합니다.",
    decision: "verify-first"
  },
  "testing.test-foundation-missing": {
    clusterId: "testing.regression-safety-net",
    clusterTitle: "회귀 검증 기반 확인",
    whyRisky: "자동 회귀 검증이 없으면 중요한 상태 전이나 순수 로직 변경의 실패를 반복 가능하게 탐지하기 어렵습니다.",
    possibleImpact: "변경 후 회귀가 늦게 발견되고 수동 검증 비용이 누적될 수 있습니다.",
    riskFactors: "변경이 잦거나 상태 전이가 복잡한데 CI에서 실행할 테스트 명령이 없는 경우",
    mitigatingControls: "상위 workspace나 외부 CI에서 검증하고 있어 선택한 폴더에서는 보이지 않는 경우",
    verification: "workspace 루트와 CI에서 실제 변경 경로를 검증하는 테스트 명령 및 최근 실행 결과를 확인합니다.",
    decision: "verify-first"
  },
  "testing.e2e-path-missing": {
    clusterId: "testing.critical-journeys",
    clusterTitle: "고위험 사용자 여정 검증",
    whyRisky: "여러 경계를 통과하는 핵심 여정은 단위 테스트만으로 라우팅, 인증, 결제 또는 제출 실패를 포착하기 어렵습니다.",
    possibleImpact: "가입·결제·제출 같은 전환 여정이 배포 후 중단될 수 있습니다.",
    riskFactors: "고위험 다단계 여정이 있는데 통합 테스트나 합성 모니터링 같은 대체 검증도 없는 경우",
    mitigatingControls: "해당 제품에 고위험 여정이 없거나 다른 계층의 반복 가능한 전체 경로 검증이 있는 경우",
    verification: "실패 비용이 큰 사용자 여정을 나열하고 현재 자동화가 각 경계를 실제로 통과하는지 확인합니다.",
    decision: "verify-first"
  },
  "seo.next-metadata-missing": {
    clusterId: "seo.indexability-baseline",
    clusterTitle: "공개 URL의 검색 노출 계약 확인",
    whyRisky: "렌더링된 메타데이터를 찾지 못하면 검색 엔진과 공유 미리보기가 페이지의 의도를 일관되게 해석하지 못할 수 있습니다.",
    possibleImpact: "잘못된 title·canonical URL, 중복 URL 또는 검색 노출 저하 가능성이 있습니다.",
    riskFactors: "검색 노출 대상 라우트인데 메타데이터가 다른 계층에서 주입되지 않는 경우",
    mitigatingControls: "비공개 라우트, 상위 렌더링 계층 또는 별도로 검증된 메타데이터 처리",
    verification: "대표 공개 URL의 최종 HTML에서 title, description, canonical URL과 상태 코드를 확인합니다.",
    decision: "verify-first"
  },
  "seo.sitemap-missing": {
    clusterId: "seo.indexability-baseline",
    clusterTitle: "공개 URL의 검색 노출 계약 확인",
    whyRisky: "공개 URL이 많거나 구조가 깊은 사이트는 sitemap이 없으면 검색 엔진의 페이지 발견과 갱신이 늦어질 수 있습니다.",
    possibleImpact: "일부 공개 URL의 발견 또는 갱신이 지연될 수 있습니다.",
    riskFactors: "동적·대규모 URL, 내부 링크가 약한 페이지, 잦은 URL 변경",
    mitigatingControls: "규모가 작고 내부 링크가 충분하거나 외부 sitemap 서비스가 있는 경우",
    verification: "공개 URL 목록과 실제 배포된 sitemap의 위치와 내용을 확인합니다.",
    decision: "verify-first"
  },
  "seo.robots-missing": {
    clusterId: "seo.indexability-baseline",
    clusterTitle: "공개 URL의 검색 노출 계약 확인",
    whyRisky: "환경별 크롤링 정책이 명시되지 않으면 프리뷰 또는 제한 URL이 예상과 다르게 노출될 수 있습니다.",
    possibleImpact: "불필요한 크롤링, 프리뷰 페이지 노출 또는 운영 URL 차단 가능성이 있습니다.",
    riskFactors: "프리뷰와 운영 도메인이 분리돼 있는데 별도 엣지 설정을 확인하지 못한 경우",
    mitigatingControls: "플랫폼이나 엣지 계층에서 검증된 robots 정책을 제공하는 경우",
    verification: "운영 및 프리뷰 도메인의 실제 robots 응답과 meta robots를 확인합니다.",
    decision: "verify-first"
  },
  "seo.indexing-intent-unknown": {
    clusterId: "seo.indexing-intent",
    clusterTitle: "검색 노출 범위 확인",
    whyRisky: "공개 URL이 있는지 모르면 메타데이터·sitemap 부재를 결함으로 잘못 판단하거나 필요한 검색 노출 검증을 놓칠 수 있습니다.",
    possibleImpact: "내부 서비스에 불필요한 SEO 작업을 만들거나 공개 서비스의 검색 노출 계약을 검토하지 못할 수 있습니다.",
    riskFactors: "공개·내부 라우트가 섞여 있거나 배포 환경과 인증 경계가 문서화되지 않은 경우",
    mitigatingControls: "제품 소유자가 검색 노출 대상 URL과 내부 전용 경계를 명시한 경우",
    verification: "공개 검색 유입이 필요한 URL과 인증·네트워크로 제한된 URL을 구분합니다.",
    decision: "information-gap"
  },
  "dead-code.marked-removal-candidate": {
    clusterId: "dead-code.removal-candidates",
    clusterTitle: "표시된 제거 후보 검증",
    whyRisky: "`TODO remove`나 `@deprecated` 표시는 정리가 필요할 수 있다는 신호지만, 실제로 사용하지 않는 코드라는 증거는 아닙니다.",
    possibleImpact: "그대로 두면 코드를 파악하기 어려워지고, 확인 없이 삭제하면 동적 경로나 공개 API가 깨질 수 있습니다.",
    riskFactors: "만료된 기능 플래그·어댑터인데 담당자와 실제 사용 여부를 확인하지 못한 경우",
    mitigatingControls: "호환성 유지나 예정된 마이그레이션 때문에 의도적으로 남겨둔 경우",
    verification: "정적·동적 참조, export, 부수효과, 모니터링 기록과 담당자를 확인합니다.",
    decision: "observe"
  },
  "observability.console-only-catch": {
    clusterId: "observability.error-recovery",
    clusterTitle: "오류 복구와 진단 경로 확인",
    whyRisky: "console 출력만으로 끝나는 오류는 사용자 안내나 운영 진단으로 이어지지 않을 수 있습니다.",
    possibleImpact: "사용자는 실패 이유나 재시도 경로를 잃고 운영자는 반복 장애를 추적하지 못할 수 있습니다.",
    riskFactors: "중요한 데이터 변경·결제·인증 경로인데 상위 error boundary나 로거가 없는 경우",
    mitigatingControls: "상위 계층이 오류를 처리하고 기존 모니터링 도구가 자동으로 수집하는 경우",
    verification: "호출 계층의 error boundary, 사용자 오류 안내, 로거와 알림 연결을 확인합니다.",
    decision: "verify-first"
  },
  "styling.overlay-clipping-context": {
    clusterId: "styling.overlay-layout",
    clusterTitle: "오버레이의 잘림·레이어 경계 확인",
    whyRisky: "오버레이로 보이는 CSS 블록에 잘림, 높이 제한과 별도 레이어를 만드는 선언이 함께 있습니다. 실제 DOM과 스타일 적용에 따라 내용이나 하위 메뉴가 잘릴 수 있습니다.",
    possibleImpact: "모달의 오류 안내, 선택 메뉴 또는 필수 동작이 가려져 사용자 작업이 중단될 수 있습니다.",
    riskFactors: "같은 요소에 해당 선언이 실제 적용되고 확장되는 콘텐츠나 오버레이 자식이 있는 경우",
    mitigatingControls: "의도된 장식용 잘림, 별도 스크롤 영역, 적절한 Portal 또는 검증된 콘텐츠 크기",
    verification: "해당 스타일의 실제 적용 요소와 조상 레이어를 확인하고, 긴 콘텐츠·하위 메뉴를 열어 잘림과 클릭 가능성을 브라우저에서 재현합니다.",
    decision: "verify-first"
  },
  "styling.fixed-overlay-width": {
    clusterId: "styling.overlay-layout",
    clusterTitle: "오버레이의 잘림·레이어 경계 확인",
    whyRisky: "오버레이로 보이는 CSS 블록에 큰 고정 너비가 있고 같은 블록에 최대 너비 제한이 없습니다. 지원하는 좁은 화면에서 내용이 벗어날 가능성이 있습니다.",
    possibleImpact: "모달·메뉴의 내용이나 닫기·확인 동작이 화면 밖으로 밀릴 수 있습니다.",
    riskFactors: "좁은 viewport에서도 해당 선언이 적용되고 다른 스타일이 너비를 제한하지 않는 경우",
    mitigatingControls: "다른 규칙의 반응형 제한, 의도된 큰 화면 전용 범위 또는 검증된 대체 UI",
    verification: "지원 breakpoint 전후에서 실제 계산된 너비와 가로 넘침, 필수 동작 접근성을 확인합니다.",
    decision: "verify-first"
  },
  "rules.framework-version-unknown": {
    clusterId: "context.framework-version",
    clusterTitle: "프레임워크 정보 확인",
    whyRisky: "버전과 실행 모델을 모르면 적용 가능한 규칙과 API를 신뢰성 있게 선택할 수 없습니다.",
    possibleImpact: "잘못된 Router·RSC·TypeScript 가정을 바탕으로 과도하거나 호환되지 않는 권고가 나올 수 있습니다.",
    riskFactors: "모노레포 하위 폴더만 선택했거나 패키지 정보가 다른 위치에 있는 경우",
    mitigatingControls: "사용자가 버전과 실행 모델을 별도 근거로 제공한 경우",
    verification: "현재 사용하는 workspace package와 lockfile, 프레임워크 설정 파일을 포함해 다시 선택합니다.",
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
  // A directory name or README is not an E2E configuration or test-source path.
  // These paths remain inventory evidence, not proof of execution or journey coverage.
  const e2e = paths.some((path) =>
    /(^|\/)(?:playwright|cypress)\.config\.[cm]?[jt]s$/.test(path)
    || /(^|\/)(?:e2e|playwright|cypress)\/.*\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)
    || /(^|\/)cypress\/(?:e2e|integration)\/.*\.cy\.[jt]sx?$/.test(path)
  );

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
        ? "HTML 직접 삽입 코드 " + htmlSinkCount + "곳, 정제 라이브러리 흔적은 있으나 각 위치의 적용 여부는 확인되지 않음"
        : "HTML 직접 삽입 코드 " + htmlSinkCount + "곳, 정제 라이브러리 의존성이나 import를 찾지 못함",
      evidence: htmlSinkMatches.map((match) => match.path),
      occurrenceCount: htmlSinkCount,
      recommendation: sanitizerEvidence
        ? "각 삽입 위치의 HTML이 승인된 정제 과정을 거치는지 확인합니다."
        : "콘텐츠 출처별 신뢰 경계를 문서화하고 검증된 SafeHtml 경계에서 정제 처리를 통일합니다."
    }));
    findings.push(finding({
      id: "security.html-trust-boundary-unknown",
      severity: "medium",
      area: "security",
      type: "gap",
      evidenceLevel: "unknown",
      title: "HTML 콘텐츠의 서버 정제 여부와 신뢰 경계는 자동으로 확인할 수 없음",
      evidence: htmlSinkMatches.map((match) => match.path),
      occurrenceCount: htmlSinkCount,
      recommendation: "백엔드 정제 여부와 제3자 콘텐츠·사용자 입력의 경계를 담당자 확인과 실제 응답 검증으로 확인합니다."
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
    title: "postMessage의 대상 origin에 `*` 사용",
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
      evidence: ["`test` 스크립트와 test/spec 파일을 찾지 못함"],
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
      title: "E2E 설정 또는 테스트 소스 경로를 찾지 못함",
      evidence: ["Playwright·Cypress 설정 및 E2E 테스트 소스 경로 미발견"],
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
    if (!robots) findings.push(missingConfig("seo.robots-missing", "low", "robots 구성을 찾지 못함", "프로덕션과 프리뷰 환경의 크롤링 정책을 나누어 명시합니다."));
  } else if (nextVersion && seoScope === "unknown") {
    findings.push(finding({
      id: "seo.indexing-intent-unknown",
      severity: "low",
      area: "seo",
      type: "gap",
      evidenceLevel: "unknown",
      title: "프로젝트의 검색 노출 범위가 지정되지 않음",
      evidence: ["사용자 입력: 검색 노출 범위 미확인"],
      recommendation: "공개 검색 유입이 필요한 URL이 있는지 확인한 뒤 SEO 검사를 적용하거나 제외합니다."
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
      title: "삭제 표시가 있는 코드 " + deadCandidates.length + "개 파일",
      evidence: deadCandidates.map((record) => record.path),
      occurrenceCount: deadCandidates.length,
      recommendation: "참조, 동적 import, 공개 export와 부수효과를 확인합니다. 이 결과만으로 삭제하면 안 됩니다."
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
      title: "오류 처리가 console 출력에서 끝날 가능성",
      evidence: consoleOnly.map((record) => record.path),
      recommendation: "기존 로거와 오류 경계를 확인하고 사용자 복구 상태와 진단 정보를 함께 설계합니다."
    }));
  }

  addStylesheetFindings(findings, records);

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
  const areas = ["rules", "testing", "seo", "security", "dead-code", "observability", "styling"];
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
      + "security, dead-code markers, error handling and observability, narrow stylesheet layout candidates",
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

function addStylesheetFindings(findings, records) {
  const clipped = [];
  const wide = [];
  const overlaySelector = /(?:^|[.#\s>+~])(?:modal|dialog|popover|dropdown|tooltip|overlay|drawer|menu|toast)(?:[-_\s.#:[>+~]|$)/i;
  for (const record of records.filter((item) => /\.(?:css|scss)$/i.test(item.path))) {
    for (const block of stylesheetBlocks(record.content, /\.scss$/i.test(record.path))) {
      if (!overlaySelector.test(block.selector)) continue;
      const declarations = stylesheetDeclarations(block.body);
      const value = (name) => declarations.get(name)?.value || "";
      const clipping = [value("overflow-x"), value("overflow-y")]
        .some((item) => /^(?:hidden|clip)$/.test(item));
      const heightLimit = [value("height"), value("max-height")]
        .some((item) => /^\d+(?:\.\d+)?(?:px|rem|em|vh|svh|dvh)$/.test(item));
      const context = /^(?:fixed|sticky)$/.test(value("position"))
        || ["transform", "filter", "perspective", "backdrop-filter"]
          .some((name) => value(name) && value(name) !== "none")
        || value("isolation") === "isolate"
        || /(?:^|\s)(?:layout|paint|strict|content)(?:\s|$)/.test(value("contain"));
      if (clipping && heightLimit && context) clipped.push(record.path);
      const width = /^(\d+(?:\.\d+)?)px$/.exec(value("width"));
      const desktopGuard = width && block.conditions.some((condition) => {
        // Only recognize a single simple conjunctive min-width guard. A comma or
        // negation can make another branch apply to a narrow viewport.
        if (!/^@media\b/i.test(condition) || /,|\bnot\b|\bor\b/i.test(condition)) return false;
        const minWidth = /\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/i.exec(condition);
        return minWidth && Number(minWidth[1]) >= Number(width[1]);
      });
      if (width && Number(width[1]) >= 640
        && (!value("max-width") || value("max-width") === "none")
        && !desktopGuard) wide.push(record.path);
    }
  }
  const configs = [
    ["styling.overlay-clipping-context", clipped, "medium", "오버레이 스타일의 잘림·높이·레이어 선언 조합 확인"],
    ["styling.fixed-overlay-width", wide, "low", "오버레이 스타일의 큰 고정 너비와 반응형 제한 확인"]
  ];
  for (const [id, paths, severity, title] of configs) {
    if (!paths.length) continue;
    findings.push(finding({
      id, severity, title,
      area: "styling",
      type: "risk",
      evidenceLevel: "inferred",
      evidence: paths,
      occurrenceCount: paths.length,
      recommendation: "기존 레이어 토큰과 공통 오버레이 구조를 유지하며, 실제 화면의 잘림·겹침·클릭 차단을 재현한 뒤 필요한 경계만 수정합니다.",
      limitation: "독립 CSS/SCSS의 단순 선언 블록만 검사합니다. 선택자가 실제 적용되는지, DOM 관계·cascade·media query·CSS-in-JS·inline style·브라우저 top layer는 확인하지 않았습니다. 화면 결함이나 안전성을 확정하지 않습니다."
    }));
  }
}

// A bounded lexical inventory, deliberately not a CSS parser or cascade evaluator.
// Strings and comments are masked before matching so their example text cannot
// create declarations or alter brace boundaries. Only leaf declaration blocks run.
function stylesheetBlocks(content, scss) {
  const chars = content.split("");
  let quote = null;
  let comment = null;
  for (let index = 0; index < chars.length; index += 1) {
    const current = content[index];
    const next = content[index + 1];
    if (comment) {
      if (comment === "block" && current === "*" && next === "/") {
        chars[index] = chars[index + 1] = " ";
        index += 1;
        comment = null;
      } else if (comment === "line" && current === "\n") {
        comment = null;
      } else if (current !== "\n") chars[index] = " ";
      continue;
    }
    if (quote) {
      chars[index] = current === "\n" ? "\n" : " ";
      if (current === "\\") {
        if (index + 1 < chars.length) chars[++index] = " ";
      } else if (current === quote) quote = null;
      continue;
    }
    if (current === "/" && (next === "*" || (scss && next === "/"))) {
      comment = next === "*" ? "block" : "line";
      chars[index] = chars[index + 1] = " ";
      index += 1;
    } else if (current === '"' || current === "'") {
      quote = current;
      chars[index] = " ";
    }
  }
  if (quote || comment === "block") return [];
  const source = chars.join("");
  const frames = [];
  const blocks = [];
  let boundary = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "{") {
      if (frames.length) frames[frames.length - 1].nested = true;
      frames.push({ selector: source.slice(boundary, index).trim(), start: index + 1, nested: false });
      boundary = index + 1;
    } else if (source[index] === "}") {
      const frame = frames.pop();
      if (!frame) return [];
      if (!frame.nested) blocks.push({
        selector: frame.selector,
        body: source.slice(frame.start, index),
        conditions: frames.map((ancestor) => ancestor.selector)
      });
      boundary = index + 1;
    } else if (source[index] === ";" && !frames.length) boundary = index + 1;
  }
  return frames.length ? [] : blocks;
}

function stylesheetDeclarations(body) {
  const values = new Map();
  function set(name, value, important) {
    if (!values.get(name)?.important || important) values.set(name, { value, important });
  }
  for (const declaration of body.split(";")) {
    const match = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(declaration);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const important = /\s*!important\s*$/i.test(match[2]);
    const value = match[2].replace(/\s*!important\s*$/i, "").trim().toLowerCase();
    if (name === "overflow") {
      const [x, y = x] = value.split(/\s+/);
      set("overflow-x", x, important);
      set("overflow-y", y, important);
    }
    set(name, value, important);
  }
  return values;
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
