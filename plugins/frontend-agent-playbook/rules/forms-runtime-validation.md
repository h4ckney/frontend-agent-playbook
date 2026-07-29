# Forms And Runtime Validation Rules

## Purpose

Define how AI agents should validate untrusted runtime data and build form workflows that remain correct, accessible, secure, and proportionate to the codebase.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Prefer the project's existing form library, schema validator, API contract, server enforcement, localization, and error conventions before introducing a new validation dependency or abstraction.

## References

- TypeScript Erased Types: https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html#erased-types
- Zod Basic Usage: https://zod.dev/basics
- Next.js App Router Forms: https://nextjs.org/docs/app/guides/forms
- Next.js Pages Router API Routes: https://nextjs.org/docs/pages/building-your-application/routing/api-routes
- WAI Validating Input: https://www.w3.org/WAI/tutorials/forms/validation/
- WAI User Notifications: https://www.w3.org/WAI/tutorials/forms/notifications/

## Applicability

- **SHOULD**: Load this rule for forms, API request or response boundaries, URL and search parameters, browser storage, environment-derived configuration, webhooks, third-party SDK payloads, and other runtime values that can violate frontend assumptions.
- **SHOULD**: Keep this rule conditional for trusted internal values already created behind a validated boundary.
- **MUST**: Do not assume TypeScript annotations validate runtime data; TypeScript types are erased from emitted JavaScript.

## Trust Boundaries

- **MUST**: Treat user-controlled, network, storage, URL, third-party, and cross-window values as untrusted until the required shape and constraints are verified.
- **SHOULD**: Validate at the narrowest stable boundary where untrusted data becomes application-owned data.
- **SHOULD**: Record whether a boundary performs validation, normalization, coercion, authorization, or only static typing.
- **MUST**: Keep authentication, authorization, ownership, rate limiting, and business invariants server-authoritative.
- **MUST**: Revalidate submitted data on the server even when client-side validation already provides immediate feedback.
- **SHOULD**: Validate external API responses when their shape is not guaranteed by a trusted same-process contract or when malformed data could corrupt important UI state.

## Schema And Type Ownership

- **SHOULD**: Reuse the project's existing runtime schema tool, such as Zod, Valibot, Yup, Ajv, io-ts, or an established generated validator.
- **MUST**: Do not add Zod or another validation dependency when the current stack already provides a suitable runtime validator.
- **SHOULD**: Derive TypeScript input and output types from the schema when the library supports it, instead of maintaining duplicate shapes manually.
- **SHOULD**: Distinguish schema input from parsed output when coercion, defaults, preprocessing, or transforms can change the value.
- **SHOULD**: Keep normalization and coercion explicit so empty strings, missing values, nulls, dates, numbers, and locale-dependent input do not change meaning silently.
- **SHOULD**: Share a schema across client and server only when the validation semantics, bundle boundary, messages, and dependencies are genuinely compatible.
- **MUST**: Do not import server-only code, secrets, database types, or authorization logic into client bundles to reuse a schema.

## Form Behavior

- **SHOULD**: Use native HTML constraints such as `required`, semantic input types, and appropriate autocomplete values when they match the product rule.
- **SHOULD**: Use client validation for timely feedback and server validation for authoritative acceptance.
- **MUST**: Preserve entered values after validation, authorization, network, or server failures unless retaining them would expose sensitive data.
- **SHOULD**: Separate field errors, form-level errors, and terminal failures so each has an appropriate recovery path.
- **MUST**: Prevent duplicate irreversible submissions while the authoritative request is pending.
- **SHOULD**: Keep reversible draft saving separate from irreversible submission when their validation and retry semantics differ.
- **SHOULD**: Avoid expensive asynchronous validation on every keystroke; choose submit, blur, debounce, or explicit availability checks based on user value and backend cost.
- **MAY**: Use optimistic UI for reversible form-related mutations only when rollback and conflict behavior are defined.

## Validation Results And Errors

- **SHOULD**: Represent expected validation failure as data rather than an uncaught exception.
- **SHOULD**: With Zod, prefer `safeParse` or `safeParseAsync` for expected invalid external input and reserve throwing parse paths for programmer invariants or established error boundaries.
- **MUST**: Handle asynchronous refinements or transforms with the validator's asynchronous parse API.
- **SHOULD**: Map server field errors only to fields the current form owns; keep unknown or cross-field failures at the form level.
- **MUST**: Do not expose stack traces, internal identifiers, authorization details, or raw upstream payloads in user-facing validation messages.
- **SHOULD**: Preserve a stable machine-readable error code when product copy is localized or may change.

## Accessibility And Localization

- **MUST**: Associate field errors programmatically with their controls and identify invalid fields in text, not color alone.
- **SHOULD**: Move focus to the first invalid field or a concise error summary after failed submission when the error would otherwise be missed.
- **SHOULD**: Announce dynamically inserted form-level status with an appropriate live region without causing unnecessary repeated interruption.
- **SHOULD**: Make messages actionable and identify the expected correction without exposing security-sensitive acceptance rules.
- **SHOULD**: Keep validation messages compatible with the project's localization and pluralization model.
- **SHOULD**: Accept reasonable user input formats and normalize after parsing when product requirements allow it.

## Next.js Boundaries

- **SHOULD**: App Router: validate `FormData` and other untrusted input inside the Server Action or Route Handler before mutation.
- **MUST**: App Router: do not treat a Server Action boundary as authorization by itself; verify the current user and resource access inside the server mutation path.
- **SHOULD**: App Router: return serializable validation state that the client form can map without exposing server-only details.
- **SHOULD**: Pages Router: validate `req.body`, `req.query`, cookies, and dynamic route values in the API route or server boundary that owns the operation.
- **MUST**: Do not apply Server Action or `useActionState` guidance to a Pages Router-only application.
- **SHOULD**: Keep client-side form-library integration consistent with the active router and React version instead of migrating form architecture during a narrow validation change.

## Observability And Privacy

- **SHOULD**: Report unexpected parse failures through the existing observability path with boundary, operation, and safe error-category context.
- **MUST**: Do not log passwords, tokens, complete form payloads, personal data, or raw validation input.
- **SHOULD**: Distinguish expected user validation failures from operational errors so monitoring is not flooded with normal input mistakes.
- **MAY**: Measure aggregated validation failure categories when product value, privacy policy, and telemetry conventions justify it.

## Testing

- **SHOULD**: Unit-test meaningful schema boundaries, transforms, coercion, and error normalization.
- **SHOULD**: Use component or integration tests for field association, focus recovery, pending state, server error mapping, retry, and value preservation.
- **SHOULD**: Use E2E coverage for high-risk multi-step, authentication, payment, destructive, or irreversible submission journeys.
- **MUST**: Include server rejection in verification when client and server acceptance rules can diverge.
- **SHOULD**: Test representative malformed external payloads without copying secrets, personal data, or production payloads into fixtures.

## Avoid Over-engineering

- **MUST**: Do not validate every internal object merely because a schema library is available.
- **SHOULD**: Prefer one owned boundary schema over wrapper layers that repeat the same parsing and error mapping.
- **SHOULD**: Do not build a generic form framework for one workflow.
- **SHOULD**: Do not force one client and server schema when their responsibilities or accepted inputs intentionally differ.
- **SHOULD**: Add runtime validation where failure affects correctness, security, data integrity, recovery, or repeated maintenance cost.

## Verification

Report:

- The untrusted inputs and the boundary that validates each one
- The schema tool reused or why no library is needed
- Client feedback versus server-authoritative validation
- Input-to-output normalization or coercion
- Field, form, authorization, and operational error behavior
- Accessibility and localization behavior
- Tests and manual checks run, plus unverified server or third-party assumptions

Do not claim that a TypeScript type, client-side schema, or successful happy-path test proves server acceptance, authorization, or runtime safety.

## AI Agent Checklist

- Did I identify which values are untrusted at runtime?
- Is validation performed at the boundary that owns the data?
- Does the server remain authoritative for acceptance and authorization?
- Did I reuse the existing validation and form stack?
- Are input and parsed output types intentionally different where needed?
- Can users find, understand, and recover from errors accessibly?
- Are sensitive values excluded from logs and telemetry?
- Did I choose the narrowest reliable unit, integration, or E2E coverage?
