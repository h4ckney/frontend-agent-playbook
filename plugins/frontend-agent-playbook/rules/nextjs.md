# Next.js Rules

## Purpose

Define how AI agents should work with Next.js after identifying the installed version and whether each affected route uses the App Router or Pages Router.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Consult version-matched Next.js documentation for framework behavior after identifying the project's router, rendering model, and deployment conventions.

## References

- Next.js Server and Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js App Router: https://nextjs.org/docs/app
- Next.js Pages Router: https://nextjs.org/docs/pages
- Next.js Fetching Data: https://nextjs.org/docs/app/getting-started/fetching-data
- Next.js generateMetadata: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- Next.js Image Optimization: https://nextjs.org/docs/app/building-your-application/optimizing/images
- Next.js Font Optimization: https://nextjs.org/docs/app/building-your-application/optimizing/fonts

## Core Rules

- **SHOULD**: Read `package.json`, the lockfile, Next.js configuration, and the `app`, `pages`, `src/app`, and `src/pages` directories before recommending router APIs.
- **SHOULD**: Use documentation that matches the installed Next.js major version and the router used by the affected route.
- **SHOULD**: Treat mixed-router repositories per route tree. Do not assume that an `app` directory makes Pages Router code follow App Router rules.
- **SHOULD**: Follow the routing model already used by the affected area.
- **MUST**: Do not turn a scoped feature or bug fix into a router migration unless migration is explicitly requested or required by the feature.

## App Router Rules

- **SHOULD**: Apply these rules only to routes under the App Router in a version that supports the referenced API.
- **SHOULD**: Prefer Server Components unless browser APIs, client hooks, or interactivity require a Client Component.
- **SHOULD**: Keep `use client` boundaries small and intentional.
- **SHOULD**: Fetch data at the route or Server Component level when possible.
- **SHOULD**: Handle loading, error, and not-found states at the correct route-segment boundary.
- **SHOULD**: Use `metadata` or `generateMetadata` for indexable routes when supported by the installed version.
- **SHOULD**: Avoid duplicate data fetching across nested components.

## Pages Router Rules

- **SHOULD**: Use `getStaticProps`, `getServerSideProps`, API Routes, `_app`, and `_document` only according to the installed version and existing project pattern.
- **MUST**: Do not recommend Server Components, `use client`, App Router file conventions, or App Router metadata APIs for Pages Router routes.
- **SHOULD**: Handle loading and error states in the page, data layer, or existing application boundary rather than inventing App Router special files.
- **SHOULD**: Preserve Pages Router behavior during scoped work. Recommend migration separately only when there is a concrete product or maintenance benefit and a migration plan.

## Do

- **SHOULD**: Use URL state for shareable filters, tabs, search, and pagination with the router API used by the affected route.
- **SHOULD**: Keep route segments, pages, and layouts focused on real product structure.
- **SHOULD**: Be explicit about caching and revalidation when data freshness matters.
- **SHOULD**: Use framework image and font optimization when the project already uses it.
- **SHOULD**: Keep metadata specific to the current route using the router-compatible metadata mechanism.

## Avoid

- **SHOULD**: Do not add `use client` at a high App Router layout level without a clear reason.
- **MUST**: Do not pass non-serializable props across App Router Server-to-Client boundaries.
- **MUST**: Do not hide important SEO content behind client-only rendering when SEO matters.
- **SHOULD**: Do not create metadata that is generic or copied across unrelated pages.
- **SHOULD**: Do not create request waterfalls that can be avoided at the route level.

## AI Agent Checklist

- Did I identify whether this project uses App Router, Pages Router, or both?
- Did I check the installed Next.js version and use matching documentation?
- Am I applying rules to the affected route tree rather than the repository as a whole?
- For an App Router route, does this component need to be a Client Component?
- Are data fetching and cache rules clear?
- Are loading, error, and not-found states handled where Next.js expects them?
- Is route metadata specific and aligned with visible page content?
- Did I avoid unnecessary client-side JavaScript?

## App Router Examples

Bad:

```tsx
'use client';

export default async function ProductPage() {
  const product = await getProduct();
  return <ProductDetails product={product} />;
}
```

Good:

```tsx
export default async function ProductPage() {
  const product = await getProduct();
  return <ProductDetails product={product} />;
}
```

Bad:

```tsx
export const metadata = { title: 'Page' };
```

Good:

```tsx
export const metadata = {
  title: 'Pricing - Acme Analytics',
  description: 'Compare Acme Analytics plans for product teams.',
};
```

## Expansion Notes

Add version-specific examples for App Router route handlers, redirects, not-found states, cache revalidation, and equivalent Pages Router workflows.
