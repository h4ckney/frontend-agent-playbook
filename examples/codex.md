# Codex Example

## Purpose

Copy-ready examples for using `frontend-agent-playbook` with Codex.

## Project Instruction Block

```text
Use frontend-agent-playbook for frontend work.

Read relevant files before editing. Prefer existing project patterns over new abstractions. Keep changes scoped to the request. Start with `rules/governance.md`, then use `skills/audit-frontend-rules/references/rule-routing.md` to select only task-relevant rules.

Use `rules/governance.md` to resolve conflicts and `rules/testing.md` to select risk-appropriate coverage. Run available verification commands before the final response. If relevant verification cannot run, explain why.
```

## AGENTS.md-Style Snippet

```md
# Frontend Rules

- Inspect existing implementation before changing code.
- Start with `rules/governance.md` and select the smallest task-specific subset through `skills/audit-frontend-rules/references/rule-routing.md`.
- Follow `rules/react.md` for component, state, hook, and accessibility decisions.
- Follow `rules/nextjs.md` for routing, server/client boundaries, metadata, and data fetching.
- Follow `rules/typescript.md` for type safety and API boundaries.
- Follow `rules/performance.md` for measured runtime performance risks.
- Follow `rules/bundle-dependencies.md` before changing production dependencies, client boundaries, code splitting, or bundle budgets.
- Follow `rules/accessibility.md` for semantics, keyboard interaction, focus, forms, and dynamic UI.
- Follow `rules/seo.md` for crawlability, metadata, links, and structured data.
- Follow `rules/testing.md` for unit, component, integration, and E2E coverage decisions.
- Follow `rules/dead-code.md` before deleting unused code, exports, dependencies, assets, styles, flags, or compatibility paths.
- Follow `rules/code-review.md` when reviewing or self-reviewing changes.
```

## Implementation Task

```text
Implement the requested feature. Read the relevant files first, make a scoped change, and verify with the project's available test/type/lint commands.

Use the frontend-agent-playbook checklists before finishing.
```

## Bug Fix Task

```text
Fix the bug with the smallest safe change.

Requirements:
- Reproduce or reason through the failure.
- Preserve unrelated behavior.
- Add a regression test when practical.
- Verify loading, empty, error, and success states if affected.
```

## Review Task

```text
Review the current diff using Critical / Standards / Optimization gates.

Findings should lead. Include severity, impact, and a concrete fix. Avoid style-only comments unless they affect correctness, consistency, or maintainability.

Use `examples/version-aware-review.md` when the finding depends on the Next.js router, React RSC support, TypeScript feature version, or Hooks ESLint configuration.
```
