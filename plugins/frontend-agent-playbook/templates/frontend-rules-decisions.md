# Frontend Rules Decisions

Copy this template to `.frontend-rules-decisions.md` in the audited repository. Keep only material decisions, exceptions, and recheck conditions; do not copy the full playbook.

## Metadata

- Schema version: 3
- Repository:
- Default branch:
- Last audited date:
- Last audited commit:
- Decision owner:
- Next scheduled review, if any:

## Codebase Context

| Area | Observed value | Evidence |
| --- | --- | --- |
| Framework and version |  |  |
| Route model | App / Pages / mixed / other |  |
| React and rendering model | RSC / SSR / CSR / mixed |  |
| TypeScript version |  |  |
| State and data tools |  |  |
| Test tools |  |  |
| Lint and CI |  |  |
| Observability |  |  |

## Selected Guidance

- Always loaded:
- Task-core rules:
- Risk-triggered rules:
- Conditional rules:
- Excluded rules:
- Exclusion evidence:

## Rule Decisions

Use one row only when a decision materially changes how the shared guidance applies.

| Decision ID | Guidance | Decision | Scope | Evidence status | Evidence | Reason | Verification | Recheck trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example-router-mode | rules/nextjs.md#app-router-rules | Disable | Pages Router tree | Observed fact | package version and route tree | App Router conventions do not apply | Route inventory checked | Route migration or framework upgrade |

Allowed decisions:

- **Keep**: Apply the guidance as written in the named scope.
- **Conditional**: Apply only under the recorded trigger, route, risk, or threshold.
- **Disable**: Do not apply in the named scope; retain the guidance for other contexts.
- **Removal candidate**: Consider removing duplicated, obsolete, contradictory, or harmful guidance. This is not deletion approval.

Evidence status:

- **Observed fact**: Directly supported by source, configuration, tests, commands, or runtime output.
- **Risk inference**: A review conclusion based on observed facts.
- **Information gap**: Required evidence is unavailable or outside the inspected boundary.

## Project Exceptions

Record approved exceptions to MUST or SHOULD guidance. A MUST may be overridden only by a higher-precedence requirement.

| Exception ID | Guidance | Level | Scope | Higher-precedence reason or evidence | Approved by | Expires or recheck trigger | Required verification |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Guidance Proposal Decisions

Record only material project guidance proposals. Approval is scoped to the named repository, behavior, and target files.

| Proposal ID | Source finding IDs | Type | Status | Scope | Target files | Artifact fingerprint | Evidence status | Owner | Reason | Verification | Recheck trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Allowed statuses:

- Proposed
- Approved
- Revision requested
- Deferred
- Rejected
- Applied

An approved proposal must be re-approved if its target paths, artifact fingerprint, dependencies, enforcement behavior, or material scope changes.
Finding IDs preserve evidence traceability; they are not approval and must remain stable while the underlying category remains active.

## Urgent Recommendation Decisions

Record only recommendations that were accepted, deferred, or rejected by an owner.

| Recommendation | Status | Owner | Reason | Target date or recheck trigger | Verification |
| --- | --- | --- | --- | --- | --- |

Allowed statuses:

- Accepted
- Deferred
- Rejected
- Completed

## Information Gaps

| Unknown | Why it matters | How to verify | Owner |
| --- | --- | --- | --- |

## Revalidation Triggers

Re-run affected decisions when any of these change:

- Framework, React, TypeScript, router, or rendering model
- ESLint, compiler, test, CI, cache, state, or observability tooling
- Authentication, payment, HTML trust boundary, third-party data, or privacy policy
- Indexing intent, URL structure, metadata ownership, or deployment environment
- Repeated regression evidence that invalidates an earlier exception
- Scope or owner recorded in a decision no longer exists

## Maintenance Rules

- Keep decision IDs stable while the decision remains active.
- Update the audited commit and evidence when a decision changes.
- Remove superseded rows instead of retaining a second active decision; rely on version control for history.
- Do not store secrets, tokens, personal data, private payloads, or unnecessary source excerpts.
- Do not convert an information gap into a no-finding conclusion.
- Do not treat this file as higher priority than security, accessibility, privacy, data integrity, explicit user requirements, or verified product behavior.
