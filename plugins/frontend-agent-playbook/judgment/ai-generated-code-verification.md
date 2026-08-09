# AI-Generated Code Verification

Status: Pilot draft. Representative use and outcome tracking are still required.

## Purpose

Retain engineering ownership when an AI coding agent plans, writes, reviews, or refactors frontend code. Fast generation is useful only when the resulting system remains explainable, verifiable, and recoverable by its human owners.

Use [Code Review Rules](../rules/code-review.md), [Testing Rules](../rules/testing.md), and [Rule Governance](../rules/governance.md) as supporting constraints.

## Before Delegation

Define the smallest useful contract:

1. User or system outcome
2. Current entry point and affected path
3. Invariants that must remain true
4. Trust, state, runtime, and failure boundaries
5. Allowed scope and actions that require separate approval
6. Evidence required before accepting the result

Increase the required explanation and verification when blast radius, irreversibility, uncertainty, or production impact grows.

## What The Agent May Own

The agent may inspect the repository, trace code paths, propose alternatives, implement approved changes, run checks, and summarize evidence within the granted scope.

The agent must not silently expand product behavior, migration scope, dependencies, enforcement, external publication, release authority, or destructive actions.

## What The Engineer Must Retain

Before accepting a material change, the engineer should be able to answer:

1. Why the change is needed
2. Which entry point, data flow, state owner, and side effects it changes
3. Which assumptions are observed and which remain inferred
4. How the change can fail for users or operators
5. Which checks demonstrate the intended behavior and important negative paths
6. How to investigate and recover if production behavior differs

This is an ownership handoff, not a claim that reading a summary guarantees understanding.

## Verification Loop

1. Compare the proposed behavior with the request and current project conventions.
2. Inspect the final diff, not only the agent summary.
3. Trace one representative success path and one relevant failure or empty path.
4. Confirm version, router, rendering, state, data, and trust-boundary assumptions against repository evidence.
5. Run checks proportional to the actual risk and report checks that were not run.
6. Challenge the change with a counterexample that could expose hidden coupling or over-generalization.
7. Separate implementation completion from release readiness and measured outcome.

## Rejection Signals

Reject or revise the change when:

- It uses generic best practice to override a valid project decision without evidence.
- It adds abstraction, dependency, state, caching, or a test tier without a demonstrated problem.
- It reports a static pattern as a confirmed runtime defect.
- It cannot explain the authoritative data or state owner.
- Its tests assert implementation details while missing the user-visible invariant.
- It weakens loading, empty, error, accessibility, observability, or rollback behavior.
- It changes more than the approved scope or hides unresolved work in an unrelated refactor.

## Maintain, Improve, Propose, Reject

- **Maintain**: preserve existing patterns that are correct, understood, and appropriately verified.
- **Improve**: correct a demonstrated problem within the approved task and validate the affected path.
- **Propose**: record out-of-scope risk with evidence, impact, and completion criteria; do not implement or publish it without approval.
- **Reject**: do not accept a change whose assumptions, scope, causal model, or verification remain materially unsupported.

AI output should not create work merely because a possible improvement can be named.

## Counterexamples

- All tests pass, but the generated code duplicates server state in a global store. Passing tests do not establish correct ownership.
- A framework recommendation is current, but the repository uses an older router or compiler. Current documentation does not make the recommendation applicable.
- The diff is small, but it changes authorization, payment, or destructive behavior. Line count does not make the change low risk.
- The code is correct, but nobody can identify its failure signal or recovery path. Implementation may be complete while ownership transfer remains incomplete.

## Handoff

Report the problem, system path, decision, changed files, evidence, checks, unverified gaps, rollback or recovery path, and first investigation point. Preserve stable finding or proposal IDs when the work originated from an audit.
