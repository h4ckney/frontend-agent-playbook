# Dependency advisory review

Queried at: 2026-10-29T15:50:55.911Z

Coverage: **complete**. Complete means only the submitted locked inventory was queried; it does not establish safety.

Only ecosystem, package name and locked exact version were sent to OSV (plus advisory IDs/page tokens). Project paths, source code and phase evidence stay local. Package names can identify private modules.

| Module | Version | Result | Declared phase / local evidence |
| --- | --- | --- | --- |
| npm:lodash | 4.17.20 | advisories-reported | runtime @ package-lock.json:node_modules/lodash |

## GHSA-29mw-wpgm-hmr9

Aliases: CVE-2020-28500

Regular Expression Denial of Service  ReDoS  in lodash

[OSV record](https://osv.dev/vulnerability/GHSA-29mw-wpgm-hmr9) — OSV version-query association; deployment and vulnerable call path require verification.

- npm:lodash@4.17.20 — runtime / package-lock.json:node_modules/lodash

## GHSA-35jh-r3h4-6jhm

Aliases: CVE-2021-23337

Command Injection in lodash

[OSV record](https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm) — OSV version-query association; deployment and vulnerable call path require verification.

- npm:lodash@4.17.20 — runtime / package-lock.json:node_modules/lodash

## GHSA-f23m-r3pf-42rh

Aliases: CVE-2026-2950

lodash vulnerable to Prototype Pollution via array path bypass in  _.unset  and  _.omit 

[OSV record](https://osv.dev/vulnerability/GHSA-f23m-r3pf-42rh) — OSV version-query association; deployment and vulnerable call path require verification.

- npm:lodash@4.17.20 — runtime / package-lock.json:node_modules/lodash

## GHSA-r5fr-rjxr-66jc

Aliases: CVE-2026-4800

lodash vulnerable to Code Injection via  _.template  imports key names

[OSV record](https://osv.dev/vulnerability/GHSA-r5fr-rjxr-66jc) — OSV version-query association; deployment and vulnerable call path require verification.

- npm:lodash@4.17.20 — runtime / package-lock.json:node_modules/lodash

## GHSA-xxjr-mmjv-4gpg

Aliases: CVE-2025-13465

Lodash has Prototype Pollution Vulnerability in  _.unset  and  _.omit  functions

[OSV record](https://osv.dev/vulnerability/GHSA-xxjr-mmjv-4gpg) — OSV version-query association; deployment and vulnerable call path require verification.

- npm:lodash@4.17.20 — runtime / package-lock.json:node_modules/lodash

## Manifest provenance covered by lock entries

- lodash declared ^4.17.20 / package.json:dependencies/lodash — Same-directory lock evidence retained; manifest constraint compatibility and installation are not verified.

## Coverage gaps

- Runtime Node/PHP versions are not npm/Packagist packages and are not queried here.
- Declared versions, ranges, unsupported lock formats and absent inventory remain unverified.
- Lockfile phase describes a declared installation role; production installation, actual runtime version, vulnerable call path and vendor backports require verification.
