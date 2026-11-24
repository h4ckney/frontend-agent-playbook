# owner·security 승인 키 교체와 폐기

Risk Level 2. 조직 승인 키의 권한을 교체하고, 폐기된 키가 다시 채택되지 않도록 한다.

현재 정책과 TUF 상태를 유지하면서 v2 로컬 witness와 v3 원격 witness에서 owner·security 승인 키를 추가, 교체 또는 폐기할 수 있다. 공개키 지문, 승인 기록, 변경 순번을 남긴다. [검증 근거](evidence/approval-key-rotation-2026-11-24.md)

## 현재 정족수와 새 키 확인

새 authority 파일에서 `approverEpoch`를 정확히 1 높이고 `approvers`를 수정한다. 이전 파일에 epoch가 없으면 0으로 본다. 조직, store, threshold, witness endpoint와 전송 키 설정은 동일하게 유지한다. 유지하는 키의 ID와 역할도 그대로 둔다. 폐기된 Ed25519 공개키 지문은 이후에 ID를 바꾸어 등록해도 거절된다.

현재 owner·security 정족수와 다음 owner·security 정족수가 같은 요청을 각각 서명한다. 새로 추가되는 모든 키는 다음 정족수가 이미 충족된 경우에도 소유를 증명한다. 두 종류의 서명은 서로 교환할 수 없다. 폐기 대상 키의 서명 없이도 **남은 기존 키로 현재 정족수를 충족하면** 폐기할 수 있다. 기존 owner 또는 security 정족수를 구성할 수 없다면 이 절차로 임의의 새 정족수를 세울 수 없다. 그런 경우에는 [사전에 등록한 복구 정족수로 비상 복구](emergency-quorum-recovery.md)를 진행한다.

```sh
node verification/organization-governance.mjs plan-rotation \
  --store STORE --authority CURRENT.json --destination-authority NEXT.json \
  --output ROTATION_REQUEST.json

# 현재 정족수의 각 승인자가 실행한다.
node verification/organization-governance.mjs sign \
  --authority CURRENT.json --rotation-side current --request ROTATION_REQUEST.json \
  --approver CURRENT_ID --key CURRENT_KEY.pem --output CURRENT_SIGNED.json

# 다음 정족수와 새로 추가되는 각 승인자가 실행한다.
node verification/organization-governance.mjs sign \
  --authority NEXT.json --rotation-side next --request ROTATION_REQUEST.json \
  --approver NEXT_ID --key NEXT_KEY.pem --output NEXT_SIGNED.json
```

`combine --authority CURRENT.json`에 각 서명 파일을 별도의 `--approval`로 모두 전달하여 `ROTATION_APPROVED.json`을 작성한다. 운영자는 요청에서 기존 체크포인트, 이전과 다음 키의 역할·공개키 지문, 추가·폐기 목록을 확인한다. 진행 중인 TUF refresh lease나 요청 이후 변경된 상태가 있으면 적용이 거절된다.

```sh
node verification/organization-governance.mjs rotate \
  --store STORE --authority CURRENT.json --destination-authority NEXT.json \
  --approval ROTATION_APPROVED.json
```

`rotated` 후 보호된 launcher와 승인 워크플로에서 `NEXT.json`으로 전환한다. 기존 정책·승인 원문·TUF 저장소와 하한은 유지된다. 기존 인증 토큰은 무효가 되며 새 스캔은 현재 authority와 기존 TUF 상태의 유효성을 확인한다. 폐기는 **새 승인 적용**에 효력이 있다. 이미 적용된 정책과 역사적 서명은 감사와 검토에 남는다. 오프라인에서 이전 키로 만든 서명은 현재 authority에서 적용이 거절된다.

## 중단과 재개

v2는 주 DB와 로컬 witness를 하나의 SQLite transaction으로 바꾼다. v3는 먼저 HTTPS witness의 쓰기 권한과 최신 체크포인트를 검증한다. 승인한 정확한 내용을 담은 동결 상태를 먼저 로컬에 저장하고 v2/v3 일반 접근을 차단한다. 원격 서비스는 두 정족수와 새 키 소유 증명, 전이 전후의 TUF·정책·승인 이력을 독립적으로 확인한 뒤 단일 append로 현재 authority를 바꾼다. 원격 서버의 설치 시 authority digest는 시작점으로 유지되고, 현재 authority는 영속 이력의 마지막 체크포인트에서 읽는다. 기존 authority와 다음 authority는 같은 원격 endpoint를 사용한다. [Ed25519 검증 API](https://nodejs.org/api/crypto.html) · [SQLite transaction](https://www.sqlite.org/lang_transaction.html)

```sh
node verification/organization-governance.mjs resume-rotation \
  --store STORE --authority CURRENT.json --destination-authority NEXT.json
```

| 확인 지점 | 복구 방법 |
| --- | --- |
| v3 동결 전 오류, 원격 authority가 기존 그대로 | 원인을 고친 뒤 승인 범위·기존 체크포인트가 같으면 `rotate` 재실행 |
| 동결 후 첫 원격 게시 전 | 승인 유효기간 안에 `resume-rotation`으로 정확한 이전 요청을 적용 |
| 원격 게시 후 응답 유실 또는 로컬 커밋 전 | 같은 후보 digest로 재조회·재시도. 원격에 기록된 교체는 승인 유효기간이 지나도 로컬로 마무리 가능 |
| 이미 양쪽에 교체 완료 | `already-rotated` 반환. 새 항목을 다시 추가하지 않음 |
| 동결됐지만 원격 게시 전에 승인이 만료 | 만료된 교체를 원격에서 거절. 기존 원격 authority의 최신 head로 [이중 승인 복구](remote-witness-recovery.md#중단과-복구)를 수행해 새 경로를 활성화한 뒤 새 요청으로 다시 시작 |
| 더 최신 원격 전이 또는 로컬 변조 | 현재 원격 authority/head 확인 후 [이중 승인 복구](remote-witness-recovery.md#중단과-복구) |

v3 교체 중에는 양쪽 CLI가 pending 로컬 store를 일반 스캔용으로 열지 못한다. 서버는 이미 교체한 원격 head에 대해서만 같은 옛 authority의 재시도 요청에 응답하며, 옛 authority의 일반 읽기·쓰기는 차단한다. 격리된 v2 호스트의 두 파일과 기존 launcher까지 과거로 복원하는 경우에는 로컬-only 경계가 적용된다. v3 운영 launcher는 새 authority를 고정한다.

`node scripts/drill-approval-key-rotation.mjs --output NEW_RECEIPT.json`으로 HTTPS witness가 커밋한 직후 실제 CLI 프로세스를 종료하는 훈련을 반복할 수 있다. 원격 head와 정책·TUF 하한, 승인 원문을 비교하고 두 폐기 키로 새 승인을 적용할 수 없는지 확인한다. 실제 운영 키 변경과 개인키 폐기 또는 HSM 접근권한 회수는 조직 운영자가 별도로 수행한다.
