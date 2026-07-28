# Pages Router Production Audit

This example shows how to apply the audit skill to an established Pages Router application without importing App Router or RSC assumptions.

## Evidence Status

The repository identity, product names, source paths, and source code are intentionally omitted. Counts and stack details come from an anonymized audit summary supplied by the repository owner. This file is an example of audit reasoning, not independently reproduced evidence.

## Codebase Context

- Next.js 13 with Pages Router only
- React 18 without React Server Components
- TypeScript 4.x with `satisfies` support
- An established server-state library plus class-based dependency injection and observable client state
- A mature unit-test suite and a smaller Playwright E2E suite
- Existing error monitoring and mature CI

The installed versions and route tree make App Router, Server Component, Server Action, and App Router metadata conventions inapplicable.

## Selected Guidance

- Always: governance
- Loaded: React, Next.js Pages Router, TypeScript, security/privacy, testing, and code review
- Conditional inspection: error handling and observability because Sentry exists
- Excluded: App Router and RSC rules
- Not assessed from the supplied summary: performance, detailed cache behavior, SEO output, and dead-code reachability
- Evidence: supplied package versions, route model, lint state, test inventory, HTML sink count, storage classification, and reported bug history

## Existing Rules and Skills

- Keep governance precedence and evidence requirements.
- Apply React rules in a non-RSC rendering model.
- Apply Pages Router-specific Next.js rules.
- Apply TypeScript rules compatible with 4.9, including the supported satisfies operator.
- Apply security/privacy, testing, error-handling, and code-review rules; keep SEO output unassessed until route-level evidence is available.
- Keep the audit skill, but distinguish supplied evidence from direct repository inspection.

## Conflicts

- Generic RSC guidance conflicts with the Pages Router-only architecture and must not be applied.
- A blanket browser-storage warning conflicts with observed use: storage keys hold UI state, tooltip, scroll, and display flags rather than credentials.
- A blanket public-environment-variable warning conflicts with the documented provider model: the observed third-party client SDK identifiers are designed to be public.
- A blanket Effect dependency recommendation would be too broad, but this project has both a disabled exhaustive-deps rule and multiple reported dependency-omission regressions.

## Applicability Decisions

| Guidance | Decision | Evidence |
| --- | --- | --- |
| Pages Router conventions | Keep | Pages Router is the only active route model |
| App Router and RSC guidance | Disable | No App Router route tree or RSC integration |
| TypeScript 4.9 literal features | Keep | Installed compiler supports satisfies |
| TypeScript 5 const type parameters | Conditional | Requires a separately approved compiler upgrade |
| Browser token-storage warning | Keep, no finding | No token or password values were observed in browser storage |
| Public environment key warning | Conditional | Observed keys are provider-approved public client identifiers |
| Effect dependency review | Keep | Disabled lint rule plus repeated concrete bug history |

## Over-engineering Risks

- Do not propose an App Router or RSC migration during the security and test work.
- Do not replace established server-state, dependency-injection, or observable-state tools without a demonstrated ownership defect.
- Do not add another test framework; use the established Vitest and Playwright stack.
- Do not treat a SafeHtml component as authorization to render arbitrary HTML. It must encode an approved trust and sanitization boundary.

## Removal Candidates

No removal candidate is supported by the supplied evidence. A separate dead-code audit would be required before recommending deletion.

## Security Or Privacy Risks

### Observed facts

- Multiple `dangerouslySetInnerHTML` call sites were reported across the inspected feature set.
- No DOMPurify, isomorphic-dompurify, sanitize-html, or equivalent dependency or import was reported.
- Some content is backend-provided, while other content may cross third-party or user-derived boundaries.
- No documented HTML trust boundary was reported.

### Risk inference

The combination creates an unreviewed XSS exposure surface. It does not prove that every call site is exploitable because backend sanitization and runtime response controls were not independently verified.

### No finding

- No authentication token or password was reported in localStorage or sessionStorage.
- Provider-approved public client identifiers are not treated as leaked secrets.

## Error Handling Or Observability Risks

Error monitoring is already present. Reuse the existing monitoring and application logger path when adding HTML-boundary diagnostics or payment-flow telemetry. Do not add another monitoring SDK from this audit alone.

## Testing Gaps

The smaller E2E suite is concentrated around partial or lower-risk journeys. Reported high-risk conversion gaps are:

- A high-value submission journey
- Third-party payment completion and failure recovery
- Full account-registration completion

The number of existing tests is not the issue. The gap is failure cost and cross-boundary coverage in these journeys.

## Urgent Recommendations

### 1. Define the HTML trust boundary

- Evidence: Multiple HTML sinks, no sanitizer dependency or import, and no documented trust boundary
- Impact: Third-party or user-derived HTML could bypass a consistent review and sanitization boundary
- Smallest practical change: Inventory content sources, define approved trust levels, and route permitted rich HTML through one reviewed SafeHtml boundary
- Verification: Add malicious-markup fixtures, verify sanitizer behavior, inspect CSP and backend contracts, and exercise representative call sites

### 2. Promote exhaustive-deps from off to warn

- Evidence: The rule is disabled and multiple dependency-omission regressions were reported
- Impact: Stale closures and missed synchronization have repeated in production work
- Smallest practical change: Enable warn, baseline existing reports, and fix findings by risk without blind dependency insertion
- Verification: Reproduce known failure classes, run lint and tests, and confirm changed Effect frequency and cleanup behavior

### 3. Cover one high-risk conversion journey at a time

- Evidence: A smaller E2E suite exists, but submission, payment, and registration completion are not represented
- Impact: Revenue or conversion failures can cross frontend, backend, provider, and auth boundaries undetected
- Smallest practical change: Start with the highest-cost journey and cover success plus one valuable failure path using existing Playwright infrastructure
- Verification: Run in CI with controlled test data and stable user-visible locators

## Proposed Changes

1. Document content origins and trust decisions before changing all reported call sites.
2. Implement and test the smallest approved SafeHtml boundary.
3. Enable exhaustive-deps as warn with a measured cleanup plan.
4. Add the first high-risk Playwright journey.
5. Re-run the audit and record unresolved backend or deployment assumptions.

Unassessed cache, SEO, performance, and dead-code domains require their own evidence before a no-finding conclusion.
