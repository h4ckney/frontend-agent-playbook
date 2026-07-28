# State Ownership Rules

## Purpose

Define how AI agents should assign ownership for server data, URL state, form drafts, local interaction state, shared client state, optimistic projections, and persisted preferences without creating competing sources of truth.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Preserve the project's established router, query cache, form, and client-state tools unless concrete evidence justifies a change.

## References

- React Choosing the State Structure: https://react.dev/learn/choosing-the-state-structure
- React Sharing State Between Components: https://react.dev/learn/sharing-state-between-components
- React Preserving and Resetting State: https://react.dev/learn/preserving-and-resetting-state
- React `useSyncExternalStore`: https://react.dev/reference/react/useSyncExternalStore
- Next.js Server and Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js `useSearchParams`: https://nextjs.org/docs/app/api-reference/functions/use-search-params
- TanStack Query Overview: https://tanstack.com/query/v5/docs/framework/react/overview
- TanStack Query Hydration: https://tanstack.com/query/v5/docs/framework/react/reference/hydration
- Redux Style Guide: https://redux.js.org/style-guide/

## Applicability

- **SHOULD**: Load this rule when a task introduces or changes a store, provider, query cache, URL synchronization, persistence, hydration, optimistic update, or state shared across component boundaries.
- **SHOULD**: Load this rule when the same entity or workflow value appears in more than one state system.
- **SHOULD**: Do not load this rule for every isolated `useState`; require an ownership, sharing, synchronization, persistence, or lifecycle decision.

## Ownership Model

For each material state value, identify its authoritative owner, writers, readers, lifetime, reset trigger, persistence policy, and reconciliation path.

| State category | Usual owner | Typical examples | Main risk |
| --- | --- | --- | --- |
| Server state | Backend boundary; query or framework cache is a client representation | Entities, permissions, inventory, account data | Stale or duplicated authority |
| URL state | Router and URL | Search, filters, sort, pagination, navigable tabs | Broken sharing and back navigation |
| Form or draft state | Form instance or feature-local draft owner | Inputs, dirty state, validation feedback | Refetch overwrites and unclear reset |
| Local UI state | Nearest component | Open state, hover state, temporary selection | Unnecessary global coupling |
| Shared client state | Closest stable provider or existing store | Cross-tree workflow or UI coordination | Overscoped lifetime and hidden writes |
| Persisted preference | Narrow storage adapter plus runtime validation | Theme, dismissed notice, user preference | Stale schema, privacy, account leakage |

- **MUST**: Assign one logical authoritative source for each unique state value, even when caches or replicas exist.
- **MUST**: Treat the server as authoritative for authentication, authorization, ownership, billing, and business invariants even when the client displays cached or optimistic values.
- **SHOULD**: Let the URL own state whose value should survive reload, be shareable or bookmarkable, or participate in browser navigation.
- **SHOULD**: Keep transient interaction state in the nearest component that needs it.
- **SHOULD**: Lift state to the closest common owner when multiple components must coordinate the same value.
- **SHOULD**: Use an external store only when sharing scope, lifetime, update frequency, or non-React consumers justify it.

## Duplication And Derivation

- **MUST**: Do not copy query or framework-cache results into Zustand, Redux, MobX, Context, or another store as a second canonical copy without an explicit snapshot, draft, or reconciliation contract.
- **SHOULD**: Store identifiers instead of duplicate entity objects when the canonical entity already exists in a cache.
- **SHOULD**: Derive filtered, sorted, counted, and combined values during render or through the existing selector mechanism instead of synchronizing redundant state.
- **SHOULD**: Do not add an Effect solely to keep two client state containers synchronized when one can be derived from the other.
- **MUST**: When duplicate representations are required, document which copy is authoritative, when divergence is allowed, and how conflicts are resolved.
- **SHOULD**: Avoid mirroring URL state into a store unless one direction owns writes and back, forward, refresh, and external URL changes are handled.

## Scope And Global State

- **SHOULD**: Reuse the project's existing state stack before adding a new library, provider, or abstraction.
- **MUST**: Do not migrate between Context, Zustand, Redux, MobX, or another state tool as incidental work in a narrowly scoped feature.
- **SHOULD**: Treat Context as a distribution mechanism, not an automatic answer to state modeling or performance.
- **SHOULD**: Scope providers and stores as narrowly as the required consumers and lifetime allow.
- **SHOULD**: Measure or demonstrate a render or update problem before splitting contexts or introducing selector infrastructure solely for performance.
- **SHOULD**: Preserve an established global store when it already owns a genuinely cross-cutting workflow; local-first guidance is not a mandate to rewrite stable architecture.

## URL And Navigation State

- **SHOULD**: Put search terms, filters, sort order, pagination, and selected navigable views in the URL when users should be able to share, reload, or revisit them.
- **MUST**: Do not put secrets, credentials, sensitive personal data, or large unsaved drafts in the URL.
- **SHOULD**: Define whether URL updates use push or replace and whether rapid inputs require debouncing.
- **MUST**: Validate and narrow URL values as untrusted runtime input according to [Forms and Runtime Validation](./forms-runtime-validation.md).
- **SHOULD**: Test back, forward, reload, and direct-entry behavior when URL state affects the workflow.

## Drafts, Optimistic State, And Reconciliation

- **MUST**: Distinguish canonical server data, an editable user draft, and a pending optimistic projection when more than one exists.
- **MUST**: Do not let a background refetch silently overwrite an unsaved user draft.
- **SHOULD**: Define optimistic update scope, rollback, invalidation, and eventual reconciliation before implementing the optimistic path.
- **MUST**: Do not treat an optimistic client projection as proof that a server-authoritative action succeeded.
- **SHOULD**: Avoid optimistic treatment for irreversible or high-risk actions unless product semantics and recovery behavior make it safe.
- **SHOULD**: Keep related lists, counters, details, and badges coherent after mutation using the existing cache invalidation or update model.

## Persistence

- **SHOULD**: Persist only values with a deliberate cross-reload or cross-session requirement.
- **MUST**: Treat browser storage and rehydrated state as untrusted runtime input.
- **MUST**: Do not persist secrets, credentials, raw authentication tokens, or unnecessarily sensitive data in client storage.
- **SHOULD**: Define schema version, migration or fallback, expiry, logout reset, and account-switch behavior for persisted state.
- **SHOULD**: Do not persist an entire query cache or global store by default; select the smallest values that need persistence.
- **SHOULD**: Use [Security and Privacy](./security-privacy.md) when persistence includes identity, personal data, payment, or third-party content.

## SSR, RSC, And Hydration

- **MUST**: Identify the actual rendering model before applying SSR, RSC, or hydration guidance.
- **MUST**: Do not keep request-specific or user-specific server state in a shared module singleton.
- **MUST**: Ensure the server snapshot and first client snapshot are compatible when hydrating an external store or query cache.
- **MUST**: Do not read `window`, browser storage, or browser-only APIs during server rendering.
- **SHOULD**: In Next.js App Router, keep client providers as deep as practical and avoid turning an otherwise server-rendered tree into a Client Component solely for convenience.
- **SHOULD**: In Pages Router or SSR without RSC, follow the existing per-request initialization and hydration pattern without introducing App Router assumptions.
- **SHOULD**: Define whether persisted client state may replace server-rendered defaults only after hydration and prevent visible or behavioral mismatches.

## Testing

- **SHOULD**: Unit-test reducers, selectors, normalization, migrations, and non-trivial state transitions when they contain meaningful logic.
- **SHOULD**: Use component or integration tests for ownership boundaries, draft preservation, optimistic rollback, provider scope, and cache-store coordination.
- **SHOULD**: Test reload, direct entry, back and forward navigation for material URL-owned state.
- **SHOULD**: Test hydration and account or logout resets when persisted or request-scoped state could leak or visibly mismatch.
- **SHOULD**: Reserve E2E coverage for critical journeys whose correctness depends on coordination across routing, persistence, server mutations, or multiple owners.

## Avoid Over-engineering

- **MUST**: Do not add a state library because state exists; identify a concrete ownership or coordination problem first.
- **SHOULD**: Prefer direct props, colocated state, existing form state, the router, or the existing query cache when one already owns the value.
- **SHOULD**: Do not build a generic state abstraction for a single simple workflow without repeated evidence.
- **SHOULD**: Record an information gap instead of prescribing a store migration when state writers, readers, or lifetime cannot be verified.

## Verification

Report:

- Material state categories and their authoritative owners
- Duplicate representations and their reconciliation contract
- URL, draft, optimistic, persistence, reset, and hydration behavior affected by the change
- Existing state tools reused and any new abstraction that was justified
- Unit, integration, navigation, hydration, and E2E checks run
- Remaining information gaps or synchronization risks

Do not claim state consistency from static search alone. Verify actual writers, readers, lifecycle, and mutation paths.

## AI Agent Checklist

- Did I name one authoritative owner for each material state value?
- Did I avoid copying server cache data into a second canonical client store?
- Is URL-owned state shareable and compatible with browser navigation?
- Can background refresh overwrite an unsaved draft?
- Are optimistic rollback and reconciliation explicit?
- Are persisted values minimal, validated, versioned, and reset at identity boundaries?
- Does the first client snapshot agree with server-rendered state?
- Did I reuse the existing state stack instead of creating incidental architecture?
