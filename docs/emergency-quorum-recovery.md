# owner·security 정족수 상실 시 비상 복구

Risk Level 2. 정상 정족수를 잃었을 때 미리 승인한 별도 키로 새 정족수를 세운다.

현재 조직 정책, 승인 원문, TUF 저장소 데이터와 하한을 보존한다. 비상 복구에는 **사전에 등록한 복구 정족수**와 **다음 owner·security 정족수**가 필요하다. 조직의 일반 키와 같은 지문이나 ID를 복구 키에 사용할 수 없다. 등록이 없거나 복구 정족수마저 잃은 경우에는 이 절차를 사용할 수 없다. [검증 근거](evidence/emergency-quorum-recovery-2026-11-24.md)

## 사고 전 복구 정족수 등록

보호된 기존 authority의 사본에 다음 필드를 추가하고 `approverEpoch`를 1 올린다. 아래 공개키는 조직이 별도로 검토한 Ed25519 공개키로 교체한다.

```json
{
  "recovery": {
    "threshold": 2,
    "approvers": [
      {"id": "recovery-owner", "role": "owner", "publicKey": "REPLACE_WITH_ED25519_SPKI_PEM"},
      {"id": "recovery-security", "role": "security", "publicKey": "REPLACE_WITH_ED25519_SPKI_PEM"}
    ]
  }
}
```

`plan-rotation`에서 이 파일을 목적 authority로 선택한다. 현재·다음 정족수에 더해 **새 복구 키 각각**이 `sign --rotation-side recovery-setup --authority NEXT.json`으로 소유를 증명한다. 세 종류의 서명을 `combine --authority CURRENT.json`에 넣고 일반 `rotate`로 등록한다. 복구 정족수의 재구성이나 폐기도 정상 정족수의 승인으로 진행한다. 보관자와 개인키 저장 위치를 기록하고, 일반 승인 계정과 분리한다. 복구 키 자체에는 정책 채택이나 일반 복구를 승인할 권한이 없다. [정상 교체 절차](approval-key-rotation.md)

## 정상 정족수가 사라진 경우

1. 마지막으로 확인한 authority, witness 체크포인트, 남은 lease와 복구 키 보관자를 확인한다. 유효한 refresh lease는 정상 종료한다. 끊긴 lease에는 [기존 중단 복구 절차](organization-trust.md#저장중단복구)를 적용한다.
2. `NEXT.json`에 새 owner·security 공개키를 넣고 epoch를 정확히 1 올린다. 사고와 관련된 키를 폐기하고 최소 한 개의 새 키를 등록한다. 복구 정족수, 조직, 일반 threshold, witness와 전송 설정은 유지한다.
3. 다음으로 요청을 만든다. 사유에는 비밀이나 개인키 대신 짧은 내부 사고 식별자를 사용한다. 검토자는 현재 체크포인트와 새 키·폐기 키 목록을 확인한다.

```sh
node verification/organization-governance.mjs plan-quorum-recovery \
  --store STORE --authority CURRENT.json --destination-authority NEXT.json \
  --reason "Incident IR-EXAMPLE: owner and security quorum lost" \
  --output RECOVERY_REQUEST.json

node verification/organization-governance.mjs sign \
  --authority CURRENT.json --rotation-side recovery --request RECOVERY_REQUEST.json \
  --approver RECOVERY_ID --key RECOVERY_KEY.pem --output RECOVERY_SIGNED.json

node verification/organization-governance.mjs sign \
  --authority NEXT.json --rotation-side next --request RECOVERY_REQUEST.json \
  --approver NEXT_ID --key NEXT_KEY.pem --output NEXT_SIGNED.json
```

복구 정족수, 다음 정족수, 새로 추가된 일반 키 각각의 서명 파일을 `combine --authority CURRENT.json --approval FILE ... --output RECOVERY_APPROVED.json`으로 합친다. 각 파일은 `--approval`을 별도로 지정한다. 서명은 비상 복구 전용 요청에 묶여 있으며 정상 승인이나 복구 키 등록에 재사용할 수 없다.

```sh
node verification/organization-governance.mjs recover-quorum \
  --store STORE --authority CURRENT.json --destination-authority NEXT.json \
  --approval RECOVERY_APPROVED.json
```

`quorum-recovered`를 확인한 뒤 보호된 launcher와 승인 워크플로를 `NEXT.json`으로 전환한다. 다음 스캔은 현재 authority와 저장된 TUF 상태를 재검증한다. TUF의 만료나 이미 거절된 갱신은 기존 규칙대로 처리된다. 폐기된 공개키는 이름을 바꾸거나 복구 키로 등록해도 재사용할 수 없다.

## 중단·재개

v2에서는 로컬 두 DB를 하나의 SQLite transaction으로 전환한다. v3에서는 원격 witness가 현재 digest, 등록된 복구 정족수와 새 키 서명, 기록 및 TUF 하한의 일치를 먼저 확인한다. 원격 확정 뒤 로컬에서 같은 결과를 커밋하므로, 두 DB를 과거로 복구해도 옛 authority로 새 변경을 적용할 수 없다. v2는 이전 문서의 로컬 롤백 경계가 적용된다. [SQLite transaction](https://www.sqlite.org/lang_transaction.html) · [Ed25519 검증 API](https://nodejs.org/api/crypto.html)

| 상태 | 처리 |
| --- | --- |
| 원격 커밋 전 연결이 끊김 | 이전 체크포인트가 유지된다. 서명이 유효하면 같은 요청을 재시도한다. 만료됐다면 현재 head를 확인한 뒤 새 요청을 승인한다. |
| 원격 커밋 후 응답 유실 또는 로컬 커밋 전 종료 | 옛 authority의 원격 접근이 차단된다. `resume-quorum-recovery`로 정확한 원격 후속 항목을 다시 읽어 로컬 반영을 완료한다. |
| 이전에 시작한 일반 교체가 로컬에서만 동결됨 | 원격이 여전히 옛 체크포인트이면 비상 복구를 승인해 대체할 수 있다. 원격에 일반 교체가 먼저 기록됐다면 그 교체를 재개하거나 이미 활성화된 authority에서 새 요청을 만든다. |
| 로컬까지 이미 반영됨 | `already-recovered`를 반환하고 새 기록을 추가하지 않는다. |
| 주 DB 또는 원격 witness 손상·소실 | 체크포인트와 승인 이력을 보존한다. 이 정족수 복구 절차는 유실된 저장소 자체를 초기화하는 경로를 제공하지 않는다. [원격 상태 복구](remote-witness-recovery.md#중단과-복구) |

```sh
node verification/organization-governance.mjs resume-quorum-recovery \
  --store STORE --authority CURRENT.json --destination-authority NEXT.json
```

도구는 기존 head의 바로 다음 후속 항목과 두 서명 집합을 확인한다. 이미 원격 커밋이 완료된 요청은 승인 유효기간이 지나도 로컬 반영을 끝낼 수 있다. 원격이 다른 항목으로 전진했거나 로컬 원본 digest가 달라졌으면 중단한다.

`node scripts/drill-emergency-quorum-recovery.mjs --output NEW_RECEIPT.json`으로 훈련한다. 장애 전 복구 키를 등록하고 기존 테스트 개인키를 삭제한 뒤 실제 CLI를 원격 확정 직후 종료한다. [훈련 결과](evidence/emergency-quorum-recovery-2026-11-24/recovery-drill.json)

운영에서는 복구 키 보관자와 비상 승인 채널부터 확인하고, 완료 후 witness의 숫자와 정책 digest, TUF 하한을 비교한다. 운영 키 등록과 비상 복구 훈련은 실제 조직의 책임과 권한이 정해진 다음 수행한다.
