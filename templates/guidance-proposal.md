# Guidance Proposal

Use one copy of this template for each material proposal. A proposal is not approval to create files, install tools, change configuration, or publish external work items.

## Proposal Identity

- Proposal ID:
- Type: Existing rule adoption / Project rule / Project skill / Enforcement change / Issue draft / No artifact needed
- Requested decision: Approve / Revise / Defer / Reject
- Owner:

## Evidence

- Source finding IDs:
- Evidence status: Observed fact / Risk inference / Information gap
- Evidence:
- Affected scope:
- User or product impact:

## Existing Coverage

- Existing project guidance:
- Applicable playbook guidance:
- Why existing guidance or a direct code fix is insufficient:

## Proposed Artifact

- Intended behavior:
- Exact target files:
- Proposed artifact fingerprint:
- Trigger or applicability:
- Revalidation trigger:

For `No artifact needed`, explain the direct fix, existing rule, or one-time decision that is sufficient and leave target files empty.

## Proportionality Check

- Why this should be reusable guidance:
- Why a rule is insufficient if proposing a skill:
- Simpler alternative considered:
- Over-engineering risk:

## Validation

- Automated checks:
- Manual verification:
- Unverified assumptions:

## Decision

- Status: Proposed / Approved / Revision requested / Deferred / Rejected / Applied
- Approved scope:
- Approved target files:
- Approved artifact fingerprint:
- Decision owner:
- Decision date:
- Decision reason:

## Safety Rules

- Do not create or change target files before explicit approval.
- Treat approval as scoped to the named proposal ID, target repository, files, and behavior.
- Request renewed approval when target paths, dependencies, enforcement, or scope materially change.
- Do not create a new rule for a one-off implementation detail.
- Do not create a skill when a concise rule, existing script, or direct fix is sufficient.
- Do not copy the full playbook into the target repository.
- Do not include secrets, personal data, private payloads, or unnecessary source excerpts.
- Use dashboard finding IDs only for traceability; they do not grant write approval or prove a defect.
