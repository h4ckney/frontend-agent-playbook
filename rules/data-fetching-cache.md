# Data Fetching And Cache Rules

## Purpose

Define how AI agents should fetch, cache, revalidate, mutate, and display remote data in frontend applications without creating stale UI, request waterfalls, or unnecessary client complexity.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Prefer the framework's current data model, server and client boundaries, backend cache contracts, and existing project utilities before introducing a new fetch abstraction.

## References

- Next.js Fetching Data: https://nextjs.org/docs/app/getting-started/fetching-data
- Next.js Caching: https://nextjs.org/docs/app/getting-started/caching
- Next.js `fetch` API: https://nextjs.org/docs/app/api-reference/functions/fetch
- React `Suspense`: https://react.dev/reference/react/Suspense
- React `use`: https://react.dev/reference/react/use
- React `useTransition`: https://react.dev/reference/react/useTransition

## Core Rules

- **SHOULD**: Match data fetching strategy to the framework and route mode already in use.
- **SHOULD**: Fetch on the server by default when the framework supports it and the interaction does not require immediate client ownership.
- **SHOULD**: Be explicit about cache behavior, freshness, and invalidation for every non-trivial remote read.
- **SHOULD**: Avoid request waterfalls when data can be fetched independently.
- **SHOULD**: Keep mutation flows coherent: optimistic updates, invalidation, rollback, and post-submit UI should agree.
- **MUST**: Do not introduce a new query or cache library for a narrow task when the existing stack already covers the need.

## Server And Client Boundaries

- **SHOULD**: In Next.js App Router, prefer Server Components for read-heavy data that does not require client interactivity.
- **SHOULD**: Use Client Components for user-driven refresh, local interaction, browser-only APIs, or state that must live on the client.
- **SHOULD**: In Pages Router or non-RSC React apps, follow the project's existing fetching layer before introducing route-local patterns.
- **MUST**: Do not move data fetching client-side only to avoid understanding the current server path.
- **SHOULD**: When React Suspense or `use` is already part of the stack, follow that pattern instead of mixing incompatible loading models in the same flow.

## Cache Rules

- **SHOULD**: Declare whether data should be cached, revalidated, or always fetched fresh.
- **SHOULD**: Prefer framework-native cache controls and tags before ad hoc cache-busting query parameters.
- **MUST**: Do not rely on default caching behavior when freshness materially affects correctness.
- **SHOULD**: Avoid duplicate caches that can drift from each other without a clear owner.
- **SHOULD**: Document or encode invalidation boundaries when a mutation affects multiple views.

## Mutation Rules

- **SHOULD**: Prefer server-side mutation boundaries that return a clear success or failure contract.
- **SHOULD**: Keep pending, success, validation-error, authorization-error, and retry states visible when they affect user decisions.
- **SHOULD**: Use optimistic UI only when rollback behavior is understood and the product value justifies the complexity.
- **MUST**: Do not leave stale lists, counters, badges, or detail views after a successful mutation.
- **SHOULD**: Avoid silent background overwrites when the user could lose unsaved work.

## Loading And Error Rules

- **SHOULD**: Represent loading, empty, error, and success states deliberately for data-dependent UI.
- **SHOULD**: Keep skeletons, placeholders, or fallbacks visually close to the content they represent.
- **SHOULD**: Prefer localized loading boundaries over full-page blocking when only part of the view is waiting.
- **MUST**: Do not swallow fetch failures. Surface actionable recovery when the workflow is important.
- **SHOULD**: Preserve already revealed content during refresh when the framework and UX pattern support it.

## Next.js-Specific Rules

- **SHOULD**: App Router: distinguish static, dynamic, and revalidated data intentionally. Use route or fetch-level controls that match the freshness requirement.
- **SHOULD**: App Router: use tags, revalidation, or framework-supported cache invalidation instead of ad hoc client refetch loops when the source of truth is server-owned.
- **SHOULD**: Pages Router: respect existing `getServerSideProps`, `getStaticProps`, API route, or client-fetch conventions already present in the codebase.
- **MUST**: Do not mix incompatible router assumptions in the same review or implementation.

## Change Requirements

- **MUST**: Explain cache and freshness behavior for any new remote read that affects user-visible correctness.
- **SHOULD**: Add focused tests for state transitions or data-dependent rendering when the project has an appropriate layer.
- **SHOULD**: Fetch in parallel when requests are independent and latency-sensitive.
- **MAY**: Use client-side fetching for user-scoped live interaction, polling, or browser-owned state when that pattern already exists.
- **MUST**: Explain why a new data abstraction, cache layer, or invalidation mechanism is necessary before adding it.

## Verification

Report:

- Where data is fetched and why that boundary was chosen
- Cache mode, revalidation, invalidation, or refetch behavior changed by the task
- Loading, empty, error, success, and mutation states that were verified
- Remaining risk around stale data, duplicate requests, or unsynchronized views

Do not claim cache correctness without checking the actual invalidation and refresh path.

## AI Agent Checklist

- Did I choose the server or client boundary that already fits this app?
- Is cache behavior explicit enough for correctness-sensitive data?
- Did I create a request waterfall that could be parallelized?
- Are loading, empty, error, and success states coherent?
- After mutation, which views can become stale and how are they refreshed?
- Did I avoid introducing a new fetch abstraction without a real gap?
