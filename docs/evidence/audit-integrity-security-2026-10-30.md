# 2026-10-30 분석 신뢰도·보안 개선 근거

기준 커밋: `e9be632b37e5a9cb80d1ce5cae1843b5a820b540`. 구현 범위·구조·전달 경로는 [개선 문서](../audit-integrity-security-upgrade.md)를 따른다. 이 문서는 현재 상태를 구분하며 기존 2026-10-25 증거를 이번 변경의 통과 근거로 재사용하지 않는다.

## 확인한 동작

| 근거 | 검증 | 자료 |
| --- | --- | --- |
| 생성 헤더·CI | 일반 문구가 소스를 숨기지 않음; 실제 제외는 부분 분석; 별개의 새 위험은 exit 1 유지 | [analyzer 테스트](../../analysis/analyzer.test.mjs), [CLI 테스트](../../bin/frontend-agent-audit.test.mjs) |
| 기준선 | 탐지기 버전 변경·권고 시점 미확인·lock 제거/미지원은 과거 위험을 미검증으로 유지 | [계약 테스트](../../analysis/audit-contract.test.mjs) |
| 검토 상태 | 두 탭·빈 백업·저장 불가 재연결·미래 시각·다시 열기·v1 이관 | [상태 테스트](../../analysis/triage-state.test.mjs), [VM UI 테스트](../../analysis/browser-smoke.test.mjs) |
| 공개 계약 | 중첩 필수 필드 삭제·enum/type/날짜·추가 필드와 baseline 메타데이터 거부 | [스키마 생성 검사](../../scripts/sync-artifact-schemas.mjs), [계약 테스트](../../analysis/audit-contract.test.mjs) |
| 보안 문맥 | 버전 경계·범위/가상 PHP/일반 React 오판 방지·Docker 별칭·CI 표현식·PHP 버전 미확인·잘못된 lock 경로 | [보안 테스트](../../analysis/security-context.test.mjs) |
| 최신 모듈 조회 | 좌표 중복 제거·모듈별 단계·별칭 묶기·페이지 대응·실패/제한/잘못된 응답·입력 검증 | [OSV 테스트](../../scripts/query-osv.test.mjs) |
| 증거 출처 | 서버 응답·체크아웃 일치, 오래된 서버·중간 변경 거부 | [출처 HTTP 테스트](../../scripts/dashboard-provenance.test.mjs), [브라우저 스크립트](../../scripts/verify-dashboard.mjs) |

## 합성 보안 입력

[재현 스크립트](../../scripts/reproduce-security-context.mjs)는 취약한 버전 문자열을 포함한 메모리 입력만 만든다. 패키지를 설치하거나 실행하지 않았다.

- [정규화된 결과](security-2026-10-30/synthetic-scan.json)
- [사람이 읽는 보고서](security-2026-10-30/synthetic-report.md)
- [발견·단계·묶음 검사](security-2026-10-30/synthetic-checks.json)

Node는 빌드 stage, PHP는 기본 최종 stage의 서비스 실행, 중첩 RSC 패키지는 개발 단계로 분리된다. 같은 typed array 권고는 Next·RSC 세 위치를 한 부모 아래 보존한다. 공식 권고와 일치하는 버전·조건을 보여주며 실제 설치·배포·악용의 증거는 아니다. `coverage.complete`는 `false`이고 자동 외부 조회도 하지 않았다.

## 검증 상태

- 로컬 Node 검사는 [로그](security-2026-10-30/node-tests.log)를 따른다. Node 25.2.1에서 실행한 결과이며 Node 22/24/26 실행으로 표현하지 않는다.
- 문서 링크·규칙 ID, 플러그인 동기화, 브라우저 스키마 복사본과 diff 검사를 수행한다.
- 출처 HTTP 검사 4개는 로컬 실행에서 통과했다. 모든 실제 브라우저 시나리오 통과를 뜻하지 않는다.
- 이번 실제 Chrome/내장 브라우저 확인 시도는 자동 승인 검토 시스템의 모델 용량·시간 초과로 실행 권한을 얻지 못했다. 위험 판정으로 거절된 것은 아니다. 통과 증거가 생기기 전에는 실제 화면 검증을 미완료로 유지한다.
- 실제 OSV 통신은 수행하지 않았다. 테스트는 공식 API 형태의 주입 응답을 사용한다. 저장소의 실제 제품 의존성이 취약하다는 판정도 하지 않았다.
- 원격 PR/CI·머지는 전달 시점에 별도로 확인한다. 공개 release, 서비스 배포, 운영 효과와 물리 기기 검증은 범위 밖이다.

## 재현 명령

```sh
node scripts/validate-docs.mjs
node scripts/sync-plugin-package.mjs --check
node scripts/sync-artifact-schemas.mjs --check
node --test analysis/*.test.mjs bin/frontend-agent-audit.test.mjs scripts/guidance-approval.test.mjs scripts/query-osv.test.mjs scripts/dashboard-provenance.test.mjs
node scripts/reproduce-security-context.mjs /tmp/security-context-evidence
node scripts/verify-dashboard.mjs --url http://127.0.0.1:4381/analysis/ --output /tmp/security-browser-evidence --channel chrome
```

마지막 두 경로는 예시다. 실제 브라우저 실행에는 호출 환경이 제공하는 Playwright와 로컬 미리보기가 필요하다. OS의 폴더 선택 창은 검증 범위에서 제외하며, 버튼의 키보드 활성화와 디렉터리 파일 입력은 구분해서 확인한다.
