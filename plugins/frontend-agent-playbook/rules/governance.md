# Rule Governance

## Purpose

Define how AI agents should resolve conflicts, decide whether a rule applies, and avoid over-engineering when adapting this repository to an existing codebase.

## Precedence

Rule ID: `governance.codebase-context`

Use this order when guidance conflicts:

1. Non-negotiable security, accessibility, privacy, and data-integrity requirements
2. Explicit user requirements and intended product behavior
3. Existing codebase configuration and established project patterns
4. Official documentation for the framework and version in use
5. Rules in this repository
6. Team preferences that are not already encoded in the project

Do not use an existing convention to preserve a known correctness, security, or accessibility defect. Document the conflict and apply the smallest justified correction.

## Requirement Levels

- **MUST**: Required for correctness, security, accessibility, data integrity, or an explicit project constraint.
- **SHOULD**: Recommended default. Skip it when codebase evidence or task scope gives a stronger reason.
- **MAY**: Optional technique whose value depends on context.

Every actionable bullet in a rule section must use the `- **LEVEL**: statement` format. References, examples, checklists, definitions, and explanatory prose do not require a level.

- **MUST**: Override a MUST only when a higher-precedence requirement conflicts with it. Record the conflict, affected scope, and verification.
- **SHOULD**: Skip a SHOULD when codebase evidence, task scope, or measured behavior gives a stronger reason. Record the exception when it materially affects the result.
- **MAY**: Apply a MAY only when it provides concrete value without disproportionate complexity.

Level words describe obligation, not finding severity. A violated MUST is not automatically Critical; use the review model and demonstrated impact to assign severity.

## Applicability Decisions

Classify reviewed rules and skills as one of:

- **Keep**: Fits the codebase and provides useful protection.
- **Conditional**: Applies only to named frameworks, routes, risks, or thresholds.
- **Disable**: Should not be applied in this codebase, but may remain useful elsewhere.
- **Removal candidate**: Duplicated, obsolete, contradictory, or consistently harmful guidance that should be considered for deletion.

Support Conditional, Disable, and Removal candidate decisions with concrete evidence from configuration, source code, tests, official versioned documentation, or measured behavior.

## Avoid Over-engineering

- **SHOULD**: Inspect the current implementation before proposing a new abstraction, dependency, state layer, validation library, or test tier.
- **SHOULD**: Prefer the smallest change that satisfies the user-visible requirement and preserves project conventions.
- **MUST**: Do not impose framework features that the project does not use.
- **SHOULD**: Do not add an abstraction for a single simple use unless it protects a real boundary or matches an established pattern.
- **SHOULD**: Do not expand tests beyond the change's risk and regression surface.
- **SHOULD**: Record a recommendation instead of changing unrelated architecture during a scoped task.

## Changing Rules And Skills

- **SHOULD**: Update guidance when official APIs, framework versions, or repeated project evidence make it inaccurate.
- **SHOULD**: Add exceptions beside the rule they qualify; do not rely on hidden agent judgment.
- **SHOULD**: Mark a rule or skill as a removal candidate before deleting it.
- **MUST**: Do not delete or disable shared guidance without user or repository-owner approval.
- **SHOULD**: Keep the reason, affected scope, and replacement guidance in the review or commit history.

## Urgent Recommendations

Report zero to three urgent changes. Include only issues that materially affect correctness, security, accessibility, data integrity, active delivery, or repeated engineering waste. Do not fill the list to reach three.

For each recommendation, include:

1. Evidence
2. Impact
3. Smallest practical change
4. Verification

## AI Agent Checklist

- Did I inspect the codebase and its local instructions before applying generic guidance?
- Did I use the shared precedence order?
- Did I distinguish mandatory requirements from recommendations?
- Did I identify rules that are conditional, disabled, or removal candidates?
- Did I explain exceptions with evidence?
- Did I limit urgent recommendations to genuine priorities?
