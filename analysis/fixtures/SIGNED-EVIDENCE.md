# Signed fixture provenance

The PAE string, public P-256 coordinates and ECDSA signature in [attestations.test.mjs](../attestations.test.mjs) are the DSSE 1.0.2 public interoperability vector from the [official protocol](https://github.com/dsse-lf/dsse/blob/master/protocol.md), checked 2026-11-22. Tests reproduce verification with platform crypto; the official sample private scalar is not copied.

[The generator](signed-evidence.mjs) makes fresh ephemeral P-256 keys and uses Node crypto to sign independently constructed DSSE PAE for synthetic in-toto build/deployment statements. The product verifier uses platform WebCrypto. Generated example files contain only public keys and signatures. They are controlled fixtures, not a production builder/collector identity or live deployment evidence.
