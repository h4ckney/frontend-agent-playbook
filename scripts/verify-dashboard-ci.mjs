#!/usr/bin/env node
// Serve this checkout only, using a fresh loopback port. Never execute project inputs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (request, response) => {
  const resource = request.url === '/analysis/' ? 'index.html' : /^\/analysis\/((?:vendor\/)?[\w.-]+\.(?:js|css|html))$/.exec(request.url)?.[1];
  if (request.method !== 'GET' || !resource) { response.writeHead(404).end(); return; }
  try {
    const bytes = await readFile(path.join(root, 'analysis', resource));
    response.writeHead(200, { 'Content-Type': resource.endsWith('.js') ? 'text/javascript' : resource.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/analysis/`;
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/verify-dashboard.mjs'), '--url', url, '--output', path.resolve(process.argv[2] || '.frontend-audit/browser')], { stdio: 'inherit' });
    const timer = setTimeout(() => child.kill('SIGTERM'), 4 * 60 * 1000);
    timer.unref();
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Browser verification failed: ${code ?? signal}`)); });
  });
} finally { await new Promise(resolve => server.close(resolve)); }
