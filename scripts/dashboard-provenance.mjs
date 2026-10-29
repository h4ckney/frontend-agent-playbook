import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export function previewUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !["/analysis/", "/analysis/index.html"].includes(url.pathname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error("use a local HTTP preview at /analysis/ or /analysis/index.html");
  }
  return url;
}

// Verify the actual response bytes before opening a browser and once more after
// the scenarios. A matching checkout hash alone says nothing about the server.
export async function verifyDashboardPreview(input, sourceRoot, previous) {
  const url = previewUrl(input);
  const diskHashes = {};
  const servedHashes = {};
  const assetUrls = {};
  const readAsset = async (assetUrl, relative) => {
    const response = await fetch(assetUrl, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
    });
    assert.equal(response.status, 200, "preview asset response: " + assetUrl);
    const served = Buffer.from(await response.arrayBuffer());
    const disk = await fs.readFile(path.join(sourceRoot, relative));
    diskHashes[relative] = sha256(disk);
    servedHashes[relative] = sha256(served);
    assetUrls[assetUrl.href] = relative;
    assert.equal(servedHashes[relative], diskHashes[relative], "served asset differs from checkout: " + relative);
    return served.toString("utf8");
  };
  const html = await readAsset(url, "analysis/index.html");
  const references = [...html.matchAll(/<(script|link)\b([^>]*)>/gi)].flatMap((match) => {
    const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
      .map((item) => [item[1].toLowerCase(), item[2] ?? item[3] ?? item[4]]));
    if (match[1].toLowerCase() === "script" && attributes.src) return [attributes.src];
    if (match[1].toLowerCase() === "link" && attributes.rel === "stylesheet" && attributes.href) return [attributes.href];
    return [];
  });
  assert.ok(references.length, "dashboard must load script/style assets");
  for (const reference of [...new Set(references)]) {
    const assetUrl = new URL(reference, url);
    assert.equal(assetUrl.origin, url.origin, "dashboard assets must use this local preview");
    assert.match(assetUrl.pathname, /^\/analysis\/[\w.-]+\.(?:js|css)$/,
      "only direct dashboard script/style files are supported");
    assert.equal(assetUrl.search + assetUrl.hash, "", "dashboard asset URL must be stable");
    await readAsset(assetUrl, assetUrl.pathname.slice(1));
  }
  if (previous) {
    assert.equal(previous.testedUrl, url.href, "preview URL changed during verification");
    assert.deepEqual(diskHashes, previous.diskHashes, "dashboard source changed during verification");
    assert.deepEqual(servedHashes, previous.servedHashes, "served dashboard changed during verification");
  }
  return { testedUrl: url.href, checkedAt: new Date().toISOString(), diskHashes, servedHashes, assetUrls };
}

export async function hashVerificationSources(sourceRoot) {
  const hashes = {};
  for (const file of ["scripts/verify-dashboard.mjs", "scripts/dashboard-provenance.mjs"]) {
    hashes[file] = sha256(await fs.readFile(path.join(sourceRoot, file)));
  }
  return hashes;
}
