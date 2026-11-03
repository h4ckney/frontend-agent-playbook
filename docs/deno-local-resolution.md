# Deno local glob·protocol·workspace·외부 import map

2026-11-03 · 기준 `3c5dd59` · 위험 수준 2: 선택 파일·소유 위치·보안 기준선의 판정 계약을 확장한다. [legacy/custom/local 분석](deno-legacy-custom-local.md)을 이어 적용한다. CVE 스냅샷(2026-10-30)과 지원 정책(2026-11-02)의 확인일은 유지한다.

## 목적과 지원 범위

선언된 local 연결을 놓치면 전이 npm 권고의 소비 workspace를 설명하기 어렵다. 반대로 형제 패키지나 다른 설정의 pin을 빌리면 잘못된 해결·노이즈가 발생한다. 이번 변경은 선택한 파일 안에서 명시적인 선언 연결을 확장하고, 해석하지 못한 근거는 `coverage.gaps`에 남긴다.

| 입력 | 지원하는 연결 | 미검증 경계 |
| --- | --- | --- |
| `links`·이전 `patch`, workspace 경로 | literal 상대 경로, `*`, `?`, 전체 segment `**`, `!` 제외. 겹친 동일 경로는 한 번 연결 | brace·문자 class·extglob·절대/file URL·선택 루트 밖 경로. 일치하는 선택 manifest가 없으면 gap |
| package.json `file:./lib`, `file:../lib` | 선언 파일 기준의 선택된 local npm manifest. 별칭·순환·같은 이름의 서로 다른 버전별 대상 보존 | 원격/절대 file URL·archive·빠진 manifest·모호한 lock 메타데이터 |
| `workspace:*`, `workspace:^`, `workspace:~` | 해당 workspace family가 선언한 이름의 멤버 | 다른 family·미선언 sibling·중복 이름·그 외 selector. 일반 registry 범위와 local 버전의 복잡한 semver 호환성은 gap |
| 중첩 멤버 경로 | 한 root의 `workspace: ["foo", "foo/bar"]`, glob으로 선택한 멤버. 별도로 link한 workspace root의 명시적 멤버도 확장 | 멤버가 다시 `workspace`를 선언하는 중첩 root는 Deno 미지원 설정으로 gap. member lock·links·importMap·scopes도 root 전용 설정으로 진단 |
| `importMap: "maps/imports.map"` | 명시적 선택 파일의 imports·scopes에서 npm/JSR 선언과 상대 파일·prefix 대상. 상대 값은 **map 파일 위치** 기준 | 원격 map·재귀 map/config chaining·inline/external 충돌·손상/누락 map. root 외부 map과 member imports 조합도 미지원 설정 |

local 패키지를 registry의 확정 버전으로 바꾸지 않는다. 그 패키지를 거쳐 도달하는 **고정 npm pin**만 기존 권고·별도 OSV 조회에 연결한다. local의 dev 의존성이 소비자의 runtime 전이 의존성으로 승격되지 않으며, 멤버 자체 root의 dev 용도는 보존한다. JSR은 npm과 분리하고 Deploy 사용으로 해석하지 않는다.

## 공식 근거와 재현 자료

- [Deno workspace 문서](https://docs.deno.com/runtime/fundamentals/workspaces/): root 전용 설정, 중첩 workspace 제한, workspace protocol.
- [Deno 설정 문서](https://docs.deno.com/runtime/reference/deno_json/): links glob·제외와 importMap. Deno 자체가 처리할 수 있는 file URL 전체를 이 분석기의 선택 루트 밖 파일 읽기 권한으로 취급하지 않는다.
- 고정 commit `e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd`의 [file dependency manifest](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/npm/file_specifier/package-a/package.json), [중첩 멤버 경로](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/run/workspaces/nested_member/deno.json), [linked workspace](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/workspaces/patch/workspace/deno.json), [버전별 local lock key](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/npm/link_npm_package_deep/expected_lockfile.out).
- [공식 외부 map fixture](../analysis/fixtures/deno-upstream/external-import-map.json)의 원본·SHA-256·MIT 라이선스는 [fixture 출처](../analysis/fixtures/deno-upstream/README.md)에 보존한다. 이 파일만 upstream bytes를 복사했으며 나머지 조합 반례는 [synthetic 회귀 검사](../analysis/deno-resolution.test.mjs)다. Deno 설치나 upstream 프로젝트 실행 결과로 표현하지 않는다.

## 구조와 파일 경계

[deno-resolution.js](../analysis/deno-resolution.js)가 선택 파일 index, 안전한 상대 경로, glob, workspace 소속, 외부 map 발견을 공유한다. [deno-lock.js](../analysis/deno-lock.js)는 lock의 선언과 실제 manifest를 대조해 root·local node·edge를 만든다. [security-context.js](../analysis/security-context.js)는 누락/손상 근거를 gap으로 합치고 [runtime-lifecycle.js](../analysis/runtime-lifecycle.js)는 외부 map의 JSR 사용 근거만 별도로 읽는다. CLI와 대시보드는 같은 모듈을 사용한다.

custom lock과 외부 map은 기존 수집 후 설정이 명시한 경로만 두 번째로 읽는다. `.map` 등 일반 허용 확장자가 아니어도 명시적 대상은 기존 파일 수·크기·총량의 남은 예산을 사용한다. symlink(CLI), 환경/인증 파일·키·제외/생성 디렉터리·다른 manager의 manifest/lock은 추가 대상으로 읽지 않는다. 경로는 선택 루트 안에서만 정규화하며 URL·인코딩·역슬래시를 거절한다. 프로젝트 코드·설치 스크립트·네트워크 조회는 실행하지 않는다.

glob은 패턴 최대 4,000개·각 1,000자와 matcher 작업 100,000회 제한이 있다. manifest가 선택된 디렉터리만 대상으로 검사하고, 제외는 긍정 패턴의 합집합 뒤에 적용한다. 예산 초과·미일치·미지원 문법은 gap이다. 다른 소유자의 lock pin이나 이름이 같은 패키지를 fallback으로 빌려 완전하다고 표시하지 않는다.

결과 schema에 선택적 `graph.importMaps`, `graph.localMappings`를 추가하고 화면·Markdown에 출처와 선택 파일 유무를 표시했다. `graph.complete`는 선언 연결 해석 상태다. local 내용·모듈 내용은 별도 gap이며 설치·안전성을 뜻하지 않는다. import map scopes는 선언 목록으로 읽는다. 실제 각 source의 import 선택, longest-prefix 및 scope 적용, AST 도달성이나 파일 내용 무결성을 증명하지 않는다. 로컬 파일이 존재해도 실제 사용·빌드 성공으로 해석하지 않는다.

## 발견한 문제와 수정

기존 main `3c5dd59`와 현재 소스에 같은 반례를 입력했다. `app/deno.json`의 정상 npm import·취약한 lock을 기준선으로 만든 뒤 lock을 제거하고 `imports.next`를 객체로 손상시키면, 기존 버전은 gap 없이 이전 권고를 `resolved`로 표시했다. 현재 버전은 `malformed-deno-import-map`을 남기고 **`unverified`를 유지한다**. lock이 있을 때만 하던 import map 검증을 발견 단계에서도 수행하도록 수정했다. 이는 중간급 보안 판정 무결성 오류이며 운영 악용을 관찰한 결과는 아니다.

구현 리뷰에서는 선택 루트의 map 기준 경로가 빈 문자열일 때 config 폴더로 되돌아가는 오류, lock에 빠진 member의 root 전용 설정을 놓치는 경우, file 대상이 같은 이름의 다른 패키지와 섞이는 경우를 수정하고 반례로 고정했다. 이 항목들은 이번 구현 과정에서 잡은 결함이며 이전 출시 버전의 결함으로 주장하지 않는다. 누락·손상 map으로 이전 권고를 해결하지 않는 검사도 포함한다.

## 검증·전달·후속

최종 로컬 소스에서 전체 **231개 테스트**, Chrome 156 **44개 시나리오**(페이지 오류 0개)를 통과했다. 320/390px에서 glob·protocol·외부 map의 새 표시와 overflow를 확인했고, 소스·서버·브라우저 응답 hash를 대조했다. 기존 닫기·baseline·내보내기·권고 검사를 포함한다. 이는 이번 대시보드 시나리오 검증이며 전체 CSS/z-index·모든 운영 화면·실기기 검증은 아니다. 문서·schema·plugin 동기화도 전달 전에 검사한다.

리뷰는 소유 위치, fallback, malformed/missing 입력, budget, false resolution, 문서의 지원 주장과 schema/UI 일치를 반례로 점검한다. 독립된 사람의 승인으로 표현하지 않는다. PR의 동일 head에서 Node 22/24/26·Chromium 네 검사가 성공한 뒤 머지하고 main CI도 확인한다. 실제 전달 상태는 PR/CI 기록을 따른다. 되돌리기는 해당 PR revert다.

문제가 생기면 먼저 `coverage.gaps`, graph의 `roots/importMaps/localMappings`, 선언 manifest와 수집 제외·예산을 확인한다. 관찰 기준은 반례에서 오해결·소유 위치 혼동·루트 밖 읽기가 발생하지 않는 것이다. 자동 운영 감시를 예약하지 않았다.

남은 우선순위는 (1) 실제 설치/SBOM·배포 채널 근거와 대조, (2) JSR 권고 및 정책 갱신 체계, (3) 실제 필요 사례가 확보된 추가 protocol·glob 문법과 source별 import 해석이다. 실제 런타임 설치·실행·배포·보안 개선 효과는 **미확인**이며 담당자·측정 기간은 정해지지 않았다.
