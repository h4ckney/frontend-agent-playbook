# Rule Routing

Use this reference after the initial repository inspection. Load governance first, then only the rule files justified by the task and observed risks.

## Context Probe

Record before selecting rules:

- Framework, installed version, route model, and affected route tree
- React version and confirmed RSC, SSR, or client-rendering model
- TypeScript version and relevant compiler options
- Existing ESLint, test, CI, cache, state, and observability tools
- Task type, affected user journey, and indexing intent
- Security, accessibility, data-integrity, or destructive-action boundaries

Do not infer App Router, RSC, TypeScript features, or lint enforcement from a major version alone.

## Loading Tiers

### Tier 0: Always

- `rules/governance.md`

### Tier 1: Task Core

Choose the smallest useful set, normally two to four files.

| Task signal | Load |
| --- | --- |
| React component or hook | `react.md`, `typescript.md` |
| Next.js route, layout, or rendering | `nextjs.md`, then the matching App or Pages sections |
| Form, schema, or runtime input boundary | `forms-runtime-validation.md`, `typescript.md` |
| Shared state, store, provider, URL synchronization, persistence, or hydration | `state-ownership.md`, `react.md` |
| Remote read, mutation, cache, or optimistic UI | `data-fetching-cache.md`, `error-handling-observability.md` |
| Bug fix or regression | `testing.md`, plus the domain rule for the failure |
| Code review | `code-review.md`, plus rules for the changed surface |
| Type boundary or compiler change | `typescript.md` |

### Tier 2: Risk Triggered

Load only when the trigger is present.

| Trigger | Load |
| --- | --- |
| Auth, storage, HTML insertion, third-party script, payment, or personal data | `security-privacy.md` |
| Keyboard, form, focus, custom widget, media, or semantic UI | `accessibility.md` |
| User-controlled URL, storage, network, cross-window, or third-party payload | `forms-runtime-validation.md` |
| The same entity or workflow value appears in a query cache, URL, form, store, or browser persistence | `state-ownership.md` |
| Indexable URL, metadata, canonical, redirect, robots, sitemap, or structured data | `seo.md` |
| Measured slowdown, bundle change, image/font/script addition, or performance acceptance criterion | `performance.md` |
| Removal, unused dependency, expired flag, or cleanup request | `dead-code.md` |
| Critical workflow or missing regression coverage | `testing.md` |

### Tier 3: Evidence References

Open official version-matched documentation and repository-specific instructions only for claims that depend on them. Do not load every external reference listed by a rule file.

## Route And Rendering Decisions

- Pages Router only: disable App Router file conventions, Server Component boundaries, Server Actions, and App Router metadata APIs.
- App Router: confirm the affected route tree before applying RSC defaults or Client Component guidance.
- Mixed router: classify each finding by route tree. Do not issue repository-wide router conclusions from one route.
- SSR without RSC: apply server-rendering evidence but do not introduce RSC directives or serialization constraints.
- React without a framework-managed RSC integration: disable RSC implementation guidance.

## Exclusions

- Do not load SEO rules for private or internal routes unless indexing controls are part of the task.
- Do not load performance rules for every component edit; require a changed cost, measurement, or explicit risk.
- Do not load forms and runtime validation rules for every internal typed object; require a form task or an untrusted runtime boundary.
- Do not load state ownership rules for every local state edit; require sharing, synchronization, persistence, hydration, duplication, or lifecycle risk.
- Do not load dead-code rules for ordinary refactoring unless removal is in scope.
- Do not load a new test tier solely because testing guidance exists.
- Do not load every rule to produce a general review. Start from changed files and demonstrated risk.

## Selection Record

Include a compact record in the audit:

```markdown
## Selected Guidance
- Always: governance
- Loaded: react, testing, security-privacy
- Conditional: nextjs Pages Router sections
- Excluded: App Router/RSC, SEO, performance, dead code
- Evidence: package.json, pages route tree, ESLint config, changed auth form
```

Explain material exclusions, especially when a user might expect a rule to apply.
