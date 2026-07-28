# Next Issue Drafts

This document proposes the next implementation issues after the v0.1 audit, routing, and decision-persistence work. It is a staging document, not a record of published GitHub issues.

## Implementation Status

| Issue | Status | Evidence |
| --- | --- | --- |
| 1. Proposal and approval contract | Implemented | Audit skill, guidance proposal template, decision schema |
| 2. Approved guidance application | Implemented | `apply-frontend-guidance` skill and application contract |
| 3. Audit-to-Issue drafts | Implemented | Local audit issue template and audit drafting rules |
| 4. Workflow forward-test | Representative-tested | Pages, App, and mixed-router adoption fixtures |
| 5. GitHub publication | Deferred | Requires live draft-quality validation and separate external approval |

Implementation does not publish GitHub issues. The drafts below remain the design and acceptance record for each item.

## Design Decision

Keep analysis, approval, application, and publication as separate boundaries.

1. `audit-frontend-rules` inspects the target repository and proposes project-specific rules, skills, and follow-up issues.
2. The user approves, rejects, or narrows each proposed artifact.
3. A separate application workflow creates only the approved files, validates them, and updates `.frontend-rules-decisions.md`.
4. GitHub issue drafts remain local until the user separately approves publication.

The browser dashboard must not generate or install rules and skills. Its static findings can be evidence inputs, but repository-aware agent inspection is required before making a proposal.

## Recommendation Contract

Every proposed rule or skill must include:

- Proposal ID and type: existing rule adoption, project rule, project skill, enforcement change, or issue draft
- Triggering evidence and evidence status
- Why existing project instructions or playbook guidance are insufficient
- Intended scope, location, owner, and revalidation trigger
- Expected benefit and over-engineering risk
- Exact files that would be created or changed
- Validation commands and manual verification
- Decision requested: Approve, Revise, Defer, or Reject

Do not propose a new rule for a one-off implementation detail. Do not propose a skill when a short rule or existing script is sufficient. Do not write files, enable tooling, or publish issues before explicit approval.

## Recommended Sequence

1. Issue 1: proposal and approval contract
2. Issue 2: approved guidance application workflow
3. Issue 3: audit-to-Issue draft generation
4. Issue 4: forward-test the complete workflow
5. Issue 5: optional GitHub issue publication

Issues 1 through 4 form the recommended next milestone. Issue 5 should remain optional until the draft quality is proven.

---

## Issue 1: Add project guidance proposals and approval gates to audits

### Suggested title

`feat(audit): propose project-specific rules and skills behind an approval gate`

### Priority

P0

### Problem

The audit currently classifies shared guidance and recommends changes, but it does not produce a structured proposal for rules or skills that should live in the audited repository. Moving directly from a finding to file creation would bypass project ownership and could introduce duplicate or over-engineered instructions.

### Proposed approach

- Add a `Guidance Proposals` section to the audit report.
- Use the recommendation contract defined in this document.
- Classify each proposal as existing rule adoption, project rule, project skill, enforcement change, or no artifact needed.
- Require the audit to explain why a project rule is better than a one-time code fix.
- Require the audit to explain why a repeatable workflow needs a skill instead of a concise rule.
- End the proposal phase with explicit Approve, Revise, Defer, or Reject decisions.
- Keep the audit read-only unless the user explicitly requests persistence of approved decisions.

### Out of scope

- Creating rule or skill files
- Enabling ESLint plugins, CI jobs, or dependencies
- Publishing GitHub issues
- Generating artifacts from dashboard heuristics alone

### Acceptance criteria

- Audit reports can contain zero or more structured guidance proposals.
- Every proposal includes evidence, scope, target path, rationale, risk, and verification.
- The workflow does not force a rule or skill proposal when no reusable guidance is justified.
- No target-repository file is written before explicit approval.
- Approved, revised, deferred, and rejected outcomes can be represented in `.frontend-rules-decisions.md`.
- The documentation validator checks the required proposal fields in the proposal template.

### Verification

- Run the audit against one repository where an existing playbook rule is sufficient.
- Run it against one repository where a project-specific rule is justified.
- Run it against one repository where a repeatable workflow justifies a skill.
- Confirm a one-off finding results in `no artifact needed` rather than a new rule.

### Dependencies

- Existing rule routing and governance
- Existing decision persistence format

### Suggested labels

`enhancement`, `audit`, `governance`, `P0`

---

## Issue 2: Create an approval-scoped guidance application workflow

### Suggested title

`feat(skill): apply approved frontend guidance to target repositories`

### Priority

P1

### Problem

Once a user approves a rule or skill proposal, the playbook needs a controlled way to create it using the target repository's existing instruction layout. Adding this behavior directly to the audit skill would mix read-only assessment with repository mutation and make approval boundaries harder to verify.

### Proposed approach

- Add a separate `apply-frontend-guidance` skill.
- Accept only explicitly approved proposal IDs as input.
- Reinspect target paths and local instructions immediately before writing.
- Prefer existing locations such as `AGENTS.md`, project rule directories, or established skill directories.
- Create the smallest artifact that satisfies the approved proposal.
- Follow the target repository's naming, frontmatter, and validation conventions.
- Show the planned files and scope before writing when approval did not already include exact paths.
- Validate links, metadata, syntax, and project-specific checks after creation.
- Update `.frontend-rules-decisions.md` with the applied proposal, owner, verification, and recheck trigger.

### Safety constraints

- Do not create a new instruction hierarchy when the repository already has one.
- Do not overwrite project-owned instructions without explicit file-level approval.
- Do not install dependencies or enable enforcement tools unless separately approved.
- Do not weaken higher-precedence security, privacy, accessibility, or data-integrity requirements.
- Do not copy the entire playbook into the target repository.

### Acceptance criteria

- The skill refuses unapproved proposal IDs.
- The skill lists exact target files and approved scope before mutation.
- Generated skills have valid `SKILL.md` frontmatter and matching UI metadata when the target system requires it.
- Generated rules distinguish MUST, SHOULD, and MAY only where the target repository adopts that convention.
- Existing user changes are preserved.
- Validation results and unverified checks are reported.
- The applied decision is persisted without secrets or unnecessary source excerpts.

### Verification

- Apply one approved project rule to a fixture with an existing `AGENTS.md` convention.
- Apply one approved skill to a fixture with an existing skill directory.
- Confirm an unapproved proposal is rejected without writes.
- Confirm conflicting target paths require renewed approval.
- Confirm rerunning the same proposal is idempotent or produces a clear update diff.

### Dependencies

- Issue 1
- Existing decision template
- Skill metadata validation

### Suggested labels

`enhancement`, `skill`, `governance`, `P1`

---

## Issue 3: Generate actionable GitHub issue drafts from audit findings

### Suggested title

`feat(audit): generate evidence-based GitHub issue drafts`

### Priority

P1

### Problem

Audit findings and urgent recommendations are not yet converted into implementation-ready work items. A raw finding usually lacks ownership, scope, acceptance criteria, dependencies, and verification, while automatically publishing every finding would create noisy or unsafe backlogs.

### Proposed approach

- Add an `Issue Drafts` output section and a reusable issue template.
- Draft issues only for accepted or explicitly requested follow-up work.
- Group multiple findings that share one root cause.
- Keep unrelated security, testing, SEO, dead-code, and migration work separate.
- Include evidence status so inferences and information gaps are not written as confirmed defects.
- Redact secrets, personal data, private payloads, and unnecessary source excerpts.
- Suggest labels and priority without assuming the target repository uses them.
- Keep generated drafts local Markdown until publication is separately approved.

### Draft format

- Title
- Problem and impact
- Evidence and evidence status
- Scope
- Out of scope
- Proposed approach
- Acceptance criteria
- Verification
- Dependencies and blockers
- Suggested labels and priority

### Acceptance criteria

- A finding can be excluded when immediate remediation is more appropriate than an issue.
- Duplicate findings with one root cause produce one issue draft.
- Information gaps become investigation tasks, not confirmed bug reports.
- Removal candidates never imply deletion approval.
- Drafts contain no environment values, secrets, personal data, or full private source excerpts.
- Every draft has testable acceptance criteria and verification steps.
- No issue is published automatically.

### Verification

- Generate one security remediation draft from HTML trust-boundary evidence.
- Generate one testing-gap draft for a high-risk journey.
- Generate one investigation draft from an information gap.
- Confirm duplicate findings are grouped.
- Confirm a low-value heuristic finding is omitted.

### Dependencies

- Issue 1 recommendation contract
- Existing evidence-status model

### Suggested labels

`enhancement`, `github`, `audit`, `P1`

---

## Issue 4: Forward-test proposal, approval, application, and issue drafting

### Suggested title

`test(audit): forward-test the approved guidance adoption workflow`

### Priority

P1 release gate

### Problem

The proposed workflow changes repository instructions and can create backlog items. Fixture-only validation would not show whether it overproduces rules, duplicates existing guidance, chooses incorrect paths, or writes issues from weak evidence.

### Proposed approach

- Test against at least three representative repositories: Pages Router, App Router, and mixed or non-Next React.
- Include repositories with different instruction layouts.
- Record proposals that were intentionally rejected as over-engineering.
- Compare first and second runs to verify decision reuse and idempotency.
- Review generated rules, skills, and issue drafts manually before declaring the workflow usable.

### Acceptance criteria

- At least one run correctly recommends no new rule or skill.
- At least one project rule and one project skill are proposed with distinct justification.
- No files are created before approval.
- Approved application follows the target repository's existing layout.
- A repeated run does not create duplicate active decisions or duplicate artifacts.
- Issue drafts separate observed facts, risk inferences, and information gaps.
- False-positive and over-engineering decisions are documented in examples.

### Verification artifacts

- Anonymized audit report
- Approved proposal record
- Applied diff or fixture output
- Generated issue drafts
- Validation commands and results
- Rejected proposals with reasons

### Dependencies

- Issues 1, 2, and 3

### Suggested labels

`testing`, `audit`, `release-gate`, `P1`

---

## Issue 5: Publish approved drafts to GitHub Issues

### Suggested title

`feat(github): publish explicitly approved audit issue drafts`

### Priority

P2 optional

### Problem

After draft quality is proven, manually transferring approved drafts to GitHub is repetitive. Publication still requires a separate permission boundary because it changes external project state and can notify collaborators.

### Proposed approach

- Publish only draft IDs explicitly approved for the named repository.
- Show final title, body, labels, milestone, and assignee before publication.
- Verify repository identity and current authentication.
- Create issues one at a time and return confirmed URLs.
- Do not create labels, milestones, or assignments unless separately approved.
- Record only confirmed publication results.

### Acceptance criteria

- Local draft generation remains usable without GitHub authentication.
- Publication requires explicit repository and draft selection.
- The workflow previews the exact final issue payload.
- Partial failures do not duplicate already-created issues on retry.
- Only confirmed issue URLs are reported.

### Dependencies

- Issue 3
- Issue 4 forward-test results

### Suggested labels

`enhancement`, `github`, `integration`, `P2`

## Review Outcome

Proceed with Issues 1 through 4. Keep Issue 5 deferred until real audits show that generated drafts need little manual rewriting. This preserves the useful approval boundary without adding GitHub integration before the core recommendation quality is proven.
