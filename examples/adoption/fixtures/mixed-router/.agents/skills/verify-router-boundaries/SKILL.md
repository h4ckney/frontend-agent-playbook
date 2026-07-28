---
name: verify-router-boundaries
description: Verify changed files in a mixed Next.js repository against the correct App Router or Pages Router conventions, rendering model, metadata API, data ownership, and test paths. Use during route changes, shared-module refactors, or staged Pages-to-App migrations when one global router assumption would be unsafe.
---

# Verify Router Boundaries

## Required Input

- Changed files or proposed migration scope
- Installed Next.js and React versions
- Current `app/` and `pages/` route inventory
- Existing migration decisions and test commands

## Workflow

1. Classify every changed route file as App Router, Pages Router, shared, or outside routing.
2. Confirm RSC, SSR, and client-rendering behavior from the affected tree rather than package major versions.
3. Check imports from shared modules for server-only, browser-only, and serialization constraints.
4. Apply App Router metadata, cache, and boundary APIs only to the App Router tree.
5. Apply Pages Router data methods and `next/head` conventions only to the Pages Router tree.
6. Identify redirects, rewrites, links, tests, and observability paths that cross the boundary.
7. Report conflicts and required verification without migrating additional routes.

## Stop Conditions

- Stop when the changed route cannot be assigned to one tree.
- Stop when a shared module mixes server-only and browser-only dependencies without an owner decision.
- Do not move routes, add `use client`, or replace data APIs without separate approval.

## Verification

- Run existing route, type, lint, test, and build checks relevant to the changed tree.
- Exercise representative URLs from both trees when shared routing or middleware changed.
- Record checks not run and environment-dependent behavior.

## Output

```markdown
## Route Classification
## Rendering Boundaries
## Cross-Tree Risks
## Required Changes
## Verification
## Unverified Assumptions
```
