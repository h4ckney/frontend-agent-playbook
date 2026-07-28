# Testing Rules

## Purpose

Define risk-based unit, component, integration, and end-to-end testing guidance for frontend changes without forcing every test tier onto every task.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Prefer the project's existing test runner, browser tooling, fixtures, and conventions before introducing new tools.

## Select Tests By Risk

Choose the lowest test level that gives reliable confidence, then add broader coverage only when the failure crosses boundaries or affects a critical user journey.

| Change or risk | Preferred coverage |
| --- | --- |
| Pure transformation, validation, reducer, or state transition | Unit test |
| Component interaction, form behavior, accessibility, or async UI state | Component or integration test |
| Routing, authentication, permissions, checkout, destructive action, or multi-page workflow | E2E test |
| Production bug | Regression test at the narrowest level that reproduces it |
| Styling-only change with no behavioral risk | Existing visual checks or focused manual verification |

## Unit And Component Tests

- **SHOULD**: Test public behavior and observable outcomes instead of implementation details.
- **SHOULD**: Cover meaningful branches, boundaries, state transitions, and error handling.
- **SHOULD**: Prefer accessible queries such as role, label, and visible text for UI tests.
- **SHOULD**: Mock external boundaries only where needed; avoid mocking the unit's own behavior.
- **SHOULD**: Do not snapshot large component trees as the primary correctness check.
- **SHOULD**: Keep tests deterministic and independent of execution order.

## E2E Tests

- **SHOULD**: Reserve E2E coverage for critical journeys and integration risks that lower-level tests cannot represent reliably.
- **SHOULD**: Use stable user-facing locators; add dedicated test IDs only when semantic locators are insufficient.
- **SHOULD**: Control test data and isolate accounts or records when mutation is involved.
- **SHOULD**: Wait for observable application states instead of fixed sleeps.
- **SHOULD**: Cover the highest-value failure path as well as the happy path when the risk justifies it.
- **SHOULD**: Keep the suite small enough to remain reliable and actionable.

## Change Requirements

- **MUST**: Add or update a test when an explicit acceptance criterion requires automated coverage.
- **SHOULD**: Add a focused regression test for a behavior change or bug when the project has a suitable test layer.
- **MAY**: Use documented manual verification when automation would be disproportionate, unavailable, or outside task scope.
- **MUST**: Explain skipped verification when the affected behavior is high risk.
- **SHOULD**: Avoid adding a new test framework for one change unless existing tooling cannot cover a material risk.

## Verification Report

Report:

- Commands run and whether they passed
- Relevant tests not run and why
- Manual checks performed
- Remaining risk or unverified environments

Do not claim a test passed unless it was executed in the current environment.

## AI Agent Checklist

- What user or system failure would this test prevent?
- Is the chosen test level the narrowest reliable one?
- Does the project already have a matching test pattern?
- Are loading, empty, error, and success states relevant?
- Does the test use observable behavior and stable selectors?
- Is E2E coverage justified by a cross-boundary or critical workflow risk?
