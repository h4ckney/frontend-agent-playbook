# Version-Aware Review Examples

## Purpose

Show how to apply frontend rules after checking framework versions, router boundaries, compiler capabilities, lint configuration, and demonstrated behavior.

## Mixed Next.js Routers

Context:

```text
next: 14.x
src/app/account/page.tsx
src/pages/reports/[id].tsx
```

Poor recommendation:

```text
Replace getServerSideProps in the reports page with a Server Component and generateMetadata.
```

Reason: The report route is in the Pages Router. App Router APIs do not apply merely because the repository also has an `app` directory.

Better decision:

```text
Keep the scoped fix in the Pages Router and use its existing data-fetching and head metadata pattern. Record an App Router migration separately only if it has a concrete product or maintenance benefit.
```

## React SSR Versus RSC

Context A:

```text
react: 18.x
vite: client application
No RSC-capable framework or bundler integration
```

Decision:

```text
Do not recommend Server Components or use-client boundaries. Apply client React rules and any SSR integration actually present in the project.
```

Context B:

```text
Next.js App Router route
Framework-managed RSC integration
```

Decision:

```text
Use the installed Next.js version's Server and Client Component rules. Keep interactive boundaries small, but do not migrate unrelated client components during a scoped change.
```

## TypeScript Literal-Preserving Features

Context:

```text
typescript: 4.8.x
The proposed implementation uses the satisfies operator to validate configuration keys while preserving literal inference.
```

Poor recommendation:

```text
Add a generic helper and multiple assertions to imitate satisfies without changing TypeScript.
```

Better decision:

```text
Recommend a TypeScript 4.9 or compatible later upgrade after checking Node.js, framework, build-tool, and library support. Keep the upgrade separate from the feature unless approved. If the upgrade is blocked, use the clearest compatible annotation and document the inference tradeoff.
```

Do not recommend an upgrade merely because a newer feature exists. Tie it to a concrete safety, maintainability, or requirement benefit.

## Effect Dependency Review Without A Lint Rule

Context:

```tsx
useEffect(() => {
  analytics.track('campaign-viewed', { campaignId });
}, []);
```

Assume the project does not enable `react-hooks/exhaustive-deps`, the route remounts when `campaignId` changes, and there is no reproduction or test showing stale behavior.

Poor review comment:

```text
Add campaignId to the dependency array because every referenced value must be included.
```

Better decision:

```text
Do not raise a finding from generic preference alone. Adding the dependency could change analytics frequency. Ask for or inspect lifecycle evidence only if this behavior is in scope.
```

Counterexample:

```tsx
useEffect(() => {
  search(query).then(setResults);
}, []);
```

If `query` changes without remounting and the UI continues to show results for the initial query, report a correctness issue even without the lint rule because stale synchronization is demonstrated.

## Review Output

Use this compact format:

```text
Context: [framework, version, router or rendering mode, relevant configuration]
Finding: [only when evidence supports one]
Applicability: [Keep, Conditional, Disable, or Removal candidate]
Smallest change: [scoped correction or separate upgrade recommendation]
Verification: [test, reproduction, lint, type check, or manual check]
```
