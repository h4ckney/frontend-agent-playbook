# Pages Router to App Router Migration Playbook

Use this playbook only for an explicitly scoped migration. A feature, bug fix, SEO correction, or dependency update does not authorize router migration.

## Decision Gate

Proceed only when all of the following are known:

- The installed Next.js, React, Node.js, and deployment platform versions support the intended App Router behavior.
- The route owner has named a concrete benefit such as shared layouts, streaming, Server Components, or removal of a verified Pages Router constraint.
- The affected URLs, rendering mode, data dependencies, authentication boundary, metadata, analytics, and rollback owner are inventoried.
- The team accepts temporary mixed-router operation and can test both route trees.

Defer the migration when the benefit is only “newer architecture,” a critical feature has the same deadline, framework or library compatibility is unknown, or rollback cannot restore the original URL behavior.

## Migration Boundaries

- **MUST**: Classify each URL as Pages, App, or intentionally redirected. Do not apply one router's conventions globally in a mixed repository.
- **MUST**: Keep `pages/_app` and `pages/_document` behavior for remaining Pages routes while introducing the App Router root layout.
- **MUST**: Treat Server Components, cache behavior, metadata, and Route Handlers as new execution contracts, not file moves.
- **SHOULD**: Migrate one coherent route slice at a time while preserving public URLs.
- **SHOULD**: Keep API Route migration separate unless the selected page cannot move without it.
- **MAY**: Keep both routers indefinitely when ownership and route-tree tests make the boundary explicit.

## Phase 0: Baseline

Record before editing:

- URL inventory, status codes, redirects, canonical URLs, metadata, structured data, and sitemap membership
- `getServerSideProps`, `getStaticProps`, `getStaticPaths`, API Routes, middleware or proxy, and custom `_app`, `_document`, and error behavior
- provider tree, browser-only dependencies, global styles, scripts, analytics, auth, feature flags, and observability
- representative HTML, RSC-disabled baseline behavior, cache headers, performance measurements, and critical journey tests

Upgrade Next.js or Node.js separately when compatibility work is required. Passing an upgrade does not approve route migration.

## Phase 1: Coexistence Shell

1. Add the smallest valid App Router root layout.
2. Move only layout concerns required by the first App route.
3. Put context providers that require state, effects, or browser APIs behind a narrow Client Component boundary.
4. Verify that remaining Pages routes still receive their existing `_app`, `_document`, styles, scripts, and analytics behavior.

Exit when an App-only probe route and representative Pages routes build, render, navigate, report errors, and preserve expected styles without URL collisions.

## Phase 2: One Route Slice

1. Choose a low-coupling route or one route group with an explicit owner.
2. Map the page to `page`, nested `layout`, `loading`, `error`, and `not-found` files only where their behavior is required.
3. Keep components server-rendered by default, then add `"use client"` only at boundaries that need state, effects, event handlers, or browser APIs.
4. Verify that props crossing the Server-to-Client boundary are serializable.
5. Remove the old Pages route only in the same reviewed change that proves the App route owns the URL.

Do not leave two route trees claiming the same URL and do not use a broad `"use client"` boundary to preserve the old component model without measuring the shipped result.

## Phase 3: Data, Cache, And Metadata

- Replace Pages data functions with App Router data access intentionally; document freshness, revalidation, request-specific behavior, and invalidation after mutations.
- Preserve authorization on the server. A Server Component or Route Handler is not an authorization policy by itself.
- Translate `next/head` behavior into static `metadata` or `generateMetadata` only after recording the final rendered title, description, canonical, robots, and social metadata.
- Check dynamic params, search params, locale handling, preview or draft behavior, and not-found responses against the installed Next.js version.
- Treat a change from request-time rendering to cached or prerendered output as a product and data-correctness decision.

## Phase 4: Route Handlers

Migrate a `pages/api` endpoint only when it is in scope and its clients, runtime, authentication, body parsing, streaming, cache, status, headers, and error contract are covered. Route Handlers use Web `Request` and `Response` APIs; do not assume an API Route handler can be renamed unchanged.

Do not colocate `route.ts` and `page.tsx` at the same segment level.

## SEO And Redirect Contract

- Preserve public URL, status, canonical, indexability, internal links, sitemap membership, and structured data unless a separately approved URL migration changes them.
- Use permanent redirects only for intentionally permanent URL moves; verify query, locale, base path, and method behavior.
- Compare final production-like HTML and headers. Configuration presence alone does not prove crawler-visible output.
- Keep old-to-new redirects for the agreed retention period and monitor 404s, redirect loops, canonical conflicts, and indexing signals.

## Verification Matrix

For every migrated slice:

- typecheck, lint, production build, unit and integration tests
- direct request, hard refresh, client navigation, back and forward navigation
- loading, empty, error, not-found, auth, permission, and mutation paths
- mobile and desktop interaction, keyboard and focus behavior
- final HTML, metadata, status, redirects, cache headers, analytics, and error reporting
- bundle and performance comparison when the client boundary or data waterfall changed

Mixed-router CI must exercise at least one representative route from each tree until migration is complete.

## Rollback

Keep each slice reversible:

1. Restore the Pages route and its data functions.
2. Remove or disable the conflicting App route for that URL.
3. Revert route-specific redirects, metadata, and cache changes.
4. Preserve unrelated App routes and shared compatibility fixes.
5. Repeat the pre-migration verification matrix.

Rollback must not depend on a database or API change that cannot be reversed within the same release window.

## Completion

Remove `pages/_app`, `pages/_document`, Pages-only dependencies, compatibility adapters, and mixed-router exceptions only after no owned URL or API endpoint depends on them and production evidence confirms the final route inventory.

## Official References

- [Next.js: How to migrate from Pages to the App Router](https://nextjs.org/docs/pages/guides/migrating/app-router-migration)
- [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js: Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)
- [Next.js: Metadata and OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images)
- [Next.js: Redirecting](https://nextjs.org/docs/app/guides/redirecting)
