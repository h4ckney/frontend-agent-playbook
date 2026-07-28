# Audit Issue Draft: Cover Final Application Submission

This is a local draft. Publication is not approved.

## Draft Identity

- Draft ID: `application-final-submit-e2e`
- Source proposal IDs and finding IDs: `application-submission-boundary`, `testing.application-submit-e2e-gap`
- Status: Draft
- Suggested priority: High
- Suggested labels: `testing`, `application-flow`

## Title

Add an E2E regression for final application submission

## Problem And Impact

The existing component tests cover field validation, but no browser test verifies the irreversible final-submit boundary through confirmation. A regression could allow duplicate requests, lose entered data after server rejection, or navigate before success.

## Evidence

| Evidence status | Evidence | Scope | Limitation |
| --- | --- | --- | --- |
| Risk inference | Playwright inventory has no final-submit journey | Authenticated application submission | Missing coverage does not prove a production defect |

## Scope

- Included: One deterministic happy path plus server-rejection preservation and duplicate-submit assertion
- Owner: Application experience
- Affected routes or systems: Application form, submission API sandbox, confirmation route

## Out Of Scope

- Unrelated cleanup: Existing advertisement and authentication-wall tests
- Unapproved migrations, dependencies, or enforcement: No test framework or CI topology change
- External systems requiring separate ownership: Real production submissions and third-party notifications

## Proposed Approach

Use the existing Playwright fixtures and a sandboxed or intercepted submission response. Assert user-visible outcomes and request count rather than internal component state.

## Acceptance Criteria

- [ ] A valid application produces one final-submit request and reaches confirmation.
- [ ] Repeated activation while pending does not produce a second request.
- [ ] A server rejection preserves entered values and exposes an accessible error summary.
- [ ] The test uses existing auth and data fixtures without production applicant data.
- [ ] The test does not rely on fixed sleeps.

## Verification

- Automated checks: Focused Playwright project, existing lint and typecheck
- Manual checks: Inspect trace for request count, focus target, and redacted payloads
- Runtime or deployment checks: None; test boundary is sandboxed
- Checks requiring another owner: API error contract confirmation

## Dependencies And Blockers

- Dependencies: Stable submission sandbox or network fixture
- Information gaps: Confirm whether the API provides an idempotency key
- Recheck trigger: Submission endpoint or auth fixture changes

## Publication Decision

- Repository: Representative fixture
- Final title approved: No
- Final body approved: No
- Labels, milestone, and assignee approved: Not requested
- Approved by:
- Published URL:
