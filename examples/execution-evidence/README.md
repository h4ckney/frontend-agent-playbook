# Execution evidence example — synthetic

This example is generated from [the synthetic fixture builder](../../analysis/fixtures/execution-evidence.mjs). It is not a real installation, SBOM or deployment. The observation date is pinned to 2026-11-22; later scans may correctly flag stale evidence.

From this repository, run:

```sh
node bin/frontend-agent-audit.mjs scan --root examples/execution-evidence --format json
```

The root [.frontend-evidence.json](.frontend-evidence.json) binds the [workspace manifest](apps/web/package.json) and [lock](apps/web/package-lock.json) to three reports:

- [npm tree](evidence/install.tree): `format: npm-ls`, `mode: installed-tree`.
- [CycloneDX SBOM](evidence/sbom.cdx): `format: cyclonedx-json`.
- [Deployment observation](evidence/deployment.report): `format: deployment-observation`.

Every file hash uses SHA-256 over UTF-8 bytes and is prefixed with `sha256:`. The synthetic artifact digest is a placeholder distinct from each report's hash. Replace report contents, manifest/lock hashes, revision, observation dates and artifact digest with your own observations together. Never interpret this example's matching hashes as operational proof.

The deployment report is this repository's interchange format, not a provider's native response. Required fields are `schemaVersion: "1"`, `kind: "deployment"`, `status: "succeeded"`, `environment` (production/staging/preview), `manifest`, `revision`, `artifactDigest`, and UTC `observedAt`. Optional `runtimes` contains `{name, version}` objects for Node/PHP/Deno/Bun. Tokens, URLs and provider response bodies are unnecessary.

Report paths are relative to the selected root. Unknown extensions are admitted only when explicitly referenced. Shared reports, mismatches, unsupported values and missing inputs remain unverified. See [scope, primary sources, capture instructions and limitations](../../docs/execution-evidence.md).
