# Sigstore keyless: Fulcio·OIDC·Rekor 검증

2026-11-22 · 기준 `cc44330` · Risk: Level 2 — 외부 CA·신원·투명성 로그가 보고서 인증 상태를 결정하는 신뢰 경계를 확장한다. [고정 공개키 DSSE](attestation-verification.md)의 소스·보고서 바인딩과 운영 미검증 원칙은 유지한다. CVE snapshot 2026-10-30과 수명 정책 확인일 2026-11-02를 이번 작업으로 갱신하지 않았다.

후속 [TUF 갱신·폐기와 실제 공개 Sigstore 검증](tuf-trust-lifecycle.md)을 추가했다. 아래 고정 root profile은 PR #13 기록이며 계속 지원한다. 실제 공개 자료에서 확인한 빈 timestamp 및 Rekor sharding 호환성 교정은 후속 문서를 따른다.

## 선택과 신뢰 경계

자체 X.509·SCT·Merkle 검증기를 구현하는 대신 [공식 sigstore-js](https://github.com/sigstore/sigstore-js/releases)의 `@sigstore/verify@4.1.3`을 lockfile로 고정했다. 검토 기준은 [2026-11-05 release commit](https://github.com/sigstore/sigstore-js/commit/4576519f81b93bf96bd7457fc7252b8cfa11e67f)이며 transitive integrity도 package-lock에 고정했다. 기존 공개키 전용 유지보다 keyless 입력을 처리할 수 있고, 네트워크를 사용하는 고수준 SDK보다 오프라인 경계가 작다. 대가는 Node 전용 검증과 별도의 도구 설치다. [`GHSA-xgjw-pm74-86q4`](https://github.com/sigstore/sigstore-js/security/advisories/GHSA-xgjw-pm74-86q4)의 unsigned integratedTime 문제를 고려해, inclusion proof만 있는 시간을 인증 시각으로 사용하지 않는다.

외부에서 검토·배포한 **정책**과 **TrustedRoot**를 호출자가 각각 명시해야 한다. 프로젝트 파일, bundle 내 root, 시스템 CA, 이전 검증 성공 JSON은 신뢰를 만들지 않는다. 검증 중 URL·JWKS·TUF·Rekor API를 호출하지 않는다. 이 고정 root 경로는 TrustedRoot의 출처·배포 신뢰·최신성·폐기를 TUF로 검증하지 않으므로 별도 운영 절차가 필요하다. 후속 TUF 경로는 위 확장 문서를 따른다. root hash 일치 자체는 출처 인증이 아니다.

OIDC 검증은 신뢰한 CA가 서명한 인증서의 issuer extension과 SAN을 정책의 **정확한 문자열**과 대조하는 것이다. 와일드카드·정규식을 허용하지 않는다. 원본 JWT를 수신·재검증하거나 OIDC 로그인을 실행하지 않는다. CA가 한 신원 확인을 신뢰하는 Sigstore 모델이다. [공식 검증 개념](https://docs.sigstore.dev/cosign/verifying/verify/)과 [클라이언트 요구사항](https://github.com/sigstore/architecture-docs/blob/main/client-spec.md)을 따른 제한된 소비자 profile이다.

## 현재 지원 profile

| 항목 | 실제 검사와 제한 |
| --- | --- |
| bundle | Sigstore v0.2/v0.3 JSON, DSSE in-toto payload, 서명 1개, leaf 1개. messageSignature·공개키 bundle·bundle 제공 chain root는 미지원 |
| Fulcio | 별도 TrustedRoot CA chain으로 leaf 서명·경로·서명 시각의 유효 기간 검사. CA는 명시한 신뢰 영역이며 URL만으로 공용 Fulcio라고 인정하지 않음 |
| CT | 신뢰된 CT log의 SCT 1개 이상. SCT 서명·log key 유효 기간 검사 |
| OIDC | 인증된 leaf의 issuer와 SAN이 정책과 literal equality로 일치 |
| Rekor | 1개 이상 log entry의 본문과 DSSE 내용 일치, inclusion proof·서명된 checkpoint, root/tree size 일치. 전역 index는 SET, shard-local index는 Merkle proof로 각각 검증하며 서로 같다고 가정하지 않음. SET가 있으면 SET도 검증 |
| 시각 | 서명된 Rekor inclusion promise(SET) 또는 RFC3161 TSA chain·서명·메시지 imprint. proof-only entry의 integratedTime은 시간 근거에서 제외 |
| 만료 | 인증서·CA는 인증된 서명 시각에서, 정책은 분석 현재 시각과 서명 시각에서 확인. proof-only log key도 TSA 시각 유효 기간 확인. 과거 서명 시각 검증이 정책·보고서 freshness를 연장하지 않음 |
| 바인딩 | 기존 SLSA/배포 profile의 repository·revision·builder·params·manifest/lock/report hash·artifact·환경·report format 대조. 서명이 유효해도 다르면 거절 |

entry당 proof hashes 64개, bundle당 Rekor entries 4개·RFC3161 timestamps 2개, leaf Base64 22,000자·SCT 8개, root CA/CT/Rekor 각 8개·chain 4개, 정책 공개키+keyless 합계 8개다. 기존 500KB 파일·4,000개 파일·25MB 수집, envelope 50개와 공개키 서명 시도 256회 한도도 유지한다. keyless 암호 검증은 envelope당 한 번 수행하며 여러 정책은 인증된 신원·컨텍스트에 대조한다. 범위 밖 형식을 자동으로 약한 검증으로 낮추지 않는다.

## CLI·API와 정책

[제어된 예제](../examples/keyless-evidence/README.md)는 실서비스 없이 실제 chain/CT/SET/DSSE 서명을 검증한다. Node `^22.22.2 || ^24.15.0 || >=26.0.0`에서 실행한다. Node 20·25 등 미지원 버전은 인증을 올리지 않는다.

```sh
npm ci --prefix verification/sigstore --omit=dev --ignore-scripts --no-audit --no-fund
node verification/sigstore-root-digest.mjs /trusted/sigstore-root.json
node bin/frontend-agent-audit.mjs scan --root /project --trust-policy /trusted/policy.json --sigstore-trusted-root /trusted/sigstore-root.json --format json
```

설치는 **분석기 도구**의 고정 패키지만 대상으로 한다. 프로젝트 의존성을 설치하거나 코드를 실행하지 않는다. 기본 정적 scan·공개키 DSSE에는 이 설치가 필요 없다. 테스트는 `--omit=dev` 없이 설치해 공식 mock으로 일시 CA·CT·Rekor·TSA를 만든다. 네트워크 없는 검증과 패키지 최초 다운로드는 별개다.

정책은 `schemaVersion: "1"`, 선택적 `keys`, 선택적 `keyless` 배열을 받는다. `keyless`의 각 rule은 `oidcIssuer`, `certificateIdentity`, `trustedRootDigest: "sha256:..."`와 기존 `roles`, `repository`, `builderId`, `buildType`, `externalParameters`, `environments`, `notBefore`, `notAfter`를 명시한다. build role은 buildType/params, deployment role은 environments가 필요하다. [전체 예제 정책](../examples/keyless-evidence/public-policy.json)을 참고한다. root digest는 strict JSON object의 key를 정렬하고 공백 없이 직렬화한 SHA256이며, [계산 도구](../verification/sigstore-root-digest.mjs)가 중복 key·손상 UTF-8을 거절한다. raw 파일 bytes hash와 다르다.

프로젝트 evidence config는 `attestations: [{kind, path, sha256, format: "sigstore-bundle"}]`로 bundle의 **원본 파일 bytes**를 고정한다. API는 `createAuditBundleAsync({records, trustPolicy, sigstoreTrustedRoot, ...})`를 사용한다. 직접 만든 성공 객체를 주입할 수 없고 기존 snapshot/time-bound 불투명 token 계약을 유지한다. 선택한 정책/root는 scan 대상 출력에서 제외한다.

## 상태와 UI

Node 성공은 `authentication.attestations[].method: "sigstore-keyless"`와 `keyless`의 verifier/root digest, chain·issuer·identity·CT·Rekor·signed time 확인 및 signingTimes를 남긴다. raw 인증서·신원·예외·token은 보고서에 내보내지 않는다. `signatureVerified`와 `bindingsVerified`를 나눠 보존한다. root/도구가 없으면 unverified, 선택된 신뢰 경계에서 변조·불일치면 rejected다. 거절된 근거는 기존 `security.attestation-integrity` 상위 이슈의 파일별 하위 항목으로 묶이고 제거만으로 자동 resolved 되지 않는다.

브라우저는 Node 검증기를 실행하지 않는다. 별도 정책을 골라도 `sigstore-node-verifier-required`와 Node CLI 필요 안내를 표시하고 unverified를 유지한다. 성공 보고서 JSON을 가져와 인증으로 승격하는 경로도 없다. keyless 파일 hash가 다르면 rejected를 유지한다. 공개키 DSSE의 브라우저 WebCrypto 검증은 유지한다.

어떤 성공도 SLSA 등급, 실제 배포·서비스 노출·호출 경로, 취약점 해결을 확정하지 않는다. `signed-evidence-operation-unverified`와 취약 버전 경고는 그대로다.

## 근거·리뷰·운영 인계

[실행 기록과 화면·의존성 감사 근거](evidence/keyless-verification-2026-11-22.md)를 보존했다.

[암호·부정 경로 검사](../analysis/keyless-attestations.test.mjs)는 실제 controlled chain/CT/Rekor/SET/TSA 서명, 네트워크 차단, issuer/SAN prefix·regex 반례, 다른 CA/CT anchor, leaf/payload/서명·SET·proof·checkpoint·index 변조, unsigned time, 만료·log key validity, multiple-rule 순서와 바인딩 실패를 검사한다. [CLI 검사](../bin/frontend-agent-audit.test.mjs)는 각각의 명시 선택, duplicate-key root와 symlink를 검사하고, [브라우저 검사](../scripts/verify-dashboard.mjs)는 keyless 미검증·변조와 320/390px를 확인한다. fixture 출처는 [공식 mock](https://github.com/sigstore/sigstore-js/tree/main/packages/mock)이며 개인키는 저장하지 않는다. PR #13 당시 실제 공개 Fulcio/OIDC/Rekor 연동 acceptance는 미확인이었다. 후속의 실제 공개 읽기 검증과 신규 발급 미검증은 위 문서를 따른다.

리뷰에서 invalid mixed policy가 일부 공개키를 활성 상태로 남기던 경로를 원자적 실패로 고쳤고, 동일 신원에 여러 context rule이 있을 때 첫 rule 때문에 거절되는 문제를 수정했다. PR #13에서 checkpoint의 중복 root/tree/index 필드 일치를 추가했으나 index 동일성 가정은 후속에서 교정했다. root/tree 및 proof-only log key의 TSA 시각 유효성 검사는 유지한다. 초기 CLI 테스트가 내부 파일별 findings를 UI 상위 이슈 수와 혼동한 검증 코드를 수정했으며 UI의 단일 parent는 별도 브라우저 검사가 담당한다.

- **Why:** 기존 공개키 정책만으로는 keyless CA·신원·로그를 검증할 수 없었다.
- **System change:** 명시한 외부 root/policy → 공식 오프라인 검증 → 기존 바인딩 → 별도의 인증 상태로 연결한다.
- **First look:** `authentication.attestations`의 reason/signature/bindings → 정책의 literal 신원·기간·root hash → bundle의 proof/서명 시각과 현재 source/report hash 순서로 조사한다.

배포 범위는 PR/main 분석기 코드와 문서이며 운영 서비스 배포가 아니다. 실패 시 이 PR revert로 기존 공개키 경로를 복구한다. 머지 전 Node 22/24/26와 브라우저 CI가 필요하며 실제 실행 상태는 PR/Actions 기록을 따른다. 관찰 신호는 변조·자체 신뢰·unsigned time이 인증을 올리지 않는 것이다. 운영 효과 측정은 신뢰된 조직 자료 확보 후 수행하며 소유자·기간은 미정이고 자동 예약은 없다.

PR #13 당시 후속 (1)은 TUF 신뢰·폐기 정책과 실제 조직 bundle acceptance였으며, 현재 TUF·공개 자료 지원과 남은 조직 운영 범위는 위 후속 문서를 따른다. 이어서 (2) provider별 buildType·배포 관찰, (3) 공유 SBOM selector·OCI 종류다. 지원하지 않는 bundle profile을 추측해 인증하지 않는다.
