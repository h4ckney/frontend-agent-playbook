import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = new URL("./frontend-agent-audit.mjs", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { createAuditBundle } = require("../analysis/audit-contract.js");

async function fixture(profileOverrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-audit-"));
  await fs.mkdir(path.join(root, "pages"), { recursive: true });
  await fs.mkdir(path.join(root, ".frontend-audit"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    dependencies: { next: "13.5.0", react: "18.2.0" },
    scripts: { test: "vitest" }
  }));
  await fs.writeFile(path.join(root, "pages", "index.tsx"), "export default function Page() { return <main>Home</main>; }");
  await fs.writeFile(path.join(root, ".env"), "SECRET_TOKEN=must-not-appear");
  const profile = {
    schemaVersion: "1",
    project: { id: "fixture", visibility: "internal" },
    suppressions: [],
    ci: { mode: "report-only", failOn: [], requireComplete: false },
    ...profileOverrides
  };
  await fs.writeFile(path.join(root, ".frontend-agent-playbook.json"), JSON.stringify(profile));
  return root;
}

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function snapshotBaseline(root) {
  const resultPath = path.join(root, ".frontend-audit", "result.json");
  const baselinePath = path.join(root, ".frontend-audit", "baseline.json");
  const scan = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--format", "json", "--output", resultPath, "--quiet"
  ], root);
  assert.equal(scan.status, 0, scan.stderr);
  const baseline = run([
    "baseline", "--from", resultPath, "--output", baselinePath, "--quiet"
  ], root);
  assert.equal(baseline.status, 0, baseline.stderr);
}

function scanWithBaseline(root) {
  return run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--baseline", ".frontend-audit/baseline.json", "--format", "json"
  ], root);
}

test("emits clean JSON without source or environment values", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json", "--format", "json"
  ], root);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.project.rootLabel, "fixture");
  assert.equal(parsed.engine.analysisMode, "static-lite");
  assert.doesNotMatch(result.stdout, /must-not-appear|SECRET_TOKEN/);
  assert.equal(parsed.scope.excludedByReason.environment, 1);

  const directRecords = await Promise.all(["package.json", "pages/index.tsx"].map(async (relative) => {
    const content = await fs.readFile(path.join(root, relative), "utf8");
    return { path: relative, content, size: Buffer.byteLength(content) };
  }));
  const profile = JSON.parse(await fs.readFile(path.join(root, ".frontend-agent-playbook.json"), "utf8"));
  const direct = createAuditBundle({
    name: "fixture",
    records: directRecords,
    scope: { selected: 4, analyzed: 2, excluded: 2, analyzedBytes: 1 },
    profile,
    profileDigest: parsed.engine.profileDigest,
    scopePolicyDigest: parsed.scopePolicyDigest,
    capabilities: parsed.engine.capabilities,
    generatedAt: parsed.generatedAt
  }).audit;
  assert.deepEqual(
    parsed.findings.map(({ id, fingerprint, detectorId }) => ({ id, fingerprint, detectorId })),
    direct.findings.map(({ id, fingerprint, detectorId }) => ({ id, fingerprint, detectorId }))
  );
});

test("creates a baseline and blocks only configured new findings", async (t) => {
  const root = await fixture({
    ci: {
      mode: "blocking",
      failOn: ["finding:security.html-sink-boundary"],
      requireComplete: false
    }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, ".frontend-audit", "result.json");
  const baselinePath = path.join(root, ".frontend-audit", "baseline.json");

  const first = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--format", "json", "--output", resultPath, "--quiet"
  ], root);
  assert.equal(first.status, 0, first.stderr);

  const baseline = run([
    "baseline", "--from", resultPath, "--output", baselinePath, "--quiet"
  ], root);
  assert.equal(baseline.status, 0, baseline.stderr);

  await fs.writeFile(
    path.join(root, "pages", "unsafe.tsx"),
    "export default function Unsafe({ html }) { return <div dangerouslySetInnerHTML={{ __html: html }} />; }"
  );
  const changed = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--baseline", ".frontend-audit/baseline.json", "--format", "json"
  ], root);

  assert.equal(changed.status, 1, changed.stderr);
  const parsed = JSON.parse(changed.stdout);
  assert.ok(parsed.diff.new.includes("security.html-sink-boundary:pages/unsafe.tsx"));
  assert.ok(parsed.diff.unchanged.includes("security.html-sink-boundary:pages/index.tsx") === false);
});

test("uses exit 2 for invalid profile input", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, ".frontend-agent-playbook.json"), "{\"schemaVersion\":\"1\"}");

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json", "--format", "summary"
  ], root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid project profile/);
});

test("uses exit 3 when complete coverage is required but a symlink is excluded", async (t) => {
  const root = await fixture({
    ci: { mode: "report-only", failOn: [], requireComplete: true }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.symlink(path.join(root, "pages", "index.tsx"), path.join(root, "pages", "linked.tsx"));

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json", "--format", "json"
  ], root);

  assert.equal(result.status, 3, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.scope.partial, true);
  assert.deepEqual(parsed.scope.partialReasons, ["symlink:1"]);
});

test("refuses to overwrite an existing non-analyzer file", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageBefore = await fs.readFile(path.join(root, "package.json"), "utf8");

  const result = run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--format", "json", "--output", "package.json", "--quiet"
  ], root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /refusing to overwrite/);
  assert.equal(await fs.readFile(path.join(root, "package.json"), "utf8"), packageBefore);
});

test("refuses to replace an audit result with its derived baseline", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, ".frontend-audit", "result.json");
  assert.equal(run([
    "scan", "--root", ".", "--profile", ".frontend-agent-playbook.json",
    "--format", "json", "--output", resultPath, "--quiet"
  ], root).status, 0);

  const result = run([
    "baseline", "--from", resultPath, "--output", resultPath, "--quiet"
  ], root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /must differ/);
});

test("ordinary generated wording cannot hide an unchanged baseline risk", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "pages", "unsafe.ts");
  await fs.writeFile(file, "element.innerHTML = userValue;");
  snapshotBaseline(root);
  await fs.writeFile(file, 'const label = "do not edit";\nelement.innerHTML = userValue;');

  const result = scanWithBaseline(root);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const fingerprint = "security.html-sink-boundary:pages/unsafe.ts";
  assert.equal(parsed.scope.partial, false);
  assert.equal(parsed.scope.excludedByReason["generated-header"], undefined);
  assert.ok(parsed.diff.unchanged.includes(fingerprint));
  assert.ok(!parsed.diff.resolved.includes(fingerprint));
});

test("new explicit generated headers make missing baseline evidence unverified", async (t) => {
  const root = await fixture({
    ci: { mode: "report-only", failOn: [], requireComplete: true }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "pages", "unsafe.ts");
  await fs.writeFile(file, "element.innerHTML = userValue;");
  snapshotBaseline(root);
  await fs.writeFile(file, "// @generated by tool\nelement.innerHTML = userValue;");

  const result = scanWithBaseline(root);
  assert.equal(result.status, 3, result.stderr);
  const parsed = JSON.parse(result.stdout);
  const fingerprint = "security.html-sink-boundary:pages/unsafe.ts";
  assert.equal(parsed.scope.partial, true);
  assert.equal(parsed.scope.excludedByReason["generated-header"], 1);
  assert.ok(parsed.scope.partialReasons.includes("generated-header:1"));
  assert.ok(parsed.diff.unverified.includes(fingerprint));
  assert.ok(!parsed.diff.resolved.includes(fingerprint));
});

test("an unrelated new risk still blocks when an old finding with the same detector disappears", async (t) => {
  const root = await fixture({
    ci: { mode: "blocking", failOn: ["severity:high"], requireComplete: true }
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const previous = path.join(root, "pages", "legacy.ts");
  await fs.writeFile(previous, 'localStorage.setItem("token", legacySession);');
  snapshotBaseline(root);
  await fs.rm(previous);
  await fs.writeFile(path.join(root, "pages", "checkout.ts"), 'sessionStorage.setItem("access_token", checkoutSession);');

  const result = scanWithBaseline(root);
  assert.equal(result.status, 1, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.scope.partial, false);
  assert.ok(parsed.diff.new.includes("security.browser-auth-storage:pages/checkout.ts"));
  assert.ok(parsed.diff.unverified.includes("security.browser-auth-storage:pages/legacy.ts"));
  assert.ok(!parsed.diff.unverified.includes("security.browser-auth-storage:pages/checkout.ts"));
});

test('CLI retains workspace gaps and reads Yarn Classic plus npm v1 without exposing resolved credentials', async t => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'apps/untested/pages'), { recursive: true });
  await fs.writeFile(path.join(root, 'apps/untested/package.json'), '{}');
  await fs.writeFile(path.join(root, 'apps/untested/pages/index.tsx'), 'export {}');
  await fs.writeFile(path.join(root, 'yarn.lock'), '# yarn lockfile v1\nnext@^16.4.0:\n  version "16.4.0"\n  resolved "https://user:private-token@example.invalid/archive"\n');
  await fs.writeFile(path.join(root, 'apps/untested/package-lock.json'), JSON.stringify({ lockfileVersion: 1, dependencies: { 'react-server-dom-webpack': { version: '19.3.0', dev: true } } }));
  const output = run(['scan', '--root', '.', '--format', 'json'], root);
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.ok(result.findings.some(f => f.id === 'testing.test-foundation-missing' && f.scope.paths.includes('apps/untested/package.json')));
  assert.equal(result.findings.filter(f => f.id === 'security.rsc-typed-array-rce').length, 2);
  assert.ok(result.securityContext.inventory.some(item => item.manifest === 'yarn.lock' && item.phase === 'unknown'));
  assert.doesNotMatch(output.stdout, /private-token|example.invalid/);
});

test('CLI accepts all modern text locks and connects a shared exact package to the declaring workspace', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-modern-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'apps/web'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"root"}');
  await fs.writeFile(path.join(root, 'apps/web/package.json'), '{"name":"web","dependencies":{"next":"^16.4.0"}}');
  const locks = [
    ['pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/web:\n    dependencies:\n      next: {specifier: ^16.4.0, version: 16.4.0}\npackages:\n  next@16.4.0: {}\nsnapshots:\n  next@16.4.0: {}\n"],
    ['yarn.lock', '__metadata: {version: 8}\n"root@workspace:.":\n  resolution: "root@workspace:."\n"web@workspace:apps/web":\n  resolution: "web@workspace:apps/web"\n  dependencies: {next: "npm:^16.4.0"}\n"next@npm:^16.4.0":\n  version: 16.4.0\n  resolution: "next@npm:16.4.0"\n'],
    ['bun.lock', '{"lockfileVersion":1,"workspaces":{"":{"name":"root"},"apps/web":{"name":"web","dependencies":{"next":"^16.4.0"}}},"packages":{"next":["next@16.4.0","",{}]},}']
  ];
  for (const [name, content] of locks) {
    await fs.writeFile(path.join(root, name), content);
    const output = run(['scan', '--root', '.', '--format', 'json'], root);
    assert.equal(output.status, 0, output.stderr);
    const result = JSON.parse(output.stdout);
    assert.equal(result.scope.partial, false, name);
    assert.deepEqual(result.securityContext.coverage.gaps, [], name);
    assert.equal(result.securityContext.graphs.length, 1);
    const locked = result.securityContext.inventory.find(item => item.provenance === 'lockfile');
    assert.equal(locked.workspaceUsage[0].manifest, 'apps/web/package.json');
    assert.ok(result.findings.some(item => item.id === 'security.rsc-typed-array-rce' && item.observedFact.includes('apps/web/package.json')));
    await fs.rm(path.join(root, name));
  }
});

test('CLI retains both pnpm documents and binary lock exclusions cannot turn missing version evidence into resolved', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-lock-protocol-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"root"}');
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), "---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    configDependencies:\n      next: {specifier: 16.4.0, version: 16.4.0}\npackages:\n  next@16.4.0: {}\nsnapshots:\n  next@16.4.0: {}\n---\nlockfileVersion: '9.0'\nimporters: {.: {}}\n");
  const initial = run(['scan', '--root', '.', '--format', 'json'], root);
  assert.equal(initial.status, 0, initial.stderr);
  const parsed = JSON.parse(initial.stdout);
  assert.equal(parsed.securityContext.graphs.length, 2);
  assert.equal(parsed.securityContext.inventory[0].phase, 'build');
  await fs.rm(path.join(root, 'pnpm-lock.yaml'));
  await fs.writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{},"node_modules/next":{"version":"16.4.0"}}}');
  const baselineSource = path.join(root, 'before.json');
  assert.equal(run(['scan', '--root', '.', '--format', 'json', '--output', baselineSource, '--quiet'], root).status, 0);
  assert.equal(run(['baseline', '--from', baselineSource, '--output', 'baseline.json', '--quiet'], root).status, 0);
  await fs.rm(path.join(root, 'package-lock.json'));
  await fs.writeFile(path.join(root, 'bun.lockb'), Buffer.from([0, 255, 1, 42]));
  const after = run(['scan', '--root', '.', '--baseline', 'baseline.json', '--format', 'json'], root);
  assert.equal(after.status, 0, after.stderr);
  const audit = JSON.parse(after.stdout);
  assert.equal(audit.scope.excludedByReason['binary-lockfile'], 1);
  assert.equal(audit.scope.partial, true);
  assert.ok(audit.scope.partialReasons.includes('binary-lockfile:1'));
  assert.ok(audit.diff.unverified.some(id => id.startsWith('security.rsc-typed-array-rce:')));
  assert.ok(!audit.diff.resolved.some(id => id.startsWith('security.rsc-typed-array-rce:')));
});

test('CLI preserves separate lifecycle products, private configuration boundaries and Deno lock coverage', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frontend-lifecycle-cli-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  await fs.writeFile(path.join(root, 'package.json'), '{}');
  await fs.writeFile(path.join(root, '.dvmrc'), 'lts');
  await fs.writeFile(path.join(root, '.bun-version'), '1.4.4');
  await fs.writeFile(path.join(root, 'deno.jsonc'), '{"deploy":{"app":"private-deploy-project"},"imports":{"assert":"jsr:@std/assert@^1"},}');
  await fs.writeFile(path.join(root, 'deno.lock'), JSON.stringify({version:'5',specifiers:{'jsr:@std/assert@^1':'1.0.0'},jsr:{'@std/assert@1.0.0':{integrity:'synthetic'}},workspace:{dependencies:['jsr:@std/assert@^1']}}));
  const output = run(['scan', '--root', '.', '--format', 'json'], root);
  assert.equal(output.status, 0, output.stderr);
  const audit = JSON.parse(output.stdout);
  assert.equal(audit.scope.partial, false);
  assert.equal(audit.scope.excludedByReason['unsupported-lockfile'], undefined);
  assert.equal(audit.securityContext.graphs[0].format,'deno');
  assert.equal(audit.securityContext.graphs[0].complete,true);
  const lifecycle = audit.securityContext.lifecycle;
  const byComponent = Object.fromEntries(lifecycle.entries.map(item => [item.component, item]));
  assert.equal(lifecycle.policy.checkedAt, '2026-11-02');
  assert.equal(byComponent['deno-runtime'].supportEnds, '2027-10');
  assert.equal(byComponent['deno-deploy'].supportEnds, '2027-04');
  assert.equal(byComponent.jsr.category, 'registry');
  assert.equal(byComponent.jsr.supportEnds, null);
  assert.equal(byComponent.bun.dateBasis, 'not-published');
  assert.equal(byComponent['deno-lts'].supportScope, 'release-line');
  assert.equal(byComponent['deno-lts'].version, 'lts');
  assert.doesNotMatch(output.stdout, /private-deploy-project/);
  assert.ok(audit.securityContext.coverage.gaps.some(item => item.reason === 'jsr-advisory-coverage-unavailable'));
});

test('CLI reads a declared no-extension custom lock and follows a local link inside the selected root',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-deno-custom-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'app'));await fs.mkdir(path.join(root,'locks'));await fs.mkdir(path.join(root,'lib'));
 await fs.writeFile(path.join(root,'app/deno.json'),JSON.stringify({lock:'../locks/pins',links:['../lib'],imports:{lib:'jsr:@example/lib'}}));
 await fs.writeFile(path.join(root,'lib/deno.json'),JSON.stringify({name:'@example/lib',imports:{next:'npm:next@^16.4.0'}}));
 await fs.writeFile(path.join(root,'locks/pins'),JSON.stringify({version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'synthetic'}},workspace:{dependencies:['jsr:@example/lib@*'],links:{'jsr:@example/lib':{dependencies:['npm:next@^16.4.0']}}}}));
 const output=run(['scan','--root','.','--format','json'],root);assert.equal(output.status,0,output.stderr);
 const result=JSON.parse(output.stdout);assert.equal(result.scope.partial,false);
 assert.equal(result.securityContext.graphs[0].lockfile,'locks/pins');
 assert.equal(result.securityContext.graphs[0].complete,true);
 assert.equal(result.securityContext.inventory[0].workspaceUsage[0].manifest,'app/deno.json');
 assert.ok(result.findings.some(item=>item.id === 'security.rsc-typed-array-rce' && item.evidence.some(item=>item.path === 'locks/pins')));
});

test('CLI refuses to follow outside-root and symlink custom locks and retains missing version evidence',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-deno-boundary-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-deno-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
 await fs.writeFile(path.join(outside,'secret.lock'),'{"PRIVATE_DATA":"must-not-appear"}');
 await fs.writeFile(path.join(root,'deno.json'),JSON.stringify({lock:'pins',imports:{next:'npm:next@^16.4.0'}}));
 await fs.symlink(path.join(outside,'secret.lock'),path.join(root,'pins'));
 const output=run(['scan','--root','.','--format','json'],root);assert.equal(output.status,0,output.stderr);
 const result=JSON.parse(output.stdout);assert.equal(result.scope.partial,true);assert.equal(result.scope.excludedByReason.symlink,1);
 assert.ok(result.securityContext.coverage.gaps.some(item=>item.reason === 'deno-custom-lock-unavailable'));
 assert.doesNotMatch(output.stdout,/PRIVATE_DATA|must-not-appear|secret.lock/);
 await fs.writeFile(path.join(root,'deno.json'),JSON.stringify({lock:outside+'/secret.lock'}));
 const unsafe=run(['scan','--root','.','--format','json'],root);assert.equal(unsafe.status,0,unsafe.stderr);
 assert.ok(JSON.parse(unsafe.stdout).securityContext.coverage.gaps.some(item=>item.reason === 'unsafe-deno-lock-path'));
 assert.doesNotMatch(unsafe.stdout,/PRIVATE_DATA|must-not-appear|secret.lock/);
});

test('CLI reads a selected external map with an unknown extension and preserves local file provenance',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-deno-map-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'maps'));
 await fs.writeFile(path.join(root,'deno.json'),JSON.stringify({importMap:'maps/imports.map'}));
 await fs.writeFile(path.join(root,'maps/imports.map'),JSON.stringify({imports:{next:'npm:next@^16.4.0',module:'../entry.ts'}}));
 await fs.writeFile(path.join(root,'entry.ts'),'export const value=1;');
 await fs.writeFile(path.join(root,'deno.lock'),JSON.stringify({version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'x'}},workspace:{dependencies:['npm:next@^16.4.0']}}));
 const output=run(['scan','--root','.','--format','json'],root);assert.equal(output.status,0,output.stderr);
 const result=JSON.parse(output.stdout),graph=result.securityContext.graphs[0];
 assert.deepEqual(graph.importMaps,['maps/imports.map']);
 assert.deepEqual(graph.localMappings,[{source:'maps/imports.map',target:'entry.ts',prefix:false,exists:true}]);
 assert.ok(result.findings.some(item=>item.id === 'security.rsc-typed-array-rce'));
});

test('CLI workspace protocol binds declared members and refuses a symlink external import map',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'frontend-deno-ws-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'packages/lib'),{recursive:true});
 await fs.writeFile(path.join(root,'deno.json'),JSON.stringify({workspace:['packages/*']}));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({dependencies:{lib:'workspace:*'}}));
 await fs.writeFile(path.join(root,'packages/lib/package.json'),JSON.stringify({name:'lib',version:'1.0.0',dependencies:{next:'^16.4.0'}}));
 await fs.writeFile(path.join(root,'deno.lock'),JSON.stringify({version:'5',specifiers:{'npm:next@^16.4.0':'16.4.0'},npm:{'next@16.4.0':{integrity:'x'}},workspace:{packageJson:{dependencies:[]},members:{'packages/lib':{packageJson:{dependencies:['npm:next@^16.4.0']}}}}}));
 const output=run(['scan','--root','.','--format','json'],root);assert.equal(output.status,0,output.stderr);
 const result=JSON.parse(output.stdout);
 assert.ok(result.securityContext.graphs[0].edges.some(item=>item.to === 'local/packages/lib/npm'));
 await fs.writeFile(path.join(root,'private.txt'),'{"SECRET":"never-disclose"}');
 await fs.symlink(path.join(root,'private.txt'),path.join(root,'imports.map'));
 await fs.writeFile(path.join(root,'deno.json'),JSON.stringify({workspace:['packages/*'],importMap:'imports.map'}));
 const blocked=run(['scan','--root','.','--format','json'],root);assert.equal(blocked.status,0,blocked.stderr);
 const audit=JSON.parse(blocked.stdout);assert.equal(audit.scope.partial,true);
 assert.ok(audit.securityContext.coverage.gaps.some(item=>item.reason === 'deno-import-map-unavailable-or-invalid'));
 assert.doesNotMatch(blocked.stdout,/never-disclose/);
});
