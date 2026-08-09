# Performance Diagnosis

Status: Pilot draft. Representative use and outcome tracking are still required.

## Purpose

Determine why a user-visible frontend workflow is slow before selecting an optimization. This model is for measured symptoms or credible regression reports, not routine component edits.

Use [Performance Rules](../rules/performance.md) and [Bundle And Dependency Rules](../rules/bundle-dependencies.md) only after evidence identifies a relevant boundary.

## Trigger

Start when at least one signal exists:

- A user-visible interaction, navigation, or render is measurably slow.
- A production metric, trace, bundle report, or controlled comparison regressed.
- A change adds a credible cost to a critical route, device class, or runtime.

Do not start with “optimize this component” when the affected user action and baseline are unknown.

## System Model

Decompose the elapsed time before changing code:

```text
user action
  -> network and connection
  -> server, edge, cache, and data dependencies
  -> document or route response
  -> browser parsing, style, layout, and paint
  -> JavaScript download, parse, execution, and scheduling
  -> framework rendering and hydration
  -> next usable state
```

The categories can overlap. The goal is to find the boundary that explains the symptom, not to assign every millisecond perfectly.

## Evidence

Record:

1. The user action, route, expected state, and device or network assumptions
2. A reproducible baseline and measurement source
3. The largest observed delay and the boundary that owns it
4. Existing budgets, caching behavior, monitoring, and known variance
5. What remains unknown or cannot be reproduced locally

Classify claims as observed, estimated, or unknown. Static source patterns may suggest a cost but do not prove a runtime bottleneck.

## Decision Process

1. Reproduce the symptom with the narrowest stable scenario.
2. Split the path into Network, Server, Rendering, JavaScript, and Asset costs.
3. Select the first boundary whose measured behavior can plausibly explain the symptom.
4. Form one falsifiable hypothesis and state what evidence would disprove it.
5. Change one material variable or add instrumentation before combining optimizations.
6. Compare against the same baseline and check a realistic low-end or failure condition.
7. Keep the change only when the measured improvement is meaningful and the maintenance cost is justified.

## Decision Rules

- Do not introduce memoization, code splitting, caching, virtualization, preloading, or a new dependency without naming the measured cost it addresses.
- Do not treat a smaller bundle as proof of a faster user workflow; transfer, parse, execution, scheduling, and cache behavior may differ.
- Do not optimize a server or network bottleneck by adding client complexity.
- Prefer removing work over scheduling, caching, or abstracting the same work.
- Preserve correctness, accessibility, and recovery behavior while optimizing.
- Keep a reversible change when evidence is incomplete; avoid architecture migration as a performance experiment.

## Counterexamples

- A component rerenders often, but profiling shows the work is cheap and outside the delayed interaction. Do not add memoization.
- A dependency is large, but it is server-only and absent from shipped client output. Do not report a client bundle regression.
- A route is slow only on a cold backend cache. A client rendering rewrite does not address the measured boundary.
- A lab score improves while the critical production interaction does not. Treat the result as inconclusive.

## AI Control

An AI agent may collect traces, inspect bundles, identify candidate boundaries, and propose experiments. Before accepting a change, the engineer should be able to explain:

1. Which user action was slow
2. Which boundary owned the dominant delay
3. What evidence supports the chosen change
4. What regression or tradeoff the change can introduce
5. How to verify and revert it

If those answers are missing, produce an investigation plan rather than an optimization patch.

## Verification And Handoff

Report the before and after measurement, environment, variance, changed boundary, checks run, and remaining unknowns. Name the first trace, metric, or profile to inspect if the regression returns.
