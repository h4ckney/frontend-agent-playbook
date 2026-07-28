# Claude Example

## Purpose

Copy-ready examples for using `frontend-agent-playbook` with Claude Code.

## Project Instructions

```text
Follow the frontend-agent-playbook repository when working on frontend code.

Priority order:
1. Non-negotiable security, accessibility, privacy, and data-integrity requirements
2. Explicit user requirements and intended product behavior
3. Existing codebase configuration and established patterns
4. Version-matched official documentation
5. frontend-agent-playbook documents

Before editing:
- Inspect the relevant files.
- Identify the framework patterns already used.
- Start with `rules/governance.md`, then use `skills/audit-frontend-rules/references/rule-routing.md` to load only task-relevant rules.
- State assumptions only when they affect implementation choices.

When implementing:
- Make the smallest production-ready change.
- Handle loading, empty, error, and success states when user-visible.
- Preserve accessibility and semantic HTML.
- Apply `rules/accessibility.md` when changing interactions, focus, forms, dialogs, or dynamic UI.
- Keep TypeScript types precise at API and component boundaries.
- Avoid broad rewrites unless explicitly requested.
- Apply testing rules according to risk instead of requiring every test tier.
- Treat unused-code findings as candidates until dynamic, public, generated, framework, and side-effect entry points are checked.

Before finishing:
- Run available tests, type checks, lint, or explain why they were not run.
- Summarize changed files and verification.
```

## Feature Implementation Prompt

```text
Implement this frontend feature using the repository's frontend-agent-playbook.

Goal:
[Describe user-facing behavior]

Scope:
[Routes/components/files]

Requirements:
- Loading state:
- Empty state:
- Error state:
- Success state:
- Accessibility:
- Performance:

Verification:
[Tests, type checks, lint, manual checks]
```

## Refactor Prompt

```text
Refactor this frontend area without changing user-visible behavior.

Current problem:
[Duplication, unclear state, type issue, performance risk]

Constraints:
- Preserve existing behavior.
- Follow existing project conventions.
- Avoid unrelated rewrites.
- Add or update tests only where behavior needs protection.

Verification:
[Commands or manual regression checks]
```

## Code Review Prompt

```text
Review this frontend change using Critical / Standards / Optimization gates.

Prioritize:
1. User-visible correctness
2. Accessibility
3. Type safety and API boundaries
4. State and data flow
5. Performance and SEO risks
6. Maintainability

Return findings first, ordered by severity. Include file/line evidence when available.
```
