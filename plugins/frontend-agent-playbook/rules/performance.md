# Performance Rules

## Purpose

Define how AI agents should reason about frontend performance before adding code, dependencies, assets, or client-side rendering.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Base optimization decisions on project measurements and budgets, then consult web.dev, MDN, and version-matched framework guidance.

## References

- web.dev Learn Performance: https://web.dev/learn/performance
- Core Web Vitals: https://web.dev/articles/vitals
- Optimize LCP: https://web.dev/articles/optimize-lcp
- Optimize INP: https://web.dev/articles/optimize-inp
- Optimize CLS: https://web.dev/articles/optimize-cls
- MDN Web Performance: https://developer.mozilla.org/en-US/docs/Learn/Performance
- Next.js Image Optimization: https://nextjs.org/docs/app/building-your-application/optimizing/images
- Next.js Font Optimization: https://nextjs.org/docs/app/building-your-application/optimizing/fonts

## Core Rules

- **SHOULD**: Measure or identify a concrete risk before making broad performance claims.
- **SHOULD**: Protect Core Web Vitals: LCP, INP, and CLS.
- **SHOULD**: Avoid unnecessary client-side JavaScript.
- **SHOULD**: Avoid heavy dependencies unless the product value justifies the cost.
- **SHOULD**: Keep images, fonts, and media optimized for real viewport sizes.
- **SHOULD**: Avoid avoidable request waterfalls.
- **SHOULD**: Keep loading states visually stable.

## Rendering Rules

- **SHOULD**: Avoid unnecessary state updates and render loops.
- **SHOULD**: Keep expensive calculations out of hot render paths.
- **MAY**: Consider virtualization when list size and measured rendering cost justify its complexity.
- **SHOULD**: Use memoization only when it solves a demonstrated rendering cost.
- **SHOULD**: Use stable keys based on identity, not array indexes, for dynamic lists.

## Bundle Size Rules

- **SHOULD**: Check existing utilities before adding a dependency.
- **SHOULD**: Prefer platform APIs when they are clear, supported by target environments, and simpler than a dependency.
- **SHOULD**: Avoid importing entire libraries for one helper.
- **SHOULD**: Keep Client Components small in Next.js apps.

## Asset Rules

- **SHOULD**: Set stable image dimensions to reduce layout shift.
- **SHOULD**: Lazy-load below-the-fold media.
- **SHOULD**: Use modern image formats and responsive sizes when supported.
- **SHOULD**: Avoid unused font weights and large icon packs.

## Network and Data Fetching Rules

- **SHOULD**: Fetch independent data in parallel when possible.
- **SHOULD**: Avoid refetching stable data on every render.
- **SHOULD**: Be explicit about cache behavior and freshness requirements.
- **SHOULD**: Keep error and loading states cheap to render.

## AI Agent Checklist

- Did I add a dependency, image, font, script, or Client Component?
- Could this change affect LCP, INP, or CLS?
- Is there an avoidable request waterfall?
- Are loading states stable and non-jumpy?
- Is memoization solving a real problem?
- Did I use the framework's existing optimization tools?

## Examples

Bad:

```tsx
import _ from 'lodash';

const names = _.uniq(users.map((user) => user.name));
```

Good:

```tsx
const names = Array.from(new Set(users.map((user) => user.name)));
```

Bad:

```tsx
<img src="/hero.jpg" alt="Product dashboard" />
```

Good:

```tsx
<img src="/hero.jpg" alt="Product dashboard" width="1200" height="630" loading="eager" />
```

## Expansion Notes

Add examples for Next.js Client Component boundaries, image optimization, and request waterfall reviews.
