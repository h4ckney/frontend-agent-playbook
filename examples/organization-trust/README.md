# Organization trust example

This is a **reviewable example**, not an adopted production organization policy. It uses an illustrative example/frontend main-workflow identity, a one-day policy window, and the previously verified public TUF floor. No actual organization or workflow is approved by this file. Replace the organization/profile, exact repository/workflow/ref, roles, builder, parameters and validity with separately approved values. Never let the scanned project adopt or reset the operator's store.

Follow the [operator runbook](../../docs/organization-trust.md). The policy is bounded and compiled atomically by [organization-trust.cjs](../../verification/organization-trust.cjs), then must be explicitly adopted before a scan can select it. The checked-in file itself grants no authority. The example's build role does not authenticate deployment.
