# Bundle And Dependency Rules

## Purpose

Define how AI agents should evaluate dependencies, imports, code splitting, client and server bundle boundaries, and performance budgets using measured project evidence instead of universal package-size rules or speculative optimization.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Existing package policy, supported runtimes, bundler configuration, lockfile, framework boundaries, measured baselines, and deployment constraints outrank generic bundle advice.

## References

- MDN Dynamic `import()`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import
- web.dev JavaScript Code Splitting: https://web.dev/articles/reduce-javascript-payloads-with-code-splitting
- web.dev Performance Budgets: https://web.dev/articles/your-first-performance-budget
- Next.js Package Bundling: https://nextjs.org/docs/pages/guides/package-bundling
- Next.js CLI Bundle Analyzer: https://nextjs.org/docs/app/api-reference/cli/next
- webpack Tree Shaking: https://webpack.js.org/guides/tree-shaking/

## Applicability

- **SHOULD**: Load this rule when a task adds, upgrades, removes, or replaces a dependency; changes imports or exports; adds client JavaScript, third-party scripts, fonts, or large assets; changes code splitting; or affects an explicit bundle budget.
- **SHOULD**: Load this rule when a Server Component or server-only module may cross into a client bundle.
- **SHOULD**: Do not load this rule for every import edit; require a changed shipped cost, package boundary, build contract, or measured performance risk.

## Context And Baseline

- **MUST**: Inspect the package manager, lockfile, workspaces, bundler, framework version, target runtimes, package policy, and existing analysis commands before recommending a dependency or bundle change.
- **SHOULD**: Identify whether affected code ships to the browser, server, edge runtime, build tooling, tests, or development only.
- **MUST**: Compare against a reproducible project baseline before claiming bundle reduction, regression, or budget compliance.
- **SHOULD**: Measure the affected route or entry point rather than relying only on repository-wide package size.
- **MUST**: Do not use download size, unpacked npm size, or a third-party size website as proof of the bytes shipped by the configured build.
- **SHOULD**: Record unavailable production-build or analyzer evidence as an information gap.

## Dependency Decisions

- **SHOULD**: Reuse an installed dependency, platform API, framework capability, or small local implementation when it meets the requirement clearly.
- **MUST**: Explain the user or engineering value, existing alternatives, runtime destination, maintenance owner, and verification before adding a production dependency.
- **SHOULD**: Inspect package exports, module format, tree-shaking behavior, side effects, browser compatibility, type support, release health, license policy, and security policy as relevant to the project.
- **MUST**: Do not add a dependency solely to avoid understanding a small existing implementation.
- **MUST**: Do not replace a stable project dependency during a narrow task without separate approval and a migration reason.
- **SHOULD**: Prefer focused imports only when the package and bundler documentation show that import shape affects output; do not rewrite imports from folklore.
- **MUST**: Keep manifest and lockfile changes coherent and use the repository's package manager.

## Client And Server Boundaries

- **MUST**: Verify whether an import moves code, data, secrets, Node APIs, or heavy dependencies across a server, client, worker, or edge boundary.
- **MUST**: Do not import server-only modules, credentials, database clients, or privileged configuration into browser-reachable code.
- **SHOULD**: In RSC-capable applications, inspect the actual client boundary and import chain before attributing a package to the client bundle.
- **SHOULD**: Keep browser-only dependencies out of server paths when they require DOM globals at module evaluation time.
- **MUST**: Do not infer App Router, RSC, or edge compatibility from Next.js or React major versions alone.
- **SHOULD**: Treat third-party scripts and SDKs as execution, privacy, security, and lifecycle costs in addition to transfer bytes.

## Imports, Exports, And Tree Shaking

- **SHOULD**: Prefer static imports for initial dependencies that benefit from bundler analysis and preloading.
- **SHOULD**: Use dynamic imports when code is costly, not needed for the initial experience, and has a clear loading and failure boundary.
- **MUST**: Do not use dynamic import as a cosmetic optimization without checking chunk output, request timing, caching, and user-visible fallback behavior.
- **SHOULD**: Avoid splitting tiny or commonly required modules when extra requests and delayed execution outweigh the saved initial work.
- **MUST**: Preserve module side effects, CSS imports, polyfills, registrations, and initialization behavior unless removal is independently verified.
- **MUST**: Do not change package `sideEffects`, export maps, or barrel structure based only on unused-source appearance.
- **SHOULD**: Inspect barrel exports and broad entry points when measured output shows they pull unnecessary code, then verify the actual build after changing them.

## Budgets And CI

- **SHOULD**: Define budgets from measured project baselines and user-facing performance goals rather than universal kilobyte thresholds.
- **SHOULD**: Name the measured output, route, compression mode, device or runtime assumptions, and allowed variance for each budget.
- **MUST**: Enforce an existing approved budget when the task changes its measured surface.
- **MUST**: Do not add a blocking CI budget until the metric is reproducible, the baseline is accepted, and expected variance is understood.
- **SHOULD**: Group shared chunks and one root cause so one dependency does not create misleading duplicate regressions.
- **SHOULD**: Review transfer size together with parse, compile, execution, request count, caching, and interaction cost when those affect the user.
- **MAY**: Use a non-blocking report before enforcement while a new baseline is being calibrated.

## Loading And Failure Behavior

- **MUST**: Provide an appropriate loading, error, retry, or fallback path when deferred code is required for a user workflow.
- **MUST**: Do not make a critical action depend on an unhandled dynamic-import or third-party-script failure.
- **SHOULD**: Avoid eager preloading that cancels the intended benefit of code splitting.
- **SHOULD**: Preserve accessibility and focus behavior while deferred UI loads or fails.
- **SHOULD**: Reuse the existing observability path for unexpected chunk or script loading failures when the workflow is important.

## Testing

- **SHOULD**: Run the production build and the project's existing bundle analyzer when output composition is part of the claim.
- **SHOULD**: Compare before and after output for the affected route, entry, or runtime using the same configuration.
- **SHOULD**: Test deferred loading success, failure, retry, offline, and slow-network behavior when users depend on it.
- **SHOULD**: Run type, test, build, and lockfile verification after dependency or export-boundary changes.
- **SHOULD**: Verify supported browser, server, edge, or worker runtimes when package compatibility is uncertain.
- **MAY**: Use focused manual analysis when no stable automated budget exists; report the limitation.

## Avoid Over-engineering

- **MUST**: Do not add a bundle analyzer, performance service, or CI gate for one speculative optimization without repeated need or explicit approval.
- **SHOULD**: Do not replace readable code with fragile import tricks for an unmeasured byte difference.
- **SHOULD**: Avoid a new wrapper library when the dependency it wraps already has a stable project-owned integration.
- **SHOULD**: Do not remove a dependency solely because a local alternative has fewer lines; include maintenance, correctness, security, and compatibility costs.
- **SHOULD**: Keep dependency modernization separate from a feature unless compatibility blocks the approved work.

## Verification

Report:

- Package manager, bundler, runtimes, baseline, and analysis commands inspected
- Dependencies and import boundaries added, removed, upgraded, or moved
- Client, server, edge, worker, build, test, and development bundle effects
- Before and after measurements with route, compression, and configuration
- Loading, failure, retry, accessibility, and observability behavior
- Type, test, build, analyzer, budget, and lockfile checks run
- Unverified package, license, runtime, or deployment assumptions

Do not claim a bundle improvement from source inspection alone. Verify configured production output and user-relevant cost.

## AI Agent Checklist

- Does this code ship to the browser or another constrained runtime?
- Did I inspect existing alternatives before adding a dependency?
- Is the dependency value worth its runtime and maintenance cost?
- Is a client/server boundary pulling in unexpected code or secrets?
- Is dynamic loading justified and failure-safe?
- Did I preserve side effects and verify tree-shaking claims?
- Are budgets based on a reproducible accepted baseline?
- Did I compare the same production output before and after?
