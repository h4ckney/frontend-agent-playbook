# 개선 근거와 검증 기록

작성일: 2026-10-25 · 최종 검증: 2026-10-26 00:04 KST (Asia/Seoul)

아래 실행 상태와 JSON은 커밋 전 로컬 검증 시점의 기록이다. 이후 커밋·원격 CI·머지 결과는 이 변경을 전달하는 PR의 실행 기록을 따른다. 원격 작업이 진행돼도 당시의 로컬 검증 결과를 사후 덮어쓰지 않는다.

이 문서는 [개선 계획](../audit-upgrade-plan.md)의 근거 원장이다. 소스·설정에서 관찰한 사실, 인위적인 입력으로 재현한 결과, 실제 브라우저 검증, 계획을 구분한다. 코드는 공개 저장소 기준이며 실제 서비스의 사용자 데이터·토큰·환경 값은 수집하지 않는다.

## 기준과 확인 범위

| 항목 | 확인값 | 한계 |
| --- | --- | --- |
| 저장소 | `h4ckney/frontend-agent-playbook` | 다른 서비스 프론트의 구현 상태를 대신하지 않음 |
| 기준 커밋 | `1952b8a818668e231fbbb4b5833213b8c49cf7a3` | 이번 변경 이전 상태 |
| GitHub / 원본 로컬 | 기준 커밋 일치, 원본 working tree clean 확인 | 브랜치 보호·필수 승인 설정은 미확인 |
| 이번 작업 | 격리한 작업 사본의 `feature/audit-triage-layout` | 원본 로컬과 main 변경 없음; 원격 게시·release 별도 |
| 대상 서비스 | 실행 주소·대표 route·지원 환경 미제공 | 서비스의 깨진 화면 발견·수정·실기기 검증을 주장하지 않음 |

## 기준 구현에서 확인한 사실

| ID | 관찰 | 근거 | 의미 |
| --- | --- | --- | --- |
| E-01 | CLI와 브라우저가 공통 정규화 계약을 사용 | [audit-contract.js](../../analysis/audit-contract.js), [CLI](../../bin/frontend-agent-audit.mjs) | 새 UI 처리 상태는 분석 계약과 분리할 수 있음 |
| E-02 | 경로별 fingerprint·baseline diff·만료 suppression 존재 | [audit-contract.js](../../analysis/audit-contract.js) | 반복 검토 감소의 기반은 있으나 작업 관리와 동일하지 않음 |
| E-03 | UI에 지속적인 처리 상태와 종료·재개 조작 없음 | [app.js](../../analysis/app.js), [index.html](../../analysis/index.html) | 이번 1차 구현 대상 |
| E-04 | 코드리뷰·테스트 가이드와 PR/main 검증 CI 존재 | [code-review](../../rules/code-review.md), [testing](../../rules/testing.md), [workflow](../../.github/workflows/validate.yml) | 전체 branch→PR→merge 운영 경로는 별도 연결 필요 |
| E-05 | browser smoke는 Node vm의 fake element 사용 | [browser-smoke.test.mjs](../../analysis/browser-smoke.test.mjs) | 실제 browser E2E나 화면 정상 근거가 아님 |
| E-06 | 버전은 처음 찾은 package manifest의 선언값 중심 | [detectProjectContext](../../analysis/audit-contract.js) | lockfile exact version·workspace별 지원 상태는 미확인 |
| E-07 | 스타일 가이드는 있지만 CSS 화면 결함 탐지 없음 | [styling rule](../../rules/design-system-styling.md), [analyzer](../../analysis/analyzer.js) | 정적 후보와 runtime 검증을 구분해서 보강 |
| E-08 | analyzer 설계의 문제 표에 구현 전 상태가 남음 | [analyzer design](../analyzer-v0.2-design.md) | 과거 표로 명시해 구현 완료 기능 재제안 방지 |

위 링크는 작업 사본의 변경 후 파일도 가리킨다. 기준 동작을 재확인하려면 기준 커밋과 비교한다. 기준선 이후의 변경을 원래 구현의 근거로 혼동하지 않는다.

## 재현 입력과 판정

앞선 조사에서 다음 입력을 `createAuditBundle`과 `compareWithBaseline`에 전달해 기준 구현의 결과를 관찰했다. 재현용 입력은 합성 데이터이며 운영 결함 재현이 아니다. 재실행 진입점은 [재현 스크립트](../../scripts/reproduce-audit-gaps.mjs)다. 실행 산출물은 [변경 전](audit-probes.before.json)과 [변경 후](audit-probes.after.json)를 비교한다.

| ID | 입력 | 기준 결과 | 이번 처리 / 남은 한계 |
| --- | --- | --- | --- |
| P-01 | 테스트 실행 코드 없이 `e2e/README.md`만 존재 | `testing.e2e-path-missing` 없음 | 변경 후 gapReported=true; 실제 여정 커버리지는 여전히 미확인 |
| P-02 | `KEY="access_token"; localStorage.setItem(KEY, userToken)` | 인증 저장소 finding 없음 | 상수·래퍼 데이터 흐름 미탐 유지; 이번에 심층 보안 분석 완료로 표시하지 않음 |
| P-03 | admin/public 각각의 HTML 직접 삽입 | 하나의 HTML 위험 cluster | canonical category 묶음 한계 유지; 브라우저 triage는 모듈 디렉터리로 분리하나 동일 원인 확정은 아님 |
| P-04 | 같은 파일에 HTML 삽입 위치 추가 | 경로 fingerprint 동일, baseline `unchanged` | canonical 한계 유지; 브라우저는 관련 소스 digest 변경으로 기존 검토를 다시 표시 |
| P-05 | 여러 package의 서로 다른 framework 버전 | 처음 찾은 manifest 중심 project context | workspace별 정확한 환경 분석 후속 |
| P-06 | transform·clipping·고정 크기를 포함한 overlay CSS | 관련 styling finding 없음 | 변경 후 CSS 후보 2종 탐지; 실제 잘림/가림 확인은 runtime 필요 |

수정 후 재현은 기대 결과와 잔존 공백을 함께 출력해야 한다. 현재 남겨둔 공백의 존재를 테스트 실패 은폐나 전체 기능 완료로 해석하지 않는다.

## 변경 후 검증 기록

초기 기준 검사에서는 Node 테스트 49개, Markdown 54개 검사, plugin 동기화가 통과했다. 변경 후 최종 로컬 검사에서는 Node 테스트 **66개(기준 49개 + 신규 17개)**, Markdown **57개**, plugin 동기화와 diff 검사가 통과했다. Node 실행 환경은 25.2.1이며, 정의된 원격 CI의 Node 20 실행은 이번에 수행하지 않았다.

| 검사 | 최종 상태 | 실행 근거 |
| --- | --- | --- |
| 로컬 처리 상태 | 통과 | [테스트 로그](node-tests.log): 만료·변경·중복 실행·격리·잘못된 import·수정 완료와의 분리 |
| CSS 후보 / E2E 흔적 | 통과 | [변경 전](audit-probes.before.json) / [변경 후](audit-probes.after.json), 양성·음성 fixture |
| analyzer·contract·CLI·승인 gate 포함 전체 | 66개 통과, 실패 0 | [테스트 로그](node-tests.log) |
| 문서·plugin mirror·diff | 통과 | [검사 기록](validation.json) |
| 도구 대시보드 실제 브라우저 | Chrome 155.0.8059.85 / macOS, 14개 확인 통과 | [브라우저 결과와 소스 SHA-256](browser/browser-result.json) |
| 대상 서비스 실제 화면 | 미실행 | 서비스 주소·상태·실행 권한과 데이터 필요 |
| 실기기 | 미실행 | 실제 기기·OS·브라우저 및 결과 필요 |
| 원격 CI·PR·머지·배포 | 미실행 | 로컬 검증을 원격 실행이나 공개 release로 표현하지 않음 |

브라우저 확인 범위: 묶음 닫기·다시 열기 가능성, reload 복원, 상태 내보내기/가져오기와 키보드 file chooser, 모듈별 우선순위 격리와 닫힌 상위 위험 제외, dialog Escape·포커스 복원, CSS 후보와 소스 변경 후 재표시, 프로젝트 불일치 import 거부, 320/390/768/1440px document 가로 넘침 없음, 정상 클릭·재검증 요청, 미제출 프로젝트 이름으로 연결이 바뀌지 않음, 늦은 폴더 선택의 덮어쓰기 방지, localStorage 거부 시 메모리 상태·내보내기 유지다. page error는 0개였다. 지원 환경 전체나 대상 서비스 정상 판정이 아니다.

화면 증거: [데스크톱](browser/dashboard-1440.png), [모바일 390px 발견 묶음](browser/dashboard-review-390.png), [320px 발견 묶음](browser/dashboard-review-320.png), [닫기 대화상자](browser/dashboard-close-dialog.png). viewport 캡처를 직접 확인했다. 비교 기준 이미지를 승인한 visual regression test와는 구분한다.

최종 실행 명령:

```bash
node scripts/validate-docs.mjs
node scripts/sync-plugin-package.mjs --check
node --test analysis/*.test.mjs bin/frontend-agent-audit.test.mjs scripts/guidance-approval.test.mjs
node scripts/reproduce-audit-gaps.mjs
git diff --check
```

실제 브라우저 확인은 [선택 실행 스크립트](../../scripts/verify-dashboard.mjs)로 수행한다. Playwright는 호출 환경에서 제공하며 저장소 runtime 의존성이나 기본 CI 설치에 추가하지 않는다. 해당 URL을 서비스하는 로컬 서버를 준비하고 응답을 확인한 뒤 실행한다.

```bash
node scripts/verify-dashboard.mjs --url http://127.0.0.1:4381/analysis/ --output docs/evidence/browser --channel chrome
```

## 독립 리뷰에서 확인하고 수정한 회귀

| 문제 | 수정 | 확인 근거 |
| --- | --- | --- |
| 먼저 선택한 느린 폴더가 최신 선택을 덮어쓸 수 있음 | 선택 generation을 읽기 전에 증가시키고 stale 결과 무시, digest 입력 snapshot 고정 | 실제 브라우저의 지연 읽기 경합 시나리오 |
| 다른 모듈·닫힌 항목의 높은 위험이 우선순위에 남음 | 현재 묶음의 열린 항목으로 severity·decision·근거 재계산 | 두 모듈 CSS와 상위 위험 닫기 시나리오 |
| 재렌더링 후 묶음이 접히고 키보드 포커스가 사라짐 | 펼침 유지, 남은 조작/묶음 summary로 포커스 복원 | dialog 종료·Escape·window focus 시나리오 |
| 숨긴 file input의 label만 있어 키보드 가져오기 불가 | 폴더 선택·상태 가져오기를 실제 button으로 연결 | Enter file chooser·상태 roundtrip |
| 범위 변경이 미제출 프로젝트 ID를 연결할 수 있음 | 이미 연결한 ID로 범위 재검사 | 미제출 이름과 bound identity 분리 시나리오 |

원본의 상수/래퍼 인증 저장소 미탐, canonical cluster의 원인 구분, 파일 내부 baseline identity, workspace별 버전 판별은 남아 있다. 이를 1차 완료에 포함시키지 않는다.

## 근거의 해석 경계

- 정적 CSS 패턴은 선언 조합의 관찰과 위험 추론이다. DOM·cascade·미디어 조건·브라우저 layout을 실행하지 않은 상태에서 화면 깨짐을 확정하지 않는다.
- runtime 검증이 생기면 route·state·viewport·browser·commit별로 기록한다. 한 화면의 성공을 전체 화면 정상이나 실기기 정상으로 확대하지 않는다.
- UI에서 닫음은 검토 결정이다. canonical finding·CI policy·GitHub issue·검증된 수정 완료를 동시에 바꾸지 않는다.
- 로컬 source digest는 finding 관련 파일과 manifest의 변경을 재확인하게 하는 신호다. runtime·모든 dependency·서버 동작의 불변성을 증명하지 않는다.
- CSS 후보는 기본 report-only 정책에서 보고한다. 기존 명시적 blocking profile의 `decision:verify-first`나 severity selector에 포함될 수 있으므로 도입 시 영향 검토가 필요하다.
- source·advisory 부재와 검사 실패·부분 분석을 안전 판정으로 만들지 않는다.
- 외부 도구 연결, 알림, 예약 작업, 배포가 실제로 실행되지 않았으면 미실행 상태를 유지한다.

## 공식 문서 대조

2026-10-25에 아래 원문을 확인했다. 외부 제품의 동작이 바뀌면 적용 시 다시 확인한다.

| 출처 | 설계에 반영한 점 |
| --- | --- |
| [MDN stacking context](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Positioned_layout/Stacking_context) | 중첩된 stacking context를 따라 조사하고 z-index 숫자만으로 순서 확정하지 않음 |
| [Playwright actionability](https://playwright.dev/docs/actionability) | 가려진 컨트롤의 실제 이벤트 수신 확인, 강제 클릭 우회 금지 |
| [Playwright screenshot 비교](https://playwright.dev/docs/test-snapshots) | 기준/실행 환경의 일관성과 이미지 차이 검토; baseline 생성 자체는 정상 판정이 아님 |
| [GitHub PR-issue 연결](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) | 기본 브랜치 대상 PR에서 종료 키워드 처리; develop 반영과 최종 종료 구분 |

관련 제안 전체는 [실행 계획](../audit-upgrade-plan.md), 반복 사용 규칙은 [레이어·스타일 가이드](../../rules/design-system-styling.md)에 있다. 이 근거 기록을 각 템플릿에 복사하지 않는다.
