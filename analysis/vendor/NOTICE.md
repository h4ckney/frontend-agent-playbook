# Vendored YAML parser

- Package: js-yaml **5.5.0**, MIT. [License](js-yaml.LICENSE)
- Upstream: [release](https://github.com/nodeca/js-yaml/releases/tag/5.5.0), [security advisories](https://github.com/nodeca/js-yaml/security/advisories).
- Reviewed on 2026-11-01. [Source tarball](https://registry.npmjs.org/js-yaml/-/js-yaml-5.5.0.tgz), upstream member `package/dist/browser/js-yaml.umd.min.js`, copied byte for byte as `js-yaml-5.5.0.js`.
- npm tarball integrity: `sha512-paNr4LFIFPjeeSmwNYdrb8FafLLG/Cr2Af3GjbsHJ5CxIjH4r0c2emlmRdAtpPAieP1gRVzk6buBbVP5gBMGAg==`
- Vendored script SHA-256: `02970a652376ad653ff069c606ee7440b0514f52ed94a98426cb52426c8e5a02`. The regression suite verifies these bytes.
- License SHA-256: `a07bc24468b9654ce76a547d47a2db282d07733b715db4c73a98bd63961f9550`.

Browser and CLI use the same local UMD distribution. No runtime download, package install or target script execution. The source-map directive is upstream metadata; the map is not needed for execution and is not bundled.

The analyzer uses FAILSAFE_SCHEMA, maxDepth 48, maxAliases 0 and maxTotalMergeKeys 0. It does not enable YAML 1.1 merge keys or executable tags. Version 4.1.1 was considered and rejected after checking upstream advisories, including [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh). This is a reviewed version pin, not a claim that unknown vulnerabilities cannot exist. Future updates must check upstream advisories, verify tarball integrity, retain the license, update the byte-hash test and run malformed-input plus browser verification.
