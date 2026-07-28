# SEO Rules

## Purpose

Define how AI agents should preserve crawlability, indexability, canonical consistency, search appearance, and safe URL lifecycle behavior using current Google Search Central guidance.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Confirm the product's indexing intent, target search engines, locales, framework version, and deployment environment before applying SEO guidance.

## References

- Google Search Essentials: https://developers.google.com/search/docs/essentials
- Google SEO Starter Guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Crawling and indexing overview: https://developers.google.com/search/docs/crawling-indexing/overview
- Canonical URLs: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Robots meta and X-Robots-Tag: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
- Build and submit a sitemap: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Redirects and Google Search: https://developers.google.com/search/docs/crawling-indexing/301-redirects
- JavaScript SEO basics: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Dynamic rendering guidance: https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering
- Structured data introduction: https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data
- Structured data policies: https://developers.google.com/search/docs/appearance/structured-data/sd-policies
- Title links: https://developers.google.com/search/docs/appearance/title-link

## Indexing Intent

- **SHOULD**: Classify affected pages as indexable, intentionally non-indexable, duplicate, redirected, removed, or environment-only before changing SEO behavior.
- **SHOULD**: Keep staging, preview, account, internal search, and private pages out of search only through the mechanism approved by the project and hosting architecture.
- **MUST**: Do not change `noindex`, robots rules, authentication, or canonical behavior without confirming ownership and intent.
- **MUST**: Do not claim that a page is indexed or removed based only on source markup; indexing is controlled by crawlers and search-engine processing.

## Crawlability And Rendering

- **SHOULD**: Keep primary content, headings, links, and metadata available in rendered HTML when organic discovery matters.
- **SHOULD**: Use real links with crawlable URLs for navigation and internal discovery.
- **SHOULD**: Return meaningful HTTP status codes for success, redirects, not found, and server errors.
- **SHOULD**: Avoid client-only gates that require interaction before important content or links exist.
- **SHOULD**: Prefer server rendering, static rendering, or hydration over dynamic rendering for long-term JavaScript SEO solutions.
- **SHOULD**: Verify rendered output rather than assuming that source JSX or a client request is visible to crawlers.

## Canonical And Duplicate URLs

- **SHOULD**: Use one stable, absolute canonical URL that represents the preferred version of duplicate or parameterized content.
- **SHOULD**: Keep canonicals consistent with redirects, internal links, hreflang when used, and sitemap entries.
- **SHOULD**: Include canonical indexable URLs in sitemaps; exclude redirected, non-indexable, error, and duplicate URLs.
- **MUST**: Do not point canonicals to unrelated content or use them as a substitute for redirects when a URL has permanently moved.
- **SHOULD**: Confirm protocol, host, path, trailing-slash, locale, and parameter conventions before generating canonicals.

## Robots And Sitemaps

- **SHOULD**: Use robots meta directives for HTML pages and `X-Robots-Tag` when indexing directives are required for non-HTML resources or response-level control.
- **MUST**: Do not block crawling of a URL when a crawler must read its `noindex` directive.
- **SHOULD**: Treat `robots.txt` primarily as crawl control, not as proof that a URL cannot appear in search.
- **SHOULD**: Generate sitemaps from canonical, indexable URLs and keep `lastmod` values accurate when supplied.
- **SHOULD**: Keep environment-specific robots and sitemap behavior explicit so preview settings cannot leak into production.

## Metadata And Search Appearance

- **SHOULD**: Use unique, specific titles and descriptions for indexable pages and keep them aligned with visible content.
- **SHOULD**: Keep a logical heading hierarchy and descriptive internal-link text.
- **SHOULD**: Avoid duplicated boilerplate that hides the page's actual subject.
- **SHOULD**: Treat social metadata as a related sharing concern, not a replacement for search metadata.
- **MUST**: Do not promise that a search engine will display the supplied title, description, or rich result.

## Structured Data

- **SHOULD**: Add structured data only when a supported type accurately represents the page's primary visible content.
- **SHOULD**: Include required properties and relevant recommended properties from the current feature documentation.
- **SHOULD**: Keep structured data complete, current, and consistent with canonical URLs and visible content.
- **MUST**: Do not add hidden, misleading, fake, or irrelevant entities, ratings, reviews, prices, availability, or relationships.
- **SHOULD**: Validate syntax and feature eligibility, while recognizing that valid markup does not guarantee a rich result.

## URL Changes And Removal

- **SHOULD**: Use a permanent server-side redirect when content has permanently moved to a meaningful replacement.
- **SHOULD**: Use a temporary redirect only for genuinely temporary changes.
- **SHOULD**: Return not-found or gone behavior for removed content without a relevant replacement; do not redirect unrelated removed URLs to the home page.
- **SHOULD**: Update internal links, canonicals, sitemaps, hreflang, and structured-data URLs when paths or hosts change.
- **SHOULD**: Preserve redirect mappings long enough for users, crawlers, bookmarks, and external links according to the project's migration policy.

## Verification

- **SHOULD**: Check production-equivalent rendered HTML, HTTP status, redirect destination, canonical, robots directives, and structured data.
- **SHOULD**: Check representative URL variants including parameters, locale, protocol, host, and trailing-slash forms when relevant.
- **SHOULD**: Validate sitemap contents against the route inventory and indexing intent.
- **SHOULD**: Use Search Console URL Inspection or equivalent search-engine tooling when access exists; report when it does not.
- **SHOULD**: Record what was verified and avoid claiming ranking, indexing, or rich-result outcomes before external systems process the change.

## AI Agent Checklist

- What is the indexing intent and environment for each affected URL?
- Are status codes, rendered content, links, canonical, robots, and sitemap entries consistent?
- Are metadata and structured data specific, visible, accurate, and supported?
- Could JavaScript rendering hide important content or directives?
- Are URL moves and removals handled with the correct redirect or terminal status?
- Did I verify output without promising search-engine behavior?

## Examples

Bad:

```tsx
export const metadata = {
  title: 'Home',
  description: 'Welcome to our website',
};
```

Good Next.js App Router example:

```tsx
export const metadata = {
  title: 'Frontend AI Rules for React and Next.js',
  description: 'Production-grade frontend rules for AI coding agents working with React, Next.js, TypeScript, accessibility, SEO, and performance.',
  alternates: { canonical: 'https://example.com/frontend-agent-playbook' },
};
```

Poor removal decision:

```text
Redirect every deleted product URL to the home page.
```

Better removal decision:

```text
Redirect only to a relevant replacement. Otherwise return the project's not-found or gone response and remove the URL from internal links and sitemaps.
```
