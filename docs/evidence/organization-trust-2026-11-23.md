# 조직 정책·영속 TUF 운영 검증 — 2026-11-23 KST

기준 main `90f029720e0f0bb50a7dcce6dec5ebcbe6d14b0b`, branch `feature/organization-trust-store`. [설계·실행·복구 runbook](../organization-trust.md), [실행 예제](../../examples/organization-trust/README.md)를 함께 읽는다. 구현·로컬 관찰과 PR/main 원격 CI·머지 상태를 구분하며 최종 원격 기록은 GitHub를 따른다.

| 검사 | Observed / 범위 |
| --- | --- |
| 전체 회귀 | Node v24.22.3, 356/356 pass, fail/skip 0. [실행 로그](organization-trust-2026-11-23/node-tests.log). 최종 pass/skip/fail 집계는 로그 마지막 줄을 따른다 |
| 조직 전용 회귀 | [26개 테스트](../../analysis/organization-trust.test.mjs): 실제 controlled TUF/keyless 서명, 조직 격리, 채택 revision/철회, compiler/token 위조, 부분 실패 floor, state 단독 rollback, refresh lease/경쟁·PID 복구, 만료 경계, private 권한·symlink/hardlink, 별도 CLI 프로세스·SIGKILL transaction 복구, scan 인증·scope 안정성 |
| 실제 공개 읽기 | [7단계 persistence receipt](organization-trust-2026-11-23/public-persistence.json): 임시 private SQLite init/adopt → 공개 mirror refresh → 새 process status → 두 번째 refresh → 새 process status → 새 process opaque snapshot 재검증. root 16 / timestamp 841 / snapshot 166 / targets 14. 이는 조직 도입/신규 발급/게시/배포가 아님 |
| 브라우저 | Chrome 157.0.8103.79 / macOS, [54개 시나리오·page errors 0](organization-trust-2026-11-23/browser-result.json). 320/390px·서명/TUF 미검증·checkout/served/browser hash 검사 통과. 원격 Validate의 별도 Chromium job도 머지 전에 확인 |
| 의존성 | SQLite는 Node 내장 모듈. npm package/lock 변경 없음. 기존 고정 verifier와 이전 legacy TUF 회귀를 유지 |
| 문서·계약 | runbook/예제, AuditResult optional trustContext schema/browser copy, CLI 도움말, plugin 동기화, 구문·diff 검사. 최종 원격 job 로그로 재확인 |

## 적대 리뷰와 수정

- **높음 — 정책 객체 변조/위조 경계:** 초기 구현의 공개 compiled description을 변경한 뒤 채택 digest를 재사용할 여지가 있었다. compiler가 발급한 handle을 WeakMap에 연결하고 내부 정책을 비공개로 보관한다. 공개 policy/map을 바꾸거나 동일 내용의 plain object를 넣어도 권한을 만들지 못하는 음성 검사를 추가했다.
- **높음 — 정책 철회와 비동기 인증 경쟁:** 검증 시작 당시 승인만 확인하면 비동기 작업 사이의 정책 변경을 놓칠 수 있다. 검증 전후 opaque token의 영속 generation/revision/digest/lease를 transaction으로 다시 읽는다. 중간 철회 시 scan 전체가 거절되는 반례를 확인했다.
- **중간 — 최신성 경계와 상태 표시:** 마지막 성공 문자열만 표시하거나 max-age 경계와 같은 시각을 허용하면 현재 사용 가능성을 과장한다. status도 실제 TUF/floor/age를 검사하고 정확한 만료 시각부터 거절한다. 오래된/미래 시각과 실제 metadata 만료도 검사한다.

새 코드의 수동 적대 리뷰와 회귀를 기록한 것이며 독립 보안 스캐너 보고서/별도 사람 승인을 뜻하지 않는다. 초기 전체 테스트의 loopback 3개는 샌드박스 EPERM으로 실행되지 않아 허용된 환경에서 전체를 다시 실행했다. 초기 경쟁/하한 테스트 2개는 테스트 자체의 비동기 순서·compiler 사용을 바로잡고 재실행했다. 브라우저 및 CI 중 발견된 결함은 머지 전에 수정한다.

## 판단·경계·후속

일반 JSON 두 파일 대신 SQLite transaction을 택했다. state/checkpoint의 부분 commit과 동시 쓰기 문제를 줄이고 npm 의존성을 추가하지 않는 대신 Node 내장 모듈의 버전별 상태와 local POSIX 운영 범위를 수용했다. 기존 단일 state updater는 유지한다. [TUF 명세](https://theupdateframework.github.io/specification/latest/)의 서명·rollback·expiry 검사 위에 운영자 선택/정책 registry를 얹으며 전체 delegation이나 온라인 revocation을 구현했다고 주장하지 않는다.

후속 우선순위: **P1** 실제 조직 owner의 identity/anchor·refresh 빈도·보호된 저장소 승인 및 restore drill → **P2** 독립 checkpoint witness/백업·schema migration → **P3** 원격/다중 host 저장소와 개별 artifact revocation. 실제 조직 owner·기간은 미정이며 자동 예약을 만들지 않았다. 전체 DB+정책의 동시 과거 복원, 같은 UID/host 관리자 공격, 호스트/디스크 손실과 network filesystem은 이번 검증 범위 밖이다. PR revert는 코드 경로 중단이며 DB revision/floor를 낮추는 복구가 아니다.

- **Why:** 조직별 승인과 영속 TUF 연속성을 scan 결과의 권한과 연결한다.
- **System change:** 명시적 adopt/profile, transaction checkpoint와 lease, fail-closed scan 및 bounded context 출력.
- **First look:** status lease/시각/버전 → 채택 revision/digest → TUF와 authentication reason.
