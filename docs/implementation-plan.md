# Historical v0.1 Implementation Plan

> Historical record: this plan describes the work that followed the initial v0.1 skeleton. It is not the current roadmap. See [v0.2 Roadmap](./v0.2-roadmap.md) for current status and release gates.

At the time this plan was written, GitHub repository creation and remote push were intentionally excluded while the local Markdown content was being prepared for publication.

## 2. Expand Rule Documents

### Goal

Turn each rule file from a planning stub into a practical AI-agent rule document that can be copied into Claude Code, Codex, or another coding-agent instruction system.

### Target Files

- `rules/react.md`
- `rules/nextjs.md`
- `rules/typescript.md`
- `rules/performance.md`
- `rules/accessibility.md`
- `rules/seo.md`
- `rules/testing.md`
- `rules/dead-code.md`
- `rules/code-review.md`
- `rules/governance.md`

### Document Structure

Each rule file should share a small common foundation, but topic-specific sections are allowed. Do not force review, SEO, performance, and framework rules into the exact same shape when a specialized structure is clearer.

Common required sections:

```md
# Topic Rules

## Purpose
## Source Priority
## References
## Core Rules or Review Gates
## AI Agent Checklist
## Examples or Expansion Notes
```

Optional topic-specific sections:

```md
## Do
## Avoid
## Review Gates
## Feedback Format
## API Boundary Rules
## Core Web Vitals Rules
## Metadata Rules
```

### Writing Guidelines

- Rules should be concrete enough for an AI agent to follow without guessing.
- Rules should prefer official documentation and existing project conventions.
- Rules should explain what to do, what to avoid, and how to verify the result.
- Examples should show realistic frontend work, not toy snippets.
- Avoid vague language like "make it clean" unless paired with specific review criteria.

### Completion Criteria

- All files in `rules/` include the common required sections where they apply.
- Topic-specific sections are allowed when they make the document clearer.
- Every rule file has official or authoritative references where appropriate.
- Every rule file includes an `AI Agent Checklist` section or a clear equivalent.
- Examples are added in phases, starting with `react.md`, `typescript.md`, and `code-review.md`.

## 3. Add TypeScript Source Priority and Concrete Rules

### Goal

Make `rules/typescript.md` official-source-driven and useful for frontend code generation and review.

### Primary References

- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/intro.html
- TypeScript Everyday Types: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- TypeScript Narrowing: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- TypeScript Generics: https://www.typescriptlang.org/docs/handbook/2/generics.html
- TypeScript TSConfig Reference: https://www.typescriptlang.org/tsconfig

### Rule Areas

- Prefer precise types over broad types.
- Avoid `any`; use `unknown` at untrusted boundaries and narrow before use.
- Use discriminated unions for UI and async states.
- Keep API response types separate from UI/domain types when transformation is needed.
- Add explicit return types at public boundaries when inference does not make the contract clear or stable.
- Use generics only when they preserve useful caller information.
- Avoid non-null assertions unless the invariant is local and obvious.
- Keep component props intentional and easy to review.

### Suggested Sections

```md
## Source Priority
## References
## Type Safety Rules
## API Boundary Rules
## React Props and State Rules
## Generics Rules
## Error Handling Rules
## AI Agent Checklist
## Examples
```

### Completion Criteria

- `rules/typescript.md` includes official TypeScript references.
- It has clear rules for `any`, `unknown`, nullability, generics, API data, and component props.
- It includes frontend-specific examples, not only generic TypeScript examples.

## 4. Add Performance Source Priority and Concrete Rules

### Goal

Make `rules/performance.md` useful for reviewing real frontend performance risks before code is shipped.

### Primary References

- web.dev Performance: https://web.dev/learn/performance
- web.dev Core Web Vitals: https://web.dev/articles/vitals
- web.dev Optimize LCP: https://web.dev/articles/optimize-lcp
- web.dev Optimize INP: https://web.dev/articles/optimize-inp
- web.dev Optimize CLS: https://web.dev/articles/optimize-cls
- MDN Web Performance: https://developer.mozilla.org/en-US/docs/Learn/Performance
- Next.js Image Optimization: https://nextjs.org/docs/app/building-your-application/optimizing/images
- Next.js Font Optimization: https://nextjs.org/docs/app/building-your-application/optimizing/fonts

### Rule Areas

- Measure before making broad performance claims.
- Protect Core Web Vitals: LCP, INP, and CLS.
- Avoid unnecessary client-side JavaScript.
- Avoid adding heavy dependencies without justification.
- Use image sizing, lazy loading, and modern formats where appropriate.
- Avoid render waterfalls and unnecessary sequential data fetching.
- Use memoization only when it solves a real rendering cost.
- Keep loading states stable to avoid layout shift.

### Suggested Sections

```md
## Source Priority
## References
## Core Web Vitals Rules
## Rendering Rules
## Bundle Size Rules
## Asset Rules
## Network and Data Fetching Rules
## AI Agent Checklist
## Examples
```

### Completion Criteria

- `rules/performance.md` includes web.dev, MDN, and framework-specific references.
- It explains what an AI agent should check before adding dependencies, images, effects, or client components.
- It includes review examples for common frontend performance regressions.

## 5. Expand Agent Examples

### Goal

Make `examples/claude.md` and `examples/codex.md` copy-ready instruction examples.

### Target Files

- `examples/claude.md`
- `examples/codex.md`

### Claude Example Plan

Add examples for:

- Project-level Claude Code instructions
- Feature implementation prompt
- Refactor prompt
- Bug fix prompt
- Code review prompt

The Claude examples should emphasize:

- Inspecting existing code before editing
- Following project conventions
- Avoiding broad rewrites
- Writing user-visible behavior checks
- Asking for clarification only when needed

### Codex Example Plan

Add examples for:

- Codex project instruction block
- `AGENTS.md`-style frontend rules
- Feature implementation task
- Bug fix task
- Review task

The Codex examples should emphasize:

- Reading relevant files first
- Making scoped edits
- Running available verification commands
- Reporting changed files and test results
- Avoiding unrelated refactors

### Completion Criteria

- Both example files contain copy-ready text blocks.
- Each example has a clear use case.
- The examples refer back to the rule files in this repository.
- The examples are concise enough to paste into real AI coding-agent instructions.

## 6. Expand Templates Into Usable Request Forms

### Goal

Make each template usable as a request format for AI coding agents.

### Target Files

- `templates/feature-implementation.md`
- `templates/refactor-request.md`
- `templates/bug-fix.md`

### Feature Implementation Template Plan

Include fields for:

- User-facing goal
- Scope
- Out of scope
- Affected routes/components
- API/data requirements
- Loading, empty, error, and success states
- Accessibility requirements
- Performance considerations
- Tests and verification commands

### Refactor Request Template Plan

Include fields for:

- Refactor goal
- Current problem
- Behavior that must not change
- Files and boundaries involved
- Allowed changes
- Disallowed changes
- Test coverage before and after
- Manual regression checklist

### Bug Fix Template Plan

Include fields for:

- Bug summary
- Expected behavior
- Actual behavior
- Reproduction steps
- Environment
- Suspected area
- Regression test requirement
- Verification checklist

### Completion Criteria

- Each template is fillable without needing extra explanation.
- Each template encourages scoped, testable work.
- Each template has a clear verification section.
- Templates avoid vague requests like "make it better".

## 7. Improve README

### Goal

Turn `README.md` into a useful landing document for people who want to use or extend the rule set.

### README Sections To Add

```md
## What This Is
## How To Use
## Rule Categories
## Source Priorities
## Maturity Status
## Roadmap
```

### Content Plan

`README.md` should explain:

- This repository is a rule set for AI coding agents working on frontend applications.
- The rules cover governance, React, Next.js, TypeScript, SEO, performance, testing, and review workflows.
- Official docs and existing project conventions outrank personal preference.
- Users can copy individual rule files into Claude Code, Codex, or project-specific agent instructions.
- The repository is still v0.1 and should be treated as a growing rule base.

### Maturity Status Plan

Add a simple status table. Keep this table updated whenever a planned area moves to draft or usable status:

```md
| Area | Status | Notes |
| --- | --- | --- |
| Governance | Usable draft | Precedence, applicability, exceptions, and removal policy added |
| React | Usable draft | Official references and agent checklist added |
| Next.js | Usable draft | Official references and agent checklist added |
| TypeScript | Usable draft | Official references and boundary examples added |
| Performance | Usable draft | web.dev, MDN, and Next.js references added |
| Accessibility | Usable draft | WCAG 2.2 and WAI-ARIA APG references added |
| SEO | Usable draft | Canonical, robots, sitemap, rendering, structured data, and URL lifecycle guidance added |
| Testing | Usable draft | Risk-based test selection added |
| Dead Code | Usable draft | Evidence-based removal and verification guidance added |
| Code Review | Usable draft | Critical / Standards / Optimization review gates added |
| Audit Skill | Usable draft | Conflict, applicability, and testing audit workflow added |
| Examples | Usable draft | Copy-ready prompts added |
| Templates | Usable draft | Fillable request forms added |
```

### Completion Criteria

- README explains the project without requiring the user to inspect every folder.
- README links to all rule, example, and template files.
- README documents the source-priority philosophy.
- README includes a short roadmap for the next version.

## 8. Add Rule Governance, Testing, And Audit Workflow

### Goal

Make the rule set adaptable to real codebases without blindly enforcing generic guidance or adding unnecessary architecture and tests.

### Target Files

- `rules/governance.md`
- `rules/testing.md`
- `skills/audit-frontend-rules/SKILL.md`
- `skills/audit-frontend-rules/agents/openai.yaml`

### Governance Plan

- Define one precedence order for non-negotiable safeguards, user requirements, codebase patterns, official docs, repository rules, and team preferences.
- Interpret unlabeled rules as recommendations rather than absolute requirements.
- Classify rules and skills as Keep, Conditional, Disable, or Removal candidate.
- Require codebase evidence for exceptions and removal candidates.
- Allow zero to three urgent recommendations instead of forcing exactly three.
- Require approval before deleting or disabling shared guidance.

### Testing Plan

- Select unit, component, integration, or E2E coverage according to risk.
- Prefer the project's existing test tools and patterns.
- Use the narrowest reliable test for regressions.
- Reserve E2E tests for critical journeys and cross-boundary failures.
- Allow documented manual verification when automation would be disproportionate.

### Audit Skill Plan

- Inspect framework versions, configuration, source patterns, test setup, CI, and local agent instructions.
- Find contradictions, obsolete guidance, unjustified absolutes, and over-engineering risks.
- Report applicability decisions, removal candidates, and testing gaps with evidence.
- Produce up to three urgent recommendations with impact, smallest practical change, and verification.
- Validate the skill metadata and structure with the Codex skill validator.

### Completion Criteria

- All topic rules use the same governance precedence.
- Testing guidance covers unit, component, integration, and E2E decisions without requiring every tier.
- The audit skill has valid metadata and a deterministic report structure.
- Existing examples link to the governance and testing rules.
- Contradictory examples and over-absolute guidance are corrected.

## Suggested Execution Order

1. Define shared governance and applicability decisions.
2. Add risk-based testing guidance.
3. Normalize topic rules to the shared precedence and requirement levels.
4. Correct conflicting or over-absolute guidance.
5. Add and validate the codebase audit skill.
6. Update examples and README links.
7. Review all docs for consistent tone, links, and structure.
8. Commit the documentation update after review.

## Commit Plan

Use one commit if the work is completed in a single pass:

```bash
git add README.md docs/implementation-plan.md rules examples templates skills scripts
git commit -m "Add frontend rule governance and audit workflow"
```

If the actual rule expansion is done separately, use smaller commits:

```bash
git commit -m "Add implementation plan"
git commit -m "Expand TypeScript and performance rules"
git commit -m "Expand examples and templates"
git commit -m "Improve README usage guidance"
```
