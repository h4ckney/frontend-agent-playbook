# TypeScript Rules

## Purpose

Define how AI agents should use TypeScript to make frontend code safer, clearer, and easier to review.

## Source Priority

Use the shared precedence in [Rule Governance](./governance.md). Consult TypeScript documentation that matches the configured compiler version after inspecting `tsconfig` and existing project type patterns.

## References

- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/intro.html
- Everyday Types: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html
- Narrowing: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- Generics: https://www.typescriptlang.org/docs/handbook/2/generics.html
- TSConfig Reference: https://www.typescriptlang.org/tsconfig
- TypeScript 3.4 const assertions: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-4.html
- TypeScript 4.9 satisfies operator: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html
- TypeScript 5.0 const type parameters: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html

## Version And Literal Type Features

- **SHOULD**: Inspect the installed TypeScript version and `tsconfig` before using newer syntax or inference behavior.
- **SHOULD**: Distinguish basic literal types from versioned features such as const assertions in TypeScript 3.4, `satisfies` in TypeScript 4.9, and const type parameters in TypeScript 5.0.
- **MUST**: Do not generate syntax that the project's compiler cannot parse.
- **SHOULD**: When a requirement materially benefits from a newer literal-preserving feature, recommend upgrading TypeScript instead of building a complex type workaround.
- **SHOULD**: Before recommending an upgrade, check Node.js, framework, build-tool, editor, and library compatibility and identify likely migration work.
- **MUST**: Do not silently upgrade TypeScript during a scoped feature or bug fix. Present the upgrade as a separate recommendation unless the user approves it as part of the task.
- **SHOULD**: When an upgrade is blocked, use the clearest compatible type and document any loss of inference or safety.

## Core Rules

- **SHOULD**: Prefer precise types over broad types.
- **SHOULD**: Avoid `any`; use `unknown` for untrusted values and narrow before use.
- **SHOULD**: Model UI states with discriminated unions when multiple states are possible.
- **SHOULD**: Keep API response types separate from UI/domain types when transformation is required.
- **SHOULD**: Add explicit return types at public boundaries when inference does not make the contract sufficiently clear or stable.
- **SHOULD**: Use generics only when they preserve useful caller information.
- **SHOULD**: Avoid non-null assertions unless the invariant is local and obvious.

## API Boundary Rules

- **MUST**: Treat API responses, local storage, URL params, and user input as untrusted.
- **MUST**: Validate or narrow external data before using it in correctness-sensitive or security-sensitive UI logic.
- **SHOULD**: Keep DTO names explicit, such as `UserResponse` or `ProductDto`.
- **SHOULD**: Convert DTOs into UI-friendly domain types near the boundary.

## React Props and State Rules

- **SHOULD**: Define component props by intent and keep them narrow.
- **SHOULD**: Avoid large prop objects full of optional fields.
- **SHOULD**: Use discriminated unions for components with distinct modes.
- **SHOULD**: Do not duplicate state that can be derived from props or existing state.

## Do

- **SHOULD**: Use `type` or `interface` consistently with the project style.
- **SHOULD**: Prefer literal unions for known option sets.
- **SHOULD**: Use `readonly` when mutation should not happen.
- **SHOULD**: Keep exported types intentional and easy to search.

## Avoid

- **MUST**: Do not silence compiler errors with `as any` in new or changed code.
- **MUST**: Do not use non-null assertions to skip required null handling in new or changed code.
- **SHOULD**: Do not create generic helpers when a concrete type is clearer.
- **SHOULD**: Do not let backend response shapes leak across the entire frontend.

## AI Agent Checklist

- Did I check the project `tsconfig` and existing type style?
- Did I check that the syntax and inference behavior are supported by the installed TypeScript version?
- If literal-preserving support is missing, did I recommend a compatible upgrade before adding a complex workaround?
- Did I avoid `any` at new or changed code boundaries?
- Did I narrow `unknown` before using it?
- Are async/UI states impossible to represent incorrectly?
- Are component props understandable at the call site?
- Did I avoid type assertions that hide real uncertainty?

## Examples

Bad:

```ts
async function loadUser(): Promise<any> {
  return fetch('/api/user').then((res) => res.json());
}
```

Good:

```ts
type UserResponse = {
  id: string;
  name: string;
};

async function loadUser(): Promise<UserResponse> {
  const response = await fetch('/api/user');
  if (!response.ok) {
    throw new Error('Failed to load user');
  }

  const data: unknown = await response.json();
  if (!isUserResponse(data)) {
    throw new Error('Invalid user response');
  }

  return data;
}

function isUserResponse(value: unknown): value is UserResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}
```

Bad:

```ts
type RequestState = {
  loading?: boolean;
  error?: string;
  data?: User[];
};
```

Good:

```ts
type RequestState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: User[] };
```

## Expansion Notes

Add validation examples with the project's preferred schema library when one exists.
