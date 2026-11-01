import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import { previewUrl, verifyDashboardPreview } from "./dashboard-provenance.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-provenance-"));
  const bodies = new Map([
    ["analysis/index.html", '<link rel="stylesheet" href="./styles.css"><script src="./app.js"></script>'],
    ["analysis/styles.css", "body{margin:0}"],
    ["analysis/app.js", "console.log('fixture');"]
  ]);
  await fs.mkdir(path.join(root, "analysis"));
  for (const [file, content] of bodies) await fs.writeFile(path.join(root, file), content);
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/analysis/" ? "analysis/index.html" : pathname.slice(1);
    response.writeHead(bodies.has(relative) ? 200 : 404);
    response.end(bodies.get(relative) || "missing");
  });
  t.after(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { root, bodies, url: "http://127.0.0.1:" + server.address().port + "/analysis/" };
}

test("binds the tested URL and every served HTML/script/style byte to this checkout", async (t) => {
  const { root, url } = await fixture(t);
  const before = await verifyDashboardPreview(url, root);
  assert.deepEqual(Object.keys(before.servedHashes).sort(), ["analysis/app.js", "analysis/index.html", "analysis/styles.css"]);
  assert.deepEqual(before.servedHashes, before.diskHashes);
  assert.equal(before.testedUrl, url);
  const after = await verifyDashboardPreview(url, root, before);
  assert.deepEqual(after.servedHashes, before.servedHashes);
});

test("rejects a stale server even when an unrelated checkout has valid source files", async (t) => {
  const { root, url } = await fixture(t);
  await fs.appendFile(path.join(root, "analysis/app.js"), "\n// checkout-only change");
  await assert.rejects(verifyDashboardPreview(url, root), /served asset differs from checkout: analysis\/app\.js/);
});

test("rejects source changes during a run even when the server catches up", async (t) => {
  const { root, bodies, url } = await fixture(t);
  const before = await verifyDashboardPreview(url, root);
  bodies.set("analysis/styles.css", "body{margin:1px}");
  await fs.writeFile(path.join(root, "analysis/styles.css"), bodies.get("analysis/styles.css"));
  await assert.rejects(verifyDashboardPreview(url, root, before), /dashboard source changed during verification/);
});

test("rejects non-preview addresses and credentials", () => {
  for (const url of ["https://example.com/analysis/", "http://127.0.0.1/other/", "http://user:secret@localhost/analysis/"]) {
    assert.throws(() => previewUrl(url), /local HTTP preview/);
  }
});
