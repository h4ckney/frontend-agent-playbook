# 조직 승인·독립 witness·복구 훈련 근거 — 2026-11-23 KST

기준 main `d94473f46c477977eb10a83cb79eaf2c071afe32`, branch `feature/organization-governance-recovery`. [설계·승인·복구 runbook](../organization-approval-recovery.md)을 함께 읽는다. 이 문서는 로컬 관찰/controlled 훈련이며 PR/main 원격 CI와 머지는 해당 GitHub 기록을 따른다.

| 범위 | Observed |
| --- | --- |
| Controlled 복구 훈련 | [7단계 receipt](governance-recovery-2026-11-23/recovery-drill.json). owner/security test-key 승인, 일관된 백업, 오래된 백업 거절, 주 DB 파일 전체 rollback 탐지, 최신 witness에서 승인 복구/이전 경로 차단, fresh TUF 강제, 현재 backup에서 승인 복구 |
| 전체 회귀 | Node v24.22.3, 384/384 pass, fail/skip 0. 최종 [테스트 로그](governance-recovery-2026-11-23/node-tests.log)의 집계 참조. 기존 조직 27개와 새 governance 27개 포함 |
| 새 부정 경로 | [governance 회귀](../../analysis/organization-governance.test.mjs): 부족/중복/위조/owner-only 서명, 같은 public key 재등록, 다른 action/org/store/authority/policy/review/expiry, 이전 정책과 전체 DB 사본 복원, 동일 generation의 내용 변경, enrollment 전 DB 복원, stale/tampered backup, witness 누락/authority 교체, WAL, SIGKILL된 attached transaction, policy 철회 복구, token 재확인, 실제 CLI plan/sign/combine/adopt/restore/scan |
| 브라우저 | Chrome 157.0.8103.79 / macOS, [54개 시나리오·page errors 0](governance-recovery-2026-11-23/browser-result.json). checkout/served/browser hash 일치. PR/main의 별도 Chromium job도 머지 전에 확인. Node 전용 governance는 browser가 새 권한을 만들도록 하지 않음 |
| 계약·문서 | optional trustContext.governance, catalog 17/security revision 2026-11-23.2, CLI 도움말, authority placeholder 양식, 운영/복구 한계와 기존 local-only 문서의 후속 링크를 동기화 |
| 의존성 | npm package/lock 변경 없음. Node 내장 crypto/SQLite, 기존 verifier tooling만 사용 |

## 수동 적대 리뷰·수정

1. **높음 — 전체 주 DB rollback:** 이전 local-only 경로는 policy/state/floor를 함께 과거 사본으로 복원하면 최신 지식을 잃었다. 보호된 경로는 주 DB 밖 witness의 최신 logical digest와 매 transaction 대조하여 서명된 과거 정책/정상 TUF 자료가 포함되어도 거절한다. format version 2로 구버전 도구의 묵시적 downgrade도 차단한다. 같은 generation의 다른 내용과 나중의 승인된 profile 철회를 되돌리는 반례도 검사했다. 이 한계를 기존 모드에서 숨기지 않으며 모든 보호된 invocation은 외부 authority를 명시한다.
2. **높음 — 승인 검토 자료와 실행 전이의 불일치:** 검토 텍스트 자체가 request에 묶이지 않으면 승인자가 본 이전/새 policy 또는 복구 floor가 실제 전이와 다를 수 있다. reviewDigest·이전 정책 digest와 최신 restore review를 함께 검사하여 key 서명과 실행 상태를 일치시켰다. policy/review 변조·중간 갱신 반례를 거절한다.
3. **중간 — 프로젝트 안 witness 선택:** authority/main store만 외부인 경우에도 프로젝트 내부 witness가 선택될 여지가 있었다. scanner가 witness의 실제 경로도 검사하고 scan root 내부이면 거절하도록 수정했다.

주 DB/witness 갱신은 임의의 두 JSON commit 대신 SQLite ATTACH의 DELETE/FULL transaction으로 묶었다. 모든 변화 후 최신 head를 같은 commit에 기록하며, 복구는 active root와 generation을 전진시켜 이전 writer/token을 차단하고 명시적 refresh 전까지 rejected로 둔다. SIGKILL 후 양쪽 미완료 변경이 남지 않는 것을 관찰했다. 전원 차단/파일시스템 전체 장애를 검증한 것으로 표시하지 않는다.

초기 코드의 DER buffer를 문자열용 SHA helper에 넘기는 오류와 테스트에서 아직 채택하지 않은 policy로 status를 조회한 순서 오류를 수정했다. restore review를 더 이른 단계에서 검증하도록 강화한 뒤 부정 테스트도 현재 거절 경계에 맞췄다. 최종 수동 리뷰에서 확인한 중간 이상 결함은 수정 후 회귀로 확인한다. 독립 보안 스캐너나 별도 사람의 승인 보고서는 아니다.

## 운영 경계와 다음 확인

Observed는 임시 controlled 조직/키, local POSIX DB, 일관된 logical backup, process crash와 명시적 rollback 주입 범위다. 실제 회사 정책 승인/키 소유권 수락, 운영 RTO/RPO, 원격 WORM witness, 다중 host, 실제 전원/volume 장애, 신규 OIDC/Rekor 게시, production 배포는 수행하지 않았다. 테스트 키/DB는 종료 때 삭제하고 receipt에 경로/비밀을 기록하지 않는다.

주 DB와 witness/authority를 함께 과거로 복원하면 로컬 자료만으로 이를 탐지하지 못한다. 별도 디렉터리와 hash chain만으로 독립 복원/비가역성이 생기지 않는다. 보호된 launcher의 governance 인자 고정과 witness의 실제 별도 restore 단위가 전제다. 다음 P1은 실제 운영 owner의 승인·키 분리·독립 witness 보관/restore drill, P2는 remote append-only/monotonic counter와 approver rotation, P3는 schema migration/예산 확대다. 소유자·측정 기간은 미정이고 자동 예약을 만들지 않았다. 코드 revert 시 DB/witness 기록을 보존하며 과거 floor로 복원하지 않는다.
