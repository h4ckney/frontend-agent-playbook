# 런타임·호스팅·레지스트리 지원 수명

정책 확인일 **2026-11-02 (Asia/Seoul)** · 기준 코드 `0167797` · 위험 수준 2: 지원 상태와 기준선의 해결 판정을 바꾼다. CVE 권고 목록의 확인일은 별도로 **2026-10-30**을 유지한다. 지원 정책을 갱신했다고 취약점 목록까지 최신으로 표시하지 않는다.

## 공식 근거와 현재 판정

| 대상 | 2026-11-02 기준 | 종료 근거·해석 |
| --- | --- | --- |
| Deno Runtime | 공식팀 개발 종료 예정 | 2026-10-09 공지의 추가 1년 지원 → **2027-10경**. 월별 버그·보안 수정 이후 공식팀 개발 종료. 오픈소스의 존속·타인의 개발 종료와 다름 |
| Deno Deploy | 서비스 종료 예정 | 같은 공지의 추가 6개월 운영 → **2027-04경**. 실제 계정·배포 상태 미확인 |
| Deno Deploy Classic | 공식 일정상 종료 | 별도 공식 문서의 **2026-07-20**. `deployctl`과 그 GitHub Action은 Classic용이며 새 Deploy와 구분 |
| JSR | 계속 운영 공지 | Cloudflare로 인프라 이전. 종료일 미공표. Deno Runtime 종료 예고를 전파하지 않음 |
| Node.js | 공식 계열별 달력 | 20은 2026-04-30, 25는 2026-06-01 종료. 22·24는 유지보수 지원, 26은 지원 중. 27은 정식 출시 전. 홀수/짝수 규칙을 추측하지 않음 |
| PHP | 공식 minor별 달력 | 8.1 이하는 종료. 8.2·8.3은 보안 수정 지원, 8.4·8.5는 일반 지원. 8.2는 2026-12-31 종료 준비 경고 |
| Bun | 공표된 1.x 지원 정책 | 1.x는 지원 중. 종료일은 만들어 넣지 않음. 다른 major·canary·prerelease는 미확인 |

1차 자료: [Deno 팀 공지](https://deno.com/blog/cloudflare), [Deploy와 Classic 구분·종료일](https://docs.deno.com/deploy/), [deployctl 적용 대상](https://github.com/denoland/deployctl/blob/main/README.md), [Deno 릴리스·LTS 채널](https://docs.deno.com/runtime/fundamentals/stability_and_releases/), [Node 공식 schedule.json](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json), [PHP 지원 일정](https://www.php.net/supported-versions.php), [PHP 과거 종료 일정](https://www.php.net/eol.php), [Bun 보안 지원 정책](https://github.com/oven-sh/bun/blob/main/SECURITY.md).

Deno의 상대 기간을 정확한 종료일로 바꾸지 않는다. `supportEnds`는 월 단위, `datePrecision: month`, `dateBasis: announcement-relative`다. 해당 월이 지난 뒤에는 **미확인·공식 공지 재확인**으로 전환한다. 날짜 계산만으로 실제 종료를 확정하지 않는다. Runtime의 항목은 제품 전체 정책이며, 버전 숫자로 개별 LTS 채널·패치의 지원을 보증하지 않는다.

Node/PHP는 공표한 날짜까지 지원하는 달력으로 해석하고 다음 날 종료로 판정한다. Node 유지보수 시작일은 당일부터, PHP 일반 지원 종료일은 다음 날부터 보안 수정 지원이다. Classic은 공지된 셧다운 당일부터 종료로 표시한다. 모든 일자 비교는 한국 날짜다. 계열 종료까지 180일 이하면 종료 준비 경고를 추가한다. 미등록 계열·모호한 selector는 미확인이다.

## 무엇을 근거로 읽는가

[지원 정책 모듈](../analysis/runtime-lifecycle.js)은 네트워크 없이 다음 설정을 읽는다. 실행 단계는 설정의 용도이며 실제 실행 이력이 아니다.

- `.nvmrc`, `.node-version`, `.php-version`, `.deno-version`, `.bun-version`, `.tool-versions`: pin·selector를 구분한다. 형제 workspace의 pin을 물려주지 않는다.
- 공식 `node`, `php`, `denoland/deno`, `oven/bun` Docker 이미지: stage 구조로 빌드·서비스 실행 설정을 구분한다. ARG·custom image·digest의 실제 내용은 미확인이다. RC·beta를 정식 패치로 비교하지 않는다.
- GitHub Actions `actions/setup-node`, `denoland/setup-deno`, `oven-sh/setup-bun`: **해당 단계의** literal 버전만 읽는다. matrix·표현식·alias·version-file은 gap으로 남긴다. `denoland/deployctl`은 Classic 배포 설정이다.
- `deno.json/c`의 프로젝트 설정, `deploy` 객체와 직접적인 `deno deploy` task/script는 Runtime·새 Deploy 근거다. `deployctl deploy` 등은 Classic 근거다. [공식 Deno 설정](https://docs.deno.com/runtime/reference/deno_json/), [새 Deploy build 설정](https://docs.deno.com/deploy/reference/builds/)을 따른다.
- `jsr.json/c`, Deno의 `jsr:` import, npm의 `@jsr/` 의존성은 JSR 사용 근거다. JSR 단독 설정은 Runtime·Deploy 사용으로 바꾸지 않는다. Bun `packageManager`는 빌드 설정이다.

문서·주석·echo 안의 명령 언급은 배포 근거가 아니다. 임의 shell 해석기, 간접 script 호출, 원격 import graph 전체를 분석하는 기능은 아니다. 설정 root가 null·scalar이거나 중복 key·YAML alias가 있으면 실패 범위를 표시하고 분석을 계속한다. 배포 앱 이름·토큰·전체 command를 결과에 복사하지 않는다.

Composer `require.php`는 정확한 숫자여도 호환 조건이다. `config.platform.php`도 가상 플랫폼이며 실제 PHP pin을 대신할 수 없다. `engines` 역시 실행 증거가 아니다. 지원 중 표시는 최신 패치·CVE 안전성·실제 설치를 뜻하지 않는다.

## 결과·노이즈·해결 판정

선택적인 `securityContext.lifecycle`에 기준일, 정책 확인일·신선도, 제품/계열 범위, 상태, 종료 근거의 정밀도, 파일 위치와 공식 URL을 넣는다. [AuditResult 스키마](../schemas/audit-result.schema.json)는 이전 lifecycle 없는 v1 결과도 허용한다. CLI JSON·Markdown과 브라우저는 같은 모듈을 사용한다.

- `security.support-ending`: 종료 예고 또는 180일 내 종료 준비. `security.runtime-eol`: 공식 일정상 종료. `security.lifecycle-coverage`: 정책·시각·지원 상태의 미확인 범위.
- 같은 제품의 같은 유형은 상위 이슈 하나와 하위 근거로 묶는다. Runtime·Deploy·Classic·JSR의 검토 경계는 분리한다. Runtime을 닫아도 Deploy는 닫히지 않는다.
- 제품 전체 종료 공지는 패치 업데이트만으로 다시 열지 않는다. 계열·정책·상태·종료 근거가 바뀌면 재검토한다. 닫기는 수리 증명이 아니다.
- 정책 확인 후 30일 초과면 재확인 안내를 표시한다. 확정된 달력 비교는 보존하지만 오래된 정책·미확인 버전·근거 소실로 기존 위험이 사라지면 `resolved` 대신 `unverified`다. 종료 예정에서 종료로 바뀌어도 이전 예정 위험을 해결로 오해하지 않는다.
- `deno.lock` v3/v4/v5와 명시적 LTS selector는 후속 [Deno lock·LTS 확장](deno-lock-lts.md)에서 지원한다. 지원하지 않는 형식·연결·HTTP import는 모듈 버전 비교 미확인으로 남긴다. Runtime 지원 정책을 알아냈다는 이유로 이전 모듈 CVE를 해결 처리하지 않는다. JSR은 레지스트리 운영 상태만 확인한다.

## 리뷰에서 수정한 문제와 검증 근거

| 재현 | 기존 결과 | 수정 후 |
| --- | --- | --- |
| `.php-version` 8.4.26 제거 후 Composer `require.php: 8.4.26`만 유지 | 실제 pin 근거 없이 이전 PHP 권고를 `resolved` | 호환 조건·버전 gap, 이전 권고 `unverified` |
| `FROM node:24.22.0-rc.1` | 정식 24.22.0 pin으로 잘라 CVE 비교 | prerelease selector, 정식 패치 CVE·계열 지원을 확정하지 않음 |
| custom action의 `node-version: 20`과 실제 setup-node 26이 공존 | 파일 전체 정규식이 다른 단계 값을 수집 가능 | 실제 setup 단계의 26만 수집 |
| Deno 설정 또는 workflow root가 null·scalar | 새 입력 경로에서 예외 발생 가능 | 명시적 gap, 나머지 분석 유지 |

[날짜·제품·기준선 회귀 검사](../analysis/runtime-lifecycle.test.mjs), [CLI 회귀 검사](../bin/frontend-agent-audit.test.mjs), [실제 브라우저 검사](../scripts/verify-dashboard.mjs)에 재현을 남긴다. 브라우저는 합성 설정과 고정 시각으로 7개 제품 상태, 독립 닫기·내보내기, 오래된 정책, JSR 단독 사용, 미지원 lock을 확인한다. 320/390px에서 펼친 목록의 넘침과 화면을 검사하며 소스·서버·브라우저 응답 hash를 대조한다. Node 22/24/26 검사와 별도 Chromium job의 **해당 PR CI 결과**가 원격 검증 근거다.

이 문서를 추가한 PR #7의 로컬 실행에서는 전체 Node 테스트 180개, Chrome 156의 브라우저 시나리오 35개(페이지 오류 0개), Markdown 69개와 plugin/schema 동기화를 통과했다. 변경·계약·부정 입력·시각·데이터 손실·제품별 검토 경계를 재검토했고 남은 중간 이상 결함은 발견하지 못했다. 이는 독립된 사람의 승인이나 전체 보안 감사 완료를 뜻하지 않는다.

검증 성공·커밋·머지는 실제 프로젝트의 런타임 설치·호스팅 이전·운영 취약점 해결과 별개다. 운영 URL·실제 계정·물리 기기는 검사하지 않는다. 되돌리기는 이 변경 PR을 revert한다.

## 남은 우선순위

1. 실제 배포의 runtime/OS/digest/SBOM과 공급업체 별도 지원을 연결한다. 설정과 실행 결과를 분리한다.
2. [Deno lock graph·공식 fixture·명시적 LTS selector](deno-lock-lts.md)를 확장했다. 이후는 custom lock·구형 형식·local 연결과 실제 채널/패치 실행 증거를 추가한다.
3. 정책 갱신 담당·공식 자료 변경 검토를 정한다. 자동 수집·알림·외부 계정 쓰기는 이번 범위에 없다. Node/PHP/Bun/Deno 이외 언어의 지원 달력도 아직 대상이 아니다.
