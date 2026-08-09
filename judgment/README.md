# Frontend Judgment Models

## Purpose

This directory captures reusable ways to reason about frontend systems while working with AI coding agents. Official framework documentation remains an input. The durable asset is the decision process used to interpret evidence, narrow uncertainty, choose a proportional action, and retain operational ownership.

The playbook does not attempt to mirror every React, Next.js, TypeScript, browser, or tooling recommendation. Searchable reference knowledge belongs in official documentation or a narrow adapter rule.

## Boundary

- Product and delivery governance answers what should be built, why it matters, and how the outcome will be measured.
- Frontend judgment models answer how to understand, diagnose, change, verify, and operate a web system without losing control of it.
- Framework and domain rules provide constraints only after the relevant judgment model and project context are known.
- The analyzer gathers bounded static evidence. It does not replace repository inspection, runtime verification, or an accountable engineering decision.

## Admission Gate

Add a core judgment model only when it satisfies at least one of these conditions:

1. It was learned from a real production failure or recovery.
2. It addresses a decision that was repeatedly wrong or expensive.
3. It covers an area where AI-generated changes commonly miss context or overstate certainty.
4. It preserves a mental model needed during an incident or difficult investigation.
5. It has been useful across more than one project or team context.

An untested idea may be recorded as a hypothesis, but it must not be presented as a validated rule.

## Document Contract

Each judgment model should contain only the sections that help make a decision, normally:

1. Trigger and user or system symptom
2. System model and relevant boundaries
3. Evidence to collect
4. Decision process
5. Counterexamples and stopping conditions
6. Verification and ownership handoff

Prefer one concrete failure path and one counterexample over a long list of generic best practices.

## Decision Axes

Keep two different decisions separate:

- **Engineering action**: Maintain the current implementation, Improve it within scope, Propose evidence-backed follow-up work, or Reject an unsupported change.
- **Guidance applicability**: Keep, make Conditional, Disable, or mark a rule or skill as a Removal candidate for the inspected repository.

An implementation can be maintained while one generic rule is disabled, or improved while the supporting guidance remains conditional. Do not translate one axis into the other automatically.

## Initial Models

- [Performance Diagnosis](performance-diagnosis.md)
- [Debugging And Root Cause](debugging-root-cause.md)
- [AI-Generated Code Verification](ai-generated-code-verification.md)

These are pilot drafts. Their value must be tested on real work before the rest of the repository is reorganized around them.

## Existing Guidance Transition

No existing rule is deleted in this phase. Use this map to guide later consolidation.

| Existing guidance | Intended role | Current decision |
| --- | --- | --- |
| `governance.md` | Shared precedence, applicability, and admission constraints | Keep as the mandatory entry point |
| `performance.md` | Measurable web-performance constraints and references | Keep; use after Performance Diagnosis selects a boundary |
| `state-ownership.md` and `data-fetching-cache.md` | State and data-flow constraints | Keep; candidate inputs for a future state-and-data-flow model |
| `error-handling-observability.md` | Failure recovery and operational evidence | Keep; candidate input for a future production-control model |
| `testing.md`, `code-review.md`, and `dead-code.md` | Verification and evidence constraints | Keep; load when selected by a judgment model or task risk |
| `security-privacy.md` and `forms-runtime-validation.md` | Trust-boundary constraints | Keep as risk-triggered domain guidance |
| `react.md`, `nextjs.md`, and `typescript.md` | Version-aware implementation adapters | Keep, but do not treat as the product's core differentiation |
| `accessibility.md`, `seo.md`, `i18n.md`, and `design-system-styling.md` | Product-domain constraints | Keep on demand; do not load for unrelated work |
| `bundle-dependencies.md` | Shipped-cost and reversibility constraints | Keep; pair with measured performance or architecture evidence |

Remove, merge, or relocate a document only after representative use shows that the replacement preserves its necessary constraints.
