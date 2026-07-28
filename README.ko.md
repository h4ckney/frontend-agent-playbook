# frontend-agent-playbook

[English](README.md) | [한국어](README.ko.md)

[![Validate](https://github.com/h4ckney/frontend-agent-playbook/actions/workflows/validate.yml/badge.svg)](https://github.com/h4ckney/frontend-agent-playbook/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Claude Code, Codex 및 기타 AI 코딩 에이전트를 위한 프로덕션 수준의 프론트엔드 플레이북입니다.

이 저장소는 React, Next.js, TypeScript, 폼, 런타임 검증, 상태 소유권, 보안, 개인정보 보호, 데이터 페칭, 캐싱, 오류 처리, 관측 가능성, 접근성, SEO, 성능, 테스트, 데드코드 제거 및 코드 리뷰 워크플로우를 위한 실용적인 규칙, 스킬, 예시와 템플릿을 제공합니다.

![근거 수준, 긴급 권고 및 위험 영역을 표시하는 프론트엔드 감사 대시보드](assets/audit-dashboard.png)

## 단순한 규칙 목록과 무엇이 다른가요?

- **도입 전 감사**: 가이드를 선택하기 전에 코드베이스, 버전, 라우터, 렌더링 모델, 기존 지침과 근거를 확인합니다.
- **승인 기반 변경**: 제안, 파일 단위 승인, 적용 및 외부 Issue 게시는 서로 분리된 경계로 유지합니다.
- **버전 인지형 프론트엔드 판단**: Pages Router와 App Router, RSC와 비 RSC React, 컴파일러가 지원하는 TypeScript 기능을 구분합니다.

## 빠른 시작

모든 규칙을 활성화하지 않고 태그가 지정된 플레이북을 가져옵니다.

```bash
npx degit h4ckney/frontend-agent-playbook#v0.1.0 .agents/vendor/frontend-agent-playbook
```

대상 저장소의 `AGENTS.md`에 최소 진입점을 추가합니다.

```markdown
## Frontend Agent Guidance

- Start with `.agents/vendor/frontend-agent-playbook/rules/governance.md`.
- Use `.agents/vendor/frontend-agent-playbook/skills/audit-frontend-rules/references/rule-routing.md` to select only task-relevant rules.
- Reinspect the installed framework, router, rendering model, TypeScript version, lint, tests, and local instructions before applying guidance.
- Keep project instructions and version-matched official documentation above the vendored playbook.
- Do not create project rules, skills, enforcement, or external Issues before explicit scoped approval.
```

이 명령은 플레이북을 참고 자료로 복사합니다. 가져온 모든 규칙을 자동으로 활성화하지 않으며 프로젝트별 지침을 대체하지 않습니다.

## 이 저장소의 목적

`frontend-agent-playbook`은 프로덕션 애플리케이션을 다루는 AI 코딩 에이전트를 위한 프론트엔드 운영 플레이북입니다.

에이전트가 먼저 기존 코드를 읽고, 프로젝트 관례를 따르며, 실제 UI 상태와 접근성을 처리하고, 완료 전에 변경 사항을 검증하도록 유도합니다. 이를 통해 모호한 AI 생성 코드를 줄이고 시니어 프론트엔드 엔지니어에 가까운 작업 방식을 갖추는 것이 목적입니다.

## 사용 방법

프로젝트 지침, 에이전트 메모리, `AGENTS.md`, Claude Code 지침 또는 Codex 작업 프롬프트에서 필요한 플레이북 파일만 참조하세요. 모든 규칙을 기본으로 한꺼번에 주입하지 마세요.

항상 [규칙 거버넌스](rules/governance.md)부터 시작한 다음 [규칙 라우팅](skills/audit-frontend-rules/references/rule-routing.md)을 사용하여 작업에 필요한 최소 규칙만 선택합니다.

사용 가능한 규칙:

- [React 규칙](rules/react.md)
- [Next.js 규칙](rules/nextjs.md)
- [TypeScript 규칙](rules/typescript.md)
- [폼 및 런타임 검증 규칙](rules/forms-runtime-validation.md)
- [상태 소유권 규칙](rules/state-ownership.md)
- [보안 및 개인정보 보호 규칙](rules/security-privacy.md)
- [데이터 페칭 및 캐시 규칙](rules/data-fetching-cache.md)
- [오류 처리 및 관측 가능성 규칙](rules/error-handling-observability.md)
- [성능 규칙](rules/performance.md)
- [접근성 규칙](rules/accessibility.md)
- [SEO 규칙](rules/seo.md)
- [테스트 규칙](rules/testing.md)
- [데드코드 제거 규칙](rules/dead-code.md)
- [코드 리뷰 규칙](rules/code-review.md)
- [강제 수단 매핑](docs/enforcement-mapping.md)

예시와 템플릿:

- [Claude 예시](examples/claude.md)
- [Codex 예시](examples/codex.md)
- [버전 인지형 리뷰 예시](examples/version-aware-review.md)
- [Pages Router 프로덕션 감사](examples/audits/pages-router-production.md)
- [App Router 대표 감사](examples/audits/app-router-representative.md)
- [가이드 도입 forward-test](examples/adoption/forward-test.md)
- [프로덕션 애플리케이션 워크플로우](examples/production-application/feature-workflow.md)
- [기능 구현 템플릿](templates/feature-implementation.md)
- [리팩터링 요청 템플릿](templates/refactor-request.md)
- [버그 수정 템플릿](templates/bug-fix.md)
- [프론트엔드 규칙 결정 템플릿](templates/frontend-rules-decisions.md)
- [가이드 제안 템플릿](templates/guidance-proposal.md)
- [감사 Issue 초안 템플릿](templates/audit-issue.md)

기존 코드베이스에는 [Audit Frontend Rules 스킬](skills/audit-frontend-rules/SKILL.md)을 사용합니다. 전체 규칙을 도입하기 전에 충돌, 예외, 상태 소유권 위험, 보안 및 개인정보 위험, 데이터와 캐시 위험, 오류 처리 공백, 제거 후보 및 테스트 공백을 확인합니다.

담당자가 명명된 제안 ID를 승인한 후에는 [Apply Frontend Guidance](skills/apply-frontend-guidance/SKILL.md)를 사용하여 승인된 프로젝트 규칙이나 스킬만 생성하고 검증한 뒤 적용 결정을 기록합니다. 프로젝트 가이드는 승인 전까지 적용되지 않으며 Issue 초안도 별도 승인 전까지 게시되지 않습니다.

의존성이 없는 [가이드 승인 게이트](scripts/guidance-approval.mjs)는 저장소 식별자, 제안 상태, 중요 범위, 정확한 대상 경로, 의존성, 강제 수단, 콘텐츠 fingerprint, 충돌 및 멱등 재실행에 대해 제공된 승인 메타데이터를 비교합니다. 이 스크립트는 저장소 소유권을 확인하거나 대상 파일 fingerprint를 직접 계산하지 않습니다. 해당 입력은 적용 에이전트가 수집하고 검증해야 합니다.

대시보드 Markdown 내보내기에는 안정적인 finding ID와 Audit Handoff 표가 포함됩니다. 추적성을 위해 해당 ID를 제안서와 Issue 초안에 전달하되, 결함의 증거나 쓰기 승인으로 간주하지 마세요.

빠른 로컬 검사를 실행하려면 [Frontend Audit 대시보드](analysis/index.html)를 열고 프로젝트 폴더를 선택합니다. 대시보드는 관찰된 사실, 위험 추론, 정보 부족 및 제거 후보를 구분하고 결과를 Markdown으로 내보냅니다. 파일은 브라우저 내부에 머무르고 민감한 값은 보고서에서 제외되지만 자동 탐지 결과는 여전히 수동 검증이 필요합니다.

## 저장소 구조

- `rules/`: 주제별 핵심 프론트엔드 규칙
- `skills/`: 규칙 적용 및 유지 관리를 위한 반복 가능한 에이전트 워크플로우
- `examples/`: 바로 사용할 수 있는 에이전트 지침 예시
- `templates/`: 일반적인 프론트엔드 작업을 위한 작성형 요청 양식
- `docs/`: 계획 및 프로젝트 문서
- `scripts/`: 외부 의존성이 없는 저장소 검증 명령
- `analysis/`: 외부 의존성이 없는 로컬 감사 대시보드 및 Markdown 보고서 생성기

## 출처 우선순위

전체 정책은 [규칙 거버넌스](rules/governance.md)에 있습니다. 요약하면 다음 순서를 사용합니다.

1. 양보할 수 없는 보안, 접근성, 개인정보 보호 및 데이터 무결성 요구사항
2. 사용자가 명시한 요구사항과 의도한 제품 동작
3. 기존 코드베이스 설정과 확립된 프로젝트 패턴
4. 사용 중인 프레임워크 및 버전에 맞는 공식 문서
5. 이 저장소의 규칙
6. 프로젝트에 아직 명시되지 않은 팀 선호

기존 패턴이라는 이유로 이미 확인된 정확성, 보안 또는 접근성 결함을 유지해서는 안 됩니다.

## 성숙도

| 영역 | 상태 | 설명 |
| --- | --- | --- |
| 거버넌스 | 사용 가능한 초안 | 우선순위, 적용 가능성, 명시적 요구 수준, 예외 및 제거 정책 추가 |
| React | 사용 가능한 초안 | 공식 참고 자료 및 에이전트 체크리스트 추가 |
| Next.js | 사용 가능한 초안 | 공식 참고 자료 및 에이전트 체크리스트 추가 |
| TypeScript | 사용 가능한 초안 | 공식 TypeScript 참고 자료 추가 |
| 폼 / 런타임 검증 | 사용 가능한 초안 | 신뢰경계, 스키마 소유권, 서버 권위, 접근 가능한 오류 및 위험 기반 테스트 추가 |
| 상태 소유권 | 사용 가능한 초안 | 서버, URL, draft, local, shared, optimistic, persisted, hydrated state 경계 추가 |
| 보안 / 개인정보 보호 | 사용 가능한 초안 | 민감정보 저장, 제3자 스크립트, CSP 및 인증 경계 지침 추가 |
| 데이터 페칭 / 캐시 | 사용 가능한 초안 | 서버-클라이언트 경계, freshness, invalidation 및 mutation 지침 추가 |
| 오류 처리 / 관측 가능성 | 사용 가능한 초안 | 실패 모델링, 복구, telemetry 및 instrumentation 지침 추가 |
| 성능 | 사용 가능한 초안 | web.dev, MDN 및 Next.js 참고 자료 추가 |
| 접근성 | 사용 가능한 초안 | WCAG 2.2 및 WAI-ARIA APG 지침 추가 |
| SEO | 사용 가능한 초안 | 인덱싱 의도, canonical, robots, sitemap, structured data 및 URL lifecycle 지침 추가 |
| 테스트 | 사용 가능한 초안 | 위험 기반 unit, component, integration 및 E2E 지침 추가 |
| 데드코드 | 사용 가능한 초안 | 근거 기반 코드, 의존성, asset, style 및 flag 제거 지침 추가 |
| 코드 리뷰 | 사용 가능한 초안 | Critical / Standards / Optimization gate 추가 |
| 감사 스킬 | 대표 시나리오 검증 초안 | 근거 기반 감사와 범위가 지정된 규칙, 스킬 및 Issue 제안 문서화 |
| 가이드 적용 | 메타데이터 게이트 및 대표 시나리오 검증 초안 | 승인 변경, 거절, 충돌, fingerprint 및 멱등 재실행 테스트 추가. 저장소 검사는 에이전트 책임 |
| 규칙 라우팅 | 사용 가능한 초안 | 거버넌스 우선 작업 및 위험 라우팅 추가 |
| 강제 수단 매핑 | 사용 가능한 초안 | compiler, lint, CI 및 수동 리뷰 경계 문서화 |
| 감사 대시보드 | 사용 가능한 초안 | 안정적인 finding ID, handoff 제한, 로컬 검사 및 Markdown 내보내기 추가 |
| 예시 | 사용 가능한 초안 | 에이전트 프롬프트, 감사, 가이드 도입 forward-test 및 프로덕션 적용 워크플로우 추가 |
| 템플릿 | 사용 가능한 초안 | 요청, 결정, 가이드 제안 및 Issue 초안 형식 추가 |

## 로드맵

- 외부 Issue 게시를 활성화하기 전에 [구현된 Issue 초안](docs/next-issue-drafts.md)을 추가 실제 저장소에서 forward-test
- 더 현실적인 좋은 예시와 나쁜 예시 추가
- 일반적인 Next.js 워크플로우를 위한 프레임워크별 예시 추가
- 심각도 레이블을 포함한 리뷰 예시 추가
- 추가 App Router 또는 mixed-router 실제 저장소에서 감사 스킬 forward-test
- 구현, 리뷰, SEO 및 데드코드 작업에서 규칙 라우팅 forward-test
- 문서화된 release gate를 충족한 후에만 다음 안정 버전 태그 생성

## 검증

커밋 전에 다음과 같이 외부 의존성이 없는 검증 명령을 실행합니다.

```bash
node scripts/validate-docs.mjs
node --check analysis/app.js
node --check analysis/analyzer.js
node --test analysis/analyzer.test.mjs
node --test scripts/guidance-approval.test.mjs
```

문서 검증 스크립트는 로컬 Markdown 링크, 해결되지 않은 TODO 표시, 필수 규칙 및 워크플로우 섹션, 스킬 frontmatter와 스킬 UI 메타데이터 참조를 확인합니다. GitHub Actions는 pull request와 `main` push에서 동일한 문서, analyzer 및 approval gate 검사를 실행합니다.

## 버전

현재 안정 버전: `v0.1.0`

`main` 브랜치에는 아직 태그가 지정된 릴리스에 포함되지 않은 가이드가 있을 수 있습니다.

## 라이선스

이 저장소는 [MIT License](LICENSE)에 따라 사용할 수 있습니다.
