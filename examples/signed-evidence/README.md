# Signed evidence example — controlled test signer

This example uses real ECDSA P-256 signatures over synthetic build and deployment statements. [The fixture generator](../../analysis/fixtures/signed-evidence.mjs) creates an ephemeral test key; only its public key and signatures are stored here. The policy represents this example's signer and is not an organization's production trust policy.

Without an explicit trust policy, the reports remain unauthenticated:

```sh
node bin/frontend-agent-audit.mjs scan --root examples/signed-evidence --format json
```

Explicitly select [the example public policy](public-policy.json) to test verification:

```sh
node bin/frontend-agent-audit.mjs scan --root examples/signed-evidence --trust-policy public-policy.json --format json
```

In the dashboard, select this folder, then separately choose `public-policy.json` with the public-key policy control. Merely including it in the folder does not activate it. Clearing the policy drops authentication immediately. Policy state is kept only in the current tab.

The [evidence config](.frontend-evidence.json) adds `artifactName` and two `attestations` references (`kind`, `path`, `sha256`, `format: dsse-in-toto`). [Build DSSE](evidence/build.dsse) signs SLSA provenance v1; [deployment DSSE](evidence/deployment.dsse) signs the repository's deployment predicate. The policy pins public SPKI SHA-256, algorithm, DER/P1363 encoding, roles, repository URI including ref, builder/collector identity, exact build parameters, deployment environment and key-validity interval.

Observations are dated 2026-11-22. Stale observations or an expired policy correctly stop authentication on later dates. Matching signatures do not establish live operation, SLSA certification, reachability or security remediation. See [verification rules, sources, failure cases and recovery](../../docs/attestation-verification.md).
