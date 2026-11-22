# TUF 신뢰 루트 갱신·폐기와 공개 Sigstore 검증

2026-11-22 · 기준 `bf6356a` · Risk: Level 2 — 신뢰 루트 변경이 보고서 인증을 바꾼다. [기존 keyless 검증](sigstore-keyless.md)은 고정한 TrustedRoot만 사용했다. 이번 확장은 검토자가 고정한 **TUF bootstrap root의 원본 bytes hash**에서 최신 서명 메타데이터와 `trusted_root.json`을 검증한다. 프로젝트 코드 실행·배포, CVE snapshot/수명 정책의 확인일 갱신은 포함하지 않는다.

## 판단과 경계

수동으로 TrustedRoot hash를 교체하는 기존 방식도 지원한다. 갱신·폐기 이력을 적용하려면 TUF 경로를 명시한다. 직접 TUF 서명 알고리즘을 구현하는 대신 [tuf-js 6.0.3](https://github.com/theupdateframework/tuf-js/commit/043f5e08fb601713c47f74071d97b32741f448cd)의 `TrustedMetadataStore`를 사용한다. 이 클래스는 package 최상위 공개 API가 아니므로 exact version·lockfile·호환 회귀 검사로 통제한다. 고수준 Updater가 네트워크·캐시를 관리하게 두는 대안보다 오프라인 scan과 검토자 소유 state를 분리하기 쉽다는 판단이다. upstream API 변경 시 재검토가 필요하다.

[현행 TUF 규격](https://theupdateframework.github.io/specification/latest/)의 root 교차 서명, 버전, 역할 서명, 만료와 파일 연결을 검사하는 **제한된 top-level profile**이다. TUF 전체 delegation 탐색기는 아니다. top-level `trusted_root.json`을 읽으며 다른 대상용 delegation 선언은 허용한다. top-level 대상이 사라지면 delegated/이전 파일에서 복구하지 않고 폐기로 처리한다.

전제는 별도 경로로 확인한 bootstrap hash, 정확한 시스템 시각, 다른 주체가 되돌리거나 삭제할 수 없는 상태 저장소다. root 자체의 self-signature만으로 최초 신뢰를 만들지 않는다. 상태 파일을 통째로 과거 사본으로 바꿀 권한이 있는 공격자까지 로컬 anti-rollback으로 막을 수 없다. bootstrap hash·신원 정책·상태 파일은 스캔 대상 프로젝트가 관리하면 안 된다.

## 검증과 폐기 의미

| 항목 | 동작 |
| --- | --- |
| Root 교체 | version을 정확히 1씩 증가, 이전 root의 임계값과 새 root 자신의 임계값 모두 검증. 과거에 수락한 root 버전의 정확한 signed 내용을 거쳐야 하므로 더 높은 버전으로 위장한 fork도 거절. 만료 bootstrap은 유효한 연속 교체 chain으로 복구 가능, 최종 root는 미만료여야 함 |
| 역할 | root가 허용한 timestamp/snapshot/targets 키로 서명 검증. 폐기된 역할 키로 새 metadata를 서명하면 거절 |
| Freeze | root·timestamp·snapshot·targets의 만료를 현재 시각에 검사. 만료 순간부터 opaque 인증 token도 무효 |
| Rollback | 보호된 state의 root/timestamp/snapshot/targets 최대 버전을 낮출 수 없음. 같은 버전의 signed 내용 변경도 거절. timestamp가 이미 지목한 snapshot 최소 버전도 보존. 이전 snapshot 역할의 누락·하위 버전도 거절 |
| Target | signed metadata의 정확한 version·hash·length 연결, `trusted_root.json` 원본 길이·SHA256 및 추가로 선언된 hash 모두 검사 |
| 대상 삭제 | 유효한 최신 targets에서 `trusted_root.json`이 사라지면 `sigstore-tuf-target-removed`. 최신 metadata floor는 보존하고 이전 root로 대체하지 않음 |
| 신뢰 키 제거 | 갱신 target에서 CA/CT/Rekor anchor가 빠지거나 validity가 닫히면 그 내용으로 이후 검증. 이전 anchor를 합쳐 쓰지 않음 |
| 실패 | fetch·변조·만료·rollback 실패 후 state를 차단 상태로 기록. 다음 scan은 과거 성공을 사용하지 않으며 성공한 갱신으로만 복구 |

CA/log의 정상 유효 기간 종료와 키 제거는 다르다. 최신 TrustedRoot가 과거 검증용 anchor를 남긴 경우 인증된 **서명 당시** 유효 기간을 적용한다. 모든 과거 서명을 일괄 취소하는 CRL/OCSP·개별 OIDC 사용자/산출물 revocation 정책까지 구현한 것은 아니다. 오프라인 scan은 마지막으로 받은 유효 metadata의 만료 전까지 변경 미관측 기간이 생길 수 있다. 최신성을 요구하는 운영에서는 scan 전에 명시적으로 refresh를 실행해야 한다.

## 실행과 상태 저장

Node 지원 버전과 격리된 설치 경로는 기존 keyless profile과 같다. 정책·상태 디렉터리는 검토자가 준비한다. 이 도구는 디렉터리나 bootstrap의 신뢰를 대신 승인하지 않는다.

```sh
npm ci --prefix verification/sigstore --omit=dev --ignore-scripts --no-audit --no-fund
node verification/refresh-sigstore-tuf.mjs --help
node verification/refresh-sigstore-tuf.mjs --initialize --bootstrap /trusted/root.json --bootstrap-sha256 sha256:REVIEWED_HASH --mirror https://tuf-repo-cdn.sigstore.dev --state /trusted/sigstore-state.json
node verification/refresh-sigstore-tuf.mjs --bootstrap-sha256 sha256:REVIEWED_HASH --mirror https://tuf-repo-cdn.sigstore.dev --state /trusted/sigstore-state.json
node bin/frontend-agent-audit.mjs scan --root /project --trust-policy /trusted/policy.json --sigstore-tuf-state /trusted/sigstore-state.json --format json
```

새 keyless rule은 기존 `trustedRootDigest` 대신 `tufBootstrapRootDigest: "sha256:..."` 하나를 쓴다. literal issuer/SAN·roles·repository·builder·입력/환경·기간 바인딩은 그대로다. 한 정책에서 정적 root와 TUF keyless 경로를 섞거나 여러 bootstrap을 섞지 않는다. CLI의 `--sigstore-trusted-root`와 `--sigstore-tuf-state`도 상호 배타적이다. TUF 정책에 정적 root만 주어도 인증으로 대체하지 않는다. API는 `createAuditBundleAsync({records, trustPolicy, sigstoreTufState, ...})`에서 원본 서명 자료를 재검증한다. 브라우저는 TUF/keyless 암호 검증을 실행하지 않으며 Node CLI 필요·미검증을 유지한다.

온라인 refresh는 허용한 공개 Sigstore mirror의 HTTPS GET만 사용하고 redirect를 거절한다. metadata 검증 전에 target bytes를 신뢰하지 않는다. 오프라인으로는 `--mirror` 대신 `--repository PATH.json`을 사용한다. 형식은 bootstrapRoot/roots/timestamp/snapshot/targets/target에 각 **원본 JSON 문자열**을 담은 [수집 예제](../analysis/fixtures/public-sigstore/repository.json)와 같다. 이 파일의 존재 자체가 신뢰는 아니다.

State에는 원본 metadata·root chain, 버전/내용 floor와 최근 갱신 상태를 저장한다. 첫 초기화만 `--initialize`가 필요하고 기존 파일을 덮지 않는다. 이후 state가 없거나 손상됐다고 자동 초기화하지 않는다. 0600 임시 파일·fsync·원자 rename과 exclusive lock으로 갱신한다. 실패 후에는 floor를 낮추지 않는다. root·timestamp·snapshot은 각 단계에서 검증한 진척을 보존하므로 뒤 단계의 실패가 앞 단계 교체를 지우지 않는다. 실행이 강제 종료되어 lock이 남으면 해당 updater가 종료됐는지 확인한 뒤 운영자가 정리한다. 정상 프로세스의 lock을 자동 삭제하지 않는다. state/lock 파일의 symlink는 거절한다. 디렉터리는 신뢰된 파일시스템 경계로 취급한다.

metadata 각 500KB, target 200KB, repository 4MB, state 4.5MB, root 교체 32회, 서명/키 64개, snapshot 항목 128개를 제한한다. 공개 mirror 요청은 각 15초 제한이다. metadata·root chain이 범위를 넘으면 수동 재검토가 필요하며 검증을 낮추지 않는다. 분석 scan에는 네트워크 side effect가 없다.

## 실제 공개 연동에서 확인한 것

[공개 probe 결과](../analysis/fixtures/public-sigstore/public-probe.json)는 2026-11-22의 **실제 읽기 요청**이다. bootstrap은 [공식 sigstore-js release seed](https://github.com/sigstore/sigstore-js/blob/4576519f81b93bf96bd7457fc7252b8cfa11e67f/packages/tuf/seeds.json)의 root 16, 원본 SHA256 `27aea7e372aa7864065174f0661784fcf8b0e28b1dbfebeada31a0f1fb19167f`다. 자체 다운로드 파일의 hash만 계산해 최초 신뢰를 만든 것이 아니다. [공식 mirror와 운영 모델](https://github.com/sigstore/root-signing)을 참고한다.

관측한 root 16 / timestamp 841 / snapshot 166 / targets 14에서 trusted_root를 인증했다. metadata의 가장 빠른 만료는 2026-11-29T01:19:39Z다. 실제 공개 root 교체가 새로 발생한 것은 관측하지 않았으며 교차 서명·키 폐기는 controlled fixture로 재현했다.

[공개 npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/@sigstore%2fverify@4.1.3)의 Fulcio 인증서·CT·GitHub issuer와 정확한 `sigstore/sigstore-js/.github/workflows/release.yml@refs/heads/main` 신원, Rekor SET·proof/checkpoint를 검증했다. signed build definition의 workflow/builder와 [release commit](https://github.com/sigstore/sigstore-js/commit/4576519f81b93bf96bd7457fc7252b8cfa11e67f), 실제 내려받은 tarball 18,412 bytes의 SHA512가 signed subject·npm integrity와 일치했다. [Rekor GET](https://rekor.sigstore.dev/api/v1/log/entries?logIndex=3692194751)으로 같은 본문과 새로운 inclusion proof도 검증했다. probe는 새 OIDC 로그인·토큰 발급·서명·로그 게시를 하지 않으며 패키지를 실행/설치하지 않는다.

이 공개 npm profile은 frontendEvidence manifest/lock/report 연결 profile과 별도다. 이 성공을 설치·SBOM·배포 보고서 전체 인증이나 이 저장소의 배포로 승격하지 않는다. 재현은 `node scripts/verify-public-sigstore.mjs --state /trusted/sigstore-state.json --output NEW_DIRECTORY`로 가능하고 당시 자료는 CI에서 네트워크 없이 **고정 관찰 시점**으로 재생한다. 고정 시점 회귀가 현재 TUF freshness 검증을 통과했다는 뜻은 아니다.

## 리뷰·근거·인계

실제 자료가 기존 가정 두 가지를 반박했다. 선택적 timestamp가 빈 배열이어도 유효하고, Rekor v1의 global index와 shard-local Merkle index는 다르다. 각각 SET와 Merkle proof로 확인하도록 수정했다. [공식 Rekor 구현](https://github.com/sigstore/rekor/blob/main/pkg/api/entries.go)과 [sharding 설명](https://docs.sigstore.dev/logging/sharding/)이 근거다. 둘 중 어느 index를 바꿔도 거절하는 실제 fixture 검사가 있다. 기존 PR #13의 index 동일성 가정은 이 확장이 교정한다.

[회귀 검사](../analysis/tuf-trust.test.mjs), [실제 공개 증명 재생](../analysis/public-sigstore.test.mjs), [CLI](../bin/frontend-agent-audit.test.mjs)와 [브라우저](../scripts/verify-dashboard.mjs)가 근거다. [실행 기록·화면·의존성 감사](evidence/tuf-verification-2026-11-22.md)를 별도로 보존한다. TUF 만료 순간의 검증 token 재사용도 차단했다. 남은 범위는 아래와 같다.

- **Why:** 고정 TrustedRoot만으로는 이후 키 제거·메타데이터 만료·rollback을 적용할 수 없었다.
- **System change:** 검토한 bootstrap → 명시적 refresh/보호된 floor → scan 시 원본 TUF 재검증 → keyless 및 기존 바인딩으로 연결한다.
- **First look:** state의 lastAttempt/floor → metadata의 서명/버전/만료/target 존재 → authentication.attestations의 TUF/keyless/bindings reason 순서로 조사한다.

이번 PR revert로 이전 정적 root·공개키 경로로 복구할 수 있다. TUF 정책을 자동으로 정적 정책으로 바꾸지 않는다. 머지 전후 Node 22/24/26·브라우저 CI를 확인하며 운영 서비스 배포는 수행하지 않는다. 실제 조직의 신뢰 anchor 선택·상태 저장소 운영·관찰 주기, 신규 OIDC 발급 round-trip, 전체 delegation/개별 artifact revocation과 새 역할 키로 버전을 초기화하는 복구 profile은 후속이다. 이 profile은 버전을 자동으로 낮추지 않으며 재bootstrap은 별도 검토가 필요하다. 위험 감소의 관찰 지표는 폐기·변조·만료·rollback 입력이 인증을 올리지 않는 것이다. 운영 자료의 관찰 소유자·기간은 미정이며 자동 예약을 만들지 않았다.
