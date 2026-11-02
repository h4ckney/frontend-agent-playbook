# 후속 작업 우선순위와 이번 실행

2026-11-01 · 기준 `8701eba` · 위험 수준 2: 기준선의 해결 판정과 PR 검증 경로 변경.

우선순위는 실패 영향, 현재 근거, 실행 가능성으로 정한다. 외부 서비스 정보가 필요한 작업을 합성 입력으로 완료 처리하지 않는다.

| 우선순위 | 작업 | 현재 상태·완료 기준 |
| --- | --- | --- |
| P0 | 버전 정보 손실로 인한 오해결 방지 | 이번 수정. 안전한 정수 범위를 벗어난 버전을 미확인으로 남기고 이전 위험을 미검증으로 유지 |
| P1 | 대시보드 실제 브라우저 CI | 이번 구현. PR/main에서 별도 Chromium job으로 23개 시나리오·서버/브라우저/소스 일치 확인. 원격 실행 결과는 해당 PR CI를 따른다 |
| P1 | 실제 서비스의 레이어·잘림·클릭 차단 | 대상 URL·지원 화면·대표 여정·허용 테스트 데이터가 필요. 현재 제공된 대상은 이 저장소 대시보드이며 그 범위는 CI가 담당 |
| P1 | 배포 런타임·OS·컨테이너 위험 | 실제 Node/PHP 버전·SAPI·OS·image digest·SBOM·공급업체 패치 필요. 합성 버전 일치를 배포 취약점으로 표현하지 않음 |
| P2 | workspace·lock 해석 확장 | 다음 구현. 우선 package별 테스트·정제 도구의 증거가 다른 package의 위험을 잘못 해소하는지 분리 재현. 그다음 실제 pnpm/yarn/bun fixture·형식별 parser·미지원 실패 경로 확보 |
| P2 | 권고 목록 갱신·외부 이슈 동기화 | 갱신 소유자·수집 범위·전송 정책·동일성/재개/종료 계약 확정 후 구현. 예약 자동화는 생성하지 않음 |
| P3 | 검토 journal 용량·가져오기 개선 | 저장 실패 시 내보내기는 유지. 동시 탭 데이터 보존을 증명하는 압축·삭제 계약이 생긴 뒤 구현 |

현재 [workspace·npm v1·Yarn Classic 확장](workspace-lock-analysis.md)에 이어 [pnpm·Berry·Bun 및 공유 workspace graph](modern-lock-workspace-graphs.md)를 구현했다. 앞의 표는 최초 우선순위다. [미지원 protocol/format 우선순위와 후속 구현](lock-protocol-priorities.md)을 추가했다. 이후는 P3 형식의 실제 fixture, 설치 SBOM·배포 증거, 실제 workspace E2E 연결을 기준으로 진행한다. 검증·머지 상태는 해당 PR/CI를 따른다.

2026-11-02에는 [런타임·서비스 지원 수명](runtime-service-lifecycle.md)을 추가했다. Deno 제품 분리와 Node/PHP/Bun 정책, 버전 근거 소실·prerelease 오판을 수정했다. [Deno lock graph·공식 fixture·명시적 LTS 채널](deno-lock-lts.md)도 확장했다. [legacy v1·v2·custom lock·literal local 연결](deno-legacy-custom-local.md)을 이어서 확장했다. 다음 우선순위는 실제 배포·채널·SBOM 근거, 추가 local protocol·glob·중첩 연결과 정책 갱신 체계다.

## 확인한 중간 이상 문제와 수정

**확인된 결함:** `9`가 100자리인 major 버전 등의 숫자가 JavaScript Number 변환에서 지수 표현으로 바뀌는데도 `runtime-pin`으로 인정됐다. 정상 Node 버전에서 이 입력으로 바꾸면 권고가 사라지고 기존 Node Brotli 항목이 `resolved`로 바뀌었다. 실제 실행 버전의 근거가 없어진 것을 해결로 표현하는 경로다.

수정 후 모든 구성 요소가 `Number.isSafeInteger`를 만족해야 정확한 버전으로 취급한다. 불확실한 버전은 미확인 범위를 만들고 기존 항목은 `unverified`로 유지한다. OSV에서도 반올림된 좌표를 전송하지 않는다. 보안 탐지기 revision을 갱신해 이전 판정을 그대로 재사용하지 않는다. 권고 자체의 확인일은 2026-10-30으로 유지한다.

근거: [기준선 회귀 검사](../analysis/audit-contract.test.mjs), [외부 조회 음성 검사](../scripts/query-osv.test.mjs).

## 브라우저 CI의 범위와 실행

기본 Node 22/24/26 검사 후 별도 `dashboard-browser` job이 Node 24에서 Playwright 1.64.1과 그 Chromium을 설치한다. 도구는 runner 임시 폴더에만 설치하며 프로젝트 의존성을 설치하거나 소스를 외부로 보내지 않는다. 기본 검사·로컬 CLI에는 패키지 설치가 필요하지 않다. 이후 modern lock 확장에서는 검토한 YAML parser를 고정해 저장소에 포함하며 출처·라이선스·hash를 기록한다.

[CI 실행기](../scripts/verify-dashboard-ci.mjs)는 이 체크아웃의 analysis 파일만 제공하는 loopback 임시 포트를 열고 [기존 브라우저 검사](../scripts/verify-dashboard.mjs)를 실행한다. 자식 검사 실패·신호 종료는 실패로 전파하고 서버를 닫는다. 브라우저 실행에는 4분, job에는 10분 한도를 둔다. 설치나 검사가 실패하면 성공으로 건너뛰지 않는다.

화면·소스 해시·브라우저 응답 해시·JSON 결과는 GitHub Actions artifact에 7일 보관한다. 실패 시 일부 화면만 존재할 수 있으며 성공한 `browser-result.json`이 없으면 통과로 취급하지 않는다. artifact 이름은 commit SHA와 실행 차수를 포함한다. checkout/setup-node/upload-artifact는 공식 릴리스 SHA를 고정하고 checkout 인증정보 보관·패키지 캐시는 끈다.

```sh
# 호출 환경에 Playwright 및 해당 Chromium이 설치되어 있을 때
node scripts/verify-dashboard-ci.mjs /tmp/frontend-browser-evidence
```

이 결과는 감사 대시보드의 합성 입력·viewport·상호작용 검사다. 실제 서비스 URL, 물리 기기, 승인된 visual regression 기준 이미지, 운영 배포 및 운영 효과는 검증하지 않는다. CI job 실패 시 먼저 설치 로그, 검사 실패 지점, artifact의 소스 해시·화면을 확인한다.

공식 근거: [Playwright CI 설치·실행](https://playwright.dev/docs/ci), [Playwright 패키지 버전](https://www.npmjs.com/package/playwright?activeTab=versions), [artifact 액션 릴리스](https://github.com/actions/upload-artifact/releases/tag/v7.0.2).

## 리뷰·전달 상태

회귀 검사·문서·plugin/schema 동기화와 반례 검토를 수행하고, 원격의 기본 검사와 브라우저 job이 모두 통과한 head만 머지한다. GitHub의 branch protection을 새로 설정한 것은 아니며 검증 job이 존재한다고 모든 관리자 머지를 강제 차단하는 것도 아니다. 실패 시 이 변경 PR을 revert하면 된다. 이전 검증 기록은 해당 시점의 역사적 근거로 보존한다.
