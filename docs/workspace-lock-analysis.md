# Workspace 경계 분석과 lockfile 확장

2026-11-01 · 기준 `f550789` · 위험 수준 2: package별 누락 판정과 버전 근거의 의미를 변경한다.

## 확인한 문제와 수정

기존 분석은 처음 찾은 package.json과 전체 선택 파일을 함께 사용했다. 그래서 형제 앱의 테스트·E2E·메타데이터나 root의 정제 도구 흔적이 다른 앱의 누락을 가릴 수 있었다. 별개 앱의 App Router와 Pages Router를 하나의 혼합 Router로 추론하는 문제도 있었다. `null` 등 객체가 아닌 package.json은 분석을 중단시킬 수 있었다.

파일을 **가장 가까운 package.json 디렉터리**에 귀속시키고 package 내부의 상대 경로로 패턴을 검사한다. 결과는 원래 경로로 복원하며 같은 종류의 항목을 부모로 유지하되 package별 발견과 판단 근거를 자식으로 남긴다. 테스트·정제·SEO 근거를 root나 형제 package에서 암묵적으로 상속하지 않는다. 객체가 아닌 manifest는 높은 수준의 유효성 발견으로 남기고 분석을 계속한다.

이것은 package 경계 분석이다. package manager가 실제로 선언한 workspace membership, import graph, 공유 설정의 실행 경로, root 테스트 명령이 검증하는 하위 앱은 자동으로 증명하지 않는다. 중첩된 독립 프로젝트도 자기 manifest의 경계로 다룬다. manifest 없는 소스는 repository 경계로 남긴다. 여러 package가 있으면 project 요약은 root manifest와 root 소스만 사용하며 첫 번째 하위 앱을 전체 프로젝트의 프레임워크로 표시하지 않는다.

누락 발견은 package manifest에 연결한다. 실제 코드 발견은 원본 파일 경로를 유지한다. 경로가 긴 workspace에서도 중복 fingerprint가 생기지 않도록 검증한다. 하위 앱의 URL을 product journey와 연결하는 세부 정책은 별도 검증이 필요하며 파일 경로만으로 여러 앱의 동일 URL을 같은 사용자 여정으로 단정하지 않는다.

탐지기 revision과 catalog를 갱신했다. 이전 revision의 판정·닫기 상태가 재검토 대상으로 표시될 수 있으며, 비교 조건이 달라진 과거 항목을 해결로 단정하지 않는다.

## 이번에 확장한 입력

| 형식 | 지원 범위 | 남는 한계 |
| --- | --- | --- |
| npm package-lock / shrinkwrap v1 | 중첩 dependencies, scope 이름, 정확한 버전, dev 조상과 직접 의존성 근거 | 깊이 32 초과·잘못된 구조·비정확 버전은 미확인. 설치·배포 증명 아님 |
| npm v2/v3 | 기존 packages 항목의 정확한 버전과 dev flag | 전체 workspace graph·root 호이스팅이 각 하위 앱에 연결되는지는 별도 |
| Yarn Classic v1 | 명시적인 v1 헤더, 일반 version stanza, 같은 이름의 grouped selector, scope 이름과 동일 이름/버전 중복 제거 | phase는 unknown. Berry·alias/local/git selector·잘못된 stanza·충돌하는 selector는 coverage gap. 전체 Yarn parser/graph 구현 아님 |
| Composer lock | 기존 packages / packages-dev 유지 | PHP 실행 버전·SAPI·공급업체 패치 별도 |
| pnpm, Yarn Berry, Bun | 이번에는 미지원 표시 유지 | 실제 형식별 fixture와 parser/graph 계약을 확보한 다음 확장 |

Yarn 항목의 로컬 발생 위치는 이름·버전으로 구분한다. selector나 버전이 바뀐 항목의 파일 이동·동일성은 확정하지 않는다. 같은 경로와 같은 이름/버전은 하나로 모으고 실행 단계는 추정하지 않는다. resolved URL·인증정보는 출력하지 않는다. 중첩 workspace와 root shared lock의 연결이 확정되지 않으면 하위 선언의 미확인 범위를 유지한다.

새로 수집한 `locked-exact` 항목은 기존 오프라인 권고 비교와 명시적 OSV 조회에 연결된다. 단, lock 버전은 설치·배포나 악용 경로의 증거가 아니다. 기본 분석은 외부 조회·프로젝트 설치·package script 실행을 수행하지 않는다.

공식 형식 근거: [npm v1 dependencies/dev 설명](https://docs.npmjs.com/cli/v7/configuring-npm/package-lock-json/), [Yarn Classic lock](https://classic.yarnpkg.com/en/docs/yarn-lock).

## 검증과 남은 작업

- source·테스트·E2E·정제·SEO·React 버전·Router를 서로 다르게 둔 package fixture로 형제 간 근거 누출을 검사한다. 파일 순서를 뒤집어도 같은 정규화 결과가 나와야 한다.
- 중첩 package와 manifest 스칼라·배열, npm v1의 dev 조상·잘못된 구조, Yarn grouped/scoped/alias/conflict와 인증정보 출력 방지를 검사한다.
- 실제 CLI로 workspace와 두 lockfile을 함께 읽고 canonical JSON에 독립 발견이 남는지 확인한다.
- 대시보드의 package별 테스트 누락·정제 근거를 실제 Chromium CI에서 추가 확인한다. 원격 결과·화면·소스 해시는 PR/main의 browser artifact를 따른다.

문제가 생기면 먼저 가장 가까운 manifest 귀속과 해당 package 소스 목록, 다음으로 lockfile coverage.gaps·versionKind·phaseEvidence, 마지막으로 실제 설치·공유 설정 실행을 확인한다. 원래 설정이나 설치된 의존성을 수정하지 않았으며, 되돌릴 때는 이 PR을 revert한다.

다음 확장은 pnpm/Berry/Bun 형식과 공용 lock·workspace graph다. 실제 서비스 URL·배포 버전·SBOM 검증은 필요한 외부 자료가 확보되면 우선 진행한다.
