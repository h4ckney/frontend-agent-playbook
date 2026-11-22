# 신규 OIDC·Fulcio·Rekor round-trip 실행 근거

2026-11-22 · 기준 `63c8983` · 최초 실제 실행 source `12d92dcbc12618edf506a91970ae49d9950aef16`. [설계·공개 게시 경계·복구](../keyless-live-round-trip.md)를 함께 읽는다. 구현·controlled tests·실제 신규 발급을 구분한다. 최종 PR/main 검증과 머지 상태는 GitHub 기록을 따른다.

## Observed — 실제 신규 발급·게시

[전용 GitHub Actions run 45033765873](https://github.com/h4ckney/frontend-agent-playbook/actions/runs/45033765873)이 성공했다. workflow는 `feature/keyless-live-round-trip`의 정확한 source commit을 실행했다. [원본 public receipt](../../analysis/fixtures/live-round-trip/receipt.json)와 [bundle](../../analysis/fixtures/live-round-trip/bundle.json), [synthetic records/정책/신뢰 근거](../../analysis/fixtures/live-round-trip/README.md)를 보존한다.

| 단계 | 관찰 |
| --- | --- |
| OIDC | GitHub job endpoint에서 새 sigstore audience token을 요청하고 repository/ref/SHA/workflow/run/attempt와 공개 visibility·유효 시간을 제한. 토큰 자체는 저장·출력하지 않음 |
| Fulcio | 새 leaf 유효 기간 2026-11-22 14:36:59–14:46:59 UTC. CA chain·CT SCT·GitHub issuer·정확한 이 저장소 workflow SAN 검증 |
| TSA | 새 RFC3161 response 및 메시지 imprint·신뢰 chain·서명 검증. 인증된 서명 시각 2026-11-22T14:36:59Z |
| Rekor | `https://log2025-1.rekor.sigstore.dev`에 새로운 hashedrekord 0.0.2 게시. index **210950482**, checkpoint·Merkle proof 검증 |
| Source/SBOM | exact repository/ref/commit/builder, DSSE payload·manifest/lock/SBOM/artifact hash 일치. 합성 build attestation의 signatureVerified/bindingsVerified true |
| Aggregate | 인증된 보고서는 합성 sbom 하나. 배포 증명을 만들지 않아 전체 authentication은 partial, operationVerified false 유지 |
| Artifact | [artifact ID 14758738460](https://github.com/h4ckney/frontend-agent-playbook/actions/runs/45033765873/artifacts/14758738460), 11개 public 파일. ZIP SHA256 `ea1bfb85b1ca4978f26d5c8641a1d94970a582eea335b0dbe60034db66f82128`를 GitHub API 값과 대조한 뒤 안전한 경로로 추출 |
| 독립 재검증 | [내려받은 자료의 별도 현재 시각 검증](live-round-trip-2026-11-22/independent-verification.json): artifact 정책을 그대로 신뢰하지 않고 기대 workflow/source/nonce에서 재구성한 정책·payload·파일 bytes와 TUF floor를 대조해 다시 통과 |
| 비밀 경계 | job 로그에서 JWT/개인키 형태가 발견되지 않음. 업로드 전 gate와 내려받은 11개 파일 gate 모두 통과. credential 전체 부재를 일반적인 문자열 검색 하나로 증명한 것은 아니며, 생성 경로가 토큰·개인키를 저장하지 않도록 제한됨 |

이전의 남이 이미 게시한 npm provenance 읽기 검증과 달리 이 run은 신규 OIDC 요청·Fulcio 인증서·TSA·Rekor POST를 실제 수행했다. 원본 JWT의 서명을 우리 코드에서 별도로 저장해 재검증하는 방식은 사용하지 않는다. Fulcio가 OIDC token을 인증하고, 독립 verifier가 그 인증서 issuer/SAN을 확인한다. append-only 로그의 공개 항목은 이미 존재하며 revert로 삭제되지 않는다.

## 검사와 수정

로컬 최종 [330 tests / 330 pass](live-round-trip-2026-11-22/node-tests.log), 실패·skip 0. 문서 89개 및 schema/plugin 동기화를 확인했다. 최초 head의 Node 22/24/26와 [Chromium 54개 시나리오·page errors 0, 소스/응답 hash 일치](live-round-trip-2026-11-22/browser-result.json)도 통과했다. 실제 fixture·문서 추가 후 최종 head CI와 main CI는 PR/Actions를 따른다. [서명 도구 감사](live-round-trip-2026-11-22/signing-dependency-audit.json)는 격리된 47개 의존성에서 당시 알려진 취약점 0건이다. 보고서·설치/배포 전체가 안전하다는 판정이 아니다.

확인한 중간급 수정은 Rekor v2의 authoritative index/checkpoint와 생략된 redundant proof 처리, 알 수 없는 log version의 암묵적 parser 재사용 차단이다. 출력 검토에서는 `.frontend-evidence.json`이 숨김 기본값으로 누락되지 않게 하고 `.sigstore`를 포함한 고정 경로만 credential gate 후 업로드한다. 로컬 테스트의 aggregate verified 가정은 기존 엔진 계약대로 partial로 고쳤고, YAML scalar의 문자열/boolean 해석 차이도 실제 parser 계약에 맞췄다. 이를 위해 제품의 전체 인증 기준을 낮추지 않았다.

고정 관찰 시각의 [실제 증명 회귀](../../analysis/live-round-trip-evidence.test.mjs)는 나중에 leaf·정책·TUF가 만료되어도 당시 호환성을 재현하기 위한 테스트다. runtime의 현재 만료 판정을 우회하는 제품 경로가 아니며, 앞으로도 live 검증이 성공한다고 보장하지 않는다. 최종 수동 리뷰에서 알려진 중간 이상 미수정 결함은 발견하지 않았다. 이는 독립 자동 보안 스캐너 보고서를 뜻하지 않는다. 원격 CI는 PR에서 확인한다. 실제 외부 서비스 장애나 정책 차단은 과거 성공으로 대체하지 않는다.

Unknown/후속: 실제 설치·배포, 운영 조직 정책 수용·상태 저장소 운영·빈도/비용 측정, 개별 사용자·artifact revocation, 물리 기기·대상 제품 화면. 실제 위험 감소의 관찰 소유자·기간은 정하지 않았고 자동 예약을 만들지 않았다. main에서는 머지 commit의 새 workflow 신원·source로 한 번 더 검증하며 결과는 그 Actions run을 따른다.
