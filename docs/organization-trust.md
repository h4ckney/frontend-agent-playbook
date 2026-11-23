# 조직 신뢰 정책과 영속 TUF 운영

Risk: Level 2 — 조직별 인증 권한과 rollback 상태의 수명을 바꾼다.

독립 정책·state 파일만으로는 조직 선택, 정책 철회, 동시 갱신과 재시작 후 TUF 하한 유지가 연결되지 않았다. 이제 **운영자가 채택한 조직 정책 → 명시적 profile → 영속 domain 상태 → offline 검증**으로 연결한다. [구현 근거·회귀·실제 공개 읽기](evidence/organization-trust-2026-11-23.md)를 별도로 기록한다. 기존 [TUF 제한 profile](tuf-trust-lifecycle.md)과 [실제 신규 발급 round-trip](keyless-live-round-trip.md)을 대체하지 않는다.

후속 [조직 승인·백업·복구·독립 witness](organization-approval-recovery.md)는 전체 주 DB rollback 탐지를 추가한다. 아래 기존 명령은 local-only 모드이며 이 보장은 제공하지 않는다. 보호된 운영은 새 문서의 governance 옵션과 외부 authority를 고정해야 한다.

## 선택과 계약

[예제 정책](../examples/organization-trust/policy.json)은 실제 회사 정책이 아니다. `schemaVersion: "1"`, `organizationId`, 단조 증가하는 양의 `revision`, 최대 8개 `trustDomains`, 최대 16개 `profiles`를 받는다. 알 수 없는 필드·중복 ID·일부만 유효한 정책을 모두 거절한다. profile은 0개로 모든 선택을 철회할 수 있다. domain은 최소 1개다.

| 범위 | 계약 |
| --- | --- |
| 조직 | 소문자 slug ID, CLI에서 반드시 명시. 다른 조직의 채택·상태를 빌리지 않는다 |
| 신뢰 domain | 고정 bootstrap 원본 SHA256, 선택한 credential 없는 HTTPS mirror, `maxRefreshAgeSeconds` 1~604800, 선택적 `minimumFloor` |
| Profile | domain 하나, 정확한 repository/ref, 기존 keyless 정책. issuer·certificate identity·builder·roles·parameters·environment·validity는 기존 검증을 그대로 적용 |
| 채택 | 동일 revision/내용은 멱등, 동일 revision 변경·과거 revision은 거절. 새 revision을 명시적으로 adopt해야 활성화 |
| 철회 | profile 제거/변경 후 이전 opaque token·옛 정책 파일 거절. domain 이름은 삭제 후에도 이전 anchor를 기억하며 다른 anchor로 재사용 불가 |
| 하한 | 정책 minimum과 저장 checkpoint를 합쳐 후퇴·같은 version의 다른 signed 내용 거절. state만 과거 사본으로 바꿔도 checkpoint 검증에서 차단 |
| 최신성 | 마지막 성공 refresh의 최대 나이와 실제 TUF 만료 중 먼저 오는 시각까지. refresh 실패/중단·갱신 중은 인증하지 않음 |
| 출력 | `AuditResult.trustContext`: 조직/profile/domain, 채택 revision/digest, generation, 확인/갱신/만료 시각. 저장 경로나 인증 비밀 없음. 이 설명 필드 자체는 보고서 진위 서명이 아님. 선택한 정책 범위만 baseline digest에 반영; 단순 refresh·다른 profile 추가로 이슈를 새로 만들지 않음 |

첫 버전의 조직 profile은 TUF 기반 keyless만 받는다. 기존 standalone 공개키·직접 pinned root 옵션은 그대로 지원하지만 조직 모드와 섞을 수 없다. 프로젝트 profile(`--profile`)은 분석 범위용이며 조직 인증 profile(`--trust-profile`)과 구분된다. browser는 조직 store에 접근하거나 정책을 채택하지 않는다. 조직 검증은 Node CLI/API 경로다.

## 운영 시작

지원하는 Node 22/24/26과 [고정 verifier 의존성](../verification/sigstore/package.json)이 필요하다. 영속 저장은 Node 내장 SQLite를 사용하여 추가 npm 의존성을 만들지 않는다. [Node SQLite 문서](https://nodejs.org/api/sqlite.html)의 API는 버전별 안정성이 다르며 Node 22/24에서 experimental 경고가 나올 수 있다. 실제 지원은 이 저장소의 해당 버전 CI 결과로 확인한다.

정책과 store는 스캔 대상이 변경할 수 없는 **별도 운영자 계정/권한 경계**에서 관리한다. CLI의 경로 밖 검사와 POSIX 권한 검사는 보조 장치다. scan 코드와 같은 OS 계정에서 악성 프로젝트 코드를 실행한다면 경로 분리만으로 권한 경계가 생기지 않는다. 프로젝트 설치 scripts를 실행하지 않는다.

```sh
npm ci --prefix verification/sigstore --ignore-scripts --no-audit --no-fund
# /operator 는 실제 운영자가 관리하는 경로로 교체한다. 예제를 먼저 검토/수정한다.
node verification/organization-trust.mjs init --store /operator/trust
node verification/organization-trust.mjs adopt --store /operator/trust \
  --organization example-platform --policy /operator/policy.json
node verification/organization-trust.mjs refresh --store /operator/trust \
  --organization example-platform --policy /operator/policy.json \
  --trust-domain sigstore-public --initialize --bootstrap /operator/approved-root.json
node verification/organization-trust.mjs status --store /operator/trust \
  --organization example-platform --policy /operator/policy.json
node bin/frontend-agent-audit.mjs scan --root /project \
  --organization-policy /operator/policy.json --organization example-platform \
  --trust-profile frontend-main --trust-store /operator/trust --format json
```

최초 bootstrap의 원본 hash는 별도 승인 경로로 확인한다. root의 self-signature나 HTTPS 다운로드만으로 최초 신뢰를 만들지 않는다. 최초 이후 refresh는 `--initialize --bootstrap`을 빼고 실행한다. mirror 대신 `--repository /operator/repository.json`을 명시하면 동일한 서명·floor 검사를 오프라인 원본 문자열 묶음에 적용한다. scan은 fetch/adopt/init/recover를 시작하지 않는다. 잘못된/누락된 조직 선택·store·state는 exit 2로 scan을 중단하며 이전 성공 보고서를 새 결과로 출력하지 않는다.

## 저장·중단·복구

macOS/Linux의 private local POSIX filesystem을 대상으로 한다. store directory 0700, SQLite file 0600·동일 UID·단일 link가 필요하며 final symlink와 쓰기 가능한 비-sticky 상위 경로를 거절한다. Windows ACL, NFS/다중 host 공유, HA failover는 지원 근거가 없다. store를 프로젝트 안에 두는 CLI 선택은 거절한다.

SQLite `BEGIN IMMEDIATE`, `synchronous=FULL`, DELETE journal로 조직 revision/generation, domain state와 독립 checkpoint를 transaction 안에 기록한다. network 전에 영속 lease(PID/host/시각)를 남긴 뒤 DB transaction은 해제한다. refresh 완료 또는 실패 기록과 floor 보존은 다시 한 transaction이다. 다른 갱신·채택·scan은 활성 lease에서 거절한다. 전체 조직 generation이 바뀌면 진행 중 scan의 opaque token을 앞뒤로 재확인해 무효화한다. token은 최대 5분이며 실제 TUF/refresh 만료가 더 빠르면 그 시각부터 무효다.

`status`는 domain별 `ready`, `stale`, `rejected`, `refreshing`, `not-initialized`와 마지막 시도 시각·버전을 출력한다. 이는 profile 신원/attestation 전체 인증 결과가 아니다. 이미 출력된 보고서를 소급 변경하지 않으므로 최신 인증이 필요한 소비자는 scan을 다시 실행해야 한다.

프로세스가 죽으면 lease가 남아 성공 fallback을 막는다. **동일 host에서 PID가 실제로 사라진 경우만** 다음 명령으로 차단 상태로 복구할 수 있다. PID가 재사용되거나 다른 host라면 자동으로 잠금을 깨지 않는다. 이후 반드시 성공한 refresh가 필요하다.

```sh
node verification/organization-trust.mjs recover --store /operator/trust \
  --organization example-platform --policy /operator/policy.json --trust-domain sigstore-public
# 그 다음 위 refresh를 initialize 없이 재실행한다.
# 첫 갱신이 state를 기록하기 전에 죽었다면 검토한 bootstrap으로 initialize부터 재시도한다.
```

DB 누락/손상·진행 중 transaction은 자동 reset하지 않는다. 작업이 모두 중지된 일관된 DB와 채택 정책을 접근 통제된 저장소에 백업하고 별도 기록의 revision/floor와 비교한다. live DB 파일만 임의 복사하지 않는다. 디스크/호스트 손실 복구나 **전체 DB·정책을 함께 과거로 복원하는 행위**는 이 로컬 checkpoint만으로 탐지할 수 없다. 독립 보관한 최신 정책/floor, 검토와 별도 복구 절차가 필요하다. 같은 UID의 저장소 관리자 자체를 공격자로 막는 기능이 아니다. 현재 버전으로 정책 revision을 낮추거나 DB를 지워 회복하지 않는다.

코드 문제가 생기면 PR revert로 신규 조직 모드 사용을 중단할 수 있다. 영속 DB는 보존하며 구버전이 자동으로 읽도록 변환하지 않는다. standalone 모드로의 전환은 운영자의 별도 신뢰 선택이다. schema migration/백업 자동화/원격 anti-rollback witness/개별 artifact revocation은 후속이다.

- **Why:** 조직 정책 철회와 재시작 후 신뢰 상태의 연속성을 인증 결과에 연결한다.
- **System change:** 운영자 채택 registry·transactional domain checkpoint·중단 lease·명시적 선택을 추가하고 검증 전후 상태 변경을 차단한다.
- **First look:** `status`의 lease/시각/버전 → 채택 revision/digest와 profile identity → TUF 서명/expiry/floor와 audit authentication reason 순서다.

위험 감소 지표는 rollback·다른 조직·정책 철회·중단/오래된 상태가 인증을 올리지 않는 것이다. 이번에는 controlled 테스트와 공개 TUF 읽기에서 측정한다. 실제 조직 도입 소유자·운영 관찰 기간은 미정이다. 실제 조직 정책 승인·배포·서비스 운영 성과는 pending이며 자동 예약을 만들지 않았다.
