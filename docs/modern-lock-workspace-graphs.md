# 공유 lockfile과 workspace 의존성 그래프

2026-11-01 · 기준 main `64d9f86` · 위험 수준 2. 버전 근거와 workspace 연결, 검토 재사용의 의미를 변경한다. 배포·설치·실제 호출 경로를 증명하는 기능은 아니다.

## 지원 범위

| 입력 | 이번 지원 | 미확인으로 남는 범위 |
| --- | --- | --- |
| pnpm lock v6 / v9 | importers의 명시적 specifier/version, v6 packages, v9 packages/snapshots, scoped 이름, peer suffix별 설치 항목, 상대 link, 빈 프로젝트 | 다른 lock version, 다중 YAML 문서, git/file/patch 등 비표준 package ID, 누락 snapshot/edge, 별칭 YAML |
| Yarn Berry lock metadata 4–10 | npm resolution의 정확한 버전, grouped descriptor, npm alias의 실제 이름, workspace resolution과 manifest의 dev/prod 역할 | patch/git/portal/virtual 등 비지원 resolution, concrete instance가 없는 peer range, 미래 metadata version |
| Bun 텍스트 lock v1 | JSONC 주석·trailing comma, workspaces, package tuple, scoped/nested key, workspace link | 바이너리 bun.lockb, 다른 text version, git/file/tarball 등 비지원 resolution |
| npm lock v2/v3 | packages의 로컬 경로와 명시적 link, 가까운 node_modules부터 찾는 호이스팅·중첩 버전 | 설치 트리와 배포 결과, selector 범위 호환성 계산 |
| npm v1 / Yarn Classic / Composer | 이전 버전 수집 지원 유지 | 이번 새 workspace graph 대상에는 포함하지 않음 |

lockfile이 명시한 로컬 package와 선택한 package.json을 연결한다. 폴더 이름이나 같은 패키지명만으로 workspace membership을 추측하지 않는다. package.json 없이 lock만 읽으면 버전 일치는 남길 수 있지만 workspace의 역할은 확인하지 못한다. 선언과 lock의 specifier가 다르거나 연결이 없으면 coverage gap을 유지한다. 범위를 풀어 새 버전을 선택하거나 registry에 문의하지 않는다.

workspace A가 공유 라이브러리 B를 소비하면 B의 runtime/optional 경로를 A까지 추적한다. B의 dev 의존성은 A로 전파하지 않는다. 각 workspace 자체의 dev 경로는 별도로 추적한다. 명시적인 peerDependencies edge는 단계가 unknown이며 concrete instance가 없으면 gap이다. pnpm의 peer suffix는 설치 항목의 식별자로 보존하고 snapshots의 명시된 연결을 따른다. optional은 설치 가능성이 있는 경로로 포함하며 현재 OS에 설치됐다는 뜻이 아니다.

같은 설치 항목이 여러 workspace에서 다른 단계로 쓰이면 최상위 phase는 unknown으로 두고 각 사용 근거를 보존한다. development 경로의 알려진 번들러·컴파일러는 build로 표시하지만 그 도구의 모든 하위 모듈을 build라고 단정하지 않는다. 미연결된 정확한 버전도 권고 비교에서 제거하지 않는다.

## 결과 계약과 낮은 노이즈

`securityContext.graphs`는 lockfile, format, complete, nodes, edges, roots를 담는다. 노드 ID는 해당 lock 안의 로컬 식별자다. edge는 from/to, dependency 이름, runtime/optional/development/peer scope를 담는다. `complete`는 지원 문법에서 그래프를 읽으며 발견한 공백이 없다는 뜻이며 프로젝트 전체 분석·설치·안전 판정이 아니다. 전체 보안 coverage.complete는 계속 false다.

각 lock inventory의 `workspaceUsage`는 manifest, phase, direct와 직접 연결의 dependency 이름을 담는다. 별칭 이름과 실제 npm 좌표를 구분한다. 이 필드와 graphs는 선택 필드이므로 기존 AuditResult v1 입력은 유효하다. 공개 JSON schema와 브라우저용 생성본을 함께 갱신했다.

같은 권고는 부모 하나, 서로 다른 설치 위치·peer context는 독립 자식으로 남긴다. workspace마다 같은 모듈의 자식을 복제하지 않는다. UI는 모듈 30개와 모듈별 workspace 사용 근거 10개까지 보여 주며 전체 연결은 JSON 보고서에 보존한다. 요약에서 생략한 workspace가 바뀌어도 검토 메타데이터 hash가 바뀌므로 이전 닫기 상태를 그대로 재사용하지 않는다. catalog 5 / security detector revision 2026-11-01.1로 이전 의미의 판정을 구분한다.

OSV 조회는 계속 명시적 실행이다. 실제 패키지명·정확한 버전·생태계만 전송하며 workspace 경로·phase·소스는 로컬 보고서에 남긴다. 명시적인 직접 graph edge가 있는 선언은 covered-by-lock, 로컬 workspace 연결은 workspace-link로 따로 보존한다. workspace 별칭을 npm registry 패키지로 만들어 조회하지 않는다. legacy lock의 같은 디렉터리 근거는 이전 동작을 유지한다.

## 입력 방어와 리뷰에서 수정한 문제

- 정규식으로 YAML 구조 전체를 추정하지 않고 고정한 js-yaml 5.5.0의 FAILSAFE schema를 사용한다. parser와 라이선스는 [vendor 기록](../analysis/vendor/NOTICE.md)에 있다. 외부 설치와 CDN 없이 브라우저와 CLI에서 같은 bytes를 사용한다.
- 검토 중 구버전 js-yaml의 공개 서비스 거부 권고를 확인해 채택하지 않았다. YAML alias를 금지하고 깊이 48, parser 입력 500 KiB, 노드 20,000, edge 40,000, 탐색 작업 100,000으로 제한한다. 상위 파일 선택 제한은 더 작은 500,000 bytes다. 제한을 넘기면 gap을 남긴다.
- npm JSON의 중복 키가 취약 버전을 덮어써 해결처럼 보일 수 있어 중복 키도 거부한다. Bun JSONC는 주석과 trailing comma를 문자열 밖에서만 처리하고 JSON으로도 검증한다. 코드·태그·프로젝트 script는 실행하지 않는다.
- npm 중첩 버전과 Bun의 scoped parent/child 키를 가까운 연결부터 찾는다. graph가 끊겨도 같은 이름의 다른 workspace 버전으로 대신 연결하지 않는다.
- Bun의 packages/next workspace와 registry의 next가 같은 내부 ID를 갖는 반례를 재현했다. workspace ID를 별도 영역으로 구분해 외부 취약 버전의 누락을 막았다.
- 새 vendor 경로를 실제 browser CI 서버와 응답 hash 검증에 포함했다. 서빙되지 않는 script를 정적 검사 통과만으로 완료 처리하지 않는다.

## 검증과 근거

Node 회귀 검사는 세 형식의 shared graph·단계·alias·nested version·peer context·cycle, 잘못된/중복/깊은/실행 가능한 입력, 경로 이탈, 오래된 specifier, 미선택 manifest, 미연결 버전의 권고 유지와 잘못된 해결 방지를 검사한다. CLI는 실제 임시 폴더에서 세 lockfile을 각각 읽는다. 정규화 JSON schema, OSV 전송 최소화와 로컬 workspace 근거 보존도 검사한다.

browser harness는 세 형식을 실제 폴더 입력으로 읽고 workspace·권고 자식·단계를 표시하며 320/390px overflow를 검사한다. 모든 linked asset의 소스/서버 응답/브라우저 응답 hash와 화면은 PR/main의 dashboard-browser artifact에 보존한다. 실제 서비스·설치된 패키지·실기기 검증은 포함하지 않는다. 실행별 통과 개수와 CI 상태는 해당 PR 및 CI 로그를 따른다.

공식 형식 근거: [pnpm v9 명세](https://github.com/pnpm/spec/blob/master/lockfile/9.0.md), [pnpm v6 명세](https://github.com/pnpm/spec/blob/master/lockfile/6.0.md), [Yarn 공식 lockfile](https://github.com/yarnpkg/berry/blob/master/yarn.lock), [Bun lockfile](https://bun.com/docs/pm/lockfile), [Bun 공식 tuple/workspace 예](https://github.com/oven-sh/bun/blob/main/bun.lock), [Bun nested key 설명과 npm 변환 구현](https://github.com/oven-sh/bun/blob/main/scripts/build/npm-ci.ts).

## 다음 우선순위와 복구

1. 지원하지 않는 pnpm 구형·다중 문서, Yarn patch/peer instance와 Bun binary는 gap으로 유지한다. 필요 프로젝트의 실제 형식 fixture가 확보되면 우선 확장한다.
2. 실제 설치된 SBOM·배포 digest와 lock graph를 대조한다. lock 연결만으로 배포 완료나 코드 실행 도달성을 증명하지 않는다.
3. workspace URL·배포 환경·사용자 여정의 매핑을 명시해 실제 앱 E2E와 연결한다. 테스트/정제 근거의 package 간 상속은 자동 변경하지 않는다.

오판은 먼저 coverage.gaps와 graph의 해당 root/edge, 다음으로 inventory.workspaceUsage를 확인한다. 실제 설치 결과로 보완한다. 되돌릴 때 이 PR을 revert하면 이전 파서·schema·UI로 함께 복구된다. 대상 프로젝트 manifest/lockfile이나 설치 내역을 수정하지 않는다.
