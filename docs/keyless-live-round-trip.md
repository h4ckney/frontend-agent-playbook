# 신규 OIDC·Fulcio·Rekor 실제 round-trip

2026-11-22 · 기준 `63c8983` · Risk: Level 2 — CI OIDC 권한과 공개 로그 게시 경계를 추가한다. [이전 공개 자료 읽기 검증](tuf-trust-lifecycle.md)에 이어 이 저장소 workflow에서 새 OIDC token, Fulcio 단기 인증서, RFC3161 timestamp와 Rekor v2 게시를 실행하고 서명·소스/SBOM 바인딩을 확인한다. 실행 완료는 실제 workflow 결과로 판단하며 구현/controlled 테스트만으로 신규 발급 완료라고 하지 않는다.

## 실행 범위와 선택

[전용 workflow](../.github/workflows/keyless-round-trip.yml)는 이 저장소의 `main`·현재 검증 branch `feature/keyless-live-round-trip`에 한정한다. workflow/probe 또는 keyless adapter 변경 push와 명시적 workflow_dispatch에서 실행한다. fork/PR/pull_request_target/workflow_run·schedule에는 실행하지 않는다. 일반 PR 검증의 contents read 권한을 유지하고 전용 job에만 `id-token: write`를 부여한다. 정확한 commit을 checkout하고 Git credential을 남기지 않는다.

대안은 로컬 대화형 OIDC 로그인 또는 기존 공개 증명 재생이다. CI 방식은 사용자 자격 증명을 채팅으로 다루지 않고 repository/workflow/ref/commit/run에 신원을 묶을 수 있어 선택했다. 추가 signing tooling은 별도 [고정 package/lock](../verification/round-trip/package.json)에 설치하고 lifecycle scripts를 끈다. 기본 분석 scan은 여전히 오프라인이며 서명·게시를 시작하지 않는다.

Rekor는 append-only 공개 로그다. 인증서의 공개 GitHub workflow 신원, 서명·합성 산출물의 hash와 로그 위치는 게시 후 삭제할 수 없다. payload는 임의 프로젝트 파일·환경·사용자 자료 대신 **고정 생성한 합성 build/SBOM**과 공개 repository/ref/SHA/run/attempt, 일시 nonce만 사용한다. 후보 branch에서 한 번, 머지 후 main에서 한 번이 정상 검증 경로이며 재시도는 별도 실행으로 기록한다. 향후 관련 경로 변경 push도 새 공개 항목을 만들 수 있고, 문서만 바꾸는 push는 게시를 반복하지 않는다. workflow 제거로 향후 실행을 멈출 수 있으나 이미 게시한 로그는 남는다.

## 실제 검증 단계

1. **사전 경계:** 고정 repository·workflow·허용 ref·push/dispatch·SHA·run과 공개 게시 acknowledgment를 확인한다. 외부/PR context와 debug 환경에서는 OIDC 요청 전 거절한다.
2. **TUF:** 별도 검토한 [bootstrap root 16](../verification/round-trip/bootstrap-root.json)의 원본 SHA256 `27aea7e372aa7864065174f0661784fcf8b0e28b1dbfebeada31a0f1fb19167f`에서 현재 metadata를 검증한다. [기록된 floor](../verification/round-trip/trust-floor.json)보다 낮거나 다른 분기로 돌아가지 않는다. 이 floor는 PR #14에서 검증한 공개 자료에서 얻었다. CI state는 run마다 격리되므로 영속 운영 저장소의 연속 anti-rollback을 대신하지 않는다.
3. **OIDC:** GitHub job이 제공한 HTTPS `*.actions.githubusercontent.com` endpoint 하나에서 `audience=sigstore` token을 새로 요청한다. ambient `SIGSTORE_ID_TOKEN`·다른 CI·대화형 로그인으로 대체하지 않는다. issuer/audience/repository ID·visibility/ref/SHA/workflow/run/attempt·발급/만료 시각을 제한한다. 로컬 claim parsing 자체는 JWT 서명 인증이 아니며 Fulcio가 원본 JWT를 인증한다.
4. **Fulcio:** 공식 `@sigstore/sign@5.1.0`의 ephemeral signer와 Fulcio client로 단기 인증서를 발급받는다. 뒤의 독립 verifier가 CA chain·CT SCT와 정확한 issuer/SAN을 확인한다. 개인키·JWT는 메모리에만 둔다.
5. **TSA → Rekor:** TSA를 먼저 요청하고, 성공하면 Rekor v2에 한 번 POST한다. DSSE PAE와 서명의 SHA256을 hashedrekord 0.0.2로 게시한다. 공식 RekorWitness의 message-signature request 변환을 사용하며 DSSE bundle의 서명 bytes는 그대로 유지한다. 자동 retry·다른 신원/로그로 fallback하지 않는다. POST timeout은 게시되지 않았다고 단정하지 않고 outcome unknown으로 남긴다.
6. **독립 검증:** TUF에서 얻은 CA/CT/Rekor/TSA 신뢰로 bundle, signed checkpoint·Merkle 위치·RFC3161 time·정확한 payload와 repository/ref/SHA/builder·manifest/lock/SBOM/artifact hash를 검사한다. 현재 발급한 단기 leaf와 신선한 서명 시각을 요구한다.

합성 build/SBOM 한 건만 인증한다. 배포 보고서나 실제 설치를 만들지 않으므로 전체 subject의 authentication은 기존 계약대로 **partial**을 유지하고, build attestation의 signatureVerified/bindingsVerified와 verifiedReports의 sbom만 확인한다. 이를 전체 운영 체인 인증으로 올리기 위해 엔진의 검증 조건을 낮추지 않는다. `receipt.status: verified`는 이 좁은 round-trip 성공이며 운영 안전성·설치·배포·취약점 해결이나 SLSA 등급 판정이 아니다.

## 출력과 실패

[실행 스크립트](../verification/round-trip/run.mjs)는 public receipt, bundle, 합성 records·정책·공개 TUF state와 AuditResult만 생성한다. JWT·OIDC request credential·개인키·raw exception·전체 환경은 출력하지 않는다. SDK의 token 포함 오류도 entrypoint에서 정적 오류로 바꾼다. 업로드 전 [evidence guard](../verification/round-trip/check-public-evidence.mjs)가 예상 JSON/text 외 파일·symlink·예산 초과·JWT/개인키 형태를 거절하고, 이 단계가 성공해야 artifact를 올린다. 실제 log 게시 성공이 확인되지 않으면 receipt를 incomplete로 남긴다.

성공 artifact는 run/commit별 7일 보관한다. public receipt는 oidcTokenIssued, claimsChecked, certificateIssued, TSA response, Rekor attempt/response와 signature/bindings 확인을 구분한다. claimsChecked만으로 JWT가 암호학적으로 인증됐다고 주장하지 않는다. 실패의 raw token/error를 보려는 절차는 제공하지 않는다. 필요한 첫 조사 대상은 failureStage·publicationOutcome, 해당 run/ref의 OIDC 권한과 신원, TUF/인증서/로그의 검증 근거다.

## 호환성·리뷰·검증

Rekor v2는 top-level logIndex와 서명된 checkpoint의 root/tree size가 권위 있는 값이다. redundant proof 필드가 생략·기본값이어도 이를 사용해 확인하며, 최종 Merkle·checkpoint 서명 검증은 공식 verifier가 한다. 기존 Rekor v1의 global/shard 분리는 유지한다. [공식 Rekor v2 client 규격](https://github.com/sigstore/rekor-tiles/blob/main/CLIENTS.md), [공식 signing API](https://github.com/sigstore/sigstore-js/blob/4576519f81b93bf96bd7457fc7252b8cfa11e67f/packages/sign/README.md), [GitHub OIDC 권한·claims](https://docs.github.com/en/actions/reference/security/oidc)를 참고했다.

입력의 kind/version을 명시적으로 제한해 미래 버전을 현재 parser로 조용히 해석하지 않는다. 검토 중 공식 low-level parser가 non-v1 버전을 v2 구조로 받는 경로가 있어 adapter에서 지원 집합을 고정했다. 잘못된 top-level index/checkpoint/TSA/payload와 알 수 없는 version을 거절하는 controlled 암호 검사가 있다. [round-trip 경계 검사](../analysis/live-round-trip.test.mjs)는 PR/fork·잘못된 OIDC claims·ambient token·PAE hash·합성 source 바인딩·nonce replay·자격 증명 출력·artifact gate와 실제 workflow 권한을 검사한다. 이는 실제 신규 발급의 대체 근거가 아니다.

- **Why:** 이미 게시된 자료의 읽기 검증만으로 신규 OIDC/CA/로그 쓰기 경로가 동작하는지 알 수 없었다.
- **System change:** 격리된 권한과 고정 합성 payload → 신규 발급/TSA/게시 → 독립 서명·바인딩 검증 → 공개 근거 artifact로 연결한다.
- **First look:** Actions receipt/failureStage → TUF·정확한 workflow identity·OIDC job 권한 → bundle의 TSA/checkpoint 및 AuditResult의 signature/bindings 순서다.

복구는 workflow/probe 변경 PR revert다. 네트워크 장애를 성공으로 바꾸거나 과거 증명으로 대체하지 않는다. 신규 공개 게시의 운영 비용·빈도와 실제 조직 자료 적용은 소유자·기간을 정한 뒤 측정하며, 자동 예약을 만들지 않았다. [최초 실제 신규 발급·게시와 독립 재검증 근거](evidence/live-round-trip-2026-11-22.md)를 보존했다. 최종 PR/main CI 상태는 Actions 기록을 따른다. 현재 통제 범위 밖인 물리 기기·서비스 배포·실제 설치·개별 사용자/산출물 revocation은 수행하지 않는다.
