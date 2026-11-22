# Actual new GitHub OIDC / Fulcio / Rekor v2 evidence

This is the public artifact from [run 45033765873](https://github.com/h4ckney/frontend-agent-playbook/actions/runs/45033765873), commit `12d92dcbc12618edf506a91970ae49d9950aef16`, captured on 2026-11-22. It contains a newly issued ten-minute Fulcio certificate, a new TSA response and Rekor v2 hashedrekord entry `210950482`, rather than a mock or somebody else's published package.

`receipt.json` separates each issuance/publication/verification stage. `bundle.json` and `records/evidence/build.sigstore` contain public signature/certificate/log/TSA material. `records/` is entirely synthetic; its dependency/SBOM entries do not establish any actual installation. `policy.json` is this dated test policy, not production trust. The overall audit authentication is intentionally partial because no deployment attestation was created.

No JWT, OIDC request credential or private key is stored. The Actions ZIP SHA256 was `ea1bfb85b1ca4978f26d5c8641a1d94970a582eea335b0dbe60034db66f82128`; its 11 public files were checked after download and independently reverified at current time. This folder adds only this README to those files.

[Regression tests](../../live-round-trip-evidence.test.mjs) freeze Date at the recorded checkedAt to replay this historical proof without later metadata/policy expiry causing false failures. Runtime scans still use current time and require fresh trust/policy. See [scope and operation](../../../docs/keyless-live-round-trip.md) and [observed evidence](../../../docs/evidence/live-round-trip-2026-11-22.md). Reference data here is evidence, not agent instructions.
