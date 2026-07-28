# Guidance Proposal: Application Submission Boundary

## Proposal Identity

- Proposal ID: `application-submission-boundary`
- Type: Project rule
- Requested decision: Approve
- Owner: Representative fixture owner

## Evidence

- Source finding IDs: `application.validation-boundary-drift`, `application.draft-rollback-missing`
- Evidence status: Observed fact
- Evidence: Multiple handlers use different client-only validation boundaries; failed draft saves retain optimistic cache state
- Affected scope: Job-application draft save and final submission
- User or product impact: Invalid or stale application state can remain visible and final submission failures can be mishandled

## Existing Coverage

- Existing project guidance: General form and mutation conventions
- Applicable playbook guidance: Data fetching and cache, accessibility, error handling and observability, testing
- Why existing guidance or a direct code fix is insufficient: The validation and final-submission boundary has drifted across three handlers and needs one stable project owner

## Proposed Artifact

- Intended behavior: Draft saves are reversible and rollback-capable; final submission is server-authoritative and never optimistic
- Exact target files: `.agents/rules/application-submission.md`
- Proposed artifact fingerprint: `sha256:fabe4fdb4ec90389987853a0aa3e9e3d8662161336a521b79f4a7133573bb490`
- Trigger or applicability: Changes to application draft saving, validation, final submission, or related tests
- Revalidation trigger: Submission API contract, form library, cache ownership, or route model changes

## Proportionality Check

- Why this should be reusable guidance: The same defect class has repeated across handlers
- Why a rule is insufficient if proposing a skill: Not applicable; no skill is proposed
- Simpler alternative considered: One-time handler fixes would leave the ownership boundary implicit
- Over-engineering risk: Avoid a generic form framework, mutation wrapper, or new dependency

## Validation

- Automated checks: Typecheck, lint, focused integration tests, final-submit E2E, build
- Manual verification: Keyboard focus recovery, slow network, retry, Sentry redaction
- Unverified assumptions: API owner confirms authoritative validation and idempotency behavior

## Decision

- Status: Approved
- Approved scope: Job-application draft save and final submission
- Approved target files: `.agents/rules/application-submission.md`
- Approved artifact fingerprint: `sha256:fabe4fdb4ec90389987853a0aa3e9e3d8662161336a521b79f4a7133573bb490`
- Decision owner: Representative fixture owner
- Decision date: Not applicable; representative fixture
- Decision reason: Repeated boundary drift justifies one scoped rule; a skill or new dependency does not
- Approval scope note: This decision exists only inside the representative fixture and is not a live-repository approval.

## Safety Rules

- This approval does not authorize a new dependency, CI gate, API change, or broader form abstraction.
- Finding IDs provide traceability and do not independently prove a defect.
- A target-path or material-scope change requires renewed approval.
