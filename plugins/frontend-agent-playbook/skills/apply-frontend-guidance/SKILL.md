---
name: apply-frontend-guidance
description: Apply explicitly approved frontend rule, skill, or enforcement proposals to a target repository using its existing instruction layout, validate the created artifacts, and persist the applied decision. Use only after an audit or user decision names approved proposal IDs, scope, behavior, and target files. Do not use for unapproved recommendations, broad playbook copying, or GitHub issue publication.
---

# Apply Frontend Guidance

Create only the project guidance that an owner explicitly approved. Read [Application Contract](references/application-contract.md) before editing.

## Required Input

- Target repository identity
- Approved proposal ID
- Approved type and intended behavior
- Approved scope and exact target files, or explicit permission to propose paths without writing
- Decision owner or explicit user approval in the current task, including the approved artifact fingerprint when using the automated gate
- Validation and recheck requirements

If any required input is missing, remain read-only and request the missing decision. When only path-proposal permission exists, propose exact files and stop for file-level approval. Do not infer approval from an audit recommendation, accepted urgent finding, or existing draft.
When this playbook's scripts are available, inspect the target repository, compute SHA-256 fingerprints from the reviewed content and current artifacts, model those facts as JSON, and run `node <playbook-root>/scripts/guidance-approval.mjs <approval-request.json>` before writing. Resolve `<playbook-root>` from the vendored or installed plugin location; do not assume the target repository contains this script. The script compares supplied metadata; it does not establish ownership, inspect files, or grant approval. Treat a blocked result as a stop condition and `noop` as a successful idempotent rerun.

## Workflow

1. Reinspect repository instructions, dirty worktree state, framework versions, and existing rule or skill locations.
2. Read `.frontend-rules-decisions.md` and the approved proposal when present.
3. Confirm repository identity, proposal ID, intended behavior, scope, and target files match the approval.
4. Stop for renewed approval when paths, dependencies, enforcement, public behavior, or material scope changed.
5. Choose the smallest artifact that implements the approval and follows the existing project layout.
6. If exact paths were not approved, propose them and stop. Continue only after file-level approval.
7. Create or update only approved files. Preserve unrelated user changes.
8. Run artifact validation and the narrowest relevant project checks.
9. Update the proposal status to Applied in `.frontend-rules-decisions.md` only when persistence was approved.
10. Report changed files, checks run, checks not run, and remaining assumptions.

## Artifact Rules

- Existing rule adoption: link or include only the selected guidance; do not copy unrelated playbook files.
- Project rule: encode a reusable project constraint, repeated defect class, stable architecture boundary, or explicit team decision.
- Project skill: encode a repeatable multi-step workflow with only the procedure and resources needed to perform it.
- Enforcement change: use the existing compiler, linter, test, or CI stack unless a new dependency was separately approved.
- No artifact needed: make no guidance file. Apply a direct fix only when that code change was separately requested.

When creating a Codex-compatible skill, follow the installed `skill-creator` guidance when available. Keep `SKILL.md` concise, use valid `name` and `description` frontmatter, put optional detail in one-level references, and keep UI metadata aligned.

## Approval Boundaries

- Approval is limited to one repository and named proposal IDs.
- Approval of a rule does not approve a skill, dependency, CI change, or broader rewrite.
- Approval of content does not approve a different target path.
- Approval does not authorize overwriting conflicting project-owned instructions.
- GitHub issue publication is outside this skill.

## Validation

- Validate Markdown links and required headings.
- Parse skill frontmatter and UI metadata when generated.
- Run existing repository validation before introducing a new validator.
- Run focused type, lint, test, or build checks only when relevant to the approved artifact.
- Reinspect the final diff for unrelated changes and secrets.
- Run `node --test scripts/guidance-approval.test.mjs` when changing the approval contract.
- Treat an unavailable check as unverified, not passed.

## Idempotency

- Reuse stable proposal and decision IDs.
- Update an existing approved artifact instead of creating a duplicate.
- On rerun, produce no change when the approved behavior and generated artifact already match.
- Request renewed approval when an existing artifact conflicts with the approved proposal.

## Report Format

```markdown
## Approval Verified
## Target Layout
## Applied Artifacts
## Decision Update
## Validation
## Unverified Checks
## Remaining Risk
```
