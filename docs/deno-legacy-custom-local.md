# Deno legacy lock·custom 경로·local 연결

2026-11-03 · 기준 `2a4baf7` · 위험 수준 2: 파일 수집 범위·의존성 연결·보안 기준선의 해결 판정을 바꾼다. [이전 v3–v5·LTS 확장](deno-lock-lts.md)에 이어 적용한다. CVE 스냅샷과 지원 달력의 확인일을 새로 갱신한 것은 아니다.

2026-11-03 후속 [glob·protocol·중첩 멤버·외부 import map](deno-local-resolution.md)을 추가했다. 아래 지원·검증 수치는 PR #9 당시 기록이다.

## 지원 범위와 판단 근거

| 대상 | 이번 처리 | 확정하지 않는 것 |
| --- | --- | --- |
| v1, version 필드 없는 URL→SHA-256 map | 기록 수·형식 확인, `lockVersion: 1`, `remoteIntegrityCount` | URL에 포함된 숫자를 npm/JSR 버전으로 추측하지 않음. 원격 내용·체크섬 일치·취약점은 미검증 |
| v2 | `npm.specifiers`·`npm.packages`와 dependency map을 v3 내부 표현으로 변환, 정확한 npm 버전 비교 | workspace·optional 메타데이터가 부족한 legacy graph는 미완전, 실행 단계는 미확인 |
| custom lock | Deno 설정의 문자열 `lock` 및 `lock.path` 객체에서 명시한 파일 | CLI flag·환경변수·임의 파일 탐색·외부 파일 읽기를 추정하지 않음 |
| local `links`·이전 `patch` | 선택된 프로젝트 안의 literal 상대 디렉터리, Deno/npm manifest의 이름·선언과 lock의 `workspace.links/patches`를 대조 | 패키지 내용·수정 효과·실제 설치는 미검증. glob·file URL·중첩 local workspace와 간접 연결은 gap |

공식 근거: 고정 Deno 소스의 [v1→v2→v3 변환](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/libs/lockfile/transforms.rs), [legacy 읽기·local lock 구조](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/libs/lockfile/lib.rs), [설정의 lock·links](https://docs.deno.com/runtime/reference/deno_json/), [workspace의 root 전용 설정](https://docs.deno.com/runtime/fundamentals/workspaces/). 실제 v1·v2 테스트의 JSON 입력을 추출하고 [고정 커밋·hash·라이선스](../analysis/fixtures/deno-upstream/README.md)를 보존했다.

## 파일 수집과 소유 위치

CLI와 브라우저는 먼저 기존 허용 파일을 크기·개수·총량 제한 안에서 읽는다. 읽은 Deno 설정에서 custom 경로를 찾은 뒤, **이미 선택·열거된 파일 중 그 경로와 일치하는 파일만** 추가한다. 확장자가 없거나 `.snapshot`이어도 이 명시적 대상이면 읽을 수 있다. 모든 `.lock`이나 임의 파일 형식을 일괄 허용하는 방식은 수집 범위가 불필요하게 넓어져 사용하지 않았다.

경로는 설정 파일이 있는 폴더 기준이다. 예를 들어 `app/deno.json`의 `lock: ../locks/runtime.snapshot`은 해당 파일을 읽지만 graph의 root는 `app/deno.json`이다. 저장 폴더인 `locks/`의 다른 manifest를 root로 빌려 쓰지 않는다. 같은 lock에 소유자가 여럿이면 모호함을 남기고 root를 연결하지 않는다.

절대 경로·URL·역슬래시·인코딩된 경로·선택 루트 밖으로 나가는 `..`는 거절한다. 기존 환경 파일·생성 파일·제외 디렉터리·크기 제한을 유지하며, 알려진 인증정보 디렉터리·키 파일·다른 패키지 매니저의 manifest/lock도 custom 대상으로 허용하지 않는다. CLI는 symlink를 수집하지 않는다. 추가 읽기는 기존 수집 한도의 남은 예산을 사용하고, 누락·읽기 실패·한도 초과는 미검증으로 남긴다. 경로 해석은 네트워크·프로젝트 코드·설치 스크립트를 실행하지 않는다.

custom 설정이 기본 `deno.lock`을 교체했다면 남아 있는 기본 파일의 오래된 버전을 사용 중인 버전으로 중복 경고하지 않는다. 새 파일이 없으면 `deno-custom-lock-unavailable`이고 이전 위험은 `unverified`다. 정상적인 대체 lock의 호환 가능한 근거가 확보된 경우에만 기준선의 해결 판정이 가능하다. 파일 수집 정책 digest와 보안 탐지기 revision을 갱신했으므로 이전 정책의 기준선을 현재와 동일한 근거로 취급하지 않는다.

## local 연결과 미검증 경계

`links: [../local]`은 선택 루트 안의 실제 `deno.json/c` 또는 `package.json`과 연결한다. 이름이 중복되거나 manifest가 없으면 후보를 임의로 고르지 않는다. local node는 파일 위치·선언 이름과 함께 별도로 보존하고 레지스트리 패키지의 확정 버전 inventory로 만들지 않는다. local을 거쳐 연결된 **고정 npm 의존성**은 기존 권고 비교·명시적 OSV 조회에 연결한다. JSR은 계속 별도 생태계이며 npm으로 바꾸어 조회하지 않는다.

실제 local 선언과 lock의 이름·의존성 목록을 대조한다. 선언의 범위가 바뀌거나 연결 정보가 누락·변경됐으면 gap이다. 원래 registry node가 local로 대체된 경우 그 버전을 local 내용의 보안 근거로 사용하지 않는다. 실행·개발·peer 용도를 분리하고 전이 연결에서 local 개발 의존성을 서비스 실행 근거로 승격하지 않는다.

graph의 `complete`는 해석한 연결에 대한 상태다. local graph가 완전해도 `deno-local-package-content-unverified`를 남기고 `coverage.complete`는 false다. 닫기·미검증·정적 해결 판정은 실제 배포의 취약점 해결과 별개다. 사용자 이름·토큰이 포함될 수 있는 원격 URL 및 거절된 경로의 원문은 결과에 복사하지 않는다. v1은 URL 원문 대신 기록 수만 보여준다.

## 재현한 중간 이상 문제와 수정

| 확인된 문제 | 영향 | 수정·검증 |
| --- | --- | --- |
| imports 값이 객체인 잘못된 설정을 무시한 뒤 빈 lock으로 바꾸면 `complete: true`, 이전 권고 `resolved` | 버전 근거가 사라진 것을 해결로 표시 | 잘못된 imports·scopes·패키지 선언을 명시적 gap으로 만들고 이전 권고 `unverified` 회귀 검사 |
| custom lock 전환 후 기본 lock의 오래된 pin도 사용 중인 것처럼 비교 | 중복·비활성 위험 경고 | 설정의 명시적 선택을 적용. 누락된 대체 파일로 이전 위험을 지우지 않는 음성 검사 |

두 경우 모두 설정과 lock의 근거를 확인하는 경로의 결함이며, 운영 서비스에서 실제 악용을 관찰한 결과는 아니다. 반례는 [legacy/custom/local 검사](../analysis/deno-legacy-local.test.mjs)에 남긴다. [CLI 검사](../bin/frontend-agent-audit.test.mjs)는 확장자 없는 파일·local 전이 권고·프로젝트 밖 경로·symlink 거절을 확인한다. [브라우저 검사](../scripts/verify-dashboard.mjs)는 custom 파일 수집·local 소유 위치·v1/v2 표시·URL 비밀정보 비노출·320/390px과 소스/서버/응답 hash를 확인한다.

로컬 최종 소스에서 전체 테스트 **210개**, Chrome 156 브라우저 **41개 시나리오**(페이지 오류 0개), Markdown **73개**, plugin/schema 동기화를 통과했다. 소스·서버·브라우저 응답 hash를 대조하고 320/390px 화면도 확인했다. 반례 리뷰 후 남은 중간 이상 결함은 발견하지 못했다. 독립된 사람의 승인이나 운영 효과를 검증한 결과는 아니다.

전달 기준은 전체 회귀·문서·plugin/schema 동기화, 반례 리뷰, 해당 head의 Node 22/24/26·Chromium CI 통과 후 PR 머지다. 되돌리기는 해당 PR revert다. 실패 시 첫 확인 위치는 `coverage.gaps`, graph의 `lockfile/roots/local node`, 설정의 상대 경로와 수집 제외·예산이다.

관찰 신호는 고정 반례에서 잘못된 해결·소유 위치 혼동·루트 밖 읽기가 발생하지 않는 것이다. 실제 운영 채널·SBOM·패키지 내용·취약한 호출 경로는 아직 확인하지 않았다. 운영 효과 측정은 실제 배포 자료 확보 후 가능하며 담당자·기간은 미정이고 자동 예약도 만들지 않았다.

local glob·file/workspace protocol·중첩 멤버·별도 import map은 [후속 확장](deno-local-resolution.md)을 따른다. 남은 우선순위는 JSR 권고와 실제 실행 채널/SBOM 근거다. 지원 범위 밖의 입력은 미검증을 유지한다.
