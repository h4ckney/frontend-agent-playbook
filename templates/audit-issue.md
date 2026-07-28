# Audit Issue Draft

This template creates a local draft only. Do not publish it to GitHub or another tracker without separate approval for the repository and final payload.

## Draft Identity

- Draft ID:
- Source proposal IDs and finding IDs:
- Status: Draft / Approved for publication / Published
- Suggested priority:
- Suggested labels:

## Title

Use a concise, action-oriented title that does not state an inference or information gap as a confirmed defect.

## Problem And Impact

Describe the affected user, product, security, operational, or maintenance outcome. Explain why this belongs in the backlog instead of an immediate direct fix.

## Evidence

| Evidence status | Evidence | Scope | Limitation |
| --- | --- | --- | --- |
| Observed fact / Risk inference / Information gap |  |  |  |

Use minimal paths and configuration references. Do not include environment values, secrets, personal data, private payloads, or full source excerpts.
Retain stable finding IDs from the dashboard or repository-aware audit. IDs provide traceability only and do not prove a defect or authorize publication.

## Scope

- Included:
- Owner:
- Affected routes or systems:

## Out Of Scope

- Unrelated cleanup:
- Unapproved migrations, dependencies, or enforcement:
- External systems requiring separate ownership:

## Proposed Approach

Describe the smallest practical direction without prescribing an unverified implementation.

## Acceptance Criteria

- [ ] The user-visible or system outcome is testable.
- [ ] Observed facts, inferences, and information gaps remain distinguishable.
- [ ] Required failure, accessibility, security, or data-integrity behavior is included when relevant.
- [ ] No removal candidate is treated as deletion approval.

## Verification

- Automated checks:
- Manual checks:
- Runtime or deployment checks:
- Checks requiring another owner:

## Dependencies And Blockers

- Dependencies:
- Information gaps:
- Recheck trigger:

## Publication Decision

- Repository:
- Final title approved: Yes / No
- Final body approved: Yes / No
- Labels, milestone, and assignee approved: Yes / No / Not requested
- Approved by:
- Published URL:

Leave the URL empty until publication is confirmed. Draft approval does not authorize creating labels, milestones, assignments, or additional issues.
