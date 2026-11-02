# Deno lock 해석과 명시적 LTS 채널

2026-11-02 · 기준 `4269e22` · 위험 수준 2: 외부 입력 parser, 공개 결과 스키마와 보안 기준선의 해결 판정에 영향을 준다. 제품 전체 종료 정책과 개별 채널 일정을 분리한다. CVE 스냅샷 확인일 2026-10-30과 지원 정책 확인일 2026-11-02는 유지한다.

2026-11-03 후속 [legacy v1·v2·custom lock·literal local 연결](deno-legacy-custom-local.md)을 추가했다. 아래 검증 수치는 PR #8 당시 기록이다.

## 범위와 공식 근거

| 입력 | 수집하는 근거 | 남기는 한계 |
| --- | --- | --- |
| Deno lock v3 | `packages.specifiers/npm/jsr`의 버전·연결, npm dependency map | npm optional 메타데이터를 완성하려면 외부 registry 조회가 필요하므로 graph 미완전 |
| Deno lock v4 | 평탄한 specifiers/npm/jsr, dependency array·alias·peer instance | v3과 같은 optional 메타데이터 공백 |
| Deno lock v5 | npm/JSR 좌표, 필수·optional·optional peer 연결 | 실제 설치·코드 도달성·패키지 내용의 무결성 검증 아님 |
| `workspace`와 `members` | 해당 폴더의 Deno imports/scopes, package.json과 lock에 함께 있는 선언 연결 | 실제 manifest가 없거나 선언이 어긋나면 gap. 형제 workspace의 선언·버전을 물려주지 않음 |
| 명시적 `lts` | setup-deno의 해당 단계, `.dvmrc`, `.deno-version`, `.tool-versions`의 Deno selector | 이동 채널 선택 의도. 실행된 바이너리·정확한 패치 버전의 증거 아님 |

공식 형식 근거는 고정된 Deno 소스의 [lockfile 읽기·workspace 구조](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/libs/lockfile/lib.rs), [v3→v4→v5 변환과 optional 정보 조회](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/libs/lockfile/transforms.rs), [설정의 lock 옵션](https://docs.deno.com/runtime/reference/deno_json/)이다. 실제 upstream fixture의 커밋·hash·라이선스는 [fixture 출처](../analysis/fixtures/deno-upstream/README.md)에 보존한다.

[Deno 채널 문서](https://docs.deno.com/runtime/fundamentals/stability_and_releases/)는 같은 `2.9.3`도 stable과 LTS 빌드가 될 수 있고, 숫자만으로 채널을 식별할 수 없다고 설명한다. 현재 LTS는 2.9 계열, 유지보수 종료일은 **2027-01-31**이다. [setup-deno 입력](https://github.com/denoland/setup-deno/blob/main/action.yml)은 `deno-version: lts` 및 version file을 지원한다. 분석기는 외부 파일 경로나 CI 표현식을 실행·치환하지 않는다. version-file 간접 참조는 아직 gap이고, 선택된 `.dvmrc` 등의 파일 내용은 독립적인 설정 근거로 읽는다.

## 제품 종료와 LTS 종료를 함께 보여주는 방식

`deno-version: lts`를 읽으면 Deno Runtime 제품 전체의 2027-10경 공식팀 개발 종료 예고와 **별도의 Deno LTS 항목**을 만든다. LTS 행은 `supportScope: release-line`, `releaseLine: 2.9`, `version: lts`다. 설치된 버전을 `2.9.x`로 채우지 않는다. 종료까지 180일 이내면 준비 경고를 표시한다. LTS 행을 검토 후 닫아도 제품 종료 이슈는 열린 채 남는다.

이동 selector는 검토된 기간 안에서만 계열과 일정을 연결한다. 2027-02-01 이후 `lts`가 어떤 계열을 선택할지는 이번 정책으로 알 수 없으므로 **미확인**이다. 여전히 2.9가 설치됐거나 LTS 전체가 끝났다고 단정하지 않는다. 숫자 버전만 있는 `.deno-version: 2.9.3`, 다른 Action의 `with`, 문서·주석은 LTS 근거가 아니다. 제품별 이전 상태 모델은 [런타임·서비스 지원 수명](runtime-service-lifecycle.md)을 따른다.

## 데이터 흐름과 해결 판정

[deno-lock.js](../analysis/deno-lock.js)는 이미 포함된 bounded parser로 중복 key·과도한 크기·깊이를 거절하고 strict JSON lock을 읽는다. [security-context.js](../analysis/security-context.js)가 graph·inventory·gap을 공통 결과에 합치고, [runtime-lifecycle.js](../analysis/runtime-lifecycle.js)가 LTS 정책을 계산한다. CLI와 브라우저가 같은 경로를 사용한다. 신규 npm 패키지 설치·프로젝트 코드 실행·네트워크 조회는 없다.

- npm pin은 기존 npm 권고 비교와 명시적 OSV 조회에 연결한다. JSR은 별도 `ecosystem: jsr`로 보존하며 npm 좌표로 보내지 않는다. JSR 권고 비교는 미지원 gap이다. JSR의 npm 의존성은 명시적 연결이 있으면 기존 npm 비교에 포함한다.
- 정확한 peer instance와 alias를 보존한다. 이름만 있는 dependency에 후보가 둘 이상이면 임의로 고르지 않는다. runtime/dev 양쪽 역할이면 둘 다 보존한다.
- graph의 `complete`는 지원하는 lock 연결 해석 범위다. 보안 점검 전체 완료가 아니다. `coverage.complete`는 여전히 false다. JSR graph가 완전해도 JSR 취약점 비교는 미확인이다.
- 원격 URL/redirect·별도 import map, 해석하지 못한 local 연결·override, custom tarball, 누락된 manifest·끊긴 연결·미지원 형식은 gap이다. URL의 토큰·호스트·전체 경로를 출력하지 않는다. 출처를 검증하지 못한 npm 좌표는 확정 pin 비교·외부 조회에서 제외한다.
- `lock:false`, stale import는 해당 lock을 활성 설정의 완전한 근거로 사용하지 않는다. custom lock·v1·v2 및 literal local 연결은 [후속 범위](deno-legacy-custom-local.md)를 따른다. prerelease package identity는 gap이다.
- `deno.lock`은 이제 선택 대상이므로 일괄 파일 제외 표시는 제거한다. 형식·연결이 지원되지 않으면 security coverage gap이 남으며, 이전 CVE가 사라진 것만으로 해결되지 않고 `unverified`를 유지한다. 성공한 파싱을 실제 배포의 안전 판정으로 바꾸지 않는다.

## 리뷰와 검증

구현 중 중간 이상으로 분류한 반례를 수정했다. 루트와 이름이 `root`인 member의 ID 충돌로 서로의 용도를 잘못 연결할 수 있던 경로는 별도 root ID로 분리했다. runtime/dev 선언이 겹치면 뒤의 선언으로 덮어쓰던 경로는 양쪽 역할을 보존한다. custom source·links·override로 pin 근거가 약해질 때 이전 권고가 해결로 사라지지 않는지도 검사한다. 개발용 Vite 등의 build 분류를 기존 graph와 맞추고, 구형/신형 section이 섞인 잘못된 lock을 미완전으로 표시하도록 보강했다.

[Deno lock 회귀 검사](../analysis/deno-lock.test.mjs)는 고정 upstream v3 JSR·v5 npm 68개 fixture, v4, alias·peer, 모호한 연결, root/member 경계, 잘못된 JSON·중복 key·conflict marker·경로·URL 비밀정보, 기존 CVE 기준선을 검증한다. [LTS 회귀 검사](../analysis/runtime-lifecycle.test.mjs)는 명시적 selector, 숫자만 있는 음성 입력, 종료일 경계·이동 채널의 다음 날과 stale 정책을 확인한다. [브라우저 검사](../scripts/verify-dashboard.mjs)는 transitive npm 권고, JSR 구분, 별도 LTS 닫기·내보내기, 320/390px 화면과 소스/서버/브라우저 응답 hash를 확인한다. 실제 운영 바이너리·계정·물리 기기는 검사하지 않는다.

로컬 전체 테스트 **197개**, Markdown **72개**, plugin/schema 동기화를 통과했다. 주요 UI 구현의 Chrome 156 브라우저 시나리오 **38개**(페이지 오류 0개)에서 소스·서버·브라우저 응답 hash를 대조했고 CLI 재검사 13개도 통과했다. 이후 실제 설정의 override·links·외부 import map 공백을 추가 재현해 보강했다. 이 최종 head의 브라우저·소스 무결성 결과는 해당 PR 원격 CI에서 확인한다. 반례 리뷰 후 남은 중간 이상 결함은 발견하지 못했다. 독립된 사람의 승인이나 운영 효과를 검증한 결과는 아니다.

전달 기준은 로컬 전체 검사, Node 22/24/26 및 Chromium 원격 CI, 반례 리뷰를 통과한 동일 head의 PR 머지다. 롤백은 해당 PR revert다. 실패 시 먼저 `securityContext.coverage.gaps`, 해당 `graphs`의 root/edge와 파일 선언, `lifecycle`의 기준일·채널·정책 신선도를 본다.

관찰 신호는 위 반례에서 잘못된 해결·workspace 혼동·가짜 실행 버전이 발생하지 않는 것이다. 이번 변경의 증거는 고정 입력의 회귀 결과이며 운영 위험 감소는 측정하지 않았다. 다음 확인 조건은 실제 배포의 버전·채널·SBOM 확보다. 운영 측정 담당자·기간은 아직 정해지지 않았고 자동 예약을 만들지 않았다.

다음 우선순위는 실제 실행 채널/패치 증거와 SBOM, 추가 local protocol·glob·중첩 workspace fixture, JSR 권고 조회 정책이다. 외부 조회는 전송 항목·지원 생태계를 먼저 확정하고 별도 명시적 실행으로 유지한다.
