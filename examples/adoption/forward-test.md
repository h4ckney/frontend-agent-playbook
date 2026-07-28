# Guidance Adoption Forward-Test

This representative test exercises proposal, approval, application, issue drafting, and rerun behavior. It uses anonymized scenarios and fixture artifacts, not claims of direct access to private repositories.

## Test Contract

- Audits remain read-only before approval.
- Every proposal has a stable ID, evidence status, exact target, proportionality check, and verification.
- Only Approved proposals may be passed to `apply-frontend-guidance`.
- Issue drafts remain local and are not published.
- A second run must not duplicate active decisions or artifacts.

## Case 1: Pages Router With No New Artifact

### Context

- Next.js 13 Pages Router only
- React 18 without RSC
- TypeScript 4.x with `satisfies` support
- Existing `AGENTS.md` already points to version-aware React, TypeScript, and Pages Router guidance
- `react-hooks/exhaustive-deps` is off, with no demonstrated synchronization regression in this scenario

### Proposal

- Proposal ID: `pages-effect-guidance`
- Type: No artifact needed
- Evidence status: Observed fact
- Existing coverage: Project instructions already require version and lint inspection
- Direct action: Keep Effect dependency preferences out of findings unless lint policy or a reproduced synchronization defect justifies them
- Target files: None
- Simpler alternative: Reuse the existing audit and React rule
- Decision requested: Approve no-artifact decision

### Result

- No rule or skill file was created.
- The decision record notes that existing guidance is sufficient.
- No GitHub issue was drafted because there is no accepted backlog work.
- A second run produces no file diff and reuses proposal ID `pages-effect-guidance`.

## Case 2: App Router Project Rule

### Context

- Next.js 14.2 App Router only with framework-managed RSC
- Dynamic product and category routes are indexable
- Route metadata ownership drifted repeatedly between layouts, route data, sitemap generation, and redirect handling
- The project already stores scoped rules under `.agents/rules/`

### Proposal

- Proposal ID: `app-metadata-ownership`
- Type: Project rule
- Evidence status: Risk inference supported by repeated observed metadata drift
- Existing coverage: Generic SEO and Next.js rules explain behavior but do not encode the project's route-data owner
- Intended behavior: Route content and metadata share one server-owned data boundary
- Target file: `.agents/rules/metadata-ownership.md`
- Simpler alternative: A one-time code fix was rejected because the ownership defect repeated across route families
- Over-engineering risk: Avoid a metadata service or duplicate fetch abstraction
- Decision: Approved for the named file and App Router indexable routes

### Applied Artifact

The expected approved output is [metadata-ownership.md](fixtures/app-router/.agents/rules/metadata-ownership.md). It does not apply to Pages Router or private routes.

### Local Issue Draft

- Draft ID: `metadata-backfill`
- Title: `Align existing App Router metadata with route data ownership`
- Evidence status: Observed route inventory plus risk inference about drift
- Scope: Audit existing indexable product and category routes against the approved rule
- Acceptance: Representative rendered output has consistent title, canonical, status, redirect, and sitemap behavior
- Publication: Not approved

### Rerun

The second run finds the same proposal ID and matching target content. It produces no duplicate rule and no additional active decision.

## Case 3: Mixed Router Project Skill

### Context

- Next.js 14 mixed `app/` and `pages/` trees during staged migration
- Shared middleware, links, and data modules can affect both trees
- Reviews repeatedly applied one router's conventions globally
- The project already stores Codex-compatible skills under `.agents/skills/`

### Proposal

- Proposal ID: `mixed-router-boundary-check`
- Type: Project skill
- Evidence status: Observed fact plus repeated review failures
- Existing coverage: The Next.js rule explains both routers but does not provide the repository's repeated changed-file classification workflow
- Intended behavior: Classify each changed route and shared dependency before applying router-specific guidance
- Target files: `.agents/skills/verify-router-boundaries/SKILL.md` and matching `agents/openai.yaml`
- Why a rule is insufficient: The task requires ordered inventory, classification, stop conditions, cross-tree checks, and command reporting
- Simpler alternative: A checklist was considered but did not cover repeated route inventory and shared-module verification
- Decision: Approved for the two named files without route migration authority

### Applied Artifact

The expected approved output is [verify-router-boundaries/SKILL.md](fixtures/mixed-router/.agents/skills/verify-router-boundaries/SKILL.md) with matching UI metadata.

### Local Investigation Draft

- Draft ID: `classify-shared-router-modules`
- Title: `Inventory shared modules that cross App and Pages Router boundaries`
- Evidence status: Information gap
- Scope: Identify ownership and runtime constraints; do not report a confirmed defect
- Acceptance: Shared modules are classified as server-only, browser-only, serializable shared code, or unresolved
- Publication: Not approved

### Rerun

The second run validates the existing skill metadata and content, reuses `mixed-router-boundary-check`, and produces no duplicate skill. A changed target path or request to migrate routes requires renewed approval.

## Outcome Matrix

| Case | Proposed type | Approval result | Applied files | Issue result | Second run |
| --- | --- | --- | --- | --- | --- |
| Pages Router | No artifact needed | Approved | None | None | No diff |
| App Router | Project rule | Approved | One scoped rule | Local remediation draft | No diff |
| Mixed Router | Project skill | Approved | Skill and UI metadata | Local investigation draft | No diff |

## Rejected Over-Engineering

- Do not add App Router or RSC guidance to the Pages Router case.
- Do not create a metadata service or new data library for the App Router rule.
- Do not turn the mixed-router verification skill into automatic migration tooling.
- Do not publish either local issue draft during forward-testing.

## Verification

- Validate repository Markdown links and skill frontmatter.
- Parse both skill UI metadata files.
- Confirm every applied fixture points to an Approved proposal ID.
- Confirm the no-artifact case has no generated fixture.
- Confirm rerun expectations prohibit duplicate decisions and files.
