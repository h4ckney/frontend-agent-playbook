# 감사 도구 개선 실행 계획

작성일: 2026-10-25 · 최종 로컬 검증: 2026-10-26 · 기준 커밋: `1952b8a818668e231fbbb4b5833213b8c49cf7a3`

목표는 같은 문제의 반복 검토를 줄이면서 중요한 새 문제와 화면 결함을 놓치지 않는 것이다. 규칙 수나 탐지 개수는 성공 지표로 사용하지 않는다. 기존 `AuditResult`, CLI의 baseline·차단 정책, 가이드 적용 승인 경계를 유지한다.

실행 근거와 검증 상태는 [근거 기록](evidence/audit-upgrade-2026-10-25.md)에 한 번 기록하고 연결한다. 일반 개발 작업에는 [작업부터 머지까지의 플레이북](../playbooks/frontend-delivery.md)을 사용한다.

## 현재 수준과 이번 범위

| 영역 | 기준 커밋에서 확인한 것 | 이번 작업 / 후속 작업 |
| --- | --- | --- |
| 결과 계약 | CLI·브라우저가 공통 `AuditResult` 사용 | 계약을 보존하며 화면 처리 상태를 별도 저장 |
| 중복·변화 | category cluster, 경로별 fingerprint, baseline diff, 만료 예외 존재 | 화면에서 관련 항목을 접어 보고 개별 처리·재개; 실제 원인별 cluster 고도화는 후속 |
| 이슈 관리 | 로컬 Issue 초안 템플릿 존재 | 이번에는 로컬 처리 상태; GitHub 부모·하위 이슈 동기화는 후속 |
| AI 가이드 | governance·작업별 rule routing·감사/적용 스킬 존재 | 전체 규칙 주입 없이 관련 규칙과 검증 경로 연결 |
| E2E | 위험별 테스트 가이드, 정적 도구/경로 흔적 확인 | README만으로 E2E 흔적을 인정하던 오판 수정; 실제 여정·최근 실행 결과 연결은 후속 |
| CSS·레이어 | 스타일링·접근성 가이드 존재 | 보수적인 정적 위험 후보와 검증 가이드 추가; 실제 화면 결함 확정은 후속 브라우저 검증 |
| 인프라·버전 | framework 선언 버전, router 추론, 이관 문서 존재 | 기존 운영 문서의 inventory 계약 정리; 정확한 lockfile·배포 정보 자동 수집은 후속 |
| 최신 심각한 의존성 문제 | 일부 소스 위험 패턴 탐지 | 기존 advisory 도구 결과 통합은 후속; 현재 기능으로 CVE 검출을 주장하지 않음 |

현재 구조는 가이드·결과 계약을 갖춘 미출시 프리뷰다. parser 기반 import graph, 정밀한 모듈/route inventory, 완전한 데이터 흐름, 대상 시스템 런타임·배포 안전성은 검증하지 않는다. 한 코드 파일에 탐지·정규화·정책이 함께 있는 부분은 있으나, 이번에 전체 모듈 시스템을 재작성하지 않는다.

## 1차 구현: 반복 검토와 화면 위험 후보

상태: 1차 로컬 구현과 검증 완료. Node 테스트 66개, 문서 57개 검사, 실제 Chrome의 14개 확인 시나리오를 통과했다. 공개 release, 팀 도입, 실제 서비스 효과는 미확인이다. 실행 원문과 확인 범위는 근거 기록을 따른다.

### 화면 처리 상태

- canonical finding과 CI 판정은 그대로 보존한다. 로컬에서 닫는 동작이 검사 결과 삭제나 CI suppression을 뜻하지 않는다.
- 관련 항목을 접힌 부모 아래 발견 위치로 보여준다. 이 묶음은 탐색 단위이며 동일 원인 확정이 아니다.
- 닫을 때 이유와 만료일을 남긴다. 오탐 또는 위험 수용을 검증된 수정 완료로 표시하지 않는다.
- 수정 확인 요청은 미해결 상태로 남기며, 다시 열기를 제공한다.
- 저장한 처리 상태는 프로젝트 구분키와 finding fingerprint에 묶는다. 재선택·가져오기에서 프로젝트 불일치나 잘못된 형식을 거부한다.
- 같은 근거의 반복 발견에는 기존 상태를 적용한다. 만료·판정에 영향을 주는 근거 변경은 다시 확인하도록 드러낸다.
- 이번 브라우저 구현은 finding의 관련 파일과 선택된 package manifest 내용의 digest를 처리 상태 서명에 포함한다. 이것은 로컬 검토의 재확인 신호이며 runtime·외부 dependency·서버 동작의 동일성을 증명하지 않는다.
- 새 경로는 별도 fingerprint로 드러난다. 파일 안 새 위치 추적과 rename identity의 정밀화는 현재 한계로 남긴다.
- 브라우저 저장이 불가능하거나 지워졌을 때를 위해 결정 내보내기·가져오기를 제공한다. 소스 원문·인증정보·환경 값은 결정에 저장하지 않는다.

완료 조건: 닫기·재개·만료·변경 후 재표시·프로젝트 격리·잘못된 import·저장 실패 경로가 검증되고, Markdown 원본 보고서와 CI 위험 결과가 UI 처리 때문에 조용히 사라지지 않는다.

### CSS·z-index 검사

정적 후보는 selector와 선언 블록 안에서 확인 가능한 조합만 다룬다. 고정 크기·큰 z-index·overflow 선언 하나만으로 결함을 생성하지 않는다. 서로 다른 블록의 선언을 합쳐 존재하지 않는 위험을 만들지 않는다.

| 단계 | 검사 내용 | 증거 수준 |
| --- | --- | --- |
| 정적 후보 | overlay의 clipping·position·context 조합, 큰 고정 너비와 제약 부재 | 위험 추론; 실제 화면 결함 미확정 |
| 저장소 검토 | DOM 조상, Portal, top layer, 레이어 토큰, CSS cascade·전역 override | 코드·설정 근거; 실행 결과와 구분 |
| 브라우저 재현 | modal/menu/tooltip/toast, 스크롤·확대·긴 텍스트·breakpoint 전후 | 해당 route·상태·환경에서 관찰한 결함 |
| 회귀 검증 | 정상 클릭·키보드·레이아웃 assertion과 검토된 screenshot | 검사한 범위의 재현/회귀 근거 |

정적 후보는 DOM 조상·선언 적용·실제 viewport를 알지 못한다. inline style, CSS-in-JS, utility class의 최종 조합, SCSS의 모든 계산·중첩, 브라우저 top-layer 동작까지 분석했다고 주장하지 않는다. 실제로 수행하지 않은 capability는 결과·근거에 표시한다.

이번 후보 ID는 `styling.overlay-clipping-context`와 `styling.fixed-overlay-width`다. 첫 항목은 overlay 이름의 독립 선언 블록 안에 clipping overflow·수치 높이 제약·context 조건이 함께 있을 때, 둘째는 같은 종류의 블록에서 640px 이상 고정 너비와 지역 `max-width` 선언 부재 또는 `none`이 관찰될 때 검토를 제안한다. 후자는 non-none 선언의 존재만 확인하며, 그 선언이 유효하고 실제 responsive cap으로 작동하는지는 증명하지 않는다. 이 수치는 heuristic 진입 조건이며 지원 화면 크기나 제품 결함 판정 기준이 아니다. 단순한 대응 min-width 미디어 조건 등 코드로 판별 가능한 완화 근거는 제외한다.

완료 조건: 양성·음성 fixture, 주석·무관한 블록·의도적 scroll 컨테이너 사례를 확인한다. 같은 원인의 여러 화면을 묶더라도 독립 수정이 필요한 경계는 합치지 않는다. CI 기본값은 report-only다. 기존 profile이 명시적으로 `decision:verify-first` 또는 해당 severity를 포함하는 selector로 차단하면 새 CSS 후보도 정책과 baseline 상태에 따라 차단 대상이 될 수 있다. detector catalog 갱신을 도입할 때 기존 profile의 영향과 적용 범위를 검토하고, 실제 화면 결함 확인과 정책상 차단을 구분한다.

## 다음 단계와 진입 조건

| 순서 | 작업 | 시작에 필요한 입력 | 완료 근거 |
| --- | --- | --- | --- |
| 2 | 대상 프론트에서 실제 화면 검사 | 저장소/실행 주소, 지원 브라우저·너비, 대표 route·상태, 테스트 계정/데이터 경로 | 재현 절차, screenshot·trace, 정상 클릭·포커스·scroll 결과 |
| 3 | 문제 identity·GitHub 연동 | 현재 issue 운영 방식·권한, 원인별 scope, 변경/rename 비교 기준 | 같은 문제 반복 검사 시 새 issue 없음, 재시도 멱등성, 재발 시 기존 issue 재개 |
| 4 | 여정·CI·개발 워크플로 연결 | 프로젝트 branch·review·merge 정책, 실제 test 명령 | critical journey와 테스트/최근 실행 커밋 연결, 검증되지 않은 머지·배포 상태 분리 |
| 5 | 운영 문서·패키지 위험 수집 | 기존 인프라/버전 문서, lockfile, advisory 결과 접근 경로 | 정확한 설치 버전, 누락/불일치, advisory의 조회 시점·영향 범위·수정 버전 근거 |
| 6 | parser·모듈 경계 분석 | 대표 프로젝트·현재 미탐 fixture, 기존 도구 비교 | 정규식 대비 유효 지적·미탐 개선 증명 후 의존성 도입 결정 |

실제 서비스 주소가 제공되지 않은 현재에는 2단계의 결함 발견·수정·실기기 검증을 완료했다고 표시할 수 없다. 외부 이슈 생성·수정, 주기 검사 설정, merge·release는 실제 실행과 권한 근거가 생길 때 별도 기록한다.

## 문제 하나를 다루는 기준

하나의 수정과 검증으로 닫을 수 있는 문제를 하나의 작업 단위로 삼는다. 파일 수나 검사 문구 유사성으로 동일 원인을 확정하지 않는다.

```text
프로젝트 감사 현황 (반복 실행마다 새 이슈를 만들지 않음)
└─ 문제: 공통 Dropdown의 clipping 경계
   ├─ 영향 화면·재현 상태·발견 위치
   ├─ 증거 / 아직 모르는 것 / 처리 결정
   └─ 수정 PR / 검증된 커밋 / 재확인 조건
```

개별 발견 위치는 기본적으로 하위 기록이다. 담당자·수정·완료 조건이 독립적일 때만 하위 이슈로 승격한다. GitHub 연동 시 동일성은 repository·detector·경계·안정적인 code identity로 관리하고, 외부 도구의 원본 ID와 advisory 별칭을 보존한다. 자동 root-cause 확정과 의미 유사도만으로의 병합은 하지 않는다.

알림은 새 문제, 검증된 악화, 재발, 담당자 판단 필요에만 보낸다. 변경 없는 검사에서는 기존 상태를 갱신하고 새 댓글·알림·이슈를 만들지 않는다. 지금 1차 구현은 이 알림 전송이나 GitHub 동기화를 제공하지 않는다.

## 인프라·버전·운영 문서 inventory

문서를 새 양식으로 복제하기 전에 기존 파일을 찾고 링크한다. 아래 값이 확인되지 않으면 `Unknown`과 확인 방법을 남긴다.

| 영역 | 최소 정보 | 확인 근거 |
| --- | --- | --- |
| 구조 | entry point, 모듈 경계, 상태·데이터 소유권, 외부 API | 코드·기존 아키텍처 문서·실행 흐름 |
| 버전 | Node, package manager, framework, React, TypeScript의 선언/해석 버전 | manifest·lockfile·runtime·workspace별 설정 |
| 배포 | 환경, build·deploy 경로, 설정 이름, rollback 지점 | CI·인프라 정의·기존 runbook; secret 값 제외 |
| 운영 | 모니터링, 첫 조사 위치, 복구 절차, 담당자 | 기존 dashboard·runbook·권한 정보 |
| 최신성 | 적용 범위, 검증 커밋·날짜, 재검토 조건 | 문서와 구현 대조; 수정일만으로 최신 판정하지 않음 |

최신 패키지 위험은 새 scanner를 직접 만드는 대신 이미 사용하는 Dependabot·OSV 등 결과의 수집부터 검토한다. lockfile 기반 직접/간접 의존성, 실행 환경, advisory ID·별칭, 영향 버전·수정 버전, DB 조회 시점, 실제 도달 가능성의 확인 수준을 구분한다. advisory가 없거나 조회가 실패한 상태를 안전 판정으로 만들지 않는다.

## 검증과 효과 확인

저장소 기본 검사와 관련 음성 경로를 통과한 뒤 실제 브라우저에서 1차 UI를 확인한다. 가짜 DOM smoke test, 실제 브라우저, 대상 서비스, 실기기 검증을 구분한다. release label·기존 stable tag는 이번 로컬 구현으로 바꾸지 않는다.

파일 변경 뒤에는 다음을 확인한다.

```bash
node scripts/validate-docs.mjs
node scripts/sync-plugin-package.mjs --check
node --test analysis/*.test.mjs bin/frontend-agent-audit.test.mjs scripts/guidance-approval.test.mjs
git diff --check
```

효과는 대표 프로젝트에서 반복 검사한 후 확인한다. 기본 지표는 동일 원인의 중복 작업 생성률, 유효 지적 비율, 검토 시간, 중요 미탐 사례다. 현재 목표 수치·운영 담당자·관찰 기간은 미정이며 측정 완료나 예약된 후속 점검으로 표현하지 않는다.

## 공식 근거

- [MDN stacking context](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Positioned_layout/Stacking_context): 레이어 경계와 조상 관계 확인.
- [MDN top layer](https://developer.mozilla.org/en-US/docs/Glossary/Top_layer): 일반 문서 레이어와 modal/popover 경계 구분.
- [Playwright actionability](https://playwright.dev/docs/actionability): 정상 조작이 이벤트를 받는지 확인; 강제 클릭으로 가림 검사를 우회하지 않음.
- [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots): 환경을 고정한 기준 이미지 비교와 차이 검토.
- [GitHub sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues): 기존 이슈 계층 활용.
- [GitHub PR 연결](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue): 기본 브랜치 대상 종료 키워드 동작.
- [GitHub dependency graph](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-graph-data): 정확한 의존성과 lockfile 근거.
