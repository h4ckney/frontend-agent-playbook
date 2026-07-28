# Bug Fix Template

Use this template when asking an AI coding agent to fix a frontend bug.

## Bug Summary

[Describe the incorrect behavior.]

## Expected Behavior

[Describe the correct behavior.]

## Actual Behavior

[Describe what currently happens.]

## Reproduction Steps

1. Open:
2. Click or enter:
3. Observe:

## Environment

- Browser/device:
- Route/page:
- User state or permissions:
- Relevant data conditions:

## Suspected Area

- Files/routes/components:
- Recent changes:
- API/data dependencies:

## Constraints

- Behavior to preserve:
- Files to avoid:
- Compatibility concerns:

## Fix Requirements

- Make the smallest safe change.
- Preserve unrelated behavior.
- Add a regression test when practical.
- Verify loading, empty, error, and success states if affected.

## Verification

- Regression test:
- Type check command:
- Lint command:
- Build command:
- Manual checks:

## Completion Criteria

- The bug no longer reproduces.
- The expected behavior is covered by test or manual verification.
- No unrelated behavior changed.
