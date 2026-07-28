# Production Feature Example: Job Application Submission

This example shows how an agent should route rules and carry evidence through audit, proposal, approval, application, implementation, testing, and a local Issue draft. It is representative, not a claim about a live repository.
It documents the expected implementation and review contract; it is not a runnable Next.js application and does not claim that the feature tests below were executed.

## Codebase Context

- Next.js 14 App Router with framework-managed RSC
- React 18 and TypeScript 5.x
- TanStack Query v5 for server state
- React Hook Form and Zod already installed
- Sentry already configured
- Vitest, Testing Library, Mock Service Worker, and Playwright already in CI
- Existing project guidance lives under `.agents/rules/`

The feature edits and saves a job-application draft, then submits it as a separate irreversible action.

## Selected Guidance

- Always loaded: `rules/governance.md`
- Task core: `rules/react.md`, `rules/typescript.md`, `rules/forms-runtime-validation.md`, `rules/data-fetching-cache.md`, `rules/error-handling-observability.md`
- Risk triggered: `rules/accessibility.md`, `rules/testing.md`
- Excluded: SEO, performance, dead-code, and router migration guidance because this task does not change public indexing, measured performance, removal scope, or route ownership

The five-file task core is an explicit exception to the normal two-to-four-file target because this cross-boundary workflow combines React interaction, runtime validation, remote mutation, cache ownership, and operational recovery.

## Audit Handoff

| Finding ID | Evidence status | Evidence | Limitation |
| --- | --- | --- | --- |
| `application.validation-boundary-drift` | Observed fact | Three submission handlers apply different client-only schemas | Server behavior still requires API-owner confirmation |
| `application.draft-rollback-missing` | Observed fact | Draft cache remains optimistic after a failed save | Runtime frequency and user impact are not measured |
| `testing.application-submit-e2e-gap` | Risk inference | Component tests cover validation, but no final-submit Playwright path exists | Test inventory does not prove production failure |

Source excerpts, payloads, applicant data, and environment values are intentionally omitted.

## Guidance Decision

Repeated validation-boundary drift justifies one scoped project rule. A new project skill is not justified because the repository already has an implementation workflow and the required behavior is a concise reusable constraint.

- Proposal: [guidance-proposal.md](guidance-proposal.md)
- Approved artifact: [application-submission.md](fixtures/.agents/rules/application-submission.md)
- Follow-up Issue draft: [issue-draft.md](issue-draft.md)

## Implementation Shape

Use one shared schema for client feedback and request typing, while treating server validation as authoritative:

Zod is reused because it is already installed. This workflow does not justify introducing a second validator or making Zod mandatory for other repositories.

```ts
const applicationDraftSchema = z.object({
  coverLetter: z.string().trim().min(50).max(4_000),
  portfolioUrl: z.string().url().optional().or(z.literal("")),
  consent: z.literal(true),
});

type ApplicationDraftInput = z.input<typeof applicationDraftSchema>;
type ApplicationDraft = z.output<typeof applicationDraftSchema>;
```

Draft saving may update the cache optimistically because it is reversible. Snapshot the exact query, restore it on failure, and invalidate after settlement:

```ts
useMutation({
  mutationFn: saveApplicationDraft,
  onMutate: async (nextDraft) => {
    await queryClient.cancelQueries({ queryKey: applicationKeys.detail(applicationId) });
    const previous = queryClient.getQueryData<ApplicationDraft>(applicationKeys.detail(applicationId));
    queryClient.setQueryData(applicationKeys.detail(applicationId), nextDraft);
    return { previous };
  },
  onError: (error, _nextDraft, context) => {
    queryClient.setQueryData(applicationKeys.detail(applicationId), context?.previous);
    captureException(error, { tags: { operation: "application-draft-save" } });
  },
  onSettled: () => queryClient.invalidateQueries({
    queryKey: applicationKeys.detail(applicationId),
  }),
});
```

Final submission must not be optimistic. Disable duplicate submission while pending, map server field errors back to fields, focus the error summary for non-field failures, and navigate only after confirmed success.

## UI State Contract

| State | Required behavior |
| --- | --- |
| Initial loading | Preserve page structure and expose a named loading state |
| Empty draft | Render editable defaults without treating absence as an error |
| Client validation error | Associate messages with fields and move focus to the first invalid field |
| Draft save pending | Keep editing available and show non-blocking save status |
| Draft save failure | Restore prior cache, retain entered values, expose retry, report through existing Sentry path |
| Final submit pending | Disable duplicate final submission and announce progress |
| Server field error | Map errors to owned fields without discarding user input |
| Terminal submit failure | Focus an accessible summary and offer a safe retry |
| Success | Invalidate application and application-list queries, then navigate to confirmation |

## Test Matrix

| Layer | Regression covered |
| --- | --- |
| Unit | Schema boundaries, API error normalization, query-key helpers |
| Integration | Client and server field errors, focus movement, optimistic draft rollback, duplicate-submit prevention |
| E2E | Authenticated user completes required fields, submits once, and reaches confirmation |
| Manual | Keyboard-only error recovery, screen-reader announcement, Sentry redaction, slow-network behavior |

The E2E test should stub or sandbox the external submission boundary. It must not create a real application or depend on production data.

## Expected Review Gates

- Critical: Verify that final submission is not optimistic and server rejection preserves entered data.
- Standards: Verify accessible names, field associations, focus recovery, cache ownership, and existing observability.
- Optimization: Reject a new state library, form abstraction, schema package, or generic mutation wrapper unless separate evidence justifies it.

## Approval Gate Example

Use the checked-in [approval-request.json](approval-request.json), which supplies matching approval and request metadata for the fixture artifact's SHA-256 fingerprint:

```bash
node scripts/guidance-approval.mjs examples/production-application/approval-request.json
```

Expected first-run action: `apply`.

Use [approval-rerun.json](approval-rerun.json) to model an inventory containing the already-applied artifact:

```bash
node scripts/guidance-approval.mjs examples/production-application/approval-rerun.json
```

Expected rerun action: `noop`.

Any repository, scope, behavior, path, dependency, enforcement, or fingerprint conflict must stop application for review.
The caller remains responsible for verifying repository identity, owner approval, file ownership, current paths, and the fingerprints supplied to the script.

## Verification

```bash
node scripts/validate-docs.mjs
node --test scripts/guidance-approval.test.mjs
```

In a target repository, also run its focused typecheck, lint, integration test, E2E test, and build commands. Unavailable checks remain unverified.
