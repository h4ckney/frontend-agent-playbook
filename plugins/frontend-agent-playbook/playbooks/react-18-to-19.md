# React 18 to React 19 Migration Playbook

Use this playbook for an explicitly approved React runtime upgrade. React version, RSC adoption, framework router migration, Actions adoption, and React Compiler adoption are separate decisions.

## Decision Gate

Proceed only when:

- the framework and renderer officially support the target React 19 release;
- `react`, `react-dom`, their type packages, the test renderer or test utilities, and framework integrations can move together;
- critical UI journeys and production error reporting have a repeatable baseline;
- incompatible libraries, internal React API usage, and deprecated APIs have owners and rollback paths.

Do not upgrade React during an unrelated feature or incident fix. Do not infer RSC support from React 19 alone.

## Phase 0: Compatibility Inventory

Record:

- exact React, renderer, framework, TypeScript, `@types/react`, and `@types/react-dom` versions
- client rendering, SSR, hydration, streaming, and framework-managed RSC usage
- legacy `ReactDOM.render`, `hydrate`, `findDOMNode`, string refs, function `defaultProps`, PropTypes, `react-dom/test-utils`, shallow rendering, and `react-test-renderer`
- libraries that access React internals, patch rendering, own portals, or depend on ref callback behavior
- error boundary, `window.reportError`, console, telemetry, hydration-warning, and uncaught-error behavior

When supported by the framework, use React 18.3 as a warning-discovery step before React 19. Resolve or explicitly accept its warnings before the major upgrade.

## Phase 1: Prepare Without New Features

1. Enable the modern JSX transform required by React 19.
2. Remove or replace deprecated APIs using reviewed codemods where helpful.
3. Update tests away from removed `react-dom/test-utils` APIs and implementation-detail renderers.
4. Search ref callbacks for implicit returns and cleanup assumptions, then run the React 19 type codemods only on reviewed paths.
5. Remove direct use of React internals or block the upgrade until the owning dependency supports React 19.

Codemod output is a proposed mechanical change, not verification. Review behavior, types, formatting, and generated diff before retaining it.

## Phase 2: Lockstep Upgrade

- Upgrade `react` and `react-dom` together.
- Upgrade `@types/react` and `@types/react-dom` together for TypeScript projects.
- Use the framework-supported versions rather than forcing peer dependencies.
- Keep package-manager overrides temporary, documented, and approved.
- Produce a clean install and lockfile diff before interpreting runtime failures.

Exit when typecheck, lint, tests, production build, SSR or static generation, and representative hydration all pass without new unowned warnings.

## Behavioral Review

### Effects

Do not rewrite Effects merely because React changed versions. Preserve existing synchronization behavior unless an enabled lint rule, reproduced bug, Strict Mode result, or migration warning supplies evidence. Verify subscriptions, cleanup, stale closures, request cancellation, and external-system synchronization in affected paths.

### Refs

React 19 supports `ref` as a prop and allows ref callback cleanup functions, but existing components do not need a broad `forwardRef` rewrite. Review callback refs whose concise bodies implicitly return assigned values because updated types may reject them or interpret cleanup incorrectly.

### Forms And Actions

Actions, `useActionState`, `useFormStatus`, and optimistic APIs are optional adoption work. Do not combine a runtime upgrade with a form architecture rewrite unless separately approved. When adopted, preserve pending, retry, validation, authorization, duplicate-submission, value preservation, accessibility, and telemetry behavior.

### Errors And Hydration

React 19 changes how caught and uncaught render errors are reported. Verify `createRoot` or `hydrateRoot` callbacks, error boundaries, `window.reportError`, Sentry or another telemetry integration, and duplicate-event behavior. Compare server HTML and first client render for time, locale, random, browser-only, and invalid-markup differences instead of suppressing hydration warnings broadly.

### Suspense And Strict Mode

Exercise loading fallbacks, sibling behavior, ref callbacks, subscriptions, and idempotent setup under the project's development and production modes. Do not classify development-only repeated execution as a production defect without reproducing the user impact.

## React Compiler Boundary

React Compiler is a separate optional build transformation, even when it supports the target React version.

- Require separate approval, build-tool compatibility, Rules of React health, profiling baseline, rollout scope, and rollback.
- Start with incremental adoption when approved.
- Do not remove existing memoization wholesale until compiler coverage and performance are measured.
- A successful React 19 upgrade does not imply Compiler readiness.

## Verification Matrix

- clean install, typecheck, lint, unit, component, integration, and production build
- framework SSR, static generation, streaming, hydration, and client navigation
- forms, async mutations, optimistic rollback, focus, and pending state
- portals, refs, imperative integrations, modals, editors, and third-party widgets
- caught, uncaught, recoverable, and hydration error reporting without duplicate or missing telemetry
- critical desktop and mobile journeys in production mode
- bundle and performance comparison only where the runtime or compiler changes shipped code

## Rollout And Rollback

Roll out by application or deployment unit rather than mixing React 18 and 19 renderers in one runtime.

Rollback restores React, React DOM, type packages, lockfile, and compatibility changes as one reviewed unit. Keep data contracts backward compatible across the rollout window and avoid irreversible API or persistence changes in the same release.

## Completion

Close the migration only when:

- deprecated and incompatible runtime paths are removed or explicitly owned;
- framework, build, test, telemetry, and critical journeys pass in production mode;
- new warnings are resolved or recorded with owner and recheck trigger;
- optional Actions, RSC, router, and Compiler work remains separately tracked.

## Official References

- [React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [React 19 release](https://react.dev/blog/2024/12/05/react-19)
- [React Compiler](https://react.dev/learn/react-compiler)
