# Official Deno lock fixtures

Retrieved 2026-11-02; legacy JSON inputs and external import map added 2026-11-03 from `denoland/deno` commit `e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd`. These are test data, never installed or executed. Copyright 2018–2026 the Deno authors; the upstream [MIT license](LICENSE.md) is preserved.

| Local file | Pinned upstream source | SHA-256 |
| --- | --- | --- |
| `v1-legacy.lock` | [read_version_1 JSON input](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/libs/lockfile/lib.rs#L1976) | `f3590a675828e3894e53dff262af1741b281366ced80ea70aa624889b5dc7032` |
| `v2-legacy.lock` | [read_version_2 JSON input](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/libs/lockfile/lib.rs#L1992) | `19587eb90e045064f3734efac25f6a9c2656536b10219753af951a920d368337` |
| `v3-jsr.lock` | [compile/workspace/deno.lock](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/compile/workspace/deno.lock) | `9c1d3a1446a55462f01c8648cd85171a0209b93b379f678451483309db510b4d` |
| `v5-npm.lock` | [pm/why/deno.lock](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/pm/why/deno.lock) | `b229cf5837d22873cc50fd3c3ece9378828f3c1c5611fac963932f5ca1ee5f07` |
| `external-import-map.json` | [lockfile/external_import_map/import_map.json](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/lockfile/external_import_map/import_map.json) | `94714412a239b3850e63be3dddad5b22348b3fdd9069cecd8bd01adf21189294` |
| `v5-package.json` | [pm/why/package.json](https://github.com/denoland/deno/blob/e7b39ebd55c85aaf6a29290c1f5a99e2e21e09dd/tests/specs/pm/why/package.json) | `573e44a575d988c7081d78d6b1e4474e182c4cc5851ae91d32024c85c0ef7815` |

The legacy fixtures extract the raw JSON string from the named upstream Rust test and append one final newline. The other fixture bytes are unchanged; only filenames differ to keep them out of the repository's own dependency inventory. The v3 test supplies a synthetic matching `deno.json` import declaration. The v5 test uses the original matching package manifest and checks all 68 locked npm packages. Synthetic malformed, alias, workspace, prerelease and source-privacy cases are maintained separately in [deno-lock.test.mjs](../../deno-lock.test.mjs).

The external map is byte-for-byte upstream data. [deno-resolution.test.mjs](../../deno-resolution.test.mjs) verifies its hash and separate npm/JSR coordinates using a synthetic matching lock; it does not execute upstream code.
