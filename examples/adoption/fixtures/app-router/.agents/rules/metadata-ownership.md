# App Router Metadata Ownership

## Purpose

Keep indexable App Router metadata owned by the same server boundary as route content so titles, canonicals, status behavior, and not-found behavior do not drift.

## Applicability

Apply to indexable routes under `app/`. Do not apply to the Pages Router tree, private routes, or routes explicitly classified as non-indexable.

## Rules

- **MUST**: Derive route-specific metadata from the existing server-owned route data or a shared cached read; do not add a duplicate client request for metadata.
- **MUST**: Keep canonical URLs, redirects, sitemap membership, and not-found behavior consistent with indexing intent.
- **SHOULD**: Use static metadata for stable values and `generateMetadata` only when route data changes the result.
- **SHOULD**: Verify rendered output for representative success, missing, redirected, and non-indexable routes.
- **MAY**: Inherit layout metadata when it accurately represents every child route in scope.

## Exceptions

Record the affected route, indexing intent, owner, and rendered-output verification when metadata ownership differs from the route data owner.

## Verification

- Inspect rendered title, description, canonical, robots directives, status, and redirect destination.
- Confirm metadata generation does not add a duplicate remote request.
- Recheck this rule when route ownership, host configuration, locale strategy, or indexing intent changes.
