# Application Submission

## Purpose

Keep application draft saving reversible and final submission server-authoritative.

## Applicability

Apply this rule to application draft, validation, final-submission, and related test changes.

## Requirements

- **MUST**: Treat server validation and authorization as authoritative for final submission.
- **MUST**: Do not optimistically mark final submission successful or navigate before confirmed success.
- **MUST**: Prevent duplicate final-submission requests while one is pending.
- **MUST**: Preserve entered values and expose an accessible recovery path after rejection.
- **SHOULD**: Snapshot and restore the owned query cache when draft saving uses an optimistic update.
- **SHOULD**: Use the existing Sentry path without applicant content, field values, or sensitive payloads.
- **MAY**: Keep draft editing available during background saving when concurrency behavior remains correct.

## Exceptions

Any exception requires an approved API contract, affected scope, owner, regression verification, and recheck trigger.

## Verification

- Run focused schema and error-normalization unit tests.
- Run integration tests for field errors, focus recovery, rollback, and duplicate-submit prevention.
- Run the sandboxed final-submission E2E journey.
- Recheck this rule when the API contract, form library, cache ownership, or route model changes.
