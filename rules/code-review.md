# Code Review Rules

## Purpose

Define how AI agents should review frontend changes with a senior-engineer review gate before approval.

## Review Model

Use a Critical / Standards / Optimization review flow:

1. Critical: block correctness, security, accessibility, data-loss, and user-visible regressions.
2. Standards: enforce project conventions, type safety, architecture boundaries, and test expectations.
3. Optimization: suggest performance, readability, maintainability, and DX improvements after the change is safe.

## Source Priority

Use the shared precedence and applicability classifications in [Rule Governance](./governance.md). Review the change against the codebase before applying generic topic rules.

## References

- React rules: ./react.md
- Next.js rules: ./nextjs.md
- TypeScript rules: ./typescript.md
- Security and privacy rules: ./security-privacy.md
- Data fetching and cache rules: ./data-fetching-cache.md
- Error handling and observability rules: ./error-handling-observability.md
- Performance rules: ./performance.md
- Accessibility rules: ./accessibility.md
- SEO rules: ./seo.md
- Testing rules: ./testing.md
- Dead-code removal rules: ./dead-code.md

## Review Gates

### Critical

Block the change when it introduces or fails to handle:

- **MUST**: Incorrect user-visible behavior
- **MUST**: Broken loading, empty, error, or success states
- **MUST**: Accessibility regressions
- **MUST**: Unsafe external data handling
- **MUST**: Security-sensitive mistakes
- **MUST**: Sensitive data leakage or broken privacy boundaries
- **MUST**: Data loss or destructive behavior
- **MUST**: Broken routing, metadata, or SEO-critical rendering

### Standards

Request changes when the implementation:

- **SHOULD**: Ignores existing project patterns
- **SHOULD**: Weakens TypeScript safety without reason
- **SHOULD**: Adds unnecessary abstraction
- **SHOULD**: Mixes unrelated responsibilities
- **SHOULD**: Creates inconsistent component, hook, API, or data-boundary ownership
- **SHOULD**: Omits risk-appropriate tests or verification without explaining why
- **SHOULD**: Uses unclear naming that hides intent

### Optimization

Suggest improvements when the change is otherwise safe but could improve:

- **MAY**: Rendering performance
- **MAY**: Bundle size
- **MAY**: Data fetching flow
- **MAY**: Cache invalidation and stale-state handling
- **MAY**: Error recovery and observability signal quality
- **MAY**: Component composition
- **MAY**: Readability
- **MAY**: Reuse of existing utilities
- **MAY**: Proven dead code, stale dependencies, and expired feature paths
- **MAY**: Developer experience

## Feedback Format

Review comments should be concrete and ordered by risk.

Use this structure:

1. Finding: what is wrong or risky.
2. Impact: why it matters to users, maintainers, or production behavior.
3. Fix: the smallest practical correction.
4. Evidence: file, line, test, or reproduction when available.

## AI Agent Checklist

- Did I review behavior before style?
- Did I identify blocking issues separately from suggestions?
- Did I check accessibility, type safety, security/privacy, and data boundaries?
- Did I check loading, empty, error, and success states?
- Did I verify tests or explain missing verification?
- Did I avoid broad rewrite suggestions unless required?
- Did I flag inapplicable or over-engineered guidance instead of enforcing it blindly?
- Did I distinguish proven dead code from candidates with dynamic, public, generated, or side-effect entry points?

## Examples

Poor review comment:

```text
This component is messy. Clean it up.
```

Useful review comment:

```text
Critical: This save action can submit twice because the button remains enabled while the request is pending. Users can create duplicate records. Disable the button during submission or guard duplicate calls in the handler, then add a regression test for double-click submission.
```

Poor review comment:

```text
Use a better type here.
```

Useful review comment:

```text
Standards: This API response is typed as `any`, so the UI can read missing fields without a type error. Add a response type or validation boundary before mapping it into component state.
```

## Expansion Notes

Add severity labels, PR review templates, and examples for React, Next.js, TypeScript, accessibility, SEO, performance, and unsafe dead-code removal.
