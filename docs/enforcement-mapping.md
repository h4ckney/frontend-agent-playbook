# Rule Enforcement Mapping

This document separates guidance that can be enforced mechanically from guidance that still requires codebase and runtime judgment.

## Principles

1. Inspect the installed versions and current configuration before recommending a tool or setting.
2. Reuse the existing compiler, linter, test runner, and CI before adding a plugin.
3. Treat lint and compiler output as evidence, not complete proof of product correctness.
4. Introduce new enforcement as warning-first when an established codebase needs a baseline.
5. Do not convert a contextual SHOULD or MAY into an unconditional CI error.
6. Keep security, accessibility, SEO, cache, and dead-code conclusions subject to manual or runtime verification.

## Mapping

| Playbook rule | Level | Possible enforcement | Adoption condition | Limits and manual review |
| --- | --- | --- | --- | --- |
| Follow the Rules of Hooks | MUST | `eslint-plugin-react-hooks/rules-of-hooks` | React hooks are used and the plugin supports the installed React/ESLint stack | Custom hook factories and framework transforms may need version-matched configuration |
| Review Effect dependencies | Conditional MUST/SHOULD | `react-hooks/exhaustive-deps` | Use the existing setting; promote from off only with project policy or demonstrated synchronization regressions | Do not add dependencies blindly. Review Effect ownership, frequency, and cleanup |
| Use supported TypeScript syntax | MUST | CI typecheck with the repository compiler version | A TypeScript project and stable typecheck command exist | Compiler success does not prove runtime boundary validation |
| Maintain strict type guarantees | SHOULD | TypeScript `strict` | Prefer for new projects; baseline and migrate established projects separately | The strict family can gain checks across TypeScript upgrades |
| Distinguish absent optional properties | MAY/SHOULD | `exactOptionalPropertyTypes` | API and domain models benefit and migration impact is measured | Can produce broad errors; do not enable during an unrelated fix |
| Check unchecked indexed access | MAY/SHOULD | `noUncheckedIndexedAccess` | Undefined index access is a repeated risk and affected libraries are compatible | Requires migration and does not validate external data |
| Find unused locals and parameters | Evidence only | TypeScript `noUnusedLocals`, `noUnusedParameters`, ESLint or typescript-eslint unused rules | Match the repository language and avoid duplicate reports | A diagnostic creates a dead-code candidate, not deletion authorization |
| Preserve semantic and accessible JSX | MUST/SHOULD | Existing `eslint-plugin-jsx-a11y` recommended or project config | The plugin already exists or repeated JSX accessibility defects justify adoption | Automated lint cannot prove keyboard flow, focus behavior, names, contrast, or screen-reader output |
| Centralize approved raw HTML rendering | MUST when untrusted HTML exists | Existing React no-danger rule, restricted syntax, or a project-specific lint rule | Use only after an approved SafeHtml boundary and migration plan exist | A ban does not prove sanitization. Backend trust boundaries and runtime payloads remain manual |
| Prevent sensitive browser storage | MUST | Restrict direct storage access in auth modules or require an approved wrapper | Storage ownership is stable enough to encode without blocking non-sensitive preferences | Generic localStorage bans create false positives and cannot infer stored values |
| Prevent forbidden imports across boundaries | Conditional | ESLint `no-restricted-imports` or project architecture tooling | Stable server/client or layer boundaries exist | Import rules do not understand runtime data ownership by themselves |
| Identify unused JavaScript variables | Evidence only | ESLint `no-unused-vars` or the TypeScript-aware equivalent | Configure one source of truth for TypeScript files | Dynamic imports, framework discovery, dependency injection, side effects, and public exports require search |
| Verify documentation structure and rule levels | MUST for this repository | `node scripts/validate-docs.mjs` in CI | Always for playbook changes | Does not validate technical truth or external documentation freshness |
| Verify analyzer behavior | MUST for analyzer changes | Node syntax checks and `node --test analysis/analyzer.test.mjs` | Always when analyzer logic or report output changes | Static fixtures cannot prove browser compatibility or production security |
| Protect critical user journeys | SHOULD/MUST by risk | Existing unit, component, integration, and E2E commands in CI | Select the narrowest reliable layer from failure cost | Test counts are not coverage quality; inspect journeys and failure paths |
| Protect route metadata and indexing intent | Conditional | Framework build, rendered-output tests, link checks, sitemap validation | Only for indexable or indexing-control work | Search-engine indexing, ranking, and rich results remain external outcomes |
| Protect cache freshness after mutation | MUST when correctness is affected | Existing query/cache tests plus integration or E2E assertions | A stable cache owner and observable stale-state risk exist | Lint cannot establish runtime freshness or distributed invalidation |
| Protect Core Web Vitals and bundle cost | SHOULD | Existing bundle budgets, Lighthouse, browser metrics, or CI performance checks | Baselines and meaningful thresholds already exist | Do not fail CI on uncalibrated synthetic noise |

## Recommended Adoption Sequence

1. Inventory current compiler, ESLint config, plugins, scripts, and CI.
2. Map only already-enforced rules first.
3. Add missing MUST enforcement when the tool is already available and false positives are understood.
4. Introduce new checks as warnings and record the baseline.
5. Fix high-risk findings before converting warnings to errors.
6. Keep manual verification beside every partial automation.

## Configuration Guidance

### React Hooks

- Keep `rules-of-hooks` enabled for React code.
- Preserve the project's `exhaustive-deps` policy unless configuration or demonstrated synchronization bugs justify a change.
- Configure custom Effect hooks only when the installed plugin version supports the setting and the hooks genuinely share Effect semantics.

### TypeScript

- Run the repository's installed compiler rather than a globally installed latest version.
- Treat `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` changes as migrations in established projects.
- Avoid duplicate base ESLint and TypeScript-aware unused-variable diagnostics.

### Security And Accessibility

- Prefer narrow restrictions around approved boundaries over global syntax bans.
- Do not treat a clean lint run as proof of security or accessibility.
- Require runtime, keyboard, focus, payload, deployment, or backend verification where the rule depends on those systems.

## Source References

- React Rules of Hooks lint: https://react.dev/reference/eslint-plugin-react-hooks/lints/rules-of-hooks
- React exhaustive-deps lint: https://react.dev/reference/eslint-plugin-react-hooks/lints/exhaustive-deps
- TypeScript strict: https://www.typescriptlang.org/tsconfig/strict.html
- TypeScript exactOptionalPropertyTypes: https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html
- TypeScript noUncheckedIndexedAccess: https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html
- TypeScript noUnusedLocals: https://www.typescriptlang.org/tsconfig/noUnusedLocals.html
- TypeScript noUnusedParameters: https://www.typescriptlang.org/tsconfig/noUnusedParameters.html
- ESLint no-unused-vars: https://eslint.org/docs/latest/rules/no-unused-vars
- ESLint no-restricted-imports: https://eslint.org/docs/latest/rules/no-restricted-imports
- ESLint no-restricted-syntax: https://eslint.org/docs/latest/rules/no-restricted-syntax
- eslint-plugin-jsx-a11y: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y

