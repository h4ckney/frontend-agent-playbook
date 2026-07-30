# Analyzer v0.2 Design

이 문서는 현재 Frontend Audit 대시보드에서 확인된 구조적 한계를 해결하기 위한 구현 설계다. 목표는 정적 패턴을 더 많이 찾는 것이 아니라, 같은 분석 결과를 CLI, CI, 브라우저 UI와 Markdown 보고서에서 재현하고 각 우선순위의 근거를 설명할 수 있게 만드는 것이다.

## Implementation Status

2026-07-30 기준 `main`에는 Recommended First Slice가 미출시 프리뷰로 구현되어 있다. 공통 `AuditResult`, project profile과 baseline schema, 브라우저 compatibility adapter, filesystem CLI, JSON/Markdown/summary 출력, policy exit code, baseline diff, detector-rule 연결 검증 및 contract/CLI test가 포함된다.

현재 profile 적용은 경로 기반 route 추론으로 확인 가능한 critical journey, route policy, trust boundary와 declared control에 한정된다. Parser 기반 route inventory와 import graph, route별 Next.js metadata 상속, 완전한 source-to-sink 분석, deep runtime 검증 및 SARIF adapter는 구현되지 않았다. 따라서 아래 Phase 3 이후 내용과 Definition of Done은 완료 상태가 아니라 후속 gate다.

## 1. Problem Statement

현재 analyzer에는 다음 한계가 있다.

| 문제 | 현재 동작 | 실제 영향 |
| --- | --- | --- |
| 데이터 흐름 부재 | 문자열과 파일 존재 여부를 중심으로 탐지 | source, transform, sanitizer, sink 관계를 설명하지 못함 |
| 분류와 적용성 부족 | 저장소 전체에서 패턴을 찾고 공통 severity를 부여 | 내부 route, 공개 route, 테스트 fixture와 실제 운영 경계가 섞여 노이즈가 커짐 |
| 우선순위 근거 부족 | decision과 severity를 정렬해 최대 세 cluster를 선택 | 사용자가 우선순위를 처음부터 다시 판단해야 함 |
| analyzer CI 진입점 부재 | CI는 analyzer의 구문과 fixture test만 실행 | 대상 저장소 scan, JSON 결과, policy exit code를 자동화할 수 없음 |
| baseline과 diff 부재 | 매번 전체 결과를 새로 표시 | 기존 부채와 새 회귀를 구분하지 못함 |
| 규칙과 detector의 연결 부재 | Markdown 규칙과 analyzer finding ID가 독립적으로 관리됨 | 자동화 범위, 누락과 문서 drift를 검증할 수 없음 |
| Next.js 검사 깊이 부족 | 저장소 어딘가의 `next/head`, metadata, sitemap 또는 robots 흔적으로 판단 | route별 누락, 상속, dynamic metadata와 실제 배포 결과를 구분하지 못함 |
| 프로젝트 고유 위험 부재 | 패키지와 일반 파일 패턴만으로 제품 의미를 추론 | 결제, 가입, 관리자 작업, 개인정보 경계를 우선순위에 반영하지 못함 |

현재 대시보드가 결과를 `Priority Review Candidate`로 제한하고 audit skill이 사람의 검증을 요구하는 것은 올바른 안전장치다. 다만 기계가 수집할 수 있는 적용성, 변경 여부, 영향 경로와 판정 근거까지 사람에게 넘기고 있으므로 분석 계약을 보강해야 한다.

## 2. Design Goals

v0.2 analyzer는 다음을 만족해야 한다.

1. 같은 입력, 설정, analyzer version, detector catalog와 analysis capability를 사용하면 CLI와 브라우저에서 같은 normalized finding을 생성한다.
2. 내부 detector finding은 관련 playbook rule을 가지며, 외부 finding은 원본 tool과 source rule을 보존한다. 모든 finding은 적용 범위, 증거 수준과 판정 근거를 가진다.
3. 기존 부채와 이번 변경에서 새로 생긴 위험을 구분한다.
4. 정적 분석으로 모르는 사실을 `정보 부족`으로 유지한다.
5. 프로젝트 담당자는 제품 고유의 중요 여정과 신뢰경계를 코드 원문 없이 선언할 수 있다.
6. CI는 명시된 정책만 차단하고 추론 또는 정보 부족을 기본 실패로 취급하지 않는다.
7. Next.js 결과는 repository-level presence가 아니라 route inventory와 route별 coverage를 기준으로 한다.
8. UI와 Markdown은 분석기가 만든 단일 JSON 결과를 표현하는 renderer가 된다.
9. 실행 surface가 제공하지 못하는 capability와 detector는 조용히 생략하지 않고 결과에 기록한다.

## 3. Non-goals

v0.2에서 다음은 하지 않는다.

- 정적 문자열만으로 취약점, dead code 또는 배포 안전성을 확정하지 않는다.
- 발견한 dead code를 자동 삭제하지 않는다.
- Markdown 문장을 실행 가능한 detector source로 해석하지 않는다.
- 모든 언어를 지원하는 interprocedural taint engine을 직접 구현하지 않는다.
- 근거를 숨기는 단일 100점 품질 점수를 만들지 않는다.
- 패키지 이름만 보고 결제, 인증 또는 개인정보 여정을 확정하지 않는다.
- 추론 finding을 기본 CI release blocker로 만들지 않는다.
- 프로젝트 저장소의 임의 JavaScript detector를 자동 실행하지 않는다.

## 4. Target Architecture

```text
Browser folder input       CLI filesystem input       External SARIF input
         |                         |                           |
         +------------ Input and scope adapters ---------------+
                                   |
                         Project context collector
                                   |
              Capability-aware repository index and route inventory
                                   |
                           Detector registry
                                   |
                         Normalized findings
                                   |
              Applicability, control and priority policies
                                   |
                 Root-cause clustering and baseline diff
                                   |
              AuditResult JSON (single source of output truth)
                    /               |                 \
                Browser UI      Markdown report      CI exit
```

### Compatibility boundary

현재 `analysis/analyzer.js`는 DOM에 의존하지 않는 분석 API와 브라우저 global, CommonJS export를 함께 제공한다. 첫 단계에서는 이 특성을 유지해 CLI가 같은 API를 직접 사용한다. CLI를 만들기 위해 analyzer 전체를 모듈 시스템이나 bundler로 즉시 재작성하지 않는다.

dependency-free browser 경로는 `static-lite` capability를 제공하고 CLI는 같은 capability에 filesystem, parser, SARIF 또는 deep-runtime capability를 선택적으로 더할 수 있다. 두 surface의 결과 동등성은 capability set이 같을 때만 보장한다. capability가 다르면 결과의 `engine.capabilities`와 diagnostic이 차이를 설명해야 한다. Browser에서 parser-backed 검사를 제공하려면 별도로 승인된 prebuilt parser bundle이 필요하며, 그 전에는 해당 detector를 실행한 것처럼 표현하지 않는다.

detector가 반복적으로 늘어나 하나의 파일에서 검토하기 어려워질 때만 registry와 detector module 분리를 별도 변경으로 승인한다.

## 5. Canonical Audit Result

CLI, UI, Markdown과 baseline은 같은 결과 계약을 사용한다. 결과 비교와 baseline diff는 analysis mode, capability set, detector catalog와 profile digest가 호환될 때만 확정적으로 수행한다.

```json
{
  "schemaVersion": "1",
  "toolVersion": "0.2.0",
  "generatedAt": "2026-07-30T00:00:00.000Z",
  "scopePolicyDigest": "sha256:example-scope-policy",
  "engine": {
    "analysisMode": "static-lite",
    "capabilities": [
      "text-patterns",
      "route-path-inference"
    ],
    "detectorCatalogVersion": "2026-07-30.1",
    "profileDigest": "sha256:example",
    "externalTools": []
  },
  "project": {
    "rootLabel": "web",
    "framework": "next",
    "frameworkVersion": "13.x",
    "routerMode": "pages",
    "reactVersion": "18.x",
    "typescriptVersion": "4.x",
    "visibility": "mixed",
    "profileSource": ".frontend-agent-playbook.json"
  },
  "scope": {
    "includedFiles": 120,
    "excludedFiles": 34,
    "includedBytes": 300000,
    "partial": false,
    "partialReasons": []
  },
  "findings": [],
  "clusters": [],
  "diff": {
    "baselineId": null,
    "unbaselined": [],
    "new": [],
    "worsened": [],
    "unchanged": [],
    "resolved": [],
    "unverified": []
  },
  "diagnostics": []
}
```

`generatedAt`은 보고용 값이며 finding fingerprint 또는 결과 동일성 비교에 사용하지 않는다.

`externalTools`를 사용하면 tool name, version과 ruleset digest를 기록한다. 동일 capability 이름만으로 서로 다른 SARIF producer나 ruleset을 호환 가능한 것으로 취급하지 않는다.

### Finding contract

```json
{
  "id": "security.html-sink-boundary",
  "fingerprint": "security.html-sink-boundary:src/features/article:render",
  "detectorId": "security.html-boundary",
  "detectorVersion": "1",
  "ruleRefs": [
    "security-privacy.html-injection"
  ],
  "sourceRuleRefs": [],
  "title": "HTML 렌더링 경계 검증 필요",
  "area": "security",
  "severity": "high",
  "evidenceLevel": "inferred",
  "exposure": "unknown",
  "controlState": "unverified",
  "applicability": {
    "status": "conditional",
    "reasons": [
      "운영 source에서 HTML sink가 관찰됨"
    ],
    "missingContext": [
      "콘텐츠 출처",
      "서버 정제 계약"
    ]
  },
  "scope": {
    "paths": [
      "src/features/article/view.tsx"
    ],
    "routes": [
      "/articles/[id]"
    ],
    "journeys": [
      "article-view"
    ]
  },
  "flow": {
    "status": "partial",
    "sources": [],
    "transforms": [],
    "controls": [],
    "sinks": [
      "dangerouslySetInnerHTML"
    ],
    "unknowns": [
      "inter-file source"
    ]
  },
  "priority": {
    "decision": "verify-first",
    "effectiveDecision": "verify-first",
    "policyId": "material-risk-missing-boundary",
    "sortKeys": [
      "unbaselined",
      "material-impact",
      "missing-control",
      "security.html-sink-boundary:src/features/article:render"
    ],
    "reasons": [
      "브라우저 실행 sink가 있음",
      "신뢰경계 근거가 없음"
    ],
    "counterEvidence": [],
    "missingEvidence": [
      "입력 출처",
      "sink별 sanitizer 적용"
    ],
    "affectedJourney": "article-view",
    "verification": "대표 payload를 source부터 sink까지 추적"
  },
  "evidence": [
    {
      "kind": "source-pattern",
      "path": "src/features/article/view.tsx",
      "symbol": "ArticleBody",
      "line": 42
    }
  ]
}
```

### Sensitive output rules

- source 원문, 환경변수 값, token, cookie, 개인정보와 runtime payload를 결과에 저장하지 않는다.
- evidence는 정규화된 상대 경로, symbol, route, line과 패턴 종류만 포함한다.
- line은 탐색 편의를 위한 위치 정보다. fingerprint에는 사용하지 않는다.
- CLI의 debug 모드도 source 원문을 기본 출력하지 않는다.
- 배열과 finding은 정규화된 route, path, detector ID와 fingerprint 순서로 정렬한다. filesystem 반환 순서가 결과 순서를 바꾸지 않아야 한다.

## 6. Detector And Rule Contract

각 detector는 최소한 다음 metadata와 동작 계약을 가진다.

```js
{
  id: "next.metadata.route-coverage",
  version: "1",
  ruleRefs: [
    "nextjs.metadata",
    "seo.metadata"
  ],
  applies(context) {},
  detect(index, context, profile) {},
  evidenceModel: "inferred",
  defaultDecision: "verify-first"
}
```

### Rule IDs

- 사람이 읽는 Markdown이 계속 규칙 설명의 canonical source다.
- 자동 검사와 연결되는 rule statement에만 안정적인 rule ID를 부여한다.
- detector는 `ruleRefs`로 rule ID를 참조한다.
- 자동 검사되지 않는 수동 규칙도 허용한다.
- 규칙 문서가 자동 강제를 주장하려면 연결된 detector 또는 enforcement mapping이 있어야 한다.
- 외부 SARIF rule은 `sourceRuleRefs`에 보존하고 사전에 선언된 mapping이 있을 때만 local `ruleRefs`를 추가한다. 이름이 비슷하다는 이유로 local rule을 추론하지 않는다.

### CI consistency checks

문서 검증에 다음 조건을 추가한다.

1. detector ID는 active catalog에서 중복될 수 없고 모든 detector에 version이 있어야 한다.
2. detector의 `ruleRefs`는 실제 rule ID를 참조해야 한다.
3. finding 의미, identity 또는 fingerprint 구성요소가 바뀌면 detector version을 올려야 한다.
4. 자동화된 것으로 표시된 rule ID에는 detector 또는 enforcement mapping이 있어야 한다.
5. detector가 없는 수동 규칙을 실패로 처리하지 않는다.
6. detector coverage 수치를 전체 규칙 coverage나 품질 점수로 표현하지 않는다.

Markdown을 runtime에 파싱하지 않는다. CI가 연결 무결성만 검증한다.

## 7. Applicability And Priority

severity, evidence, applicability와 priority를 하나의 값으로 합치지 않는다.

| 축 | 값 | 의미 |
| --- | --- | --- |
| Evidence | observed, inferred, unknown, candidate | 무엇을 실제로 확인했는가 |
| Applicability | applicable, conditional, not-applicable, unknown | 이 프로젝트와 경로에 규칙이 적용되는가 |
| Severity | critical, high, medium, low, info | 사실일 경우 가능한 영향 |
| Exposure | confirmed, likely, limited, unknown | 영향 경로가 실제 운영 범위에 얼마나 노출되는가 |
| Control | effective, partial, missing, unverified | 기존 완화 장치가 확인됐는가 |
| Decision | act-now, verify-first, observe, information-gap | evidence와 policy가 제안하는 다음 행동 |
| Effective Decision | act-now, verify-first, observe, information-gap, suppressed | suppression을 적용한 뒤 보고와 CI에 사용하는 행동 |
| Diff | unbaselined, new, worsened, unchanged, resolved, unverified | 기준선 이후 무엇이 변했는가 |

### Decision table

`act-now`는 다음 조건을 모두 충족할 때만 선택한다.

1. applicability가 `applicable`이다.
2. 관찰된 위반이 있거나 프로젝트 profile이 필요한 사실을 확인한다.
3. material impact 또는 critical journey 영향이 명시된다.
4. 효과적인 mitigating control이 확인되지 않는다.
5. 정상 backlog보다 먼저 처리할 이유가 있다.

하나의 핵심 사실이 없고 영향이 클 수 있으면 `verify-first`다. 영향과 적용 범위가 모두 불명확하면 `information-gap`이다. 실제 위험이 낮거나 기존 부채로 허용되면 `observe`다.

정적 detector는 보안 취약점이나 제품별 중요도를 혼자 확정하지 않는다. `act-now`를 출력하려면 machine-verifiable violation이거나 승인된 project profile과 관찰 근거가 함께 있어야 한다.

### Required priority trace

모든 priority candidate는 다음을 설명해야 한다.

- 적용된 `policyId`
- 우선순위를 올린 근거
- 우선순위를 낮춘 counter-evidence 또는 control
- 아직 모르는 핵심 사실
- 영향받는 route 또는 journey
- 가장 저렴한 다음 검증
- 같은 root cause로 묶인 finding ID

근거가 없는 candidate는 상위 세 개에 포함하지 않고 `information-gap`으로 보낸다. 목록을 세 개로 채우지 않는다.

candidate 정렬은 숨겨진 숫자 점수를 사용하지 않는다. 기본 순서는 `new/worsened`, `unbaselined`, 확인된 material impact, critical journey 포함 여부, control 부재, fingerprint이며 결과의 `sortKeys`에 실제 적용값을 남긴다. `decision` 문자열 자체는 순서형 값으로 취급하지 않는다. 프로젝트가 순서를 바꾸려면 profile에 명시된 policy가 필요하다.

### Human decision boundary

도구는 적용성, diff, impact context와 priority trace를 계산해 사람이 처음부터 순위를 만들지 않게 한다. 사람은 제품 의미를 확인하고 profile, suppression과 실제 변경을 승인한다. 사람이 핵심 사실을 제공하지 않은 경우 도구는 임의로 순위를 올리지 않고 필요한 질문과 가장 저렴한 검증을 남긴다.

## 8. Root-cause Clustering

단순히 같은 area나 severity를 묶지 않는다. 다음 순서로 cluster key를 선택한다.

1. 동일한 source-to-sink 또는 trust boundary
2. 동일한 route tree와 shared owner
3. 동일한 configuration root cause
4. 동일한 critical journey
5. 마지막 수단으로 detector의 기본 cluster

cluster는 가장 높은 severity를 상속할 수 있지만 occurrence 수로 severity를 계속 올리지 않는다. 여러 파일의 같은 원인은 하나의 cluster로 표시하고 occurrence count는 영향 범위로만 사용한다.

## 9. Baseline And Diff

### Baseline file

기본 경로는 `.frontend-audit/baseline.json`이다. baseline에는 normalized finding의 fingerprint와 판정에 필요한 비민감 metadata만 저장한다.

```json
{
  "schemaVersion": "1",
  "toolVersion": "0.2.0",
  "createdAt": "2026-07-30T00:00:00.000Z",
  "analysisMode": "static-lite",
  "scopePolicyDigest": "sha256:example-scope-policy",
  "profileDigest": "sha256:example-profile",
  "detectorCatalogVersion": "2026-07-30.1",
  "capabilities": [
    "text-patterns",
    "route-path-inference"
  ],
  "externalTools": [],
  "partial": false,
  "partialReasons": [],
  "findings": [
    {
      "fingerprint": "next.metadata.route-coverage:pages/account",
      "detectorId": "next.metadata.route-coverage",
      "detectorVersion": "1",
      "severity": "medium",
      "evidenceLevel": "inferred",
      "applicability": "applicable",
      "exposure": "likely",
      "controlState": "missing",
      "journeyIds": [],
      "decision": "verify-first",
      "effectiveDecision": "verify-first"
    }
  ]
}
```

### Fingerprint

fingerprint는 다음 안정적인 요소를 사용한다.

- detector ID
- route ID, symbol 또는 configuration key
- 정규화된 상대 경로
- sink 또는 rule-specific identity

line, source 값, 발견 순서, occurrence count와 절대 경로는 사용하지 않는다.

### Diff rules

- `unbaselined`: 유효한 baseline이 없어 새 항목인지 판단할 수 없음
- `new`: baseline에 없는 fingerprint
- `worsened`: 같은 fingerprint에서 확인된 impact 또는 exposure가 증가하거나, 적용 가능한 control이 제거되거나, 프로젝트 정책의 명시적 transition 조건을 충족
- `unchanged`: 의미 있는 상태 변화 없음
- `resolved`: baseline에는 있으나 현재 결과에는 없음
- `unverified`: 현재 scan 범위가 해당 baseline finding을 다시 확인하기에 불완전함

PR 기본 출력은 `new`와 `worsened`다. baseline이 없으면 모든 finding을 `new`로 가장하지 않고 `unbaselined`로 표시한다. `resolved`는 별도 summary에 표시하고 `unchanged`는 요청할 때만 펼친다.

부분 분석에서는 검사하지 못한 scope의 baseline finding을 `resolved`로 표시하지 않는다. 해당 항목은 `unverified`로 유지하고 partial reason을 함께 기록한다. rename이나 route 이동처럼 identity가 바뀌는 변경은 자동 해결로 확정하지 않고 필요하면 migration mapping을 사용한다.

`decision` 전환만으로 `worsened` 또는 개선을 판정하지 않는다. 특히 `verify-first`, `observe`, `information-gap`은 위험의 높낮이가 아니라 다음 행동이므로 서로의 순서를 가정하지 않는다. baseline과 현재 결과의 capability, profile 또는 scope가 호환되지 않으면 영향을 받는 비교를 `unverified`로 두고 차이를 diagnostic으로 기록한다.

detector catalog가 바뀌었다는 이유만으로 모든 finding을 무효화하지 않는다. 같은 detector ID의 version이 바뀐 finding만 `unverified`로 보내거나 명시적 migration mapping을 적용한다. 새 detector의 결과는 `new`, 제거된 detector의 기존 finding은 `resolved`가 아니라 `unverified`로 분류한다.

`scopePolicyDigest`는 선택 root의 논리적 label, include/exclude policy, file budget과 analyzer option을 정규화해 계산한다. 일반 source 파일의 추가·수정·삭제는 이 digest를 바꾸지 않는다. 현재 scan이 각 baseline finding의 evidence scope를 실제로 포함했는지는 별도로 확인하며, 포함 여부를 증명할 수 없으면 `unverified`다.

### Suppression

suppression은 fingerprint를 기본 대상으로 하며 이유, owner와 유효한 만료일을 요구한다. suppression된 finding도 결과에서 삭제하지 않고 원래 `decision`을 보존한 채 `effectiveDecision: suppressed`와 적용 근거를 유지하며 CI gate에서만 제외한다.

rule ID 단위 suppression에는 path 또는 route scope, 명시된 detector ID 목록, 이유, owner와 유효한 만료일이 모두 필요하다. 미래 detector와 새 finding에는 자동 적용하지 않는다. 만료되거나 충돌하는 suppression은 적용하지 않고 diagnostic으로 보고한다. 영구적인 프로젝트 예외는 무기한 suppression으로 숨기지 않고 applicability policy 또는 확인된 control로 모델링한다.

## 10. Project Risk Profile

프로젝트 고유 위험은 일반 analyzer가 완전하게 추론할 수 없다. `.frontend-agent-playbook.json`에 담당자가 승인한 최소 context를 기록한다.

```json
{
  "schemaVersion": "1",
  "project": {
    "id": "web",
    "visibility": "mixed"
  },
  "criticalJourneys": [
    {
      "id": "checkout",
      "routes": [
        "/checkout/**"
      ],
      "impact": "high",
      "owners": [
        "commerce-frontend"
      ]
    }
  ],
  "routePolicies": [
    {
      "pattern": "/admin/**",
      "visibility": "internal",
      "indexing": "not-applicable"
    },
    {
      "pattern": "/articles/**",
      "visibility": "public",
      "indexing": "required"
    }
  ],
  "trustBoundaries": [
    {
      "id": "cms-html",
      "source": "external-content",
      "paths": [
        "src/features/articles/**"
      ],
      "requiredControls": [
        "approved-html-sanitizer"
      ]
    }
  ],
  "controls": [
    {
      "id": "edge-robots",
      "area": "seo",
      "appliesTo": [
        "preview"
      ],
      "verification": "deployment-check"
    }
  ],
  "suppressions": [
    {
      "fingerprint": "next.metadata.route-coverage:pages/legacy",
      "owner": "frontend-platform",
      "reason": "승인된 종료 예정 route",
      "expires": "2026-12-31"
    }
  ],
  "ci": {
    "mode": "report-only",
    "failOn": []
  }
}
```

### Profile rules

- package 이름이나 route 이름으로 profile 값을 자동 확정하지 않는다.
- analyzer는 발견한 route와 package를 바탕으로 profile 후보를 제안할 수 있다.
- 후보는 담당자 승인 후에만 profile에 기록한다.
- profile에는 secret, 실제 고객 데이터, 내부 endpoint 값 또는 개인 식별자를 넣지 않는다.
- profile 부재는 결함이 아니라 `project-context-missing` diagnostic이다.
- 내부 서비스의 SEO는 기본 `not-applicable`로 추론하지 않는다. visibility와 indexing intent를 확인하지 못했으면 `unknown`으로 둔다.
- suppression은 CI 판정만 제한한다. finding은 결과에 유지하고 상위 governance, 사용자 요구, 법적·보안 요구를 변경하거나 자동 수정 승인을 제공하지 않는다.
- suppression된 finding은 보고서에서 숨기지 않는다. active suppression은 CI gate만 제외하며 만료, scope와 owner를 함께 표시한다.
- route policy는 exact pattern, 더 구체적인 pattern, 일반 pattern 순서로 적용한다. 같은 우선순위에서 충돌하는 값은 하나를 임의 선택하지 않고 profile 오류로 처리한다.

## 11. Next.js Route-aware Analysis

### Route inventory

먼저 Router별 route inventory를 만든다.

```json
{
  "id": "pages:/products/[id]",
  "router": "pages",
  "sourcePath": "pages/products/[id].tsx",
  "urlPattern": "/products/[id]",
  "layoutChain": [
    "pages/_app.tsx"
  ],
  "visibility": "public",
  "indexing": "required"
}
```

### Pages Router

각 page를 독립적으로 검사하고 다음을 추적한다.

- page 내부의 `next/head`
- page가 import한 shared SEO 또는 layout component
- `_app`과 `_document`에서 제공하는 전역 기본값
- dynamic title, canonical과 robots 값
- API route, test, story와 non-route module 제외

저장소 한 곳의 `<Head>`는 전체 page coverage를 의미하지 않는다. `_app`의 기본 metadata가 있더라도 route별 고유 정보가 필요한지는 별도 `conditional` finding으로 남긴다.

### App Router

각 `app/**/page.*`에 대해 다음을 추적한다.

- 가장 가까운 `layout.*`부터 root layout까지의 metadata 상속
- static `metadata`
- `generateMetadata`
- route group과 dynamic segment
- `robots`, `sitemap`, `manifest` metadata route
- `not-found`, redirect와 route handler 경계

`generateMetadata`가 있으면 `covered`로 확정하지 않고 `dynamic-unverified`로 표시할 수 있다. 정적 분석이 반환값을 확인하지 못하면 실제 렌더링 검증을 제안한다.

### Sitemap and robots

다음 구현 형태를 각각 인식한다.

- `app/sitemap.*`, `app/robots.*`
- `public/sitemap.xml`, `public/robots.txt`
- Pages/API route 또는 framework config 기반 생성
- project profile에 기록된 edge 또는 외부 서비스 control

파일명 존재만 확인하지 않는다. 정적 export, handler 응답 또는 승인된 외부 control 중 무엇으로 제공되는지 evidence에 기록한다.

### Verification modes

- `static`: source와 config로 route coverage candidate 생성
- `deep`: 사용자가 제공한 build/start command와 base URL로 대표 route의 final HTML, status와 header 확인

`deep` 모드는 임의 명령을 자동 실행하지 않는다. 승인된 command와 격리된 환경이 있을 때만 별도 단계로 실행하며 network 결과를 source truth로 과장하지 않는다.

## 12. Data-flow Evidence

데이터 흐름은 한 번에 완전한 taint analysis를 목표로 하지 않는다.

### Stage 1: Structured local evidence

- HTML sink의 경로, line과 정적으로 확실하게 식별 가능한 symbol만 기록
- 같은 파일의 명시적 sanitizer 호출과 알려진 wrapper 흔적을 후보 control로 기록
- source expression을 안전하게 해석할 수 없으면 `unknown`으로 유지
- source, transform, control, sink를 finding의 `flow`에 저장

### Stage 2: Repository index

- AST로 sink argument, local assignment와 sanitizer call 관계 확인
- import와 export 관계
- route에서 component까지의 소유 경로
- 공통 `SafeHtml` wrapper 사용 여부
- 한 단계의 symbol alias와 wrapper 호출

Stage 2는 Phase 3에서 만든 parser-backed repository index를 재사용한다. 대상 프로젝트가 우연히 TypeScript를 설치했다는 전제에 의존하지 않는다. parser 의존성 도입은 fixture에서 정규식보다 유의미하게 오탐과 미탐을 줄인다는 증거를 확보한 뒤 별도 승인하며, 승인 전에는 Phase 3과 Phase 4로 진입하지 않는다.

### Stage 3: External analysis adapter

cross-file taint와 framework-specific flow에는 직접 만든 분석기 대신 Semgrep 또는 CodeQL 같은 검증된 도구의 SARIF 결과를 선택적으로 import한다.

- 외부 도구가 없어도 기본 analyzer는 동작한다.
- SARIF finding은 source tool과 rule ID를 유지한다.
- 명시적 mapping이 없는 SARIF finding은 local `ruleRefs`가 비어 있을 수 있으며 이를 mapping gap diagnostic으로 표시한다.
- 외부 finding도 같은 applicability와 project priority policy를 거친다.
- 외부 도구 결과를 자동으로 확정 취약점이나 `act-now`로 승격하지 않는다.

## 13. CLI And CI Contract

### Proposed CLI

```bash
node bin/frontend-agent-audit.mjs scan \
  --root . \
  --profile .frontend-agent-playbook.json \
  --format json \
  --output audit-result.json

node bin/frontend-agent-audit.mjs scan \
  --root . \
  --baseline .frontend-audit/baseline.json \
  --format markdown

node bin/frontend-agent-audit.mjs baseline \
  --from audit-result.json \
  --output .frontend-audit/baseline.json
```

초기 CLI는 외부 의존성 없이 현재 file exclusion과 input budget을 재사용한다.

`baseline` command는 `scope.partial=true`인 결과를 기본 거부한다. 제한된 baseline이 반드시 필요하면 `--allow-partial-baseline`과 비어 있지 않은 `--reason`을 함께 요구하고 scope policy digest와 partial reason을 baseline에 보존한다. 호환되지 않는 capability, detector catalog, profile 또는 scope를 조용히 비교하지 않는다.

### Filesystem and execution boundary

static scan은 대상 저장소의 code, package script, config module 또는 detector를 실행하지 않는다.

- filesystem adapter는 `lstat`과 `realpath`로 선택 root를 벗어나는 경로를 거부한다.
- symlink는 v0.2 static scan에서 따라가지 않고 제외 이유와 partial coverage를 기록한다.
- output, baseline과 analyzer-generated artifact는 현재 scan input에서 제외한다.
- 파일 예산과 binary, generated, environment-file 제외 정책을 CLI에도 동일하게 적용한다.
- SARIF adapter는 source snippet, environment value와 raw payload를 canonical result로 전달하지 않는다.
- SARIF input에도 파일 크기와 finding 수 제한을 적용하고 root 밖 절대 경로와 traversal path를 evidence에서 제외한다.
- deep mode는 exact command array, working directory, timeout과 허용 환경변수를 명시적으로 승인받는다.
- deep mode는 shell expansion을 기본 사용하지 않고 저장소의 package script를 자동 발견하거나 실행하지 않는다.
- command output은 secret과 개인정보를 redaction한 뒤 필요한 status, header와 metadata evidence만 남긴다.

### Exit codes

| Code | 의미 |
| --- | --- |
| `0` | scan 완료, 설정된 차단 조건 없음 |
| `1` | `ci.failOn`에 해당하는 새 또는 악화 finding 존재 |
| `2` | 잘못된 인자, profile/schema 오류 또는 analyzer 내부 오류 |
| `3` | 분석이 부분 완료됐고 CI policy가 complete scan을 요구 |

기본 profile은 `report-only`이며 `failOn`이 비어 있다. profile이 없는 저장소에서 heuristic finding만으로 CI를 실패시키지 않는다.

부분 분석에서 code `3`을 사용할지는 profile의 complete-scan policy가 결정한다. `report-only`에서는 partial diagnostic을 결과에 남기되 그 이유만으로 non-zero exit을 반환하지 않는다.

### Output behavior

- `--format json`: canonical `AuditResult` 출력
- `--format markdown`: 같은 result에서 Markdown 생성
- `--format summary`: 사람이 읽는 짧은 terminal summary
- machine-readable output을 stdout에 쓰는 경우 진행 로그는 stderr에 쓴다.
- `--output` 사용 시 stdout에는 summary만 출력하거나 `--quiet`로 비운다.

### GitHub Actions adoption

구현 순서는 다음과 같다.

1. 이 저장소 fixture에서 CLI contract와 exit code를 테스트한다.
2. 별도 fixture repository에서 baseline diff를 테스트한다.
3. `report-only` workflow 예시를 제공한다.
4. 실제 프로젝트가 profile과 baseline을 승인한 후에만 blocking mode를 사용한다.

현재 `.github/workflows/validate.yml`은 플레이북 자체의 문서와 analyzer regression CI다. 대상 프로젝트를 감사하는 CI entrypoint와 혼동하지 않도록 이름과 README 설명을 분리한다.

## 14. Browser UI Changes

UI는 새 분석 로직을 소유하지 않고 `AuditResult`를 표시한다.

- `신규·악화`, `미기준선`, `기존`, `해결`, `미검증` tab 또는 동등한 filter 추가
- candidate마다 `왜 이 순위인가`, `반대 근거`, `부족한 정보`, `다음 검증` 표시
- route coverage는 전체 통과 표시 대신 route별 `covered`, `dynamic-unverified`, `missing`, `not-applicable` 표시
- project profile, analysis mode, capability 유무와 partial-analysis 상태를 상단에 표시
- source-to-sink evidence가 없으면 `데이터 흐름 미확인`을 명시
- 숫자 총점은 추가하지 않음

UI 개선은 JSON contract가 안정된 후 진행한다. 화면 요구 때문에 core schema를 임의로 바꾸지 않는다.

## 15. Implementation Phases

### Phase 0: Contract freeze

Deliverables:

- `schemas/audit-result.schema.json`
- `schemas/audit-baseline.schema.json`
- `schemas/project-profile.schema.json`
- dependency-free runtime assertion과 schema fixture test
- 이 문서의 finding, priority, diff와 profile vocabulary를 fixture로 고정
- 현재 analyzer result를 새 schema로 변환하는 compatibility adapter

Exit:

- 현재 browser fixture가 normalized result로 표현된다.
- source 원문이나 민감 값이 schema에 들어가지 않는다.
- 같은 fixture를 반복 실행했을 때 `generatedAt`을 제외한 결과가 같다.

### Phase 1: CLI and baseline

Deliverables:

- `bin/frontend-agent-audit.mjs`
- filesystem input adapter
- project profile loader, validation과 digest
- JSON, Markdown과 summary output
- exit code test
- baseline create/compare command

Exit:

- browser와 CLI가 같은 core analyzer를 호출한다.
- fixture에서 `unbaselined`, `new`, `worsened`, `unchanged`, `resolved`, `unverified`가 모두 검증된다.
- report-only 기본값에서 inferred finding은 CI를 실패시키지 않는다.
- invalid profile과 partial scan의 exit code가 구분된다.

### Phase 2: Detector and priority trace

Deliverables:

- detector registry
- stable rule ID와 `ruleRefs`
- applicability와 priority policy
- root-cause cluster key
- docs-to-detector consistency validation

Exit:

- 모든 internal detector finding에 detector ID, detector version과 유효한 local rule reference가 있다.
- 상위 candidate마다 선정 이유와 반대 근거가 출력된다.
- 우선순위 근거가 없는 finding은 `act-now`가 될 수 없다.
- 동일 root cause의 파일 수가 증가해도 priority가 무한 상승하지 않는다.

### Phase 3: Project profile and parser-backed repository index

Deliverables:

- project profile의 route policy, critical journey, trust boundary와 control semantics
- 승인된 parser를 사용하는 syntax, import와 export index
- Pages, App과 mixed route inventory
- route policy와 critical journey mapping

Exit:

- profile에서 내부·비검색 대상으로 확인된 route의 SEO가 명시적으로 `not-applicable`이 된다.
- mixed router는 tree별로 다른 검사 모델을 사용한다.
- profile이 없을 때 제품 중요도를 추측하지 않고 diagnostic을 남긴다.
- parser capability가 없는 surface는 import와 metadata 상속 검사를 실행한 것처럼 표시하지 않는다.

### Phase 4: Next.js metadata depth

Entry gate: Phase 3의 parser-backed repository index가 fixture에서 검증되고 해당 surface가 parser capability를 제공해야 한다. 이 gate가 없으면 path 기반 route inventory까지만 제공하고 import, export와 metadata 상속 결과를 `unknown` 또는 `dynamic-unverified`로 유지한다.

Deliverables:

- Pages Router page-level metadata coverage
- App Router metadata inheritance와 dynamic-unverified 상태
- sitemap과 robots implementation evidence
- route coverage UI와 Markdown section

Exit fixtures:

1. 한 page의 `next/head`가 다른 page를 통과시키지 않는다.
2. `_app`의 default head와 page-specific metadata를 구분한다.
3. root layout metadata가 App Router child route에 상속된다.
4. `generateMetadata`는 미발견이 아니라 dynamic-unverified다.
5. 내부 route는 metadata missing finding을 만들지 않는다.
6. app metadata route, public file과 승인된 edge control을 구분한다.

### Phase 5: Data-flow adapters

Deliverables:

- local source, control과 sink evidence
- Phase 3 AST index를 재사용하는 local flow analysis
- optional SARIF import

Exit:

- sanitizer package 존재만으로 모든 sink를 안전 처리하지 않는다.
- 같은 sink에 적용된 control과 저장소 어딘가의 unrelated import를 구분한다.
- source를 추적하지 못한 경우 `unknown`을 유지한다.
- 외부 SARIF가 없어도 CLI와 browser 분석은 정상 동작한다.

## 16. Test Strategy

### Unit

- fingerprint 안정성
- decision table
- baseline diff
- partial baseline 생성 거부와 명시적 제한 baseline
- capability, detector catalog, profile과 scope 호환성
- detector version 변경과 detector 제거 시 `unverified` 처리
- profile path matching
- route path normalization
- suppression expiry와 precedence

### Detector fixtures

- Pages, App과 mixed router
- public, internal과 unknown indexing intent
- shared metadata, dynamic metadata와 missing metadata
- sink와 same-file sanitizer
- sink와 unrelated sanitizer import
- generated, oversized, binary와 environment input exclusion

### Contract

- CLI JSON이 schema를 만족
- 같은 capability set의 browser와 CLI normalized result 동일
- capability가 다른 surface는 누락 detector를 diagnostic으로 공개
- Markdown은 finding ID와 priority trace를 보존
- stdout JSON에 진행 로그가 섞이지 않음
- exit code `0`, `1`, `2`, `3` negative path

### Adversarial

- line 이동으로 baseline finding이 새 항목이 되지 않음
- 부분 분석에서 검사하지 못한 baseline finding을 resolved로 표시하지 않음
- 파일 수 증가로 urgency가 상승하지 않음
- package 이름만으로 critical journey를 만들지 않음
- `next/head` 문자열이 주석이나 test에만 있어도 route coverage로 처리하지 않음
- profile suppression이 상위 보안 또는 governance 정책을 몰래 무효화하지 않음
- rule-level suppression이 미래 detector나 scope 밖 finding을 숨기지 않음
- partial scan이 clean result처럼 보이지 않음
- partial result에서 baseline 생성이 기본 거부됨
- root 밖 symlink를 읽지 않고 partial coverage를 보고함
- static mode가 package script와 config module을 실행하지 않음
- SARIF의 root 밖 path, source snippet과 입력 한도 초과를 거부함
- mapping 없는 SARIF rule을 임의의 local rule에 연결하지 않음

## 17. Migration And Compatibility

- 기존 `analyzeRecords(records, options)` API는 Phase 1까지 유지한다.
- browser와 CLI input adapter는 선택한 root 아래의 동일한 POSIX-style 상대 경로로 정규화한다.
- 기존 browser output과 Markdown은 compatibility adapter로 새 result를 소비하게 한다.
- 결과와 baseline은 analysis mode, capability set, detector catalog, profile digest와 scope policy digest를 기록한다.
- 기존 finding ID는 의미가 같으면 유지하고 detector ID를 별도로 추가한다.
- 의미가 달라지는 finding은 새 ID를 사용하고 baseline migration note를 제공한다.
- baseline schema version이 다르면 조용히 무시하지 않고 exit code `2` 또는 명시적 migration command를 사용한다.
- `analysis/index.html`을 직접 여는 dependency-free 사용 경로는 유지한다.

## 18. Open Decisions

구현 전에 다음 결정을 별도 승인한다.

1. Phase 3 진입 전에 TypeScript compiler API 또는 다른 parser 의존성을 repository에 포함할지 여부
2. baseline을 repository에 commit할지 CI artifact로만 관리할지 여부
3. blocking policy를 제공할 첫 detector 범위
4. deep runtime mode에서 허용할 command와 network boundary
5. project profile의 owner 형식을 자유 문자열로 둘지 CODEOWNERS와 연결할지 여부
6. 이 설계의 어느 Phase까지를 repository `v0.2` release gate에 포함할지 여부

이 결정들이 끝나기 전에도 Phase 0, Phase 1과 parser를 요구하지 않는 Phase 2 작업은 진행할 수 있다. Phase 3과 Phase 4는 parser 결정 전에는 시작하지 않는다.

## 19. Recommended First Slice

첫 구현은 다음 범위로 제한한다.

1. `AuditResult` schema와 compatibility adapter
2. project profile schema, validation과 digest
3. filesystem CLI, JSON output과 exit code
4. stable fingerprint와 baseline diff
5. 기존 detector 결과에 `detectorId`, `detectorVersion`, `ruleRefs`와 priority trace 추가
6. 현재 fixture와 CI에서 동일 capability의 browser/CLI parity와 capability 차이 diagnostic 검증

Next.js AST, deep runtime scan과 외부 SARIF는 첫 slice에 넣지 않는다. 이 순서가 완료되어야 이후 detector 개선의 효과를 baseline과 CI에서 측정할 수 있다.

## 20. Definition Of Done

Analyzer v0.2는 다음 조건을 모두 만족할 때 완료로 본다.

- 한 명령으로 저장소를 검사하고 JSON과 Markdown을 생성할 수 있다.
- 결과 schema와 exit code가 문서화되고 negative test가 있다.
- PR에서 새 finding과 기존 부채를 구분한다.
- 모든 internal detector finding이 local rule과 연결되고, external finding은 source rule과 mapping 상태를 보존하며, 모든 finding이 우선순위 판정 근거를 가진다.
- Pages, App과 mixed router fixture에서 route별 metadata coverage가 검증된다.
- 프로젝트 profile이 critical journey, indexing intent와 trust boundary를 판정에 반영한다.
- 데이터 흐름을 확인하지 못한 finding은 이를 숨기지 않는다.
- UI, CLI와 Markdown이 같은 normalized result 계약을 사용하고 surface별 capability 차이를 공개한다.
- 미탐, 부분 분석과 외부 control 미확인을 안전 판정으로 표현하지 않는다.
- 실제 저장소 forward-test에서 유효한 지적률과 잘못된 지적률을 기록한 뒤 release 여부를 판단한다.
