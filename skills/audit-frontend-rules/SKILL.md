---
name: audit-frontend-rules
description: Audit a frontend codebase against a routed subset of current guidance, identify material risks and gaps, propose project-specific rules, skills, enforcement changes, or follow-up issue drafts behind an explicit approval gate, and persist approved applicability decisions. Use when adopting or reviewing frontend AI instructions, selecting applicable rules, maintaining .frontend-rules-decisions.md, recommending reusable project guidance, or deciding whether guidance should be kept, changed, disabled, removed, or created.
---

# Audit Frontend Rules

Audit shared guidance against project evidence before recommending that it be applied, changed, disabled, or removed. Always read `../../rules/governance.md` when available. Read [Rule Routing](references/rule-routing.md) after the initial context probe and load only the rule subset justified by the task and observed risk.

## Workflow

1. Inspect the repository structure, package manager, framework versions, route trees, rendering model, configuration, scripts, test setup, CI, and local agent instructions.
2. Read `.frontend-rules-decisions.md` when present. Treat its entries as project evidence, verify their scope and recheck triggers, and do not assume stale decisions remain valid.
3. Use [Rule Routing](references/rule-routing.md) to select governance plus the smallest applicable rule subset. Record loaded, conditional, and excluded guidance.
4. Inventory applicable rule and skill files. Record duplicated guidance and their precedence.
5. Compare selected guidance with current code patterns, product requirements, persisted decisions, official version-matched documentation, and measured behavior.
6. Classify each relevant item as Keep, Conditional, Disable, or Removal candidate.
7. Identify contradictions, obsolete APIs, unjustified absolutes, duplicate instructions, and changes that would introduce disproportionate complexity.
8. Assess only risk domains supported by the task or repository evidence. Load their rule files on demand.
9. Assess unit, component, integration, and E2E gaps according to risk and the existing toolchain.
10. Recommend zero to three urgent changes. Do not fill the list when fewer issues are urgent.
11. Propose zero or more guidance artifacts using `../../templates/guidance-proposal.md`. Include `No artifact needed` when an existing rule or direct fix is sufficient.
12. Draft follow-up issues only for accepted or explicitly requested work using `../../templates/audit-issue.md` when available. Do not publish them.
13. Propose decision-file additions, updates, or removals using `../../templates/frontend-rules-decisions.md`. Write them only when the user requested persistence or approved repository changes.

## Guidance Proposals

- Prefer existing project instructions, existing playbook guidance, or a direct code fix before proposing a new artifact.
- Propose a project rule only for a reusable constraint, repeated defect class, stable architecture boundary, or explicit team decision.
- Propose a project skill only for a repeatable multi-step workflow that benefits from specialized procedure, tools, validation, or references.
- Propose an enforcement change only when the existing toolchain can reliably enforce the behavior and false-positive risk is understood.
- Give every finding and proposal a stable ID. Carry source finding IDs into proposals and Issue drafts.
- Give every proposal an evidence status, exact target files, intended scope, simpler alternative, over-engineering risk, and verification.
- End every proposal with Approve, Revise, Defer, or Reject. A proposal is not approval.
- Do not write target guidance, install tools, change enforcement, or publish issues during the proposal phase.
- When no reusable artifact is justified, say `No artifact needed` and explain the sufficient direct action.

## Issue Drafting

- Draft an issue only for accepted or explicitly requested follow-up work that should outlive the current task.
- Prefer an immediate direct fix when the work is already approved, scoped, and feasible in the current task.
- Group findings that share one root cause; keep unrelated security, testing, SEO, dead-code, and migration work separate.
- Write information gaps as investigation work, not confirmed defects.
- Keep removal candidates conditional on reachability, ownership, and side-effect verification.
- Include testable acceptance criteria, verification, dependencies, and suggested labels without assuming those labels exist.
- Preserve source finding IDs so grouped Issue drafts remain traceable to the audit evidence.
- Keep drafts local and redact secrets, personal data, private payloads, environment values, and unnecessary source excerpts.
- Do not publish issues, create labels, assign owners, or set milestones during an audit.

## Persisted Decisions

- Persist material applicability, exception, and owner decisions; do not copy every reviewed rule.
- Verify the recorded commit, scope, evidence status, and recheck trigger before reusing a decision.
- Prefer updating one stable decision ID over adding contradictory active rows.
- Record information gaps instead of converting missing evidence into no finding.
- Keep secrets, personal data, private payloads, and unnecessary source excerpts out of the file.
- Treat version control as decision history; keep the active file current.
- Do not let a persisted decision override higher-precedence governance requirements.

## Progressive Rule Loading

- Load governance first.
- Load two to four task-core rules in the normal case.
- Load forms and runtime validation, state ownership, security, accessibility, SEO, performance, testing, and dead-code rules only when their triggers are present.
- For mixed-router repositories, route findings by affected tree instead of loading one router model globally.
- Open only official references required to support a version-sensitive conclusion.
- Expand the subset when evidence reveals a new material risk; record why it was added.

## Framework Version Checks

- Identify the installed Next.js version and classify each affected route tree as App Router, Pages Router, or mixed before applying router guidance.
- Identify the React version and framework-managed RSC integration. Distinguish RSC, SSR, and client rendering instead of inferring support from React semver alone.
- Map required TypeScript syntax and inference features to the installed compiler version. Recommend a compatible upgrade before proposing complex workarounds for missing literal-preserving features.
- Inspect React Hooks ESLint configuration. Do not report Effect dependency preferences as findings without an enabled rule or demonstrated synchronization bug.

## Evidence Rules

- Cite files, configuration, tests, commands, or official documentation for material conclusions.
- Assign stable category-based finding IDs that do not depend on file counts, line numbers, secret values, or source excerpts.
- Distinguish observed facts from inferences.
- Explain the affected scope and exception for every Conditional or Disable decision.
- Mark deletion candidates; do not delete or disable shared rules or skills without explicit approval.
- Prefer a project-specific exception over weakening a generally useful shared rule.
- Do not propose a new library, abstraction, or test tier without identifying the risk it addresses.

## Testing Assessment

- Map pure logic and state transitions to unit-test opportunities.
- Map component interaction, forms, accessibility, and async UI states to component or integration tests.
- Map routing, authentication, permissions, destructive actions, and critical multi-step journeys to E2E tests.
- Identify flaky selectors, fixed sleeps, uncontrolled data, oversized snapshots, and implementation-detail assertions.
- Prefer the narrowest reliable regression test and the project's existing tools.

## Forms And Runtime Validation Assessment

- Identify user, network, URL, storage, third-party, and cross-window inputs that cross a runtime trust boundary.
- Distinguish client feedback from server-authoritative validation, authorization, and business invariants.
- Inspect the existing form and schema stack, type inference, coercion, error ownership, value preservation, and accessible recovery before proposing a new dependency.
- Use `../../rules/forms-runtime-validation.md` when available and report material boundary, validation, or form-recovery problems as Forms Or Runtime Validation Risks.

## State Ownership Assessment

- Classify material values as server, URL, form or draft, local UI, shared client, optimistic, or persisted state and identify their authoritative owners.
- Inspect duplicate server entities or workflow values across query caches, stores, Context, URL state, forms, and browser persistence.
- Check provider and store scope, reset triggers, draft preservation, optimistic rollback, account boundaries, and SSR or RSC hydration behavior.
- Use `../../rules/state-ownership.md` when available and report material duplication, synchronization, lifetime, persistence, or hydration problems as State Ownership Risks.

## Accessibility Assessment

- Inspect semantics, accessible names, keyboard operation, visible focus, form errors, dynamic state, and custom widget behavior in affected workflows.
- Use the project's accessibility target and `../../rules/accessibility.md` when available; do not infer legal compliance from generic rules.
- Treat automated checks as partial evidence and identify manual keyboard, focus, or assistive-technology verification that remains.
- Classify demonstrated accessibility regressions by user impact. Use Critical only when a regression blocks critical content or functionality, traps interaction, creates a serious safety risk, or has equivalent material impact.

## Security And Privacy Assessment

- Inspect auth state handling, browser storage, URL state, logs, analytics, embeds, cross-window messaging, and trusted-content boundaries.
- Use `../../rules/security-privacy.md` when available and distinguish frontend mitigations from backend authorization or deployment controls.
- Report sensitive storage misuse, leaked identifiers, unsafe HTML injection, excessive third-party data exposure, and CSP-sensitive changes as Security Or Privacy Risks.

## Data Fetching And Cache Assessment

- Identify the active server and client data model before evaluating cache or refetch behavior.
- Check where reads happen, how freshness is defined, how mutations invalidate dependent views, and whether request waterfalls or duplicate caches exist.
- Use `../../rules/data-fetching-cache.md` when available and report stale-state, invalidation, and ownership problems as Data Fetching Or Cache Risks.

## Error Handling And Observability Assessment

- Inspect loading, empty, validation, error, retry, and terminal-failure states in important workflows.
- Check logger, telemetry, tracing, boundary, and instrumentation paths already present in the project before recommending new tooling.
- Use `../../rules/error-handling-observability.md` when available and report swallowed failures, poor recovery, missing diagnostics, and privacy-unsafe logging as Error Handling Or Observability Risks.

## SEO Assessment

- Classify affected URLs by indexing intent and environment before reviewing metadata or crawl behavior.
- Check rendered content, status codes, internal links, canonical, robots directives, sitemap membership, structured data, and URL move or removal behavior.
- Use `../../rules/seo.md` when available and distinguish verified output from external indexing, ranking, or rich-result outcomes.
- Report conflicting signals and production-versus-preview configuration risks as SEO Risks.

## Dead Code Assessment

- Use compiler, linter, bundler, dependency, and coverage output to find candidates, then confirm them with repository and configuration search.
- Check dynamic imports, framework conventions, public exports, generated code, tests, stories, plugin registries, feature flags, compatibility policy, and module side effects.
- Use `../../rules/dead-code.md` when available. Treat incomplete evidence as a candidate, not authorization to delete.
- Recommend the smallest coherent removal and list required type, lint, test, build, route, bundle, and lockfile verification.

## Report Format

Always use these core sections:

```markdown
## Codebase Context
## Selected Guidance
## Evidence Status
## Existing Rules and Skills
## Conflicts
## Applicability Decisions
## Over-engineering Risks
## Removal Candidates
## Testing Gaps
## Urgent Recommendations
## Guidance Proposals
## Issue Drafts
## Proposed Changes
```

Add Forms Or Runtime Validation Risks, State Ownership Risks, Security Or Privacy Risks, Data Fetching Or Cache Risks, Error Handling Or Observability Risks, SEO Risks, Dead Code Candidates, Performance Risks, or Accessibility Risks only when that domain was selected or the user requested a full matrix. Record unselected domains under Selected Guidance; do not describe an unassessed domain as having no finding.

For each urgent recommendation, include evidence, impact, the smallest practical change, and verification. State explicitly when no urgent recommendation or removal candidate exists.

Issue Drafts may be omitted when no follow-up work was accepted or requested. Guidance Proposals must still state when no new artifact is justified.
