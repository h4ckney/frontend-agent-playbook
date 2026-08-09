# Debugging And Root Cause

Status: Pilot draft. Representative use and outcome tracking are still required.

## Purpose

Move from a reported frontend symptom to a verified failure boundary and the smallest coherent correction. The objective is not merely to make the current symptom disappear; it is to understand why the system produced it and how recurrence will be detected.

Use [Testing Rules](../rules/testing.md), [Error Handling And Observability Rules](../rules/error-handling-observability.md), and the affected domain rule only after the failure path is known.

## Trigger

Use this model for a reproducible bug, intermittent production failure, regression, incorrect state transition, hydration mismatch, stale data, or unexplained user-facing error.

Route an active incident to containment and recovery first. Preserve diagnostic evidence before broad cleanup or refactoring.

## System Model

Trace one failing path:

```text
entry point
  -> input and trusted source
  -> state owner and transition
  -> data flow and transformation
  -> side effect or external dependency
  -> rendering or response boundary
  -> observed failure
```

Also identify where the expected invariant should have been enforced and where the failure became observable.

## Evidence

Record:

1. Exact reproduction steps, expected behavior, and observed behavior
2. Affected versions, route tree, rendering model, account or data conditions, and frequency
3. The last known good state or change when available
4. Logs, traces, network responses, state transitions, or tests that narrow the path
5. Negative evidence that rules out plausible alternatives

Do not turn correlation, a recent diff, or one suspicious line into a root-cause claim without a causal path.

## Boundary-Narrowing Process

1. Make the failure reproducible or define the smallest observable production signal.
2. Reduce the scenario while preserving the failure.
3. Find the earliest point where actual state diverges from expected state.
4. Trace the authoritative value backward to its input, owner, and previous transition.
5. Check asynchronous boundaries, cache invalidation, lifecycle resets, retries, authorization, and stale closures only when the path crosses them.
6. State a causal hypothesis and design the cheapest check that could disprove it.
7. Confirm the cause by changing, isolating, or instrumenting that boundary.

## Root-Cause Acceptance

A root cause is strong enough to act on when it explains:

- Why the failure occurs under the observed conditions
- Why it does not occur under the relevant counterexample
- Where the violated invariant should be enforced
- Why the proposed change prevents recurrence without moving the failure elsewhere

When evidence only supports containment, label the fix as containment and keep the unresolved cause visible.

## Fix Selection

- Fix the narrowest authoritative boundary, not every downstream symptom.
- Avoid broad refactoring while the failure mechanism remains uncertain.
- Preserve user recovery, diagnostics, and rollback paths.
- Add the narrowest reliable regression test at the boundary that failed.
- Create a follow-up issue when the verified cause requires work outside the approved scope; include evidence and a completion condition.

## Counterexamples

- A retry hides an intermittent request failure but the request remains duplicated. This is containment, not root-cause resolution.
- Resetting a store fixes one screen but the same server entity is still owned by two caches. The ownership conflict remains.
- Adding an Effect dependency removes stale data but creates a loop because synchronization ownership is still undefined. The dependency list was not the root decision.
- A test passes after a timing delay is increased. The failure boundary remains unknown.

## AI Control

An AI agent may search history, compare paths, add temporary diagnostics, produce hypotheses, and implement an approved fix. The engineer should retain a concise model of the entry point, authoritative state, side effects, violated invariant, and recovery path.

Reject a patch that cannot explain its causal mechanism even when the local test passes.

## Verification And Handoff

Verify the original reproduction, the closest negative case, and the most plausible regression boundary. Report where investigation should begin if the failure returns and which assumption remains least certain.
