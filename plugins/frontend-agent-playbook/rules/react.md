# React Rules

## Purpose

Define how AI agents should write and review production-grade React code using React official guidance first.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Consult React official documentation for React-specific behavior after confirming the project's React version and established patterns.

## References

- React Thinking in React: https://react.dev/learn/thinking-in-react
- React You Might Not Need an Effect: https://react.dev/learn/you-might-not-need-an-effect
- React Lifecycle of Reactive Effects: https://react.dev/learn/lifecycle-of-reactive-effects
- React exhaustive-deps lint: https://react.dev/reference/eslint-plugin-react-hooks/lints/exhaustive-deps
- React Rules of Hooks: https://react.dev/reference/rules/rules-of-hooks
- React Server Components: https://react.dev/reference/rsc/server-components

## Version And RSC Mode

Rule ID: `react.version-context`

- **SHOULD**: Inspect the installed React version, framework, bundler, and route architecture before applying Server Component guidance.
- **SHOULD**: For React versions or setups without supported RSC integration, use client-rendered or framework-supported SSR patterns and do not recommend RSC directives or boundaries.
- **MUST**: Do not infer RSC support from the React major version alone. Some pre-React 19 frameworks used canary or experimental integrations, so verify the framework and its versioned documentation.
- **SHOULD**: For React 19 and RSC-capable frameworks, follow the framework's version-matched RSC implementation. React's framework and bundler integration APIs may not follow semver across React 19 minor versions.
- **SHOULD**: Distinguish RSC from SSR. Server-rendered HTML alone does not mean the project uses React Server Components.
- **MUST**: Do not recommend an RSC migration during scoped work without a concrete product benefit, framework support, and migration scope.

## Core Rules

- **SHOULD**: Build UI from clear component boundaries that match user-facing concepts.
- **SHOULD**: Keep state minimal and colocated with the component that owns it.
- **SHOULD**: Derive values during render when possible instead of duplicating state.
- **SHOULD**: Use effects only for synchronization with external systems.
- **MUST**: Follow the Rules of Hooks and keep hooks unconditionally called at the top level.
- **SHOULD**: Prefer semantic HTML before adding ARIA.
- **SHOULD**: Test user-visible behavior, not internal implementation details, using [Testing Rules](./testing.md).

## Do

- **SHOULD**: Split a component when it has independent behavior, data ownership, or reuse value.
- **SHOULD**: Name props by intent, not by implementation detail.
- **SHOULD**: Handle loading, empty, error, and success states when the user can observe them.
- **SHOULD**: Keep event handlers and derived values readable at the call site.
- **MAY**: Use custom hooks to share behavior when reuse or boundary ownership justifies them; do not use a custom hook only to hide unclear component logic.

## Avoid

- **SHOULD**: Do not introduce global state when local state or URL state is enough.
- **SHOULD**: Do not use `useEffect` for values that can be computed from props or state.
- **SHOULD**: Do not create boolean flag combinations that can represent impossible UI states.
- **MUST**: Do not replace semantic elements with clickable `div` or `span` elements.
- **SHOULD**: Do not split components only to reduce line count.

## Effect Dependency Reviews

- **SHOULD**: Follow the project's configured React Hooks ESLint rules when they are enabled.
- **MUST**: Do not recommend dependency-array changes solely from generic preference when `react-hooks/exhaustive-deps` is not configured and there is no concrete stale-closure, missed synchronization, duplicate-work, or lifecycle bug.
- **MUST**: Flag a dependency issue without the lint rule only when code flow, a reproduction, or an existing test demonstrates that a changing reactive value causes stale or missed synchronization.
- **SHOULD**: When the lint rule reports a problem, prefer restructuring the Effect or proving a value is non-reactive over suppressing the rule or blindly adding dependencies.
- **SHOULD**: Keep dependency-array changes scoped and verify behavior; adding a dependency can alter synchronization frequency and cleanup behavior.

## AI Agent Checklist

- Did I inspect existing component patterns before editing?
- Did I identify the React version and whether this route actually uses RSC?
- Is state stored in the smallest necessary place?
- Can any effect be removed by deriving data during render?
- Is an Effect dependency recommendation backed by project lint configuration or a concrete synchronization risk?
- Are interactive elements keyboard accessible?
- Are all user-visible states handled?
- Did I add or update behavior-focused tests when the change's risk justifies them?

## Examples

Bad:

```tsx
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${firstName} ${lastName}`);
}, [firstName, lastName]);
```

Good:

```tsx
const fullName = `${firstName} ${lastName}`;
```

Bad:

```tsx
<div onClick={onSave}>Save</div>
```

Good:

```tsx
<button type="button" onClick={onSave}>Save</button>
```

## Expansion Notes

Add more examples for forms, async UI states, custom hooks, and accessibility regressions.
