# 미지원 lock 형식·프로토콜 확장 우선순위

2026-11-01 · 기준 main `45ee848` · 위험 수준 2. 보안 버전의 동일성과 미확인·해결 판정에 영향을 준다. 대상 프로젝트 설치·스크립트 실행·원격 소스 다운로드 없이 분석한다.

## 우선순위와 이번 결과

| 우선순위 | 대상·선정 이유 | 이번 결과와 남는 경계 |
| --- | --- | --- |
| P0 | Bun 바이너리 제외 시 기존 보안 발견의 잘못된 해결 | 별도 binary-lockfile 사유와 부분 분석을 적용. 이전 발견은 unverified 유지. 직접 바이너리 해독 지원은 아님 |
| P1 | pnpm boot/project 다중 문서: 한쪽만 읽으면 의존성이 빠짐 | 두 문서를 독립 graph/inventory로 읽고 boot 패키지는 build로 보존. 같은 버전도 발생 위치를 분리. boot 항목은 앱 선언을 충족하지 않음 |
| P1 | Yarn patch: 버전은 있어도 원본 좌표가 누락될 수 있음 | npm 원본이 정확한 locator만 해석. 서로 다른 patch는 별도 설치 근거로 남기며 원본 버전 권고를 유지. patch 효과는 미검증 |
| P2 | pnpm 5.0–5.4의 기존 프로젝트 | specifiers, slash key, scoped 이름·alias·underscore peer suffix와 단일/공유 importer 지원. 미래·비지원 형식은 gap |
| P2 | pnpm registry revision·patch metadata | 원본 버전과 수정 여부·revision 번호 보존. 수정본이 취약점을 해결했다는 추론을 하지 않음 |
| P2 | Yarn portal/file 디렉터리 | 명시적으로 workspace 부모에 bound된 상대 경로와 선택된 manifest만 연결. 로컬 모듈을 npm 좌표로 조회하지 않음. 원래 registry 출처는 gap, file 복사본과 현재 소스의 동일성도 gap |
| P3 | Yarn virtual의 실제 peer instance | npm 원본 좌표는 제한된 wrapper 깊이에서 보존하되 peer binding은 gap. lock에 없는 실행 중 virtual tree를 재구성하지 않음 |
| P3 | Bun lockb 직접 해독 | 별도 변환·버전별 binary fixture와 bounded decoder 확보 후 진행. 지금은 명확한 부분 분석과 [공식 변환 안내](https://bun.com/docs/pm/lockfile)를 제공 |
| P3 | git/HTTP tarball·로컬 archive·exec·JSR | 내용 digest·출처·생태계와 버전 근거가 필요. 이름과 manifest.version만으로 npm 설치 버전을 만들지 않음. archive 해제·exec 실행은 하지 않음 |

완료 기준은 알려진 원본 버전이 누락되지 않고, 불명확한 버전·프로토콜이 안전이나 해결로 바뀌지 않으며, 동일 권고의 부모와 설치 위치별 자식 구조를 유지하는 것이다. 미지원 형식을 전부 해석한다고 주장하지 않는다.

## 구현 경계

pnpm은 bounded multi-document API로 읽는다. 지원하는 두 문서 배치는 첫 boot 문서와 마지막 project 문서이며 양쪽 lockfileVersion이 일치해야 한다. 문서를 합쳐 importer나 packages를 덮어쓰지 않는다. boot의 configDependencies/packageManagerDependencies와 하위 패키지는 빌드 도구 근거다. boot만 있거나 문서 순서·개수·version이 맞지 않으면 gap을 남긴다. 별칭 YAML 금지·깊이 48·파일/graph 예산은 유지한다.

Yarn patch는 source locator를 제한된 깊이에서 해석해 실제 npm 이름과 정확한 버전을 확인한다. 항목의 version 필드 하나만으로 git/file/unknown origin을 npm으로 취급하지 않는다. patch/virtual별 식별자는 locator의 메타데이터 hash로 분리하며 원래 patch 경로나 인증 URL은 출력하지 않는다. 이 hash는 보안 서명이나 tarball 무결성 증명이 아니다.

portal/file은 부모 workspace locator의 명시적인 binding에서 상대 경로를 계산한다. 선택된 lock root 밖으로 나가거나 부모·대상 manifest가 없으면 연결하지 않는다. local 노드는 workspace 설치 root로 추가하지 않으며, 소비 앱으로 local package의 dev 의존성을 전파하지 않는다. 로컬 모듈의 이름·version이 npm 패키지와 같아도 원래 registry 출처를 증명하지 못하므로 gap을 유지한다. 기존 registry 취약점을 같은 버전의 로컬 모듈로 교체한 것을 해결로 처리하지 않는다. file은 복사된 내용이 현재 소스와 같다고 증명할 수 없으므로 추가 gap이다. link는 package가 없는 폴더도 가리킬 수 있어 이번 package graph 해석 대상에 포함하지 않는다.

`graphs[].document`, root의 선택적 build phase, local node kind, inventory/node의 modifications·registryRevision과 inventory.lockContext를 선택적으로 확장했다. 기존 AuditResult v1은 유효하며 schema와 브라우저 생성본을 함께 갱신한다. catalog는 6, 보안 detector revision은 2026-11-01.2다. 과거 의미의 닫기·baseline 판정을 그대로 재사용하지 않는다.

OSV는 계속 명시적 실행이며 원본 npm 좌표만 조회한다. 변경된 패키지의 결과에는 modifications/revision과 실제 수정 효과 미검증을 로컬로 남긴다. boot의 build 근거가 앱의 missing lock을 가리지 않도록 선언 연결에서 제외한다. portal/file과 workspace는 로컬 연결로 보존하고 npm 패키지로 만들어 전송하지 않는다. 프로토콜 selector의 내부 경로·인증 URL은 inventory·프로젝트 버전 요약·graph에서 redacted로 표시하며, 실제 입력은 내부 비교에만 사용한다.

## 리뷰에서 수정한 중간 이상 문제

**높음: 지원하지 않는 바이너리를 일반 파일처럼 무시하면 기존 취약점이 해결로 표시될 수 있었다.** 이전 main의 analyzer/contract를 격리 VM에 읽어 동일한 합성 입력으로 대조했다. manifest가 빈 상태에서 lock의 정확한 Next 버전 근거를 만든 뒤, npm lock을 제외하고 Bun binary를 선택한 상황이다. 이전 버전은 unsupported-type을 부분 분석 사유로 보지 않았다. 버전 근거가 사라졌는데 security 발견이 resolved로 바뀌었다. 현재는 파일 선택·CLI·canonical scope 모두 binary-lockfile을 부분 분석으로 처리한다.

| 같은 재현의 결과 | 이전 main | 현재 |
| --- | --- | --- |
| 부분 분석 | false | true |
| 이전 RSC 발견 resolved | 포함됨 | 포함되지 않음 |
| 이전 RSC 발견 unverified | 없음 | 포함됨 |

**높음: 잘못된 manifest의 dependency map/selector가 무시될 수 있었다.** dependencies가 배열·null이거나 개별 버전이 숫자·객체이면 버전 근거가 사라지는데도 공백으로 처리하지 않는 경로를 재현했다. 잘못된 map과 비문자열 selector는 별도 gap으로 남겨 이전 보안 발견을 unverified로 유지한다. 같은 버전의 로컬 모듈로 교체한 경우도 registry 원본을 증명하지 못하면 해결로 처리하지 않는다.

**중간: source selector가 내보내는 버전 요약에 그대로 남을 수 있었다.** 인증 URL을 포함한 합성 patch selector로 재현했다. inventory뿐 아니라 project.frameworkVersion도 경로·인증정보를 출력할 수 있었다. 실제 비교에는 원래 selector를 사용하고 출력 근거는 일관되게 가린다. 알려진 npm 이름·정확한 버전은 보존하며, 해석하지 못한 source를 정확한 registry 버전으로 승격하지 않는다.

근거는 [프로토콜 회귀 검사](../analysis/lock-protocols.test.mjs), [실제 CLI·binary 기준선 검사](../bin/frontend-agent-audit.test.mjs), [브라우저 검증 시나리오](../scripts/verify-dashboard.mjs)에 있다. 합성 취약 버전은 설치하거나 실행하지 않았다. 실제 사용자 프로젝트가 해당 취약점에 노출됐다는 증거는 아니다.

## 검증·복구·다음 작업

Node 검사는 두 문서의 같은 패키지·서로 다른 단계, boot-only 선언 누락, 문서 순서·version·alias·깊이 실패, legacy specifier, patch origin·컨텍스트·경로 노출, registry revision, local binding·경로 이탈·file 복사본, binary 선택과 baseline unverified를 검증한다. CLI는 임시 파일을 직접 읽는다. browser harness는 pnpm 5.4, 두 문서의 독립 자식, patch 표시·selector 비노출·320/390px, Bun binary 부분 분석을 추가 검사한다.

PR/main CI에서 Node 22/24/26과 Chromium을 확인하며 실제 소스/서버/브라우저 응답 hash와 화면을 artifact로 남긴다. 실행별 통과 개수와 상태는 해당 CI 로그를 따른다. 로컬 Node 25.2.1 결과는 지원 계열 CI 검증과 구분한다. 이 기능은 실제 설치·배포·원격 tarball·코드 실행 경로를 검증하지 않는다.

오판은 coverage.gaps와 scope.partialReasons, graph.document/해당 edge, inventory의 lockContext·modifications·phaseEvidence 순서로 확인한다. 문제가 생기면 이 PR을 revert해 parser·schema·출력·binary 제외 판정을 함께 되돌린다. 원본 프로젝트의 manifest·lock·설치 파일은 수정하지 않는다.

다음은 실제 사용 프로젝트의 빈도와 fixture를 기준으로 P3 중 하나를 선택한다. Bun binary는 같은 버전의 공식 변환 결과와 대조할 수 있어야 하며, remote artifact는 digest와 출처 검증 없이 범위를 넓히지 않는다. peer binding에는 설치된 PnP/virtual tree 또는 SBOM이 필요하다. 문서화는 예약 실행이나 배포 완료를 의미하지 않는다.

공식 근거: [pnpm 다중 문서와 scanner 지침](https://pnpm.io/lockfile), [pnpm 5.2 명세](https://github.com/pnpm/spec/blob/master/lockfile/5.2.md), [pnpm v7.0.0의 5.4 lock](https://github.com/pnpm/pnpm/blob/v7.0.0/pnpm-lock.yaml), [Yarn patch](https://yarnpkg.com/protocol/patch), [Yarn locator/range 구현](https://github.com/yarnpkg/berry/blob/master/packages/yarnpkg-core/sources/structUtils.ts), [Yarn portal](https://yarnpkg.com/protocol/portal), [Yarn file](https://yarnpkg.com/protocol/file), [virtual locator의 비영속성](https://github.com/yarnpkg/berry/blob/master/packages/yarnpkg-core/sources/VirtualResolver.ts).
