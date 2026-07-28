# Error Handling And Observability Rules

## Purpose

Define how AI agents should model failures, user-facing recovery, logging, and telemetry in frontend applications without hiding errors or over-instrumenting low-value paths.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Prefer existing project logging, tracing, and alerting pipelines plus framework-supported error boundaries before adding new observability code.

## References

- Next.js Error Handling: https://nextjs.org/docs/app/getting-started/error-handling
- Next.js `instrumentation.js`: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
- Next.js OpenTelemetry Guide: https://nextjs.org/docs/app/guides/open-telemetry
- OpenTelemetry Browser Getting Started: https://opentelemetry.io/docs/languages/js/getting-started/browser/
- MDN `Window:error`: https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event
- MDN `Window:unhandledrejection`: https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event
- MDN `Error`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error

## Core Rules

- **SHOULD**: Treat failure handling as part of the feature, not cleanup after the happy path.
- **SHOULD**: Surface actionable user-facing recovery for meaningful failures.
- **SHOULD**: Preserve diagnostics needed for debugging while minimizing sensitive data in logs and telemetry.
- **SHOULD**: Prefer existing error boundaries, logger utilities, tracing hooks, and deployment instrumentation over ad hoc console output.
- **SHOULD**: Distinguish expected domain failures from unexpected application failures.
- **MUST**: Do not hide errors by catching them without recovery, logging, or user-visible consequence.

## User-Facing Failure Rules

- **SHOULD**: Model loading, empty, validation-error, authorization-error, retryable failure, and terminal failure states intentionally when they affect the workflow.
- **SHOULD**: Use inline validation and field-level messaging for user-correctable input problems.
- **SHOULD**: Use route, section, or component-level error boundaries that match the blast radius of the failure.
- **SHOULD**: Preserve user input when retrying or recovering from recoverable failures whenever practical.
- **SHOULD**: Do not replace the whole page with a generic fallback when a smaller recovery scope is available.

## Error Modeling Rules

- **SHOULD**: Throw or return structured errors with enough context to make the next layer behave correctly.
- **SHOULD**: Avoid stringly typed error branching when the project already has a structured error shape.
- **SHOULD**: Normalize backend and network failures at the boundary closest to the transport.
- **SHOULD**: Keep domain-specific recovery logic near the feature that can act on it.
- **SHOULD**: Do not use exceptions for ordinary branching when the framework or codebase models that flow explicitly.

## Logging And Telemetry Rules

- **SHOULD**: Prefer one approved logging or telemetry path over multiple disconnected ones.
- **SHOULD**: Capture event name, route or feature context, severity, and correlation identifiers when available.
- **MUST**: Do not log passwords, tokens, raw form payloads, session identifiers, or unnecessary personal data.
- **SHOULD**: Rate-limit or deduplicate noisy client-side errors when the same failure can spam telemetry.
- **SHOULD**: Remove temporary debug logging before completion unless the task explicitly requires persistent instrumentation.

## Framework And Runtime Rules

- **SHOULD**: In Next.js, use framework-supported error boundaries, route conventions, and instrumentation files before custom global handlers.
- **SHOULD**: If browser-level listeners such as `error` or `unhandledrejection` are added, document why existing instrumentation is insufficient.
- **SHOULD**: Keep client observability code lightweight. Telemetry should not materially degrade startup or interaction performance.
- **MUST**: Do not add tracing, replay, or monitoring SDKs without a clear operational reason and privacy review.

## Change Requirements

- **MUST**: Handle or explicitly surface meaningful user-facing failures for new async or remote workflows.
- **SHOULD**: Add focused verification for error and retry paths when the workflow is important or previously regressed.
- **SHOULD**: Preserve user-entered state through recoverable failures when possible.
- **MAY**: Leave low-risk internal tooling paths with simpler logging if the project already treats them as non-critical.
- **MUST**: Explain missing instrumentation or unverified failure paths when the change touches critical flows.

## Verification

Report:

- Which user-visible error states were added, changed, or preserved
- Which logs, traces, or telemetry events were added, removed, or intentionally avoided
- Error and retry paths verified by tests or local checks
- Remaining blind spots, environment dependencies, or alerting assumptions

Do not claim observability coverage unless the event path is actually wired into the project's existing tooling.

## AI Agent Checklist

- What happens for loading, empty, validation, auth, timeout, and unknown failure cases?
- Does the user get a practical recovery path?
- Did I catch an error without preserving diagnostics or visible behavior?
- Did I leak sensitive data into logs or telemetry?
- Did I reuse the project's existing boundary, logger, and instrumentation path?
- Is the added telemetry worth its runtime and privacy cost?
