# 프론트엔드 코드베이스 점검: synthetic-security-context

> 정적 패턴 검사 결과입니다. 발견된 항목이 없다고 해서 안전하거나 배포할 준비가 끝났다는 뜻은 아닙니다.

- 도구 버전: 0.2.0-dev
- 분석 방식: 브라우저 정적 패턴 검사
- 분석 기능: 라우트 경로 추론, 텍스트 패턴 검사
- 분석한 파일: 5
- 제외한 파일: 0
- 분석 범위: 설정된 한도 안에서 완료
- 기준선 비교: 기준선 없음 11, 새로 발견 0, 악화 0, 변화 없음 0, 해결됨 0, 비교할 수 없음 0

## 우선 검토 항목

1. **Next.js 이미지 처리 보안 권고와 버전이 일치함**
   - 그룹 ID: `security.next-image-svg-rce`
   - 판단: 먼저 확인
   - 왜 위험할 수 있는가: 명시된 버전 정보가 공개 보안 권고의 대상 범위와 일치합니다.
   - 가능한 영향: 실행 조건이 충족되면 원격 코드 실행 등 심각한 서버 영향 가능성
   - 우선순위 선정 근거: 명시된 버전 정보가 공개 보안 권고의 대상 범위와 일치합니다. / 실행 조건이 충족되면 원격 코드 실행 등 심각한 서버 영향 가능성
   - 아직 필요한 정보: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.
   - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

2. **Node.js Brotli 보안 권고와 버전이 일치함**
   - 그룹 ID: `security.node-brotli-2026`
   - 판단: 먼저 확인
   - 왜 위험할 수 있는가: 명시된 버전 정보가 공개 보안 권고의 대상 범위와 일치합니다.
   - 가능한 영향: 공격자 제어 Brotli 입력을 해석하면 메모리 손상·정보 노출·코드 실행 가능성
   - 우선순위 선정 근거: 명시된 버전 정보가 공개 보안 권고의 대상 범위와 일치합니다. / 공격자 제어 Brotli 입력을 해석하면 메모리 손상·정보 노출·코드 실행 가능성
   - 아직 필요한 정보: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.
   - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

3. **PHP 요청 메모리 처리 보안 권고와 버전이 일치함**
   - 그룹 ID: `security.php-oom-2026`
   - 판단: 먼저 확인
   - 왜 위험할 수 있는가: 명시된 버전 정보가 공개 보안 권고의 대상 범위와 일치합니다.
   - 가능한 영향: 실행 조건이 충족되면 원격 코드 실행 등 심각한 서버 영향 가능성
   - 우선순위 선정 근거: 명시된 버전 정보가 공개 보안 권고의 대상 범위와 일치합니다. / 실행 조건이 충족되면 원격 코드 실행 등 심각한 서버 영향 가능성
   - 아직 필요한 정보: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.
   - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

## 전체 분석 항목

- **[LOW] 보안 버전 점검에 미확인 범위가 있음**
  - 항목 ID: `security.dependency-coverage`
  - 탐지기: `security.dependency-coverage@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 정보 부족
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 정보 확인 필요
  - 적용된 판단: 정보 확인 필요
  - 근거 위치: composer.json
  - 관찰한 근거: 해석하지 못한 범위 0개; 미확정 버전·제약 1개; 스냅샷 2026-10-30 (within-30-days)
  - 위험이 성립하는 조건: 고정 버전·실제 설치 내역·최신 외부 권고 비교가 없는 경우
  - 권고 조치: 지원 lockfile과 실행 버전, 최신 npm/Composer 감사 또는 SBOM 결과를 별도로 확보합니다. 이 분석기는 해당 명령을 자동 실행하지 않습니다.
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인.
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[CRITICAL] Next.js 이미지 처리 보안 권고와 버전이 일치함**
  - 항목 ID: `security.next-image-svg-rce`
  - 탐지기: `security.next-image-svg-rce@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: package-lock.json
  - 관찰한 근거: CVE-2026-96889 / GHSA-2464-fhr4-w9xw: next@16.4.0 [runtime; lockfile; node_modules/next]
  - 위험이 성립하는 조건: glibc Linux에서 SVG를 사용하는 Image Optimization API와 실제 sharp 버전·선택 경로 확인 필요
  - 권고 조치: 공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. Next.js 15.5.28 / 16.4.1; 권고의 우회 조건은 실제 사용 sharp >=0.35.5
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[HIGH] Node.js Brotli 보안 권고와 버전이 일치함**
  - 항목 ID: `security.node-brotli-2026`
  - 탐지기: `security.node-brotli-2026@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: Dockerfile
  - 관찰한 근거: CVE-2026-111497: node@24.22.0 [build; container-configuration; FROM@1:builder]
  - 위험이 성립하는 조건: 공격자가 제공한 Brotli 데이터를 node:zlib로 압축 해제하는 실행 경로
  - 권고 조치: 공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. 22.23.4 / 24.22.1 / 26.12.1 이상인 해당 지원 계열
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[CRITICAL] PHP 요청 메모리 처리 보안 권고와 버전이 일치함**
  - 항목 ID: `security.php-oom-2026`
  - 탐지기: `security.php-oom-2026@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: Dockerfile
  - 관찰한 근거: CVE-2026-109618 / GHSA-w8hw-w9fx-j79w: php@8.4.26 [runtime; container-configuration; FROM@3:production]
  - 위험이 성립하는 조건: 웹 요청을 처리하는 PHP SAPI와 OOM 경로. SAPI별 도달 가능성과 공급업체 백포트 확인 필요
  - 권고 조치: 공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12 이상인 해당 지원 계열
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[CRITICAL] PHP 요청 사이 상태 처리 보안 권고와 버전이 일치함**
  - 항목 ID: `security.php-stale-state-2026`
  - 탐지기: `security.php-stale-state-2026@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: Dockerfile
  - 관찰한 근거: CVE-2026-109619 / GHSA-6wmf-4rv5-p3rp: php@8.4.26 [runtime; container-configuration; FROM@3:production]
  - 위험이 성립하는 조건: 동일 worker의 여러 웹 요청과 초기화 전 상태 소비 경로. PHP 8.5.12 등 패치 후에도 10월 23일 session upload progress 추가 권고를 별도 확인
  - 권고 조치: 공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12 이상인 해당 지원 계열
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp https://www.php.net/archive/2026.php
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[CRITICAL] RSC typed array 보안 권고와 버전이 일치함**
  - 항목 ID: `security.rsc-typed-array-rce`
  - 탐지기: `security.rsc-typed-array-rce@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: package-lock.json
  - 관찰한 근거: GHSA-xqc2-xf4c-x3h3 / GHSA-673q-mjm6-r5xr: next@16.4.0 [runtime; lockfile; node_modules/next]
  - 위험이 성립하는 조건: RSC 응답의 여러 typed array와 공격자 제어 값. Next.js는 App Router·Cache Components의 use cache 반환 경로 확인 필요
  - 권고 조치: 공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. RSC: 19.0.9 / 19.1.10 / 19.2.9 / 19.3.1; Next.js: 16.4.1 이상
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3 https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[CRITICAL] RSC typed array 보안 권고와 버전이 일치함**
  - 항목 ID: `security.rsc-typed-array-rce`
  - 탐지기: `security.rsc-typed-array-rce@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: package-lock.json
  - 관찰한 근거: GHSA-xqc2-xf4c-x3h3 / GHSA-673q-mjm6-r5xr: react-server-dom-webpack@19.3.0 [runtime; lockfile; node_modules/react-server-dom-webpack]
  - 위험이 성립하는 조건: RSC 응답의 여러 typed array와 공격자 제어 값. Next.js는 App Router·Cache Components의 use cache 반환 경로 확인 필요
  - 권고 조치: 공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. RSC: 19.0.9 / 19.1.10 / 19.2.9 / 19.3.1; Next.js: 16.4.1 이상
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3 https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[CRITICAL] RSC typed array 보안 권고와 버전이 일치함**
  - 항목 ID: `security.rsc-typed-array-rce`
  - 탐지기: `security.rsc-typed-array-rce@2026-10-30.1`
  - 관련 규칙: `security-privacy.dependency-exposure`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: package-lock.json
  - 관찰한 근거: GHSA-xqc2-xf4c-x3h3 / GHSA-673q-mjm6-r5xr: react-server-dom-webpack@19.3.0 [development; lockfile; node_modules/worker/node_modules/react-server-dom-webpack]
  - 위험이 성립하는 조건: RSC 응답의 여러 typed array와 공격자 제어 값. Next.js는 App Router·Cache Components의 use cache 반환 경로 확인 필요
  - 권고 조치: 공식 권고와 실제 실행 경로·설치 버전·공급업체 백포트를 확인하고 수정 버전으로 갱신합니다. RSC: 19.0.9 / 19.1.10 / 19.2.9 / 19.3.1; Next.js: 16.4.1 이상
  - 분석 한계: 오프라인 권고 스냅샷 2026-10-30; 설정·lockfile의 버전 일치이며 실행 중 악용 가능성은 미확인. https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3 https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr
  - 다음으로 확인할 것: 버전 근거와 실행 단계, 서비스 노출·관련 API·배포된 이미지 및 공급업체 패치 내역을 확인합니다.

- **[LOW] 프로젝트의 검색 노출 범위가 지정되지 않음**
  - 항목 ID: `seo.indexing-intent-unknown`
  - 탐지기: `seo.indexing-intent@1`
  - 관련 규칙: `seo.applicability`
  - 근거 수준: 정보 부족
  - 적용 여부: 확인 필요
  - 변경 상태: 기준선 없음
  - 기본 판단: 정보 확인 필요
  - 적용된 판단: 정보 확인 필요
  - 근거 위치: 사용자 입력: 검색 노출 범위 미확인
  - 관찰한 근거: 프로젝트의 검색 노출 범위가 지정되지 않음
  - 위험이 성립하는 조건: 공개·내부 라우트가 섞여 있거나 배포 환경과 인증 경계가 문서화되지 않은 경우
  - 권고 조치: 공개 검색 유입이 필요한 URL이 있는지 확인한 뒤 SEO 검사를 적용하거나 제외합니다.
  - 분석 한계: 정적 분석으로 확인할 수 없는 설정, 데이터 출처 또는 실행 결과를 추가로 확인해야 함
  - 다음으로 확인할 것: 공개 검색 유입이 필요한 URL과 인증·네트워크로 제한된 URL을 구분합니다.

- **[MEDIUM] E2E 설정 또는 테스트 소스 경로를 찾지 못함**
  - 항목 ID: `testing.e2e-path-missing`
  - 탐지기: `testing.critical-journeys@2`
  - 관련 규칙: `testing.critical-journeys`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: Playwright·Cypress 설정 및 E2E 테스트 소스 경로 미발견
  - 관찰한 근거: E2E 설정 또는 테스트 소스 경로를 찾지 못함
  - 위험이 성립하는 조건: 고위험 다단계 여정이 있는데 통합 테스트나 합성 모니터링 같은 대체 검증도 없는 경우
  - 권고 조치: 고위험 사용자 여정이 존재하는지 확인한 뒤 우선순위가 높은 하나부터 추가합니다.
  - 분석 한계: 정적 근거를 바탕으로 위험 가능성을 추정한 것으로, 결함이 확인된 것은 아님
  - 다음으로 확인할 것: 실패 비용이 큰 사용자 여정을 나열하고 현재 자동화가 각 경계를 실제로 통과하는지 확인합니다.

- **[HIGH] 테스트 기반을 찾지 못함**
  - 항목 ID: `testing.test-foundation-missing`
  - 탐지기: `testing.foundation@1`
  - 관련 규칙: `testing.test-foundation`
  - 근거 수준: 위험 가능성
  - 적용 여부: 조건부 적용
  - 변경 상태: 기준선 없음
  - 기본 판단: 먼저 확인
  - 적용된 판단: 먼저 확인
  - 근거 위치: `test` 스크립트와 test/spec 파일을 찾지 못함
  - 관찰한 근거: 테스트 기반을 찾지 못함
  - 위험이 성립하는 조건: 변경이 잦거나 상태 전이가 복잡한데 CI에서 실행할 테스트 명령이 없는 경우
  - 권고 조치: 변경 위험이 큰 순수 로직이나 상태 전이부터 좁은 회귀 테스트를 추가합니다.
  - 분석 한계: 정적 근거를 바탕으로 위험 가능성을 추정한 것으로, 결함이 확인된 것은 아님
  - 다음으로 확인할 것: workspace 루트와 CI에서 실제 변경 경로를 검증하는 테스트 명령 및 최근 실행 결과를 확인합니다.

## 분석 진단

- **project.context-missing**: 승인된 프로젝트 프로필이 없어 제품별 사용자 여정, 라우트 정책, 신뢰 경계와 방어 수단을 적용하지 않았습니다.


## 모듈·런타임 보안 근거

권고 스냅샷: security-context-2026-10-30-v1 / 2026-10-30 / within-30-days

유한한 오프라인 권고 목록입니다. 일치 없음은 안전 판정이 아니며, 실제 설치·배포·공격 경로는 미확인입니다.

| 모듈 | 버전 | 버전 근거 | 단계 | 파일·위치 | 단계 판정 근거 |
| --- | --- | --- | --- | --- | --- |
| next | ^16.4.0 | declared-range | runtime | package.json#dependencies/next | manifest:dependencies; deployment not verified |
| vite | ^6.0.0 | declared-range | build | package.json#devDependencies/vite | manifest:devDependencies; deployment not verified |
| php | ^8.4 | declared-range | runtime | composer.json#require/php | manifest:require; deployment not verified |
| vendor/app | ^1.0 | declared-range | runtime | composer.json#require/vendor/app | manifest:require; deployment not verified |
| vendor/test | ^2.0 | declared-range | development | composer.json#require-dev/vendor/test | manifest:require-dev; deployment not verified |
| node | 24.22.0 | image-pin | build | Dockerfile#FROM@1:builder | non-final Docker stage; may be used during build; custom --target not assessed |
| php | 8.4.26 | image-pin | runtime | Dockerfile#FROM@3:production | default final Docker stage or its FROM ancestor; custom --target not assessed |
| next | 16.4.0 | locked-exact | runtime | package-lock.json#node_modules/next | npm lock dev flag; package install/deployment and runtime reachability not verified |
| react-server-dom-webpack | 19.3.0 | locked-exact | runtime | package-lock.json#node_modules/react-server-dom-webpack | npm lock dev flag; package install/deployment and runtime reachability not verified |
| react-server-dom-webpack | 19.3.0 | locked-exact | development | package-lock.json#node_modules/worker/node_modules/react-server-dom-webpack | npm lock dev flag; package install/deployment and runtime reachability not verified |
| vite | 6.0.0 | locked-exact | build | package-lock.json#node_modules/vite | npm lock dev flag; package install/deployment and runtime reachability not verified |
| vendor/app | 1.0.0 | locked-exact | runtime | composer.lock#packages/vendor/app | Composer lock package group; production installation not verified |
| vendor/test | 2.0.0 | locked-exact | development | composer.lock#packages-dev/vendor/test | Composer lock package group; production installation not verified |

확인하지 못한 범위:

- Finite advisory snapshot, not a universal or live CVE database
- No installed package, deployed image, SAPI, OS, vendor backport or vulnerable data-flow verification
- npm lock v2/v3 and Composer lock only; yarn/pnpm/bun and OS packages require external tools
- Build/development phase can still expose CI credentials, artifacts and developer machines
- PHP: 2026-10-23 session upload progress configuration advisory and 2026-10-26 Windows Brotli package rebuild  -1  are not auto-matched by the runtime number; verify applicable settings, OS and package revision: https://www.php.net/archive/2026.php

공식 근거:

- https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
- https://nodejs.org/en/about/previous-releases
- https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w
- https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp
- https://www.php.net/supported-versions.php
- https://www.php.net/archive/2026.php
- https://github.com/react/react/security/advisories/GHSA-fv66-9v8q-g76r
- https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3
- https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr
- https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw
