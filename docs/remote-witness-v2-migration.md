# v2 조직 저장소를 원격 witness로 이관

Risk Level 2. 기존 승인 및 TUF 하한을 원격 신뢰 경계로 옮긴다.

v2 로컬 witness를 사용하는 조직 저장소는 같은 경로에서 v3 원격 witness 모드로 이관할 수 있다. 새 authority에는 기존 store ID, 조직 ID, 로컬 witness 경로, approver 공개키 및 threshold를 유지하고 `remoteWitness`만 추가한다. 이관은 조직 정책 변경이나 승인 키 교체와 별도의 승인이다. [원격 witness 설정](remote-witness-recovery.md) · [검증 기록](evidence/remote-witness-v2-migration-2026-11-24.md)

## 승인과 적용

1. 기존 v2 명령의 실행을 일시 중지하고 활성 갱신 lease를 정상 완료하거나 기존 절차로 중단 복구한다. 현 v2 authority로 보호된 경로에 일관된 논리 백업을 만든다. v3 이관 후 이 백업은 감사와 검토에 사용할 수 있으며, v3 복구는 최신 원격 witness를 기준으로 한다. [기존 백업 절차](organization-approval-recovery.md#백업과-승인된-복구)
2. v3 authority를 별도 파일로 준비한다. 이 파일의 authority digest에 연결된 빈 원격 서비스를 현재 바이너리로 준비한다. 이관은 쓰기 권한을 검사하므로 이관을 실행할 운영자에게만 writer 토큰을 배치한다.
3. 다음 명령으로 이관 요청을 작성한다. 기존 owner와 security 승인자는 원본 체크포인트, 정책, 승인 원문들의 digest, TUF 하한, 원격 endpoint와 공개키 digest를 검토한다. 기존 `sign`과 `combine`을 v2 authority로 실행한다.

```sh
node verification/organization-governance.mjs plan-migrate \
  --store STORE --authority V2_AUTHORITY.json \
  --destination-authority V3_AUTHORITY.json --output MIGRATION_REQUEST.json

node verification/organization-governance.mjs migrate \
  --store STORE --authority V2_AUTHORITY.json \
  --destination-authority V3_AUTHORITY.json --approval MIGRATION_APPROVED.json
```

4. `migrated-needs-refresh`를 확인한다. 보호된 CLI/CI launcher를 v3 authority로 전환하고 각 사용할 trust domain을 명시적으로 갱신한 뒤 스캔한다. 기존 조직 정책 파일은 그대로 사용할 수 있다. 결과에서 `trustContext.governance.mode = remote-witness`를 확인한다. 운영 직후에는 기존 승인 원문 개수, 정책 revision/digest와 각 역할의 하한을 이관 요청 내용과 대조한다.

기존 승인 원문은 바이트 그대로 보존한다. 승인 당시의 v2 authority digest도 원문에 남는다. 원격 순번은 새 authority에서 1로 시작하고, 첫 스냅샷 안의 이관 승인 기록이 직전 v2 순번과 체크포인트 digest를 연결한다. 폐기한 profile, 제거된 domain의 anchor와 하한, 실패한 갱신에서 검증해 보존한 하한, TUF 저장소 이력도 복사한다. 준비 상태는 다시 검증하도록 재설정한다.

## 중단 후 재시도

| 중단 지점 | 확인되는 상태 | 다음 조치 |
| --- | --- | --- |
| 원격 쓰기 권한 사전 검사 전후, 동결 커밋 전 | v2 유지, 원격 이관 항목 없음 | 문제를 해결하고 승인 유효기간 내에 같은 `migrate` 실행 |
| 로컬 동결 후, 원격 게시 전 | 주 DB는 pending 형식 v4, 기존 witness head는 비어 있음 | 원격 연결이나 권한을 복구하고 `resume-migration` 실행 |
| 원격 게시 후, 응답 유실 또는 로컬 커밋 전 | pending v4, 원격 순번 1에 정확한 승인 결과 존재 | `resume-migration`으로 동일 digest를 다시 확인하고 로컬만 확정 |
| 로컬 커밋 후 결과 출력 전 | v3, 동일 이관 승인 기록 존재 | `resume-migration`이 원격 현재 head를 검증 후 `already-migrated` 반환 |
| 동결 중 원격의 다른 digest, 로컬 변경, 동결 정보 손상 | 인증과 완료가 차단됨 | DB와 원격 기록을 보존하고 승인한 원본과 대조 |

```sh
node verification/organization-governance.mjs resume-migration \
  --store STORE --authority V2_AUTHORITY.json \
  --destination-authority V3_AUTHORITY.json
```

동결 transaction은 승인과 후보 digest를 기록하고, 기존 witness head를 제거하며, DB 버전을 pending v4로 바꾼다. 구버전 스캔과 로컬 witness만 사용하는 복구도 이 시점부터 막힌다. `resume-migration`은 이 시점에 유효했던 두 서명을 검증하고 같은 승인된 전이만 완료한다. 새 정책·다른 destination·대체 승인을 사용할 수 없다. 승인 만료 후에도 이미 동결한 동일 작업의 재시도는 가능하다. [SQLite ATTACH와 transaction 원자성](https://www.sqlite.org/lang_attach.html)

원격 데이터가 없으면 확정된 후보 하나를 게시한다. 같은 결과가 이미 있으면 다시 게시하지 않는다. 검증 가능한 서명 응답을 받아야 두 로컬 DB를 v3 상태로 커밋한다. 호스트 재시작 직후에도 pending DB 쌍을 그대로 사용한다. 과거 v2 DB와 v2 witness를 함께 복원해 옛 launcher에서 다시 쓰면 오프라인 분기가 생길 수 있다. 동결을 시작한 뒤에는 옛 launcher를 계속 중지하고 v3 authority를 고정한다. 둘 다 유실됐지만 원격 이관 항목이 있다면 [원격 승인 복구](remote-witness-recovery.md#중단과-복구)로 새 경로에 복구할 수 있다.

```sh
node scripts/drill-remote-witness-migration.mjs --output NEW_RECEIPT.json
```

훈련은 테스트 승인 키와 TUF 메타데이터로 임시 v2를 만든다. HTTPS 서버의 게시가 끝난 직후 이관 하위 프로세스를 종료하고, 두 로컬 DB를 재개방해 동일한 승인을 완료한다. 운영에서의 첫 확인은 원격 순번과 이관 승인, 다음은 source 승인 원문·TUF 하한, 마지막은 각 domain의 새 TUF 검증 상태다. 운영 조직 이관과 복구 시간 측정은 별도 운영 환경에서 진행한다.
