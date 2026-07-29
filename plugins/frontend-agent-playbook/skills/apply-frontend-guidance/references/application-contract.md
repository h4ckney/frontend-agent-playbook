# Application Contract

Use this reference to choose placement and verify approval before editing a target repository.

## Approval Record

An actionable approval identifies:

- Target repository
- Stable proposal ID
- Artifact type
- Intended behavior and scope
- Exact target files, or explicit permission to propose paths followed by a separate file-level approval
- Approved artifact fingerprint when deterministic content has been reviewed
- Owner or explicit current-task approval
- Validation and recheck requirements

Statuses such as Proposed, Revision requested, Deferred, and Rejected are not writable approvals. Applied is reusable only when verifying or updating the same approved artifact.

Path-proposal permission is read-only. It never authorizes creating the proposed files.
For deterministic metadata checks, use `scripts/guidance-approval.mjs` with an approval, requested application, and existing artifact inventory. The approval and request fingerprints must identify the same reviewed content; a matching rerun returns `noop`, while supplied content drift or duplicates return `block`.
The caller must compute fingerprints from the proposed and current files and inventory existing artifacts. The script compares those inputs but does not inspect the target repository, establish owner approval, or replace inspection of repository-local instructions, dirty worktree changes, and file ownership.

## Placement Order

1. Follow repository-local instructions and existing guidance directories.
2. Extend an existing scoped `AGENTS.md`, rule file, or skill when ownership and content align.
3. Add a new file beside related guidance when the existing layout supports it.
4. Propose a new instruction hierarchy only when no established location exists and the user approves the exact path.

Do not assume `.agents`, `.claude`, `.codex`, or another vendor-specific directory is accepted merely because the playbook recognizes it.

## Project Rule Shape

A project rule should contain:

- Purpose and applicability
- Source precedence or project authority
- MUST, SHOULD, and MAY statements only if the target project uses requirement levels
- Exceptions and evidence needed to invoke them
- Verification and recheck triggers

Keep implementation examples out unless they prevent a demonstrated ambiguity.

## Project Skill Shape

A project skill should contain:

- Valid name and trigger-oriented description
- Required inputs and preconditions
- Ordered workflow
- Approval and failure boundaries
- Validation and output format
- References or scripts only when they reduce repeated work or fragile execution

Do not add auxiliary README, changelog, or installation files inside a skill directory.

## Conflict Handling

- Higher-precedence project and security requirements win.
- Preserve unrelated dirty-worktree changes.
- Prefer a scoped exception over weakening shared guidance.
- Stop when the approved target is now owned by conflicting guidance.
- Never resolve conflict by silently broadening the proposal.

## Completion Evidence

- Applied proposal ID and decision owner
- Exact files changed
- Validation output
- Checks not run and why
- Recheck trigger
- Confirmation that no unrelated instruction or external issue was changed
