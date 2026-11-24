# 조직 정책 승인과 TUF 백업·복구 훈련

Risk: Level 2 — 정책 채택·복구 권한과 DB 전체 rollback 탐지를 확장한다.

[기존 조직 상태 운영](organization-trust.md)의 local-only 경로에 **owner/security 승인 → 독립 witness → 일관된 백업 → 승인된 새 경로 복구 → TUF 재갱신**을 추가했다. [검증 근거](evidence/governance-recovery-2026-11-23.md)와 [실행 가능한 controlled 훈련](../scripts/drill-organization-recovery.mjs)을 함께 읽는다. 실제 조직 승인·운영 배포·전원 장애 실험은 수행하지 않았다.

## 승인 권한과 신뢰 시작점

운영자가 별도로 확인한 [authority 양식](../examples/organization-trust/authority.example.json)에 새 UUID의 `storeId`, 조직 ID, 독립 `witnessDirectory`, 2~8 threshold, 서로 다른 Ed25519 공개키를 등록한다. owner/security 역할이 각각 최소 하나 필요하다. 동일 키를 두 ID로 등록하거나 owner 키만으로 quorum을 만드는 경우를 거절한다. 양식의 placeholder는 의도적으로 유효한 운영 설정이 아니며 그대로 실행하면 거절한다.

실제 키 소유자·역할·분리된 계정·보관 책임은 조직이 확인해야 한다. 코드는 서로 다른 키/역할을 검증하며 서로 다른 사람인지 SSO로 확인하지 않는다. authority 최초 배포는 별도 신뢰 경로이며 policy 자체가 자기 승인자를 정하지 않는다. 운영 권한 담당자가 검토한 authority를 scan 대상 밖의 private config directory에 0600으로 둔다. 키 파일도 별도의 private directory/0600을 사용한다. 공개키·threshold·witness 경로를 변경하면 digest가 바뀌어 기존 store는 거절한다. 자동 approver rotation/reset은 구현하지 않았다.

| 단계 | 검토할 내용 | 코드가 확인하는 내용 |
| --- | --- | --- |
| Enrollment | 기존 store 정책/anchor/floor를 동결하고 witness의 별도 복원 범위를 확인 | 서명된 전체 logical state digest, 조직 ID, authority digest; 갱신 lease가 없어야 함 |
| Policy adoption | 이전/새 정책의 repository/ref, issuer, 정확한 workflow identity, builder, parameters, roles, 기간, anchor/minimumFloor/refresh age | canonical 정책 digest/revision과 이전 정책 digest, owner/security quorum, 승인 기간과 서명 |
| Restore | 최신 witness checkpoint, 대상 새 경로, backup digest 또는 명시적 witness snapshot, 복구 후 refresh 필요성 | 정확한 checkpoint/target/source, 현 witness와 검토 내용 일치, quorum, 기존 경로 덮어쓰기 금지 |

승인 요청은 기본 24시간 유효하며 최대 7일까지 검증한다. request UUID·action·조직/store/authority·검토 내용 digest·정확한 전이를 서명한다. 다른 action/조직/store, 변경된 정책, 부족한/중복/잘못된 서명, 만료·미래 요청은 거절한다. 적용된 승인 기록은 DB와 witness logical snapshot에 보존한다. 채택 이후 요청의 원래 만료가 과거가 되었다는 이유만으로 기존 정책을 소급 폐기하지 않는다. 정책 철회는 새 revision으로 profile 제거/변경을 승인한다.

## 승인 요청·서명·적용

아래 `/operator/config`, `/operator/keys`, `/operator/requests`, `/operator/backups`, `/operator/stores`는 실제 운영 경로로 바꾸고 각각 private POSIX 권한으로 준비한다. witness는 이 DB/백업과 **다른 snapshot·restore 단위**에 둔다. 단순히 형제 디렉터리로 나누는 것만으로 다른 복원 단위가 되지는 않는다. authority는 동의한 운영 담당자가 배포하며 예제 복사나 저장소 PR 머지는 회사 정책 승인이 아니다.

```sh
# 새 store만 최초 초기화. 기존 store는 재초기화하지 않는다.
node verification/organization-trust.mjs init --store /operator/stores/active
node verification/organization-governance.mjs plan-enroll \
  --store /operator/stores/active --authority /operator/config/authority.json \
  --output /operator/requests/enroll.json
```

두 승인자는 요청의 전체 review와 digest를 각각 검토한다. `sign` helper는 명시한 Ed25519 PKCS8 PEM 키만 읽으며 key 생성·계정 로그인·환경 token 수집을 하지 않는다. 암호화 PEM/HSM/KMS provider 연동은 별도 범위다. 실제 조직 키를 예제나 공개 근거에 넣지 않는다.

```sh
node verification/organization-governance.mjs sign \
  --authority /operator/config/authority.json --request /operator/requests/enroll.json \
  --approver policy-owner --key /operator/keys/owner.pem --output /operator/requests/owner.json
node verification/organization-governance.mjs sign \
  --authority /operator/config/authority.json --request /operator/requests/enroll.json \
  --approver security-reviewer --key /operator/keys/security.pem --output /operator/requests/security.json
node verification/organization-governance.mjs combine \
  --authority /operator/config/authority.json \
  --approval /operator/requests/owner.json --approval /operator/requests/security.json \
  --output /operator/requests/enroll-approved.json
node verification/organization-governance.mjs enroll \
  --store /operator/stores/active --authority /operator/config/authority.json \
  --approval /operator/requests/enroll-approved.json
```

다음으로 `plan-adopt --store ... --authority ... --policy /operator/policy.json --output NEW_REQUEST.json`을 실행한다. 같은 sign/combine 절차로 **새 요청**에 서명하고 다음 명령으로 채택한다. 요청/서명/backup 출력은 새 파일에만 쓸 수 있다. Enrollment 승인 전후 legacy writer를 동결한다. 첫 witness 준비/transaction 실패로 불완전한 파일이 남으면 자동 reset하지 않으며 원본을 보존하고 운영자가 초기화 실패를 조사한다.

```sh
node verification/organization-trust.mjs adopt --store /operator/stores/active \
  --organization example-platform --policy /operator/policy.json \
  --governance /operator/config/authority.json --approval /operator/requests/adopt-approved.json
# 기존 refresh/status/recover 명령에도 --governance를 함께 지정한다.
node bin/frontend-agent-audit.mjs scan --root /project \
  --organization-policy /operator/policy.json --organization example-platform \
  --trust-profile frontend-main --trust-store /operator/stores/active \
  --organization-governance /operator/config/authority.json --format json
```

**보호된 운영 launcher/CI는 `--organization-governance`를 반드시 고정한다.** Enrollment된 DB는 format version 2로 표시하여 기존 version-1 도구도 거절하도록 한다. 현재 도구도 governance 없이 열면 거절한다. 다만 enrollment 전의 오래된 DB로 tag 자체까지 복원하면 그 DB만으로 예전 enrollment 사실을 알 수 없다. 외부 authority를 명시하는 경로가 이를 `governance-enrollment-required`로 차단한다. 기존 local-only/standalone 모드는 이 보장을 제공하지 않는다. 소비자는 `trustContext.governance.mode == external-witness`와 현재 scan 실행을 요구해야 하며 출력 JSON 필드 자체를 암호학적 증명으로 간주하지 않는다.

## 독립 witness와 전체 DB rollback

Witness는 별도 private `witness.sqlite`에 최신 sequence, authority/store ID, active root, 전체 logical state digest와 현재 snapshot을 보관한다. 모든 보호된 읽기/쓰기 transaction에서 전체 조직·domain·승인 기록의 canonical digest를 비교한다. 주 DB의 policy/floor/state/generation을 함께 과거로 바꾸거나 같은 generation의 내용을 바꾸면 `whole-store-rollback-or-tampering`으로 차단한다. DB/authority/witness 누락·손상·서명/선택 오류도 이전 성공으로 대체하지 않는다.

[SQLite ATTACH 규약](https://www.sqlite.org/lang_attach.html)과 [multi-file atomic commit](https://www.sqlite.org/atomiccommit.html)에 따라 실제 파일 DB 둘을 연결하고 `BEGIN IMMEDIATE`, DELETE journal, 양쪽 `synchronous=FULL`로 함께 commit한다. WAL은 거절한다. SQLite lock으로 서로 다른 연결/프로세스의 쓰기와 복구를 직렬화한다. 네트워크 fetch 동안 transaction을 잡지 않고 기존 영속 refresh lease를 사용한다. macOS/Linux의 정상 locking/fsync를 제공하는 local POSIX filesystem만 검증했다. NFS, 다중 host/HA, 임의 VFS, 잘못된 시스템 시각, 실제 전원 차단·디스크 controller 거짓 flush는 검증하지 않았다.

**한계:** 주 DB와 witness/authority를 함께 같은 과거 사본으로 돌리면 로컬 파일만으로 탐지할 수 없다. 이전 hash chain도 함께 돌아가므로 해결책이 아니다. 이 구현은 remote append-only/WORM/하드웨어 monotonic counter가 아니며, 같은 UID 관리자 공격·호스트 전체 snapshot rollback을 막는다고 주장하지 않는다. 실제 적용자는 witness를 독립 restore 단위로 보존하고 그 권한·복원 경계를 확인해야 한다. 이 절은 로컬 witness 모드에 적용된다. [원격 witness와 호스트 전체 롤백 복구](remote-witness-recovery.md)에서 원격 체크포인트를 고정하는 경로를 제공한다.

## 백업과 승인된 복구

```sh
node verification/organization-governance.mjs backup \
  --store /operator/stores/active --authority /operator/config/authority.json \
  --output /operator/backups/NEW_BACKUP.json
node verification/organization-governance.mjs plan-restore \
  --authority /operator/config/authority.json --target /operator/stores/recovered \
  --backup /operator/backups/NEW_BACKUP.json --output /operator/requests/restore.json
# restore.json을 위의 두 역할 sign/combine 절차로 승인한 뒤 실행한다.
node verification/organization-governance.mjs restore \
  --authority /operator/config/authority.json --target /operator/stores/recovered \
  --backup /operator/backups/NEW_BACKUP.json --approval /operator/requests/restore-approved.json
```

백업은 SQLite 전체 row의 **logical JSON snapshot**이며 live DB 파일 복사가 아니다. lease 없는 일관된 transaction에서 정책·domain state/floor·승인 기록과 witness checkpoint를 묶는다. DB/witness 내부로의 출력과 덮어쓰기를 거절한다. snapshot 16MB, 단일 조직, 최대 16개 domain 이력, 256개 승인 기록의 현재 예산을 넘으면 중단하며 자동 정리/낮은 floor로 초기화하지 않는다. 8개 현재 domain 제한과 별도로 삭제 후 이력도 예산에 포함된다.

기존 백업은 witness보다 오래되면 **정상적인 과거 백업이어도 복구 입력으로 거절**한다. 최신 backup이 없다면 `plan-restore`와 `restore` 양쪽에서 `--backup`을 명시적으로 생략하여 현재 독립 witness의 최신 snapshot을 선택할 수 있다. request에는 그 source 선택을 서명한다. 둘 사이 witness가 바뀌면 요청을 다시 검토해야 한다. 현재 witness도 없거나 손상됐으면 복구 근거가 없는 것이며 DB를 지워 재bootstrap하지 않는다.

복구는 빈 새 경로에만 수행한다. witness active root와 sequence를 새 DB와 함께 전진시켜 이전 store/진행 중 writer/opaque token을 차단한다. policy revision·최신 floor·승인 이력을 보존하고 모든 state를 `organization-restore-needs-refresh`로 바꾼다. 복구 성공 자체는 인증 성공이 아니다. 새 경로로 status 확인 → 승인된 현재 정책으로 명시적 refresh → scan 순서가 필요하다. `witness --authority ...`는 path/비밀 없이 sequence/digest를 조회한다.

## 훈련·복구·후속

```sh
node scripts/drill-organization-recovery.mjs --output NEW_REHEARSAL_RECEIPT.json
```

이 명령은 임시 controlled owner/security 키와 TUF 서명으로 승인·백업·오래된 백업 거절·실제 주 DB 파일 전체 rollback 탐지·최신 witness 복구·fresh TUF 강제·현재 백업 복구를 수행한 뒤 임시 키/DB를 삭제한다. 실제 조직 설정은 건드리지 않는다. [이번 7단계 receipt](evidence/governance-recovery-2026-11-23/recovery-drill.json)는 controlled 관찰이며 운영 복구 RTO/RPO 측정이 아니다. SIGKILL된 attached transaction 재개방 테스트도 실제 전원 장애와 구분한다.

코드 rollback은 이 PR revert로 새 경로 사용을 중단하는 것이다. enrollment된 DB/witness/approval 기록을 보존하고 낮은 revision/floor로 복원하거나 legacy 모드로 자동 우회하지 않는다. 운영 도입 전 owner가 witness 별도 복원 범위·키 분리·launcher 고정·백업 보존·실제 restore drill을 수락해야 한다. 실제 owner·운영 측정 기간은 미정이고 자동 예약을 만들지 않았다. 다음 우선순위는 원격 append-only witness/카운터, approver rotation, schema migration과 운영 환경의 power/volume failure drill이다.

- **Why:** 승인 주체와 DB 밖 최신 상태를 연결해야 정책/DB의 과거 사본이 다시 권한을 얻지 않는다.
- **System change:** 서명 quorum·전이 기록·연결 witness transaction·일관된 백업·승인된 새 경로 복구를 추가했다.
- **First look:** 고정 authority와 witness sequence/digest → 현재 active store/lease → 승인 전이와 TUF refresh reason 순서다.
