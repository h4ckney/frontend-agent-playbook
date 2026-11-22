# 실제 설치·SBOM·배포 보고 근거 연결

2026-11-22 · 기준 `eb0c4fd` · 위험 수준 2: 파일 선택, 의존성 버전과 보안 기준선의 의미를 확장한다. [선언 연결 분석](deno-local-resolution.md)에 이어 선택한 보고서를 연결한다. CVE 스냅샷(2026-10-30)과 지원 정책(2026-11-02)을 이번 날짜로 갱신하지 않는다.

2026-11-22 후속 [고정 공개키 기반 DSSE attestation 검증](attestation-verification.md)을 추가했다. 아래 지원·검증 수치는 PR #11 당시 기록이다.

## 결정과 구조

lockfile은 의도한 설치 연결이고 설치 목록·SBOM·배포 관찰은 각각 별도 시점의 보고다. 어느 workspace·revision·산출물의 자료인지 묶지 않으면 다른 빌드의 안전한 버전으로 현재 위험을 가릴 수 있다. 이번 구현은 **선택한 자료의 해시와 선언한 대상의 일치**를 대조한다. 파일끼리 맞는 것과 보고서 작성자의 진위, 실제 바이너리 실행·운영 상태는 별개다.

루트의 `.frontend-evidence.json`에서 대상마다 manifest·lock hash와 보고서를 명시한다. [execution-evidence.js](../analysis/execution-evidence.js)가 파일·좌표·대상·시각을 검증하고, [security-context.js](../analysis/security-context.js)가 기존 inventory에 별도 출처의 버전 근거를 더한다. JSON의 `securityContext.executionEvidence`, 대시보드와 Markdown은 같은 결과를 보여준다. 서명 검증·운영 API 접속 없이 자료의 일관성을 먼저 확인하는 방식을 선택했다. 자동 조회보다 공급업체 독립성이 높지만 출처 신뢰와 실시간 운영 확인은 남는다.

## 지원 입력과 근거

| 자료 | 읽는 범위 | 유의점 |
| --- | --- | --- |
| npm `ls --all --json` | root name, dependency tree의 정확한 버전·별칭·문제 상태 | `mode: installed-tree`를 명시. 실제 명령 인자를 보고서만으로 증명할 수 없어 진위는 미검증. file/link 패키지는 registry pin으로 승격하지 않음 |
| Composer 2 `installed.json` 복사본 | object의 `packages`에서 vendor/name·정확한 버전 | `vendor` 자체를 수집하지 않는다. 별도 보고 폴더에 복사해 명시. v1 array·dev branch·실행 PHP는 이 자료로 확정하지 않음 |
| CycloneDX JSON 1.4–1.7 | `components`와 중첩 components의 npm/Composer purl, metadata.timestamp, 대상 component의 SHA-256 | 지원하는 필드의 부분 해석이며 전체 표준 schema 검증·의존성 그래프·서비스/OS inventory 해석은 아님 |
| SPDX JSON 2.2/2.3 | packages의 PACKAGE-MANAGER purl, creationInfo.created, documentDescribes의 단일 root checksum | SPDX 3·외부 문서 참조·관계 graph는 미지원. root checksum은 묘사된 **패키지 산출물**의 값이어야 함 |
| 배포 관찰 v1 | succeeded 상태, workspace·revision·artifact digest·관찰 시각·environment·보고된 Node/PHP/Deno/Bun 버전 | 저장소 고유 interchange 형식. 클라우드 공급업체 응답이나 서명 attestation을 직접 검증하지 않음. 설치 목록으로 OS/SAPI/백포트를 추측하지 않음 |

공식 근거: [npm ls](https://docs.npmjs.com/cli/v11/commands/npm-ls/)는 기본 논리 설치 트리와 `--package-lock-only`의 차이를 설명한다. [CycloneDX 1.6](https://cyclonedx.org/docs/1.6/json/)은 metadata·component purl/hash·lifecycle을 구분한다. [SPDX package 정보](https://spdx.github.io/spdx-spec/v2.3.1/package-information/)는 purl 외부 참조와 패키지 checksum을 정의한다. [Composer 2.9.1 저장 구조](https://github.com/composer/composer/blob/2.9.1/src/Composer/Repository/FilesystemRepository.php)는 packages 목록을 저장·읽는 경로의 근거이며 [runtime 문서](https://getcomposer.org/doc/07-runtime.md)는 설치 버전과 런타임 유틸리티를 설명한다. 이 분석기는 Composer PHP 유틸리티를 실행하지 않는다.

`pkg:npm/%40scope/name@1.2.3`, `pkg:composer/vendor/name@1.2.3`를 생태계별로 읽는다. qualifiers·subpath·미지원 생태계·범위/prerelease·상충한 name/version은 gap이다. generic purl에서 Node/PHP 런타임을 추측하지 않는다. 동일 권고는 기존 상위 이슈로 묶고 lock·설치·SBOM의 발생은 하위 근거로 유지한다.

## 수집과 연결 방법

[synthetic 예제](../examples/execution-evidence/README.md)의 `.frontend-evidence.json`을 참고해 실제 자료의 경로와 해시를 넣는다. 예제는 실제 배포 기록이 아니다. 모든 상대 경로는 선택 루트 기준이고, 보고서는 선택 루트의 일반 폴더에 두어야 한다.

1. 각 workspace의 설치가 완료된 환경에서 **읽기만 하는** 보고서를 확보한다. 예: 해당 workspace에서 `npm ls --all --json --offline --package-lock-only=false > evidence/installed.json`. workspace 선택·omit/depth·npm 설정과 exit status를 함께 보존한다. `--all`을 빼거나 잘린 결과, lock-only·문제 상태를 정상 설치의 완전한 근거로 사용하지 않는다. 분석기는 이 명령을 자동 실행하지 않는다.
2. 같은 빌드 산출물의 SBOM을 확보한다. SBOM 대상 root의 SHA-256은 실제 대상 산출물 bytes의 digest여야 한다. 이미지 tag, SBOM 파일 hash, OCI manifest digest·index digest·레이어 digest를 서로 대체하지 않는다. 동일 종류의 산출물이라는 보증은 보고서 제공자가 확인해야 한다.
3. 배포 측에서 관찰한 성공 상태·revision·산출물 digest·시각을 배포 관찰 형식으로 내보낸다. URL·토큰·환경변수·전체 provider 응답은 이 형식에 넣지 않는다. 태그만 있는 보고서는 digest 근거로 인정하지 않는다.
4. 대상의 manifest/lock 및 보고서의 `sha256:<64 lowercase hex>`를 계산하고 config에 등록한다. revision은 40/64자리 hex 식별자이며 실제 Git checkout/빌드 provenance와의 일치까지 분석기가 증명하지 않는다. UTF-8 JSON 파일의 byte hash를 사용하고 BOM·잘못된 encoding은 피한다. CLI·브라우저의 UTF-8 텍스트 재인코딩이 달라지면 해시가 불일치해 연결되지 않을 수 있다.
5. 기존 CLI `scan` 또는 폴더 선택으로 분석한다. `matches-lock`, `differs-lock`, `not-in-lock`과 누락 패키지·시각·보고서 hash 상태를 검토한다. `linked`는 선언한 자료의 연결이며 실제 설치/운영 확인 표시가 아니다.

기존 파일 수·크기·총량 budget을 유지한다. `.tree`·`.cdx`·`.report` 등 일반 허용 확장자가 아닌 파일도 config가 명시한 경로만 두 번째 수집 대상으로 허용한다. symlink(CLI), 제외/생성 디렉터리, 환경·인증 파일·키·다른 manager manifest/lock을 보고서로 읽지 않는다. 경로 탈출·URL·인코딩·숨김 경로도 거절한다. 보고서 자체에 포함된 다운로드 URL·absolute 설치 경로·비밀정보는 결과에 복사하지 않는다. 선택된 원본 파일을 서버로 전송하지 않는다.

## 판정·보안 기준선

manifest hash가 다르거나 없으면 해당 대상은 거절한다. lock hash 불일치, 형제 workspace pin, 설치/SBOM 차이·누락, report hash 불일치, 중복 subject/공유 report, 예산 초과는 미검증이다. 현재 해석 예산은 대상 최대 100개, 설치/SBOM 처리 최대 20,000개 작업이며 기존 500KB/파일·4,000개·25MB 수집 한도를 따른다. 생략된 dev/optional/플랫폼 패키지도 사라졌다는 이유만으로 배포 제외를 증명하지 않는다.

연결된 배포 표시는 같은 manifest와 revision, config·SBOM root·배포 관찰의 동일한 산출물 SHA-256, 유효한 성공 상태와 관찰 순서가 모두 맞을 때 가능하다. 관찰 시각은 명시적 UTC이고 30일 초과/미래/잘못된 시각은 재확인 대상으로 둔다. 새로 쓴 config의 날짜로 오래된 SBOM timestamp를 덮지 않는다. 설치 보고서에 자체 timestamp가 없으면 config 관찰 시각은 제공자의 진술이다.

보고된 정확한 패키지·런타임 버전은 기존 유한 권고와 비교하되 `reported-exact`·`runtime-observation`으로 분리한다. 안전한 SBOM/lock이 있어도 취약 설치 보고서를 지우지 않는다. phase는 npm 설치 dev 표시와 명시적인 runtime 관찰 외에는 unknown이며, SBOM에 있다는 이유로 서버 runtime으로 바꾸지 않는다. 명시적 OSV 조회 도구는 현재 `locked-exact`만 보내므로 보고된 버전은 전송하지 않는다.

PR #11에서는 `execution-evidence-authenticity-unverified`를 항상 남겼다. 후속 서명 검증의 구체적인 인증 조건은 [attestation 범위](attestation-verification.md)를 따른다. 이 근거를 포함한 결과가 전체 보안 검증 완료를 뜻하지 않는다. 보고서 기반 권고와 수명 경고는 보고서/config가 삭제되거나 수정 버전만 남아도 이전 baseline에서 **자동 resolved가 되지 않고 unverified**로 남긴다. 보고서의 부재·해시 일치·스캐너 무경고가 운영 취약점 해결 증거는 아니다. 기존 검토 후 닫기·재열기와 별도로 운영 수정 확인이 필요하다.

## 검증과 후속

[회귀 검사](../analysis/execution-evidence.test.mjs)는 SHA-256을 Node 표준 구현과 대조하고, workspace/버전 오연결, 보고서 변조·소실, stale/future/잘못된 날짜, 중복·손상·위험 경로·작업 한도, 빈 목록·중복 runtime과 baseline 오해결을 확인한다. [CLI 검사](../bin/frontend-agent-audit.test.mjs)는 명시한 확장자만 수집하고 symlink를 거절하는지 확인한다. [브라우저 검사](../scripts/verify-dashboard.mjs)는 연결·변조·취약 설치 불일치와 320/390px 표시를 확인한다. 실제 npm 출력 캡처와 synthetic SBOM·배포 자료는 [fixture 근거](../analysis/fixtures/execution-reports/README.md)로 구분한다.

반례 리뷰에서 설치/SBOM 목록을 비우면 연결된 것으로 보일 수 있는 경우, 비교 도중 생긴 gap보다 먼저 배포 연결을 확정하는 경우, 보고서가 사라져 수명 경고를 자동 해결하는 경우를 차단했다. 이번 구현 중 발견한 중간급 판정 오류이며 기존 main의 운영 사고나 악용으로 주장하지 않는다. 최종 테스트·브라우저·원격 CI 및 머지 상태는 PR에 기록한다.

최종 로컬 전달 소스에서 **257개 테스트**, Chrome 157 **47개 시나리오**(페이지 오류 0개), Markdown **77개**, schema/plugin 동기화와 diff 검사를 통과했다. 320/390px 화면을 확인하고 최종 소스·서버·브라우저 응답 및 검사 코드 hash를 대조했다. synthetic 예제도 실제 CLI로 실행해 연결 상태를 확인했다. 이 기록은 독립된 사람의 리뷰·실기기·전체 CSS/z-index 검사·실서비스 설치/배포 검증을 뜻하지 않는다.

실패 시 첫 확인 위치는 `executionEvidence.subjects[].artifacts`, 같은 대상의 manifest/lock hash·component comparison, `coverage.gaps`다. 전달은 회귀·문서/schema/plugin 검사와 동일 PR head의 Node 22/24/26·Chromium CI 후 머지, main CI 확인 순서다. 되돌리기는 해당 PR revert다.

다음 우선순위는 검증 가능한 빌드/배포 attestation·서명과 신뢰된 관찰자, 실제 조직의 설치·SBOM·provider export를 이용한 acceptance, 공유 SBOM의 명시적 component selector와 OCI 산출물 종류의 추가 모델이다. 관찰 지표는 반례에서 잘못된 연결·자동 해결이 발생하지 않는 것이다. 실제 운영 위험 감소 측정은 신뢰된 운영 자료가 확보된 뒤 가능하며 담당자·관찰 기간은 미정이고 자동 예약을 만들지 않았다. 실제 서비스에 대한 설치·배포·호출 경로 확인은 아직 미확인이다.
