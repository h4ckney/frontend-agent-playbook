# frontend-agent-playbook

[![Validate](https://github.com/h4ckney/frontend-agent-playbook/actions/workflows/validate.yml/badge.svg)](https://github.com/h4ckney/frontend-agent-playbook/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Production-grade frontend playbook for Claude Code, Codex, and other AI coding agents.

This repository defines practical rules, skills, examples, and templates for React, Next.js, TypeScript, security, privacy, data fetching, caching, error handling, observability, accessibility, SEO, performance, testing, dead-code removal, and code review workflows.

![Frontend Audit dashboard showing evidence levels, urgent recommendations, and risk areas](assets/audit-dashboard.png)

## Why Not Just Another Rules List?

- **Audit before adoption**: inspect the codebase, versions, router, rendering model, existing instructions, and evidence before selecting guidance.
- **Approval-gated changes**: proposals, file-level approval, application, and external Issue publication remain separate boundaries.
- **Version-aware frontend decisions**: distinguish Pages Router from App Router, RSC from non-RSC React, and compiler-supported TypeScript features.

## Quick Start

Vendor the tagged playbook without activating every rule:

```bash
npx degit h4ckney/frontend-agent-playbook#v0.1.0 .agents/vendor/frontend-agent-playbook
```

Add the smallest entry point to the target repository's `AGENTS.md`:

```markdown
## Frontend Agent Guidance

- Start with `.agents/vendor/frontend-agent-playbook/rules/governance.md`.
- Use `.agents/vendor/frontend-agent-playbook/skills/audit-frontend-rules/references/rule-routing.md` to select only task-relevant rules.
- Reinspect the installed framework, router, rendering model, TypeScript version, lint, tests, and local instructions before applying guidance.
- Keep project instructions and version-matched official documentation above the vendored playbook.
- Do not create project rules, skills, enforcement, or external Issues before explicit scoped approval.
```

This copies the playbook as reference material. It does not make every vendored rule active and does not replace project-specific instructions.

## What This Is

`frontend-agent-playbook` is a frontend operating playbook for AI coding agents working on production applications.

It is designed to reduce vague AI-generated code and push agents toward senior frontend engineer behavior: reading existing code first, following project conventions, handling real UI states, preserving accessibility, and verifying changes before completion.

## How To Use

Reference the relevant playbook files from project instructions, agent memory, `AGENTS.md`, Claude Code instructions, or a Codex task prompt. Do not inject every rule by default.

Always start with [Rule governance](rules/governance.md), then use [Rule routing](skills/audit-frontend-rules/references/rule-routing.md) to select the smallest task-specific subset.

Available rules:

- [React rules](rules/react.md)
- [Next.js rules](rules/nextjs.md)
- [TypeScript rules](rules/typescript.md)
- [Security and privacy rules](rules/security-privacy.md)
- [Data fetching and cache rules](rules/data-fetching-cache.md)
- [Error handling and observability rules](rules/error-handling-observability.md)
- [Performance rules](rules/performance.md)
- [Accessibility rules](rules/accessibility.md)
- [SEO rules](rules/seo.md)
- [Testing rules](rules/testing.md)
- [Dead-code removal rules](rules/dead-code.md)
- [Code review rules](rules/code-review.md)
- [Enforcement mapping](docs/enforcement-mapping.md)

Then use the examples and templates:

- [Claude example](examples/claude.md)
- [Codex example](examples/codex.md)
- [Version-aware review examples](examples/version-aware-review.md)
- [Pages Router production audit](examples/audits/pages-router-production.md)
- [App Router representative audit](examples/audits/app-router-representative.md)
- [Guidance adoption forward-test](examples/adoption/forward-test.md)
- [Production application workflow](examples/production-application/feature-workflow.md)
- [Feature implementation template](templates/feature-implementation.md)
- [Refactor request template](templates/refactor-request.md)
- [Bug fix template](templates/bug-fix.md)
- [Frontend rules decisions template](templates/frontend-rules-decisions.md)
- [Guidance proposal template](templates/guidance-proposal.md)
- [Audit issue draft template](templates/audit-issue.md)

For an existing codebase, use the [Audit Frontend Rules skill](skills/audit-frontend-rules/SKILL.md) to identify conflicts, exceptions, security and privacy risks, data and cache risks, error-handling gaps, removal candidates, and testing gaps before adopting the full rule set.

After an owner approves named proposal IDs, use [Apply Frontend Guidance](skills/apply-frontend-guidance/SKILL.md) to create only the approved project rules or skills, validate them, and persist the applied decision. Project guidance remains unapplied and issue drafts remain unpublished until separately approved.
The dependency-free [guidance approval gate](scripts/guidance-approval.mjs) compares supplied approval metadata for repository identity, proposal status, material scope, exact target paths, dependencies, enforcement, content fingerprints, conflicts, and idempotent reruns before application. It does not inspect repository ownership or compute target-file fingerprints; the applying agent must gather and verify those inputs.
Dashboard Markdown exports include stable finding IDs and an Audit Handoff table. Carry those IDs into proposals and Issue drafts for traceability, but do not treat them as defect proof or write approval.

For a quick local scan, open the [Frontend Audit dashboard](analysis/index.html) and select a project folder. It separates observed facts, risk inferences, information gaps, and removal candidates, then exports the result as Markdown. Files remain in the browser, sensitive values are excluded from reports, and automated findings still require manual verification.

## Repository Structure

- `rules/`: Core frontend rules by topic
- `skills/`: Repeatable agent workflows for applying and maintaining rules
- `examples/`: Copy-ready agent instruction examples
- `templates/`: Fillable request forms for common frontend work
- `docs/`: Planning and project documentation
- `scripts/`: Dependency-free repository validation commands
- `analysis/`: Dependency-free local audit dashboard and Markdown report generator

## Source Priorities

The complete policy lives in [Rule Governance](rules/governance.md). In summary, use this order:

1. Non-negotiable security, accessibility, privacy, and data-integrity requirements
2. Explicit user requirements and intended product behavior
3. Existing codebase configuration and established patterns
4. Official documentation for the framework and version in use
5. Rules in this repository
6. Team preferences not already encoded in the project

Existing patterns do not justify preserving known correctness, security, or accessibility defects.

## Maturity Status

| Area | Status | Notes |
| --- | --- | --- |
| Governance | Usable draft | Precedence, applicability, explicit requirement levels, exceptions, and removal policy added |
| React | Usable draft | Official references and agent checklist added |
| Next.js | Usable draft | Official references and agent checklist added |
| TypeScript | Usable draft | Official TypeScript references added |
| Security / Privacy | Usable draft | Sensitive storage, third-party script, CSP, and auth-boundary guidance added |
| Data Fetching / Cache | Usable draft | Server-client boundary, freshness, invalidation, and mutation guidance added |
| Error Handling / Observability | Usable draft | Failure modeling, recovery, telemetry, and instrumentation guidance added |
| Performance | Usable draft | web.dev, MDN, and Next.js references added |
| Accessibility | Usable draft | WCAG 2.2 and WAI-ARIA APG guidance added |
| SEO | Usable draft | Indexing intent, canonical, robots, sitemap, structured data, and URL lifecycle guidance added |
| Testing | Usable draft | Risk-based unit, component, integration, and E2E guidance added |
| Dead Code | Usable draft | Evidence-based code, dependency, asset, style, and flag removal guidance added |
| Code Review | Usable draft | Critical / Standards / Optimization gates added |
| Audit Skill | Representative-tested draft | Evidence-based audits plus scoped rule, skill, and issue proposals are documented |
| Guidance Application | Metadata-gated and representative-tested draft | Approval drift, rejection, conflict, fingerprint, and idempotent rerun tests added; repository inspection remains agent-owned |
| Rule Routing | Usable draft | Governance-first task and risk routing added |
| Enforcement Mapping | Usable draft | Compiler, lint, CI, and manual-review boundaries documented |
| Audit Dashboard | Usable draft | Stable finding IDs, handoff limitations, local scan, and Markdown export added |
| Examples | Usable draft | Agent prompts, audits, guidance adoption forward-test, and production application workflow added |
| Templates | Usable draft | Request, decision, guidance proposal, and issue draft formats added |

## Roadmap

- Forward-test the [implemented issue drafts](docs/next-issue-drafts.md) against an additional live repository before enabling external Issue publication.
- Add more realistic good and bad examples.
- Add framework-specific examples for common Next.js workflows.
- Add review examples with severity labels.
- Forward-test the audit skill against an additional live App Router or mixed-router repository.
- Forward-test rule routing against implementation, review, SEO, and dead-code tasks.
- Add version tags after the GitHub repository structure stabilizes.

## Validation

Run the dependency-free validation commands before committing changes:

```bash
node scripts/validate-docs.mjs
node --check analysis/app.js
node --check analysis/analyzer.js
node --test analysis/analyzer.test.mjs
node --test scripts/guidance-approval.test.mjs
```

The documentation script checks local Markdown links, unresolved TODO markers, required rule and workflow sections, skill frontmatter, and skill UI metadata references. GitHub Actions runs the same documentation, analyzer, and approval-gate checks for pull requests and pushes to `main`.

## Version

Current version: `v0.1.0`

## License

This repository is available under the [MIT License](LICENSE).
