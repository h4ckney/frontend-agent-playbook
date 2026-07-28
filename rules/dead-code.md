# Dead Code Removal Rules

## Purpose

Define how AI agents should identify and remove unused frontend code, exports, dependencies, assets, styles, flags, and compatibility paths without deleting dynamically referenced or side-effectful behavior.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Prefer the project's compiler, linter, bundler, package manager, test suite, route conventions, and runtime evidence over a generic unused-code tool.

## References

- TypeScript `noUnusedLocals`: https://www.typescriptlang.org/tsconfig/noUnusedLocals.html
- TypeScript `noUnusedParameters`: https://www.typescriptlang.org/tsconfig/noUnusedParameters.html
- ESLint `no-unused-vars`: https://eslint.org/docs/latest/rules/no-unused-vars
- webpack tree shaking and side effects: https://webpack.js.org/guides/tree-shaking/
- Chrome DevTools Coverage: https://developer.chrome.com/docs/devtools/coverage

## What Counts As A Candidate

- Unreachable branches and statements
- Unused local variables, parameters, imports, private members, and internal exports
- Unreferenced components, hooks, utilities, routes, tests, stories, fixtures, assets, and styles
- Direct dependencies no longer used by source, build, test, scripts, configuration, or generated code
- Expired feature flags, rollout branches, polyfills, compatibility shims, and migration adapters
- Commented-out implementations and obsolete fallback paths preserved without an active requirement

A candidate is not proven dead code until its runtime and tooling entry points have been checked.

## Evidence Requirements

- **MUST**: Start with compiler, linter, IDE, bundler, dependency, and coverage findings, then confirm them with repository search and project conventions.
- **MUST**: Search imports, re-exports, dynamic imports, string references, route discovery, configuration, scripts, tests, stories, code generation, and package exports.
- **MUST**: Treat runtime coverage as evidence for the exercised workflow only, not proof that unexecuted code is globally unused.
- **MUST**: Treat public exports, library entry points, plugin registries, dependency injection, reflection, and framework file conventions as externally reachable until proven otherwise.
- **MUST**: Record uncertainty as a removal candidate instead of deleting code on weak evidence.

## Removal Rules

- **MUST**: Remove the smallest coherent unit and clean up its imports, exports, tests, assets, styles, flags, and documentation in the same change.
- **MUST**: Preserve module side effects such as polyfills, global registrations, CSS imports, event setup, telemetry initialization, and prototype changes unless their behavior is also proven obsolete.
- **MUST**: Do not add a no-op reference, ignore comment, or fake usage merely to silence an unused-code diagnostic.
- **MUST**: Do not replace deleted code with commented-out code; rely on version control.
- **MUST**: Do not combine broad dead-code cleanup with an unrelated behavior change unless the removal is required for that change.

## Dependencies And Bundles

- **SHOULD**: Check application, server, build, test, lint, code-generation, and configuration usage before removing a dependency.
- **SHOULD**: Remove direct dependencies with the project's package manager so manifests and lockfiles stay synchronized.
- **SHOULD**: Verify production builds when changing package `sideEffects`, barrel exports, CSS imports, or tree-shaking behavior.
- **SHOULD**: Use bundle or coverage measurements to prioritize shipped unused code, but do not infer source-level deletion safety from byte counts alone.
- **SHOULD**: Check peer, optional, and platform-specific dependency requirements before removal.

## Feature Flags And Compatibility Code

- **SHOULD**: Confirm flag ownership, rollout state, analytics, remote configuration, rollback window, and fallback behavior before deletion.
- **SHOULD**: Remove the obsolete branch and flag plumbing only after the winning behavior and migration state are confirmed.
- **SHOULD**: Keep compatibility code when the supported browser, runtime, API, or data-version matrix still requires it.
- **SHOULD**: Prefer a separate recommendation when ownership or support policy is unclear.

## Verification

- **SHOULD**: Run focused tests for affected behavior plus available type checks, lint, and production build.
- **SHOULD**: Exercise routes, entry points, lazy-loaded paths, and feature-flag states that could reference the removed code.
- **SHOULD**: Compare bundle output when the purpose is shipped-code reduction.
- **SHOULD**: Verify package-manager and lockfile consistency after dependency removal.
- **SHOULD**: Report deleted scope, evidence, commands run, and remaining uncertainty.

## AI Agent Checklist

- What evidence shows this code is unreachable or obsolete?
- Did I check dynamic, generated, framework, public, and side-effect entry points?
- Does the removal include related exports, tests, assets, styles, flags, and dependencies?
- Did I keep the change separate from unrelated refactoring?
- Did I run the verification proportional to the removal's blast radius?
- Did I mark uncertain items as candidates instead of deleting them?

## Examples

Poor decision:

```text
Chrome Coverage did not execute this module during one page load, so delete it.
```

Better decision:

```text
Coverage identifies a candidate. Confirm route, lazy import, test, story, configuration, package export, and side-effect usage before removal.
```

Poor decision:

```ts
void unusedLegacyHandler;
```

Better decision:

```text
Prove whether the legacy handler is still registered or required, then delete it and its registration together or document why it remains.
```
