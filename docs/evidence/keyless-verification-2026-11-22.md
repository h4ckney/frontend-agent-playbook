# Keyless 검증 근거 — 2026-11-22

기준 main `cc44330dd760d0d36772afc929423ecd8cd5d6e7`, 변경 branch `feature/sigstore-keyless-verification`. 구현·수동 적대 리뷰·로컬 실행 근거다. 커밋/PR/main CI와 머지 상태는 실제 GitHub 기록을 따르며 이 파일만으로 완료를 주장하지 않는다. [설계·신뢰 경계·복구·후속](../sigstore-keyless.md)을 함께 읽는다.

| 범위 | Observed |
| --- | --- |
| Node | v24.22.3, [294 tests / 294 pass](keyless-2026-11-22/node-tests.log), 실패·skip 0 |
| 추가 암호 검사 | keyless 17개. 실제 controlled CA·CT·Rekor·DSSE와 RFC3161 서명, 변조·잘못된 신원·다른 root·unsigned time·만료·context·v0.2/v0.3·baseline 삭제 반례 |
| CLI | 정책/root 각각 선택 전 미검증, 둘 선택 후 검증. 잘못된 신원·duplicate-key root·symlink bundle 거절. 별도 Node 20.19.2 수동 실행은 `sigstore-runtime-not-supported`, Node 24 예제 실행은 양쪽 `signature-and-bindings-verified` |
| 의존성 | [npm audit 결과](keyless-2026-11-22/dependency-audit.json): verifier+dev tooling 38개, 알려진 취약점 0. 외부 advisory DB의 당시 응답이며 모든 취약점 부재의 증명이 아님 |
| 실제 브라우저 | Chrome 157.0.8103.79 / macOS, [53개 시나리오, page errors 0](keyless-2026-11-22/browser/browser-result.json). HTML·JS·CSS 응답과 checkout/browser bytes hash 일치, 테스트 스크립트와 사용 예제 hash도 보존 |
| 좁은 화면 | [320px](keyless-2026-11-22/browser/dashboard-keyless-unverified-320.png), [390px](keyless-2026-11-22/browser/dashboard-keyless-unverified-390.png): 가로 overflow 검사 통과, Node CLI 필요·인증 미검증 표기를 실제 이미지로 확인 |
| 동기화 | Markdown 링크·규칙 검사, plugin 동기화, browser schema 동기화와 diff 공백 검사 통과 |

실행 명령:

```sh
node --test analysis/*.test.mjs bin/frontend-agent-audit.test.mjs scripts/query-osv.test.mjs scripts/guidance-approval.test.mjs scripts/dashboard-provenance.test.mjs
node scripts/verify-dashboard.mjs --url http://127.0.0.1:4382/analysis/ --output /tmp/keyless-browser-evidence --channel chrome
node scripts/validate-docs.mjs
node scripts/sync-artifact-schemas.mjs --check
node scripts/sync-plugin-package.mjs --check
```

최초 로컬 browser runner는 Playwright 기본 headless 실행 파일이 없어서 시작하지 못했다. 설치된 Chrome channel로 재실행해 위 검증을 완료했다. CI는 별도 Playwright/Chromium을 설치하는 기존 job을 사용한다. 초기 추가 테스트의 내부 파일별 findings 수와 UI parent 수 혼동, 자동 baseline 비교를 가정한 테스트 호출도 실제 계약에 맞게 수정 후 전체 통과했다. 검사 실패를 제품 수정 없이 통과한 것으로 숨기지 않는다.

수동 리뷰의 확인된 중간급 수정: invalid mixed policy의 부분 공개키 활성화를 차단하고, 동일 신원·여러 context 정책의 순서 의존 거절을 제거했다. 추가로 unsigned Rekor 시간 대체를 차단하고 proof/checkpoint 중복 필드 일치·log key의 TSA 시각 유효성을 확인한다. 인증서·SCT 작업 한도와 브라우저/Markdown 인증 문구도 일치시켰다. 최종 리뷰에서 알려진 중간 이상 미수정 결함은 발견하지 않았다. 이는 자동 보안 스캐너의 독립 보고서를 뜻하지 않는다.

Unknown: 공용 Fulcio/OIDC 로그인, 실제 Rekor 게시, 독립 TUF root 갱신/폐기, 실제 조직 bundle acceptance, 운영 배포·실기기·대상 앱 화면, SLSA 등급, 실제 위험 감소. 브라우저의 keyless 검증은 의도적으로 미지원이며 Node CLI만 암호 검증한다. 위 이미지로 대상 서비스 전체 CSS/z-index 결함 부재를 일반화하지 않는다. 운영 효과 측정은 자료·소유자·관찰 기간이 정해진 뒤 진행하고 자동 감시를 예약하지 않았다.
