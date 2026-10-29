# 보안 버전과 실행 단계 점검

이 분석기는 선택한 파일을 로컬에서 읽고 **설정·lockfile의 버전 근거**를 정리합니다. 실제 설치, 배포, 서비스 노출, 취약한 API 도달 가능성을 확인한 결과와 구분합니다. 프로젝트 코드를 실행하거나 의존성을 설치하지 않습니다.

## 어떤 결과를 얻는가

`analysis/security-context.js`의 `inspectSecurityContext(records, { now })`는 `snapshot`, `inventory`, `findings`, `coverage`를 반환합니다. `records`는 `{ path, content }` 배열입니다. Node CommonJS와 브라우저의 `FrontendSecurityContext`를 모두 지원합니다.

| 항목 | 의미 |
| --- | --- |
| `ecosystem`, `name`, `version` | npm, Composer, Node/PHP 런타임과 명시된 버전 |
| `versionKind` | lock의 정확한 버전, 선언 범위, 런타임 pin, 이미지 tag 등을 구분 |
| `manifest`, `path`, `provenance` | 근거 파일, 그 안의 패키지 위치, 근거 종류 |
| `phase`, `phaseEvidence` | `runtime`, `build`, `development`, `unknown`과 분류 이유 |
| `direct` | 해당 manifest의 직접 의존성 여부. 배포·실행의 증거가 아님 |
| `coverage` | 해석하지 못한 파일·버전과 점검 한계. `complete`는 항상 `false` |

동일 권고는 하나의 상위 이슈로 만들고 패키지·모듈·버전 근거는 하위 발생으로 남깁니다. 예를 들어 같은 typed array 문제의 React 상위 권고와 Next.js 하위 권고는 하나의 권고 묶음으로 취급합니다. 원인이 다른 CVE는 별도 이슈입니다. 검토 후 닫기는 버전 수정이나 보안 해결을 증명하지 않습니다.

## 지원 입력과 실행 단계

| 입력 | 현재 해석 | 확인하지 못하는 부분 |
| --- | --- | --- |
| `package.json` | dependencies, optional/dev/peer 구분, Node engines | 선언 범위만으로 설치 버전 확정 불가 |
| npm lock v2/v3, shrinkwrap | 정확한 버전, 중첩·scope 패키지, dev flag | 실제 설치·배포, 번들 포함 여부, 전체 workspace graph |
| `composer.json`, `composer.lock` | require/require-dev, packages/packages-dev | PHP 실행 버전, 배포 시 `--no-dev` 적용 여부 |
| `.nvmrc`, `.node-version`, `.php-version` | 정확한 pin과 selector 구분 | 빌드·서비스 중 어디서 사용했는지, 실제 바이너리 |
| 공식 Node/PHP `Dockerfile` 이미지 | 마지막 기본 stage와 FROM 조상은 runtime, 다른 stage는 build | 사용자 지정 `--target`, ARG 치환, custom 이미지, 배포 digest |
| GitHub Actions setup-node의 단순 literal | build 환경 설정 | matrix·표현식·YAML alias 해석, 실제 job 실행 |

일부 알려진 개발 의존성(Vite·Webpack·Rollup·esbuild·TypeScript 등)은 build로 분류합니다. 나머지 dev 의존성은 development입니다. 이 분류는 **선언과 stage 구조에서 추론한 사용 단계**입니다. 런타임 목록에 있다는 이유만으로 서비스가 해당 모듈을 호출한다고 단정하지 않습니다.

빌드·개발 도구도 CI 비밀정보, 소스와 배포 산출물에 접근할 수 있습니다. `devDependencies`라는 이유로 위험을 자동 제외하거나 낮추지 않습니다. 브라우저에 포함되는 코드, 서버의 요청 처리, 빌드 worker, 개발 서버의 노출을 각각 확인해야 합니다.

Composer `config.platform.php`는 의존성 해석을 위한 **가상 플랫폼 값**이며, 실행 중 PHP 버전의 증거로 사용하지 않습니다. Node engines도 허용 범위입니다. 패키지 선언의 정확한 버전조차 lock 근거 없이 설치 버전으로 취급하지 않습니다. 권고 매칭은 정확한 lock 버전 또는 런타임·이미지 pin에 한정합니다.

PHP 소스가 있지만 비교할 실행 버전 설정이 없으면 버전 정보 부족을 한 번 표시합니다. PHP 파일의 존재만으로 특정 CVE에 취약하다고 판정하지 않습니다. 문서만 있는 폴더에는 이 경고를 만들지 않습니다.

## 포함된 권고 스냅샷

검토일: **2026-10-30**. 자동 네트워크 조회 없이 사용하는 제한된 목록입니다. 30일이 지나거나 시각을 확인할 수 없으면 미확인 범위에 표시합니다. 30일 이내라는 표시는 최신 권고를 모두 수집했다는 의미가 아닙니다.

| 묶음 | 현재 비교 범위 | 조건과 원문 |
| --- | --- | --- |
| Node Brotli, CVE-2026-111497 | 22.x <22.23.4, 24.x <24.22.1, 26.x <26.12.1 | 공격자 Brotli 입력을 `node:zlib`로 해석하는 경로. Node 공식 등급 High. [Node 2026-10-21](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) |
| PHP OOM, CVE-2026-109618 | 지원 계열 8.2 <8.2.35, 8.3 <8.3.36, 8.4 <8.4.27, 8.5 <8.5.12 | 웹 SAPI와 메모리 고갈 경로. [PHP OOM 권고](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) |
| PHP stale state, CVE-2026-109619 | 위 PHP 지원 계열의 같은 수정 버전 | worker의 요청 사이 상태와 초기화 경로. [PHP stale state 권고](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp) |
| React2Shell, CVE-2025-55182 | RSC 19.0.0, 19.1.0, 19.1.1, 19.2.0 | `react-server-dom-webpack`, `-parcel`, `-turbopack`. react만 사용하는 클라이언트 앱은 이 조건으로 판정하지 않음. [React 권고](https://github.com/react/react/security/advisories/GHSA-fv66-9v8q-g76r) |
| RSC typed array RCE | RSC 19.0 <19.0.9, 19.1 <19.1.10, 19.2 <19.2.9, 19.3 <19.3.1; Next 16.0.0–16.4.0 | 여러 typed array와 공격자 제어 값. Next는 App Router·Cache Components의 관련 `use cache` 경로. [React 권고](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3), [Next 권고](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr) |
| Next 이미지 RCE, CVE-2026-96889 | Next 10.0.0–15.5.27, >16.0.0–16.4.0 | glibc Linux, SVG 이미지 최적화와 실제 sharp 선택 경로. 수정 Next 15.5.28/16.4.1. [Next 이미지 권고](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) |

`node2shell`, `PHP2Shell`, `React2Shell` 같은 별명은 서로 같은 취약점이라는 뜻으로 사용하지 않습니다. 결과에서는 CVE/GHSA와 원문을 기준으로 추적합니다. 최초 React2Shell 수정 버전만 권고하면 이후 공개된 다른 취약점을 놓칠 수 있으므로 후속 권고도 함께 확인해야 합니다.

PHP는 2026-10-23에 session upload progress의 추가 조건부 위험을 안내했고, 10월 26일에는 Brotli를 갱신한 Windows 빌드(`-1`)를 공개했습니다. 이 두 조건은 현재 자동 매칭하지 않습니다. PHP runtime 숫자만으로 OS·배포 패키지 revision이나 설정의 안전성을 확정할 수 없습니다. [PHP 2026 보안 공지](https://www.php.net/archive/2026.php)

지원 종료 판정도 검토일의 스냅샷입니다. Node 20·25 등 지원이 끝난 계열과 PHP 8.1 이하를 별도로 알립니다. PHP의 공급업체 백포트와 유료 지원은 확인이 필요합니다. [Node 지원 현황](https://nodejs.org/en/about/previous-releases), [PHP 지원 현황](https://www.php.net/supported-versions.php)

## 현재 한계와 다음 확인

- 이 목록에 일치하지 않아도 안전 판정이 아닙니다. npm·Packagist의 전체 CVE와 악성 패키지, OS·컨테이너 의존성은 별도 검사 대상입니다.
- Yarn·pnpm·Bun 텍스트 lock은 해석하지 않았다고 표시합니다. 바이너리 `bun.lockb`는 텍스트 분석에서 `unsupported-type`으로 제외합니다. 지원 파일이더라도 입력 크기·읽기 제한으로 빠지면 상위 분석 범위가 부분 분석임을 유지해야 합니다.
- 버전 일치 결과는 `inferred` / `verify-first`입니다. 실제 배포 버전, 도달 가능한 API, SAPI·OS, 외부 노출과 공급업체 패치로 위험을 검증합니다.
- 최신 전체 모듈 비교는 고정 설치 내역 또는 SBOM을 근거로 npm/Composer 감사·OSV 등 외부 도구와 연결하는 단계가 필요합니다. 외부 전송에는 패키지명·버전·개인 저장소 이름의 노출 범위를 먼저 명시해야 합니다.
- 빌드 공격은 credential·산출물 변조를, 서버 공격은 외부 요청 처리 경로를, 브라우저 코드는 사용자 데이터·권한 경계를 검증합니다. 실행 단계는 위험을 해석하는 근거이며 자동 면제 조건이 아닙니다.

문제가 생기면 먼저 `snapshot.checkedAt`과 `coverage.gaps`, 해당 inventory의 `manifest/path/versionKind/phaseEvidence`, 마지막으로 실제 설치·배포 정보와 공식 권고를 확인합니다.
