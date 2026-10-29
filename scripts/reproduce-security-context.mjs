#!/usr/bin/env node
// Synthetic versions only. Never installs or executes the affected packages.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAuditBundle, validateAuditResult, buildAuditMarkdown } = require('../analysis/audit-contract.js');
const records = [
  { path: 'Dockerfile', content: 'FROM node:24.22.0 AS builder\nRUN echo synthetic\nFROM php:8.4.26-fpm AS production\n' },
  { path: 'package.json', content: JSON.stringify({ dependencies: { next: '^16.4.0' }, devDependencies: { vite: '^6.0.0' } }) },
  { path: 'package-lock.json', content: JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { next: '^16.4.0' }, devDependencies: { vite: '^6.0.0' } },
    'node_modules/next': { version: '16.4.0' },
    'node_modules/react-server-dom-webpack': { version: '19.3.0' },
    'node_modules/worker/node_modules/react-server-dom-webpack': { version: '19.3.0', dev: true },
    'node_modules/vite': { version: '6.0.0', dev: true }
  } }) },
  { path: 'composer.json', content: JSON.stringify({ require: { php: '^8.4', 'vendor/app': '^1.0' }, 'require-dev': { 'vendor/test': '^2.0' } }) },
  { path: 'composer.lock', content: JSON.stringify({ packages: [{ name: 'vendor/app', version: '1.0.0' }], 'packages-dev': [{ name: 'vendor/test', version: '2.0.0' }] }) }
];
const result = createAuditBundle({ name: 'synthetic-security-context', records,
  generatedAt: '2026-10-30T00:00:00Z', scope: { selected: records.length, analyzed: records.length,
    analyzedBytes: records.reduce((sum, record) => sum + Buffer.byteLength(record.content), 0) } }).audit;
assert.deepEqual(validateAuditResult(result), []);
assert.ok(result.findings.find((item) => item.id === 'security.node-brotli-2026').observedFact.includes('CVE-2026-111497'));
assert.equal(result.findings.filter((item) => item.id === 'security.rsc-typed-array-rce').length, 3);
assert.ok(result.securityContext.inventory.find((item) => item.name === 'node').phase === 'build');
assert.ok(result.securityContext.inventory.find((item) => item.name === 'php' && item.versionKind === 'image-pin').phase === 'runtime');
assert.ok(result.securityContext.inventory.find((item) => item.name === 'vite' && item.versionKind === 'locked-exact').phase === 'build');
assert.equal(result.securityContext.snapshot.liveLookup, false);
assert.equal(result.securityContext.coverage.complete, false);
const directory = process.argv[2];
if (directory) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(directory + '/synthetic-scan.json', JSON.stringify(result, null, 2) + '\n');
  await fs.writeFile(directory + '/synthetic-report.md', buildAuditMarkdown(result, { locale: 'ko' }) + '\n');
}
process.stdout.write(JSON.stringify({ target: 'synthetic fixture; no installed or deployed package evidence',
  snapshot: result.securityContext.snapshot.id, inventory: result.securityContext.inventory.length,
  findings: result.findings.filter((item) => item.area === 'security').map((item) => ({ id: item.id, fingerprint: item.fingerprint, observedFact: item.observedFact })),
  checks: ['advisory identifiers retained', 'one parent advisory with three module occurrences', 'runtime/build/development distinguished', 'offline and incomplete coverage explicit'] }, null, 2) + '\n');
