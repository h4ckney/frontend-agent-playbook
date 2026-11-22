# 빌드·배포 attestation과 보고서 서명 검증

2026-11-22 · 기준 `7bbadda` · 위험 수준 2: 보고서 진위와 검토·보안 기준선의 신뢰 경계를 바꾼다. [이전 자료 연결](execution-evidence.md)은 hash·대상 일치를 확인했다. 이번에는 검토자가 따로 선택한 공개키 정책으로 실제 서명을 검사한다. CVE·런타임 지원 정책의 기존 확인일을 갱신하지 않는다.

후속 [Sigstore keyless 확장](sigstore-keyless.md)은 Node CLI에서 별도 root·OIDC 신원·Fulcio/CT/Rekor를 검증한다. 아래 공개키 profile은 PR #12 기록이며 계속 지원한다.

## 지원 범위와 판단

[DSSE 1.0.2](https://github.com/dsse-lf/dsse/blob/master/protocol.md)의 PAE를 정확한 payload bytes에 적용하고 플랫폼 WebCrypto의 ECDSA P-256/SHA-256으로 검사한다. PKIX SPKI 공개키 PEM과 `sha256:<SPKI DER hash>`를 고정한다. 서명 인코딩은 정책에서 `der` 또는 `ieee-p1363`를 명시하며 자동으로 알고리즘·인코딩을 낮추지 않는다. 표준·URL-safe Base64를 지원한다. envelope `keyid`는 인증되지 않은 힌트여서 신뢰 근거로 사용하지 않는다.

SLSA provenance는 현행 [SLSA 1.2 Build Provenance](https://slsa.dev/spec/v1.2/build-provenance)의 predicate URI `https://slsa.dev/provenance/v1`과 [in-toto Statement/v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)을 읽는다. 전체 SLSA 인증·등급 심사나 모든 공급업체 buildType 해석을 수행하지 않는다. 다음의 명시적인 소비자 profile을 지원한다.

| 검사 | 빌드 attestation | 배포 attestation |
| --- | --- | --- |
| predicate | SLSA provenance v1 | 이 저장소가 정의한 `https://h4ckney.github.io/frontend-agent-playbook/attestation/deployment/v1` |
| 신뢰 주체 | 정책의 공개키·build role·builder ID | 정책의 공개키·deployment role·collector ID |
| 산출물 | Statement.subject의 artifactName·SHA-256 | 같은 artifactName·SHA-256 |
| 소스 | resolvedDependencies의 정확한 repository URI와 gitCommit | predicate.source.uri·revision |
| 입력/보고서 | manifest·lock을 `file:<선택 루트 상대 경로>` resolvedDependency SHA-256으로, 설치·SBOM 보고서를 subject name·SHA-256으로 연결 | 배포 관찰 보고서를 subject name·SHA-256으로 연결 |
| 정책·시점 | buildType·externalParameters 전체와 frontendEvidence 형식/mode의 정확한 값, signed startedOn/finishedOn·순서·30일 이내 | 허용 environment, succeeded, signed observedAt과 보고서 시각·30일 이내 |

각 자료의 현재 선택된 bytes와 signed hash도 일치해야 한다. 신뢰한 키가 서명했더라도 다른 repo/ref·revision·빌더·외부 입력·workspace·산출물·보고서·환경이면 인증을 거절한다. buildType별 보안 모델·externalParameters의 올바른 정책 값은 정책 작성자가 검토한다. signed internalParameters는 빌더가 통제하는 값으로 남긴다. 서명은 발급자가 해당 내용을 진술했다는 근거이며 그 내용의 운영상 진실을 독립적으로 측정하지 않는다.

buildDefinition.externalParameters의 `frontendEvidence`는 선택한 설치/SBOM의 `format`과 선택적인 `mode`를 포함해야 하며 정책에도 같은 값을 고정한다. 서명된 bytes를 다른 형식이나 lock-only 출력의 설치 목록으로 재해석하는 것을 막는다. 실제 수집 절차의 진실성은 신뢰한 발급자의 책임이다.

배포 predicate의 필수 필드는 `reportFormat: deployment-observation`, `collector.id`, `source.uri`, `source.revision`, `environment`, `status: succeeded`, UTC `observedAt`이다. 이 값은 [배포 관찰 v1](execution-evidence.md)의 파일과 일치해야 한다. 별도 provider 응답·URL·토큰을 실행하거나 조회하지 않는다. 식별 URI의 구현 명세는 이 문서와 [예제](../examples/signed-evidence/README.md)다.

## 신뢰 정책을 별도로 선택하는 이유

프로젝트가 제공한 공개키로 프로젝트가 제공한 서명을 검증하는 것만으로 검토자의 신뢰를 만들 수 없다. CLI의 `--trust-policy PATH` 또는 대시보드의 별도 정책 파일 선택만 신뢰 입력이다. 프로젝트 폴더의 정책 파일·내장 trustPolicy·certificates·검증 성공 JSON은 자동으로 활성화하지 않는다. 정책 파일은 검토자가 관리하는 별도 위치에서 선택하는 방식이 적합하며, 저장소 안의 예제 정책을 선택하는 것은 예제 발급자만 신뢰하는 명시적 테스트다.

정책은 `schemaVersion: "1"`, `keys` 배열이다. 각 키는 `keyId`, `publicKey`, `algorithm: ecdsa-p256-sha256`, `signatureEncoding`, `roles`, `repository`, `builderId`, UTC `notBefore/notAfter`를 가진다. build role은 `buildType`, `externalParameters`도, deployment role은 `environments`도 요구한다. 정확한 공개 형태는 [public-policy.json](../examples/signed-evidence/public-policy.json)을 참고한다. 개인키는 입력하지 않는다. 허용되지 않은 정책 필드·중복 fingerprint·다른 곡선/알고리즘·알 수 없는 threshold는 거절한다.

키 유효 기간은 검증 기준 시각과 서명된 관찰 시각에 적용한다. 인증된 외부 timestamp·CA 폐기 상태를 검증하는 방식은 아니다. 회전/폐기는 검토자가 관리하는 정책에서 키를 추가·제거하거나 유효 기간을 바꾸어 다시 검사한다. 네트워크로 공개키나 정책을 자동 갱신하지 않는다. 정책은 기본적으로 1-of-authorized-key 검증이며 다중 서명 threshold는 지원하지 않는다. 브라우저 정책은 현재 탭에서만 유지하고 해제 시 인증을 바로 내린다.

## API·수집·결과

CLI scan은 비동기 `createAuditBundleAsync({ records, trustPolicy, ... })`를 사용한다. 기존 동기 `createAuditBundle`/`inspectSecurityContext`는 직접 암호 검증을 시작하지 않으며, 미검증으로 남긴다. 내부의 `attestationVerification`은 WeakMap으로 등록한 불투명 결과에 한해 받는다. 사용자가 작성한 같은 모양의 객체로 인증을 주입할 수 없다. 결과는 입력 파일들의 path/content 전체와 기준 시각에 묶이고 최대 5분·가장 이른 키 만료까지만 재사용한다. 파일/정책 변경·새 분석 후에는 다시 검사한다. 최종 보고서의 checkedAt은 당시의 검증 시각이며 현재 운영 상태의 실시간 표시가 아니다.

프로젝트 config의 `attestations: [{kind, path, sha256, format: dsse-in-toto}]`를 수집한다. 경로는 기존 bounded 선택 규칙과 제외를 유지한다. 개인키·환경/인증 파일·symlink(CLI)·선택 루트 밖을 읽지 않는다. 최대 키 8개, 대상당 role 2개, envelope 서명 4개, 검증 envelope 50개·서명 시도 256회를 제한한다. 기존 파일 500KB·4,000개·25MB budget도 유지한다. 정확한 검증 bytes를 JSON 해석에 전달하고 중복 key·손상 JSON·UTF-8·잘못된 DER·과다/모호한 subject/material을 거절한다.

`executionEvidence.subjects[].authentication`은 `status`, `policyDigest`, `checkedAt`, `verifiedReports`, `attestations`를 보존한다. 각 attestation은 `signatureVerified`와 `bindingsVerified`를 따로 기록한다. verified는 선택한 정책에 따른 보고서 인증이다. 원래 `subject.status`/`deployment.linked`의 선언 연결, 취약 버전 일치, 실제 운영 상태는 별도다. 인증된 보고서라도 취약 설치·런타임 버전은 그대로 경고하며 자동 해결하지 않는다. 인증은 서명·바인딩을 뜻하므로 해석상 gap이 있는 자료는 authentication verified와 별도로 subject partial/unlinked 상태를 유지할 수 있다.

고정 정책에서 거절된 증명은 `security.attestation-integrity` 한 상위 이슈에 경로별 근거로 묶는다. 잘못된 정책이나 자료일 수도 있어 중간급 검토 대상으로 표시하며 악의적 변조를 확정하지 않는다. 정책/증명을 제거하면 그 경고가 baseline에서 자동 resolved가 되지 않는다. 모든 보고서를 인증했어도 `signed-evidence-operation-unverified`를 남기므로 서명 성공이 보안·운영 검증 완료를 뜻하지 않는다.

## 검증 근거·리뷰·전달

[회귀 검사](../analysis/attestations.test.mjs)는 DSSE 공식 PAE/ECDSA 공개 시험 벡터, 별도 Node crypto signer가 만든 실제 DER·P1363 서명, Base64url과 unauthenticated keyid, payload/type/signature/report 변조, 다른 builder/repo/revision/입력/산출물/환경, 만료·미래 키와 시각, 역할·fingerprint·중복·작업 한도, 토큰 위조·bytes 변경·키 만료 경계·baseline 오해결을 검사한다. [fixture generator](../analysis/fixtures/signed-evidence.mjs)는 테스트 과정에서 일시 키를 생성하며 개인키를 저장하지 않는다. [CLI 검사](../bin/frontend-agent-audit.test.mjs)와 [브라우저 검사](../scripts/verify-dashboard.mjs)는 정책 선택 전/후, 변조 거절과 단일 검토 이슈, 정책 해제, 320/390px 및 응답 출처를 확인한다. 이 자료는 실서비스 attestation이 아니다.

구현 리뷰에서 검증 캐시가 키 만료를 넘기거나 늦은 정책 읽기가 새 선택을 덮을 수 있는 경우를 차단했다. 서명만 통과하고 입력·보고서 바인딩이 어긋나는 반례, 결과 객체 위조와 source bytes 변경도 고정했다. 최종 테스트·보안 검토·CI와 머지 상태는 PR의 실제 기록을 따른다. 실패 시 첫 확인은 authentication.attestations의 signature/bindings/reason, 외부 정책의 keyId·roles·유효 기간, signed subject/resolvedDependencies와 현재 파일 hash다. 되돌리기는 해당 PR revert다.

관찰 기준은 변조·타 build·만료 키·자체 신뢰 정책으로 인증 상태가 올라가지 않는 것이다. 실제 조직 자료의 acceptance·운영 위험 감소 측정은 신뢰된 발급자와 관찰 환경이 확보된 뒤 가능하며 담당자·측정 기간은 미정이다. 자동 감시를 예약하지 않았다. keyless 후속 구현은 위 확장 문서를 따른다. 남은 작업은 TUF·실제 조직 자료 acceptance, provider별 buildType/환경 관찰, 공유 SBOM 선택자와 OCI 산출물 종류 검증이다. 이 문서의 공개키 인증은 DSSE subset이며 SLSA 등급·라이브 배포·안전한 호출 경로를 확정하지 않는다.
