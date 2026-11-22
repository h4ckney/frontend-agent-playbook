# TUF 갱신·폐기 검증 근거 — 2026-11-22

기준 main `bf6356a4cc1e486c0c0fbdde4d52b3f664e6d74f`, branch `feature/tuf-trust-lifecycle`. [설계·사용법·신뢰 경계·복구](../tuf-trust-lifecycle.md)를 함께 읽는다. 이 파일은 로컬 구현·수동 적대 리뷰·실제 공개 읽기와 오프라인 회귀 근거다. PR/main CI·커밋·머지의 완료 여부는 GitHub 기록을 따른다.

| 범위 | Observed |
| --- | --- |
| 전체 회귀 | Node v24.22.3, [317 tests / 317 pass](tuf-2026-11-22/node-tests.log), 실패·skip 0 |
| TUF 부정 경로 | controlled TUF 18개: 이전/새 root threshold, 역할 키 제거, 만료, rollback/equivocation, target 삭제/변조, 부분 갱신 진척 보존, root fork, 상태 위조·cache 만료·동시 lock·복구 |
| 실제 공개 자료 | [최종 온라인 probe](tuf-2026-11-22/public-probe.json), [TUF refresh](tuf-2026-11-22/live-refresh.json). root 16 / timestamp 841 / snapshot 166 / targets 14의 서명·target 검증. 실제 npm tarball SHA512와 signed subject/registry integrity 일치, Fulcio·CT·GitHub issuer/정확한 workflow identity, release commit/builder와 Rekor SET·현재 GET proof 검증 |
| 공개 자료 재생 | 별도 [회귀 4개](../../analysis/public-sigstore.test.mjs)는 [원본 signed 자료·opaque tarball](../../analysis/fixtures/public-sigstore/README.md)을 고정 관찰 시각으로 네트워크 없이 재생. 현재 freshness 증명과 구분 |
| CLI | 외부 state/정책의 명시적 선택, 성공 후 갱신 실패 시 인증 차단, 정적 root와 TUF 상호 배타성 확인 |
| 브라우저 | Chrome 157.0.8103.79 / macOS, [54개 시나리오·page errors 0](tuf-2026-11-22/browser/browser-result.json). checkout/served/browser bytes·테스트 스크립트 hash 일치. [390px TUF 미검증 화면](tuf-2026-11-22/browser/dashboard-tuf-unverified-390.png)에서 Node 필요·인증 미검증 확인, 320/390px 기존 흐름도 통과 |
| 의존성 | [npm audit](tuf-2026-11-22/dependency-audit.json): 도구/테스트 의존성 46개, 당시 공개 DB에서 알려진 취약점 0. 취약점 전체 부재를 뜻하지 않음 |
| 문서/동기화 | Markdown 링크·규칙 검사, plugin/browser schema 동기화, 구문·diff 공백 검사. 실행 상태는 해당 로그/CI를 따름 |

수정한 확인된 중간~높음 문제:

1. **높음 — 부분 갱신 후 신뢰 교체를 잊는 경로:** 새 root·timestamp·snapshot이 유효해도 뒤 metadata가 실패하면 과거 floor로 되돌아갈 수 있었다. 각 단계의 검증 진척을 보존하고 이후 구버전 회복 시도를 거절한다. 뒤 단계 오류 후 root/역할 version 유지와 정상 최신 갱신 복구를 자식 프로세스로 재현했다.
2. **높음 — 더 높은 root로 이전 fork를 우회:** 최종 version만 비교하면 이미 수락한 root 2 대신 다른 root 2를 거쳐 root 3을 만들 수 있다. 저장된 root version의 정확한 signed 내용을 chain 중간에서도 반드시 통과하도록 수정했다. 이전 root key로 교차 서명한 별도 fork 반례를 거절한다.
3. **중간 — TUF 만료 순간 cache 경계:** 만료와 같은 millisecond에 기존 opaque token이 남을 수 있었다. 만료 직전 유효·만료 순간 무효를 확인했다.
4. **중간 — 실제 npm/Rekor 호환성:** 빈 선택적 RFC3161 배열과 Rekor v1의 서로 다른 global/shard index를 거절하던 기존 keyless 가정을 고쳤다. 실제 signed 공개 자료의 양성, global/로컬 index 각각의 변조 음성을 함께 검증했다. 서명·proof 검사를 약화해 예제를 통과시킨 것이 아니다.

최종 수동 리뷰에서 알려진 중간 이상 미수정 결함은 발견하지 않았다. 자동 보안 스캐너의 독립 보고서를 의미하지 않는다. 개발 중 첫 공개 TUF 요청은 관련 없는 delegation 선언을 이유로 거절했고, 첫 실제 bundle은 기존 timestamp/index 가정을 이유로 거절했다. 이를 범위에 맞게 수정해 재실행했다. 부분 progress 리팩터링 중 남은 변수 참조로 양성 검사가 실패한 것도 수정 후 전체 317개를 통과했다. 생성 전 근거 문서 링크를 검사해 나온 한 건은 이 파일을 작성한 뒤 최종 검사로 확인한다.

실행:

```sh
node --test analysis/*.test.mjs bin/frontend-agent-audit.test.mjs scripts/query-osv.test.mjs scripts/guidance-approval.test.mjs scripts/dashboard-provenance.test.mjs
node scripts/verify-dashboard.mjs --url http://127.0.0.1:4382/analysis/ --output /tmp/tuf-browser-evidence --channel chrome
node verification/refresh-sigstore-tuf.mjs --bootstrap-sha256 sha256:27aea7e372aa7864065174f0661784fcf8b0e28b1dbfebeada31a0f1fb19167f --mirror https://tuf-repo-cdn.sigstore.dev --state /tmp/playbook-public-tuf-state.json
node scripts/verify-public-sigstore.mjs --state /tmp/playbook-public-tuf-state.json --output /tmp/playbook-public-sigstore-complete-probe
```

Unknown/후속: 신규 OIDC 로그인·Fulcio 발급·Rekor 게시 round-trip, 실제 조직의 bootstrap 승인·상태 저장소 운영·주기, 전체 delegation 및 개별 artifact/identity revocation, 운영 배포·실기기·대상 제품 전체 화면. 공개 root가 실제로 새 version으로 교체되는 사건은 이번 관찰에서 발생하지 않았다. controlled root rotation과 공개 현재 metadata 검증을 구분한다. 고정 시점 재생은 TUF 현재 만료 판정을 우회하는 제품 기능이 아니다. 실제 서비스 위험 감소는 관찰 소유자·기간이 정해진 뒤 측정하고 자동 예약은 만들지 않았다.
