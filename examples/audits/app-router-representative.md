# App Router Representative Audit

This example tests the audit workflow against a version-pinned representative App Router scenario. It is not presented as a live repository audit.

## Evidence Status

The scenario is intentionally constructed to exercise App Router, RSC, cache invalidation, metadata, error boundaries, and E2E decisions. Paths below belong to the fixture description rather than a private production repository.

## Codebase Context

- Next.js 14.2 App Router only
- React 18.3 with framework-managed React Server Components
- TypeScript 5.4
- Server Components by default with isolated Client Components
- Vitest for unit and component tests
- Playwright for checkout E2E
- Existing application logger and Sentry integration

Fixture evidence:

- app/layout.tsx is a Server Component.
- app/products/[slug]/page.tsx fetches product data on the server.
- app/products/ProductFilters.tsx is a Client Component for URL-backed interaction.
- app/api/cart/route.ts mutates cart data.
- The cart mutation does not invalidate the server-owned cart summary.
- Dynamic product pages do not define generateMetadata.
- Checkout has no route-level error boundary.

## Selected Guidance

- Always: governance
- Loaded: React, Next.js App Router, TypeScript, data fetching/cache, error handling/observability, SEO, testing, and code review
- Conditional inspection: security/privacy for checkout and payment boundaries
- Excluded: Pages Router rules and dead-code guidance
- Not assessed: measured performance and bundle behavior
- Evidence: fixture route tree, rendering ownership, mutation behavior, metadata convention, error boundary inventory, and test inventory

## Existing Rules and Skills

- Keep governance, React, TypeScript, accessibility, security/privacy, data/cache, error handling, SEO, testing, and code-review guidance.
- Apply only App Router sections of the Next.js rules.
- Apply RSC guidance because the framework and route tree confirm supported integration.
- Keep Pages Router guidance available for other projects, but disable it for this fixture.

## Conflicts

- A client-fetch-by-default preference conflicts with the server-owned product read model.
- A broad use-client recommendation conflicts with the existing narrow Client Component boundary.
- Treating a successful cart mutation as complete conflicts with the stale server-rendered cart summary.
- Generic Head examples conflict with App Router metadata conventions.

## Applicability Decisions

| Guidance | Decision | Evidence |
| --- | --- | --- |
| App Router and RSC rules | Keep | app route tree and framework-managed RSC integration |
| Pages Router data methods | Disable | No pages route tree |
| Server-first product reads | Keep | Product data is read by a Server Component |
| Client Components | Conditional | Filters require interaction and URL state; layout and product reads do not |
| App Router metadata | Keep | Dynamic indexable product routes |
| New query library | Disable | No demonstrated client cache ownership gap |

## Over-engineering Risks

- Do not move product reads to a client query library only to standardize APIs.
- Do not mark the root layout as a Client Component to satisfy one interactive child.
- Do not add a second observability SDK when the fixture already has a logger and Sentry.
- Do not introduce optimistic cart UI until rollback and server-summary invalidation are defined.

## Removal Candidates

None. The fixture contains no evidence sufficient for deletion.

## Security Or Privacy Risks

No secret exposure or unsafe HTML pattern is part of the fixture. Authentication and payment authorization remain server responsibilities and require separate runtime verification.

## Data Fetching Or Cache Risks

### Observed fact

The cart mutation succeeds without invalidating or revalidating the server-owned cart summary.

### Risk inference

Users can see stale totals or item counts after a successful mutation. The exact duration depends on cache configuration not supplied by the fixture.

## Error Handling Or Observability Risks

Checkout lacks a route-level error boundary. A provider or server failure can replace too much UI or provide no scoped recovery path. Existing Sentry instrumentation should be reused rather than replaced.

## SEO Risks

Dynamic product pages have no generateMetadata implementation in the fixture. This is a review finding, not proof that deployed pages lack all metadata because inherited layout metadata and rendered output were not inspected.

## Testing Gaps

- Cart mutation tests do not assert that the server-owned summary becomes fresh.
- Checkout E2E does not cover provider failure and user recovery.
- Product metadata has no rendered-output assertion for representative slugs.

## Urgent Recommendations

### 1. Restore cart freshness after mutation

- Evidence: The mutation and server summary have no connected invalidation path
- Impact: User-visible totals and item counts can remain stale
- Smallest practical change: Use the existing App Router revalidation mechanism at the mutation owner
- Verification: Test mutation success, refreshed summary, duplicate submission, and failure behavior

### 2. Add a scoped checkout recovery boundary

- Evidence: Checkout has no route-level error boundary
- Impact: Payment-provider or server failure lacks a predictable recovery surface
- Smallest practical change: Add the framework-supported boundary at the smallest route scope that can retry safely
- Verification: Exercise provider rejection, retry, preserved intent, logging, and sensitive-data redaction

### 3. Verify dynamic product metadata

- Evidence: No route-specific metadata generator in the fixture
- Impact: Product pages may inherit generic search and sharing metadata
- Smallest practical change: Generate metadata from the existing server-owned product read without adding a duplicate client request
- Verification: Inspect rendered title, description, canonical, status, and not-found behavior for representative products

## Proposed Changes

1. Connect cart mutation completion to the existing server cache owner.
2. Add focused cart freshness tests.
3. Add the checkout error boundary and one provider-failure E2E case.
4. Add dynamic product metadata and rendered-output verification.
5. Re-run the audit with real cache configuration and deployment output.

Dead-code and measured-performance domains were not selected and must not be read as having no findings.
