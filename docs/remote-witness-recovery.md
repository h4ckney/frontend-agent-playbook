# 원격 witness와 호스트 롤백 복구

Risk: Level 2 — 조직 신뢰 상태를 별도 서버의 최신 체크포인트에 묶는다.

[기존 복구 모드](organization-approval-recovery.md)는 주 DB와 로컬 witness가 함께 복원되면 과거 체크포인트를 다시 읽을 수 있다. 원격 모드는 호스트 바깥 HTTPS witness에 최신 조직 정책, TUF 하한, 갱신 잠금과 복구 이력을 남긴다. 스캔과 운영 명령은 이 원격 상태를 확인한다. [검증 근거](evidence/remote-witness-2026-11-24.md)

## 체크포인트 검증

| 상황 | 동작 |
| --- | --- |
| 로컬과 원격 체크포인트가 일치 | 기존 정책 및 TUF 검사 진행 |
| 응답 누락·빈 응답·타임아웃·잘못된 서명 | 검증 차단 및 CLI 종료 코드 2 |
| 같은 순번의 다른 digest | `remote-witness-sequence-conflict` |
| 로컬이 원격보다 뒤처짐 | `remote-witness-local-behind` |
| 원격이 로컬보다 낮음 | `remote-witness-history-regressed` |
| 원격에 바로 다음 항목만 커밋됨 | 명시적 `reconcile`로 같은 경로에 정확한 원격 상태 적용 |
| 더 오래된 사본이나 두 로컬 DB 손실 | 최신 원격 체크포인트를 대상으로 새 경로 복구 승인 |

클라이언트는 HTTPS 서버 인증과 authority에 고정한 Ed25519 서명을 확인한다. 요청마다 새 nonce를 사용해 과거 응답 재사용을 차단한다. 서명은 store ID, authority digest, nonce와 체크포인트를 묶는다. 보고서에는 `trustContext.governance.mode = remote-witness`, 순번, digest를 넣는다. 이 필드는 자체 서명된 영수증의 역할을 하지 않으므로 운영 게이트는 도구의 종료 코드도 확인한다. [Node HTTPS API](https://nodejs.org/api/https.html)

쓰기 순서는 **로컬 transaction에서 다음 상태 계산 → 원격 CAS와 서명 응답 확인 → 로컬 commit**이다. 서버는 직전 digest와 순번이 일치할 때 새 항목을 추가하며, 같은 체크포인트를 다시 보내면 같은 결과를 반환한다. [정책 채택과 복구 승인 검증 및 독립 체크포인트 운영](witness-checkpoint-recovery.md)도 적용할 수 있다. 정책 revision이나 TUF 하한을 낮추거나 이전 승인 기록과 domain 이력을 지우는 전이도 거절한다. 원격 요청 하나에는 5초 제한이 있으며 로컬 쓰기 잠금은 확인 동안 유지된다. 이 모드의 스캔에는 네트워크가 필요하다. [SQLite transaction 규약](https://www.sqlite.org/lang_transaction.html)

## 서비스 설정

별도 복원 단위에 있는 호스트에서 [witness 서비스](../verification/remote-witness-server.mjs)를 실행한다. 자체 TLS 인증서와 Ed25519 서명 키, 충분한 엔트로피의 서로 다른 읽기·쓰기 토큰을 사용한다. 서비스는 한 조직 store에 전용이다. 승인 키 교체에는 [owner·security 키 교체 절차](approval-key-rotation.md)를 사용한다. SQLite 파일을 이어서 사용하도록 서비스 재시작에서는 초기화 옵션을 뺀다.

1. 운영 authority에 아래 필드를 추가한다. 공개키와 사설 CA를 쓰는 경우 해당 CA 파일은 승인된 배포 경로로 고정한다. 공용 신뢰 CA를 쓰면 `caFile`을 생략할 수 있다. 스캐너에는 읽기 토큰만 배치한다. 쓰기 토큰 파일 경로는 같은 authority에 남아 있어도 스캐너 호스트에 실제 파일은 없어도 된다. 파일은 private 디렉터리에 0600으로 두고 scan root 밖에 둔다.

   ```json
   {
     "remoteWitness": {
       "url": "https://witness.example.invalid/v1/checkpoint",
       "publicKey": "REPLACE_WITH_ED25519_SPKI_PEM",
       "readTokenFile": "/operator/secrets/witness-read",
       "writeTokenFile": "/operator/secrets/witness-write",
       "caFile": "/operator/config/witness-ca.pem"
     }
   }
   ```

2. `node verification/organization-governance.mjs authority-info --authority AUTHORITY.json`으로 `storeId`와 `authorityDigest`를 확인한다. witness 호스트에 다음 설정을 준비한다. 경로에는 실제 값과 별도 복원 단위를 사용한다.

   ```json
   {
     "storeId": "REPLACE_WITH_AUTHORITY_STORE_UUID",
     "authorityDigest": "REPLACE_WITH_AUTHORITY_DIGEST",
     "directory": "/witness/data",
     "host": "0.0.0.0",
     "port": 9443,
     "readTokenFile": "/witness/private/read-token",
     "writeTokenFile": "/witness/private/write-token",
     "signingKeyFile": "/witness/private/signing-key.pem",
     "tlsKeyFile": "/witness/private/tls-key.pem",
     "tlsCertificateFile": "/witness/private/tls-chain.pem"
   }
   ```

3. 데이터 경로를 최초 준비할 때만 `node verification/remote-witness-server.mjs SERVICE.json --initialize`를 실행한다. 운영에서는 listener의 접근을 관리하고, witness 디스크와 권한을 분석 호스트의 백업 및 복원 정책에서 분리한다. remote authority로 [기존 이중 승인 순서](organization-approval-recovery.md#승인-요청서명적용)에 따라 등록·정책 채택을 수행한다. 이미 v2로 등록한 조직은 [v2 승인 이관](remote-witness-v2-migration.md)으로 같은 저장소의 정책·승인·TUF 하한을 이어받는다.

이 서비스는 인증된 각 요청에서 24MB까지 수신하며 신뢰 상태 전체를 저장한다. 독립 체크포인트를 사용하면 원격 이력 DB의 롤백도 감지한다. 쓰기 토큰이 유출되어도 정책과 복구 경로 변경에는 유효한 승인 서명이 필요하다. 원격 서명 키 유출, 서버 관리 권한, 독립 체크포인트까지 포함한 동시 롤백은 해당 제어의 운영 신뢰 경계에 있다. 정책·승인 기록 및 경로가 포함되므로 조직 전용 접근과 백업을 적용한다. 애플리케이션 API에서 과거 항목 삭제나 리셋을 제공하지 않는다. 용량 감시와 서버 보호는 운영 범위에 포함한다.

## 중단과 복구

- **원격이 커밋하고 로컬이 응답을 잃은 경우** `node verification/organization-governance.mjs reconcile --store STORE --authority AUTHORITY.json`을 실행한다. 같은 active 경로의 정확한 다음 체크포인트만 반영한다. 원격에 완료된 갱신 결과나 거절된 메타데이터에서 전진한 하한도 그대로 보존된다. 중단된 작업의 lease만 남았다면 기존 `recover`와 새 `refresh`를 적용한다.
- **원격이 쓰기를 받기 전에 중단된 경우** 로컬 변경도 커밋되지 않는다. 이전에 커밋된 하한과 원격에 기록된 lease는 남는다. 끝난 프로세스의 lease를 기존 절차로 복구한 뒤 다시 갱신한다. 서버에 도달하지 않은 새 메타데이터는 커밋된 하한에 포함되지 않는다.
- **주 DB와 로컬 witness가 모두 과거로 돌아가거나 유실된 경우** `plan-restore --authority AUTHORITY.json --target NEW_STORE`로 최신 원격 snapshot을 검토한다. owner/security 서명 후 `restore --authority AUTHORITY.json --target NEW_STORE --approval APPROVAL.json`을 실행한다. 이력이 더 오래된 백업은 거절한다. 원격 commit으로 이전 경로의 쓰기를 차단하며, 복구된 store는 TUF 재검증 전까지 인증을 거부한다. restore 자체의 응답을 잃어 대상이 불완전하면 최신 원격 head를 확인한 뒤 새로운 빈 경로에 대한 복구 승인을 받는다.

`node scripts/drill-remote-witness.mjs --output NEW_RECEIPT.json`은 임시 TLS 인증서, 별도 HTTPS 서비스와 DB, 테스트용 승인 서명과 TUF 메타데이터로 전체 사례를 실행한다. 호스트 롤백은 같은 분석 호스트의 DB 파일 두 개를 실제 과거 사본으로 바꿔 재현한다. 원격 서비스와 기록은 롤백 대상에서 제외한다. [훈련 기록](evidence/remote-witness-2026-11-24/recovery-drill.json)

운영 수락 기준은 별도 호스트에서 동일한 검사를 실행하고, 원격 장애 중 scan 실패 및 승인 복구 후 floor 유지를 확인하는 것이다. 서비스 장애, 원격 호스트 장애 및 보존 정책 운영 지표는 실제 운영 소유자와 설정이 정해진 뒤 측정한다. 코드 롤백 시 v3 데이터와 원격 이력을 보존하고, 이전 바이너리로 v3 저장소를 쓰지 않는다.
