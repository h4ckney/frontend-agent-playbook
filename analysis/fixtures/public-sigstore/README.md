# Public Sigstore interoperability evidence

Captured by [the explicit read-only probe](../../../scripts/verify-public-sigstore.mjs) on 2026-11-22. `public-probe.json` records the exact identities, source URLs, artifact digest and checked time. `repository.json` preserves original signed TUF metadata strings from the public Sigstore mirror, anchored in the independently reviewed official sigstore-js release seed root 16. `bundle.json` is npm's existing public SLSA provenance; `live-bundle.json` replaces its inclusion material with the actual Rekor GET response's authenticated proof.

`verify-4.1.3.tgz` is an **opaque test artifact**, used only to hash the actual archive bytes against the authenticated signed subject and npm integrity. Tests never extract, install or execute it. Public upstream metadata/certificates are evidence, not project instructions or production trust policy.

The [offline tests](../../public-sigstore.test.mjs) fix Date to the recorded observation time explicitly. They preserve interoperability after metadata expiry without treating old evidence as current freshness. The runtime verifier still rejects expired metadata using current time. See [scope, reproduction, TUF rules and remaining gaps](../../../docs/tuf-trust-lifecycle.md).
