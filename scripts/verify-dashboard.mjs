#!/usr/bin/env node
// Optional real-browser verification. Playwright is supplied by the caller,
// installed only by the separate browser CI job, never by the static analyzer.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { previewUrl, sha256, verifyDashboardPreview, hashVerificationSources } from "./dashboard-provenance.mjs";

const values = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (index % 2 === 0) pairs.push([value.replace(/^--/, ""), args[index + 1]]);
  return pairs;
}, []));
if (!values.url || !values.output) throw new Error("usage: node scripts/verify-dashboard.mjs --url http://127.0.0.1:PORT/analysis/ --output DIRECTORY [--channel chrome]");
const url = previewUrl(values.url);
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
await fs.mkdir(values.output, { recursive: true });
await fs.rm(path.join(values.output, "browser-result.json"), { force: true });
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewBefore = await verifyDashboardPreview(url, sourceRoot);
const verificationSourcesBefore = await hashVerificationSources(sourceRoot);
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-audit-ui-"));
await fs.mkdir(path.join(fixture, "src"), { recursive: true });
await fs.writeFile(path.join(fixture, "package.json"), JSON.stringify({ dependencies: { react: "19.0.0" }, scripts: { test: "node --test" } }));
const stylesheet = path.join(fixture, "src", "modal.css");
await fs.writeFile(stylesheet, ".modal{position:fixed;overflow:hidden;transform:translateZ(0);height:40px;width:1200px}");
const browser = await chromium.launch({ headless: true, ...(values.channel ? { channel: values.channel } : {}) });
const errors = [];
const checks = [];
const recordCheck = (description) => { checks.push(description); process.stderr.write("verified: " + description + "\n"); };
const responseChecks = [];
const browserResponseHashes = {};
async function newContext(options) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  // Routing disables the HTTP cache, and new contexts have no persisted state.
  await context.route("**/*", (route) => route.continue());
  context.on("response", (response) => {
    const file = previewBefore.assetUrls[response.url()];
    if (!file) {
      if (["document", "script", "stylesheet"].includes(response.request().resourceType())) {
        errors.push("browser loaded an untracked dashboard asset: " + response.url());
      }
      return;
    }
    responseChecks.push((async () => {
      assert.equal(response.status(), 200, "browser asset response: " + file);
      const hash = sha256(await response.body());
      assert.equal(hash, previewBefore.diskHashes[file], "browser received different asset: " + file);
      browserResponseHashes[file] = hash;
    })().catch((error) => errors.push(error.message)));
  });
  return context;
}
async function settleView(page) {
  // Let viewport/scroll changes reach the compositor before recording pixels.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function exportDocument(page) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportTriage").click();
  return JSON.parse(await fs.readFile(await (await downloadPromise).path(), "utf8"));
}
let result;
try {
  recordCheck("preview HTML and linked scripts/styles match checkout before browser verification");
  const context = await newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(values.url);
  await page.locator("#projectIdentity").fill("synthetic/browser-verification");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  const firstGroup = page.locator(".issue-group").filter({ hasText: "HTML 콘텐츠" }).first();
  await firstGroup.locator(":scope > summary").click();
  await firstGroup.getByRole("button", { name: "열린 항목 묶음 닫기" }).click();
  await page.locator("#closeReason").fill("Synthetic review; not a verified fix.");
  await page.locator("#closeExpires").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.locator("#triageDialog").screenshot({ path: path.join(values.output, "dashboard-close-dialog.png") });
  await page.locator("#triageDialog").getByRole("button", { name: "검토 후 닫기", exact: true }).click();
  assert.equal(await page.locator(".finding-item").filter({ hasText: "security.html-sink-boundary" }).count(), 0);
  await page.locator("#showClosed").check();
  const closedGroup = page.locator(".issue-group").filter({ hasText: "HTML 콘텐츠" }).first();
  if (await closedGroup.getAttribute("open") === null) await closedGroup.locator(":scope > summary").click();
  assert.equal(await closedGroup.getByRole("button", { name: "다시 열기", exact: true }).count(), 2);
  // Check exports through a user-visible download, keeping canonical findings.
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#downloadReport").click();
  const reportDownload = await downloadPromise;
  const reportText = await fs.readFile(await reportDownload.path(), "utf8");
  assert.match(reportText, /security\.html-sink-boundary/);
  assert.match(reportText, /로컬 검토 결정/);
  recordCheck("group close hides reviewed children; closed items reopenable; original Markdown retains findings and review decision");
  await page.reload();
  await page.locator("#projectIdentity").fill("synthetic/browser-verification");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  assert.equal(await page.locator(".finding-item").filter({ hasText: "security.html-sink-boundary" }).count(), 0);
  recordCheck("same project and evidence restore close decisions after page reload");

  const stateDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportTriage").click();
  const stateFile = await stateDownloadPromise;
  const stateBuffer = await fs.readFile(await stateFile.path());
  await page.locator("#chooseTriage").focus();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "triage.json", mimeType: "application/json", buffer: stateBuffer });
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("합쳤습니다"));
  recordCheck("decision export/import roundtrip works through keyboard-accessible file chooser");

  const beforeEmptyImport = await exportDocument(page);
  await page.locator("#toast").evaluate((node) => { node.textContent = ""; });
  await page.locator("#importTriage").setInputFiles({
    name: "old-empty-backup.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: "1", projectKey: "synthetic/browser-verification", decisions: {} }))
  });
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("합쳤습니다"));
  assert.deepEqual(await exportDocument(page), beforeEmptyImport);
  recordCheck("importing an empty same-project backup preserves existing review decisions");

  // A second tab starts from a stale project view; independent decisions must
  // both survive export and reload in either tab.
  const tabB = await context.newPage();
  tabB.on("pageerror", (error) => errors.push(error.message));
  await tabB.goto(values.url);
  await tabB.locator("#projectIdentity").fill("synthetic/two-tabs");
  await tabB.getByRole("button", { name: "상태 연결", exact: true }).click();
  await tabB.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  await page.locator("#projectIdentity").fill("synthetic/two-tabs");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  const chooseRequest = async (target, id) => {
    const group = target.locator(".issue-group").filter({ has: target.locator(".finding-item code", { hasText: id }) }).first();
    if (await group.getAttribute("open") === null) await group.locator(":scope > summary").click();
    await group.locator(".finding-item").filter({ has: target.locator("code", { hasText: id }) })
      .getByRole("button", { name: "재검증 요청", exact: true }).first().click();
  };
  await chooseRequest(page, "security.html-sink-boundary");
  await chooseRequest(tabB, "dead-code.marked-removal-candidate");
  for (const target of [page, tabB]) {
    await target.reload();
    await target.locator("#projectIdentity").fill("synthetic/two-tabs");
    await target.getByRole("button", { name: "상태 연결", exact: true }).click();
    await target.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
    const exported = await exportDocument(target);
    assert.equal(Object.keys(exported.decisions).length, 2);
    assert.ok(Object.keys(exported.decisions).some((key) => key.startsWith("security.html-sink-boundary:")));
    assert.ok(Object.keys(exported.decisions).some((key) => key.startsWith("dead-code.marked-removal-candidate:")));
  }
  await tabB.close();
  recordCheck("independent decisions from two tabs remain present after each tab reloads");

  // Real directory selection, CSS candidate discovery, and source-change recheck.
  await fs.mkdir(path.join(fixture, "src", "public"), { recursive: true });
  await fs.writeFile(path.join(fixture, "src", "public", "modal.css"), ".modal{position:fixed;width:1200px}");
  await page.locator("#chooseFolder").focus();
  // Exercise the actual keyboard/button/input event path while preventing the
  // native directory picker, whose automation interception varies by Chrome.
  await page.evaluate(() => {
    window.folderActivationCount = 0;
    document.querySelector("#folderInput").addEventListener("click", (event) => {
      event.preventDefault();
      window.folderActivationCount += 1;
    }, { once: true });
  });
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.folderActivationCount), 1);
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#projectName").textContent.startsWith("frontend-audit-ui-"));
  await page.locator("#projectIdentity").fill("synthetic/css-project");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  recordCheck("keyboard activates folder control and file input; automation loads directory fixture (native directory picker excluded)");
  assert.ok(await page.locator(".finding-item").filter({ hasText: "styling.overlay-clipping-context" }).count());
  const cssGroup = page.locator(".issue-group").filter({ has: page.locator("summary small", { hasText: /^src$/ }) });
  await cssGroup.locator(":scope > summary").click();
  const publicCard = page.locator("#urgentList .urgent").filter({ hasText: "src/public" });
  assert.equal(await publicCard.locator(".pill.low").count(), 1);
  await cssGroup.locator(".finding-item").filter({ hasText: "styling.overlay-clipping-context" }).getByRole("button", { name: "검토 후 닫기", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#triageDialog").evaluate((node) => node.open), false);
  assert.equal(await cssGroup.locator(".finding-item").filter({ hasText: "styling.overlay-clipping-context" }).getByRole("button", { name: "검토 후 닫기", exact: true }).evaluate((node) => node === document.activeElement), true);
  await cssGroup.locator(".finding-item").filter({ hasText: "styling.overlay-clipping-context" }).getByRole("button", { name: "검토 후 닫기", exact: true }).click();
  await page.locator("#closeReason").fill("Synthetic candidate accepted temporarily.");
  await page.locator("#closeExpires").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.locator("#triageDialog").getByRole("button", { name: "검토 후 닫기", exact: true }).click();
  assert.notEqual(await cssGroup.getAttribute("open"), null);
  assert.equal(await cssGroup.locator(":scope > summary").evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.locator("#urgentList .urgent").filter({ hasText: " · src" }).filter({ hasNotText: "src/public" }).locator(".pill.low").count(), 1);
  recordCheck("module priority excludes another module and closed higher-risk siblings; disclosure and keyboard focus survive close; Escape returns focus");
  await fs.appendFile(stylesheet, "\n.modal .label{color:blue}");
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#exportTriage").disabled);
  await page.locator("#projectIdentity").fill("synthetic/css-project");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  assert.match(await page.locator("#findingsTable").textContent(), /근거 변경/);
  recordCheck("folder input scans CSS fixture; changed source reopens prior review without changing canonical baseline policy");

  // Invalid project import and unavailable browser storage stay fail-open.
  await page.locator("#importTriage").setInputFiles({ name: "other-project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ schemaVersion: "1", projectKey: "other/project", decisions: {} })) });
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("일치하는"));
  assert.ok(await page.locator(".finding-item").filter({ hasText: "styling.overlay-clipping-context" }).count());
  recordCheck("cross-project import rejected without hiding current findings");
  await page.waitForFunction(() => !document.querySelector("#toast").classList.contains("show"));

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(overflow.document <= overflow.viewport, JSON.stringify(overflow));
    await page.evaluate(() => scrollTo(0, 0));
    await settleView(page);
    await page.screenshot({ path: path.join(values.output, "dashboard-" + width + ".png") });
    await page.locator(".all").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await settleView(page);
    await page.screenshot({ path: path.join(values.output, "dashboard-review-" + width + ".png") });
    recordCheck("no document horizontal overflow at " + width + "px (dashboard only)");
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  const longProjectId = "review/" + "x".repeat(130);
  assert.equal(longProjectId.length, 137);
  await page.locator("#projectIdentity").fill(longProjectId);
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  const longIdOverflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(longIdOverflow.document <= longIdOverflow.viewport, JSON.stringify(longIdOverflow));
  await page.locator("#triageStorageStatus").scrollIntoViewIfNeeded();
  await settleView(page);
  await page.screenshot({ path: path.join(values.output, "dashboard-long-project-id-390.png") });
  await page.locator("#projectIdentity").fill("synthetic/css-project");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  recordCheck("valid 137-character project ID with an unbroken suffix has no document overflow at 390px");
  const group = page.locator(".issue-group").filter({ hasText: "styling.overlay-clipping-context" }).first();
  if (await group.getAttribute("open") === null) await group.locator(":scope > summary").click();
  await group.locator(".finding-item").filter({ hasText: "styling.overlay-clipping-context" }).getByRole("button", { name: "재검증 요청", exact: true }).click();
  assert.match(await page.locator("#findingsTable").textContent(), /재검증 요청/);
  assert.equal(errors.length, 0, errors.join("\n"));
  recordCheck("normal clicks reach controls and verification request remains visible; no page errors");
  const reason = group.locator(".finding-reason").first();
  if (await reason.getAttribute("open") === null) await reason.locator("summary").click();
  await reason.locator("summary").focus();
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  assert.notEqual(await reason.getAttribute("open"), null);
  assert.equal(await reason.locator("summary").evaluate((node) => node === document.activeElement), true);
  recordCheck("nested finding reason remains expanded and keyboard-focused after window focus refresh");
  await group.locator(":scope > summary").focus();
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  assert.equal(await group.locator(":scope > summary").evaluate((node) => node === document.activeElement), true);
  await page.locator("#projectIdentity").fill("unsubmitted/project-draft");
  await page.getByText("내부 전용", { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  assert.match(await page.locator("#triageStorageStatus").textContent(), /synthetic\/css-project/);
  recordCheck("scope refresh retains bound identity over unsubmitted text; window-focus refresh preserves group keyboard focus");

  await page.evaluate(() => {
    const input = document.querySelector("#folderInput");
    const dispatch = (root, slow) => {
      const file = new File(["{}"], "package.json", { type: "application/json" });
      Object.defineProperty(file, "webkitRelativePath", { value: root + "/package.json" });
      if (slow) file.text = () => new Promise((resolve) => { window.releaseSlowAuditRead = () => resolve("{}"); });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change"));
    };
    dispatch("slow-project", true);
    dispatch("latest-project", false);
  });
  await page.waitForFunction(() => document.querySelector("#projectName").textContent === "latest-project");
  await page.evaluate(async () => {
    window.releaseSlowAuditRead();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await page.locator("#projectName").textContent(), "latest-project");
  recordCheck("a delayed earlier folder selection cannot overwrite the latest selected project");

  const blockedContext = await newContext({ viewport: { width: 390, height: 844 } });
  await blockedContext.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new Error("synthetic storage denial"); } }));
  const blockedPage = await blockedContext.newPage();
  blockedPage.on("pageerror", (error) => errors.push(error.message));
  await blockedPage.goto(values.url);
  await blockedPage.locator("#projectIdentity").fill("synthetic/no-storage");
  await blockedPage.getByRole("button", { name: "상태 연결", exact: true }).click();
  await blockedPage.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  const blockedGroup = blockedPage.locator(".issue-group").first();
  await blockedGroup.locator(":scope > summary").click();
  await blockedGroup.getByRole("button", { name: "재검증 요청", exact: true }).first().click();
  assert.match(await blockedPage.locator("#triageStorageStatus").textContent(), /보관하지 못했습니다/);
  assert.equal(await blockedPage.locator("#exportTriage").isEnabled(), true);
  const deniedBeforeScope = await exportDocument(blockedPage);
  assert.equal(Object.keys(deniedBeforeScope.decisions).length, 1);
  await blockedPage.getByText("내부 전용", { exact: true }).click();
  await blockedPage.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  assert.deepEqual(await exportDocument(blockedPage), deniedBeforeScope);
  assert.equal(errors.length, 0, errors.join("\n"));
  recordCheck("denied browser storage preserves in-memory review and export across a scope refresh");
  await blockedContext.close();

  // Positive security UI coverage: the vulnerable versions are synthetic file
  // contents only; none of these packages or runtimes is installed or executed.
  await fs.writeFile(path.join(fixture, "Dockerfile"), "FROM node:24.22.0 AS builder\nFROM php:8.4.26-fpm\n");
  await fs.writeFile(path.join(fixture, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {
    "": {}, "node_modules/next": { version: "16.4.0" },
    "node_modules/react-server-dom-webpack": { version: "19.3.0" },
    "node_modules/tools/node_modules/react-server-dom-webpack": { version: "19.3.0", dev: true }
  } }));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#projectName").textContent.startsWith("frontend-audit-ui-"));
  await page.locator("#projectIdentity").fill("synthetic/security-context");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  await page.locator("#securityContext summary").click();
  const inventoryText = await page.locator("#securityContext").textContent();
  for (const text of ["node@24.22.0", "php@8.4.26", "서비스 실행", "빌드", "개발 도구"]) assert.ok(inventoryText.includes(text), text);
  const advisoryGroup = page.locator(".issue-group").filter({ has: page.locator("code", { hasText: /^security\.rsc-typed-array-rce$/ }) });
  assert.equal(await advisoryGroup.count(), 1);
  assert.equal(await advisoryGroup.locator(".finding-item").count(), 3);
  await advisoryGroup.locator(":scope > summary").click();
  await advisoryGroup.locator(".finding-reason summary").first().click();
  assert.match(await advisoryGroup.textContent(), /GHSA-xqc2-xf4c-x3h3/);
  recordCheck("synthetic security versions render runtime/build/development evidence and one advisory parent with three module children");
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.locator("#securityContext").evaluate((node) => node.scrollIntoView({ block: "start" }));
  await settleView(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(values.output, "dashboard-security-390.png") });
  await page.locator("#showClosed").uncheck();
  await advisoryGroup.getByRole("button", { name: "열린 항목 묶음 닫기", exact: true }).click();
  await page.locator("#closeReason").fill("Synthetic advisory reviewed; this is not proof of remediation.");
  await page.locator("#closeExpires").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.locator("#triageDialog").getByRole("button", { name: "검토 후 닫기", exact: true }).click();
  assert.equal(await page.locator("code").filter({ hasText: /^security\.rsc-typed-array-rce$/ }).count(), 0);
  await page.locator("#showClosed").check();
  assert.equal(await page.locator("code").filter({ hasText: /^security\.rsc-typed-array-rce$/ }).count(), 3);
  assert.equal(Object.keys((await exportDocument(page)).decisions).length, 3);
  recordCheck("security parent close retains three exportable child decisions, closed findings remain inspectable, and 390px inventory does not overflow");

  await fs.mkdir(path.join(fixture, "apps", "isolated", "pages"), { recursive: true });
  await fs.writeFile(path.join(fixture, "apps", "isolated", "package.json"), "{}");
  await fs.writeFile(path.join(fixture, "apps", "isolated", "pages", "index.tsx"), "element.innerHTML = html;");
  await fs.writeFile(path.join(fixture, "package.json"), JSON.stringify({ scripts: { test: "vitest" }, dependencies: { dompurify: "3.0.0" } }));
  await page.locator("#showClosed").uncheck();
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".finding-item"))
    .some(node => node.textContent.includes("apps/isolated/package.json") && node.textContent.includes("testing.test-foundation-missing")));
  const workspaceGap = page.locator(".finding-item").filter({ has: page.locator("code", { hasText: /^testing\.test-foundation-missing$/ }) });
  assert.equal(await workspaceGap.count(), 1);
  assert.match(await workspaceGap.textContent(), /apps\/isolated\/package\.json/);
  const workspaceSink = page.locator(".finding-item").filter({ has: page.locator("code", { hasText: /^security\.html-sink-boundary$/ }) });
  assert.match(await workspaceSink.textContent(), /찾지 못함/);
  recordCheck("workspace child test gaps and HTML sanitization evidence remain isolated from the root package in the rendered dashboard");
  await fs.rm(path.join(fixture, "package-lock.json"));
  await fs.writeFile(path.join(fixture, "package.json"), '{"name":"root"}');
  await fs.writeFile(path.join(fixture, "apps", "isolated", "package.json"), '{"name":"isolated","dependencies":{"next":"^16.4.0"}}');
  const modernLocks = [
    ["pnpm-lock.yaml", "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/isolated:\n    dependencies:\n      next: {specifier: ^16.4.0, version: 16.4.0}\npackages:\n  next@16.4.0: {}\nsnapshots:\n  next@16.4.0: {}\n"],
    ["yarn.lock", '__metadata: {version: 8}\n"root@workspace:.":\n  resolution: "root@workspace:."\n"isolated@workspace:apps/isolated":\n  resolution: "isolated@workspace:apps/isolated"\n  dependencies: {next: "npm:^16.4.0"}\n"next@npm:^16.4.0":\n  version: 16.4.0\n  resolution: "next@npm:16.4.0"\n'],
    ["bun.lock", '{"lockfileVersion":1,"workspaces":{"":{"name":"root"},"apps/isolated":{"name":"isolated","dependencies":{"next":"^16.4.0"}}},"packages":{"next":["next@16.4.0","",{}]},}']
  ];
  for (const [name, content] of modernLocks) {
    await fs.writeFile(path.join(fixture, name), content);
    await page.locator("#folderInput").setInputFiles(fixture);
    await page.waitForFunction(lock => document.querySelector("#securityContext").textContent.includes(lock)
      && document.querySelector("#securityContext").textContent.includes("apps/isolated/package.json"), name);
    const inventory = await page.locator("#securityContext").textContent();
    assert.match(inventory, /공유 lockfile 그래프 1개 · workspace 근거 2개/);
    assert.match(inventory, /apps\/isolated\/package.json \[서비스 실행 · 직접\]/);
    const finding = page.locator(".finding-item").filter({ has: page.locator("code", { hasText: /^security\.rsc-typed-array-rce$/ }) });
    assert.equal(await finding.count(), 1);
    assert.match(await finding.textContent(), /apps\/isolated\/package.json/);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + " overflow at " + width);
    }
    await fs.rm(path.join(fixture, name));
    recordCheck(name + " shared workspace graph, advisory child and phase evidence render without overflow at 320/390px");
  }
  await page.locator("#securityContext summary").click();
  await page.locator("#securityContext").scrollIntoViewIfNeeded();
  await settleView(page);
  await page.screenshot({ path: path.join(values.output, "dashboard-workspace-graph-390.png") });

  await fs.writeFile(path.join(fixture, "package.json"), '{"name":"root","dependencies":{"next":"^16.4.0"}}');
  await fs.writeFile(path.join(fixture, "apps", "isolated", "package.json"), '{}');
  await fs.writeFile(path.join(fixture, "pnpm-lock.yaml"), "lockfileVersion: 5.4\nspecifiers: {next: ^16.4.0}\ndependencies: {next: 16.4.0}\npackages:\n  /next/16.4.0: {}\n");
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#securityContext").textContent.includes("packages/next/16.4.0"));
  assert.equal(await page.locator(".finding-item").filter({ has: page.locator("code", { hasText: /^security\.rsc-typed-array-rce$/ }) }).count(), 1);
  recordCheck("legacy pnpm 5.4 specifiers and slash package keys retain the advisory child in the browser");

  const bootLock = "---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    configDependencies:\n      next: {specifier: 16.4.0, version: 16.4.0}\npackages:\n  next@16.4.0: {}\nsnapshots:\n  next@16.4.0: {}\n---\nlockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      next: {specifier: ^16.4.0, version: 16.4.0}\npackages:\n  next@16.4.0: {}\nsnapshots:\n  next@16.4.0: {}\n";
  await fs.writeFile(path.join(fixture, "pnpm-lock.yaml"), bootLock);
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#securityContext").textContent.includes("패키지 매니저·설정 도구"));
  assert.match(await page.locator("#securityContext").textContent(), /그래프 2개 · workspace 근거 1개/);
  assert.equal(await page.locator(".finding-item").filter({ has: page.locator("code", { hasText: /^security\.rsc-typed-array-rce$/ }) }).count(), 2);
  await page.locator("#securityContext summary").click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  recordCheck("pnpm boot and project documents retain separate build/runtime advisory children and one application workspace root");
  await fs.rm(path.join(fixture, "pnpm-lock.yaml"));

  const patch = "patch:next@npm%3A16.4.0#https://user:private-token@example.invalid/private.patch::version=16.4.0&hash=abc123";
  await fs.writeFile(path.join(fixture, "package.json"), JSON.stringify({ name: "root", dependencies: { next: patch } }));
  await fs.writeFile(path.join(fixture, "yarn.lock"), '__metadata: {version: 8}\n"root@workspace:.":\n  resolution: "root@workspace:."\n  dependencies: {next: ' + JSON.stringify(patch) + '}\n' + JSON.stringify('next@' + patch) + ':\n  version: 16.4.0\n  resolution: ' + JSON.stringify('next@' + patch) + '\n');
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#securityContext").textContent.includes("원본 버전 비교, 수정 효과 미검증"));
  assert.doesNotMatch(await page.locator("body").textContent(), /private-token|private.patch|example.invalid/);
  assert.equal(await page.locator(".finding-item").filter({ has: page.locator("code", { hasText: /^security\.rsc-typed-array-rce$/ }) }).count(), 1);
  await page.locator("#securityContext summary").click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.locator("#securityContext").scrollIntoViewIfNeeded();
  await settleView(page);
  await page.screenshot({ path: path.join(values.output, "dashboard-patched-version-390.png") });
  recordCheck("Yarn patch retains the base advisory and unverified-fix label, hides source selectors, and fits 320/390px");
  await fs.rm(path.join(fixture, "yarn.lock"));
  await fs.writeFile(path.join(fixture, "package.json"), '{}');
  await fs.writeFile(path.join(fixture, "bun.lockb"), Buffer.from([0, 255, 1, 42]));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#scopeExclusions").textContent.includes("Bun 바이너리 lock"));
  assert.match(await page.locator("#scopeExclusions").textContent(), /일부 파일/);
  recordCheck("Bun binary lock is explicitly excluded as incomplete coverage rather than a complete clean scan");

  // The lifecycle calendar is deterministic; these are configured products,
  // never proof that a real runtime or hosting account was used.
  await page.clock.setFixedTime(new Date("2026-11-02T03:00:00Z"));
  await fs.rm(path.join(fixture, "bun.lockb"));
  await fs.rm(path.join(fixture, "Dockerfile"));
  await fs.mkdir(path.join(fixture, ".github", "workflows"), { recursive: true });
  await fs.writeFile(path.join(fixture, ".github", "workflows", "classic.yml"), "jobs:\n  deploy:\n    steps:\n      - uses: denoland/deployctl@v1\n");
  await fs.writeFile(path.join(fixture, "deno.jsonc"), '{"deploy":{"app":"private-hosting-project"},"imports":{"assert":"jsr:@std/assert@^1"},}');
  const pins = { ".deno-version": "2.9.8", ".node-version": "20.0.0", ".php-version": "8.2.35", ".bun-version": "1.4.4" };
  for (const [name, version] of Object.entries(pins)) await fs.writeFile(path.join(fixture, name), version);
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelectorAll("[data-lifecycle-component]").length === 7);
  await page.locator("#projectIdentity").fill("synthetic/runtime-lifecycle");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  for (const [component, state, deadline] of [
    ["deno-runtime", "end-announced", "2027-10"], ["deno-deploy", "end-announced", "2027-04"],
    ["deno-deploy-classic", "ended", "2026-07-20"], ["jsr", "continuing", "공표된 종료일 근거 없음"],
    ["node", "ended", "2026-04-30"], ["php", "security-only", "2026-12-31"], ["bun", "supported", "공표된 종료일 근거 없음"]
  ]) {
    const entry = page.locator('[data-lifecycle-component="' + component + '"]');
    assert.equal(await entry.getAttribute("data-lifecycle-state"), state);
    assert.ok((await entry.textContent()).includes(deadline), component + " deadline");
  }
  assert.doesNotMatch(await page.locator("body").textContent(), /private-hosting-project/);
  const securityDetails = page.locator("#securityContext");
  await securityDetails.evaluate(node => { node.open = true; });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await securityDetails.scrollIntoViewIfNeeded();
    await settleView(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "lifecycle overflow at " + width);
    await page.locator('[data-lifecycle-component="deno-runtime"]').scrollIntoViewIfNeeded();
    await settleView(page);
    await page.screenshot({ path: path.join(values.output, "dashboard-lifecycle-" + width + ".png") });
  }
  recordCheck("seven independent lifecycle components show dated states and approximate Deno deadlines without leaking hosting configuration or overflowing 320/390px");
  await page.locator("#showClosed").uncheck();
  const runtimeGroup = page.locator(".issue-group").filter({ has: page.locator("code", { hasText: /^security\.support-ending$/ }) }).filter({ hasText: "Deno Runtime" });
  assert.equal(await runtimeGroup.count(), 1);
  await runtimeGroup.locator(":scope > summary").click();
  await runtimeGroup.getByRole("button", { name: "열린 항목 묶음 닫기", exact: true }).click();
  await page.locator("#closeReason").fill("Synthetic runtime retirement review; hosting is reviewed independently.");
  await page.locator("#closeExpires").fill("2026-11-20");
  await page.locator("#triageDialog").getByRole("button", { name: "검토 후 닫기", exact: true }).click();
  assert.equal(await runtimeGroup.count(), 0);
  assert.equal(await page.locator(".issue-group").filter({ has: page.locator("code", { hasText: /^security\.support-ending$/ }) }).filter({ hasText: "Deno Deploy" }).count(), 1);
  assert.equal(Object.keys((await exportDocument(page)).decisions).length, 1);
  recordCheck("closing the Deno Runtime parent leaves Deploy open and exports only that product's child decision");
  await page.clock.setFixedTime(new Date("2027-11-02T03:00:00Z"));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-lifecycle-component="deno-runtime"]')?.dataset.lifecycleState === "unknown");
  assert.equal(await page.locator('[data-lifecycle-component="deno-deploy"]').getAttribute("data-lifecycle-state"), "unknown");
  assert.match(await page.locator("#securityContext").textContent(), /최신 공식 공지를 재확인/);
  recordCheck("elapsed relative Deno windows become unverified with a stale-policy notice rather than a fabricated confirmed shutdown");
  await page.clock.setFixedTime(new Date("2026-11-02T03:00:00Z"));
  for (const name of [...Object.keys(pins), "deno.jsonc", ".github/workflows/classic.yml"]) await fs.rm(path.join(fixture, name));
  await fs.writeFile(path.join(fixture, "jsr.json"), '{"name":"@private/registry-only"}');
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelectorAll("[data-lifecycle-component]").length === 1);
  assert.equal(await page.locator('[data-lifecycle-component="jsr"]').getAttribute("data-lifecycle-state"), "continuing");
  assert.equal(await page.locator("code").filter({ hasText: /^security\.(support-ending|runtime-eol)$/ }).count(), 0);
  await fs.writeFile(path.join(fixture, "deno.lock"), '{"version":"5"}');
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#securityContext").textContent.includes("공유 lockfile 그래프 1개"));
  assert.doesNotMatch(await page.locator("#scopeExclusions").textContent(), /미지원 lockfile/);
  recordCheck("JSR publishing alone creates no Deno runtime or hosting warning and an empty Deno v5 lock is parsed");

  await fs.rm(path.join(fixture, "jsr.json"));
  await fs.writeFile(path.join(fixture, ".dvmrc"), "lts");
  await fs.writeFile(path.join(fixture, "deno.jsonc"), '{"imports":{"app":"jsr:@example/app@^1"}}');
  await fs.writeFile(path.join(fixture, "deno.lock"), JSON.stringify({version:"5", specifiers:{"jsr:@example/app@^1":"1.0.0", "npm:next@^16.4.0":"16.4.0"},
    npm:{"next@16.4.0":{integrity:"synthetic"}}, jsr:{"@example/app@1.0.0":{integrity:"synthetic",dependencies:["npm:next"]}}, workspace:{dependencies:["jsr:@example/app@^1"]}}));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-lifecycle-component="deno-lts"]')?.dataset.lifecycleState === "maintenance");
  await page.locator("#projectIdentity").fill("synthetic/deno-lock-lts");
  await page.getByRole("button", {name:"상태 연결",exact:true}).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
  const ltsEntry=page.locator('[data-lifecycle-component="deno-lts"]');
  assert.match(await ltsEntry.textContent(), /2027-01-31/);
  assert.match(await ltsEntry.textContent(), /2\.9/);
  assert.match(await ltsEntry.textContent(), /실제 설치 패치 미확인/);
  const denoAdvisory=page.locator(".finding-item").filter({has:page.locator("code",{hasText:/^security\.rsc-typed-array-rce$/})});
  assert.equal(await denoAdvisory.count(),1);
  assert.match(await denoAdvisory.textContent(), /deno\.lock/);
  await page.locator("#securityContext").evaluate(node => {node.open=true;node.querySelectorAll("details").forEach(item=>item.open=true);});
  assert.match(await page.locator("#securityContext").textContent(), /JSR · @example\/app/);
  for(const width of [320,390]) {
    await page.setViewportSize({width,height:1000});
    await ltsEntry.scrollIntoViewIfNeeded();
    await settleView(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Deno LTS overflow at " + width);
    await page.screenshot({path:path.join(values.output,"dashboard-deno-lts-"+width+".png")});
  }
  recordCheck("Deno v5 mixed JSR/npm graph renders its transitive advisory and an explicit LTS deadline without inventing an installed patch or overflowing 320/390px");
  const ltsGroup=page.locator(".issue-group").filter({has:page.locator("code",{hasText:/^security\.support-ending$/})}).filter({hasText:"Deno LTS"});
  assert.equal(await ltsGroup.count(),1);
  await ltsGroup.locator(":scope > summary").click();
  await ltsGroup.getByRole("button",{name:"열린 항목 묶음 닫기",exact:true}).click();
  await page.locator("#closeReason").fill("Synthetic LTS channel review; product retirement is separate.");
  await page.locator("#closeExpires").fill("2026-11-20");
  await page.locator("#triageDialog").getByRole("button",{name:"검토 후 닫기",exact:true}).click();
  assert.equal(await ltsGroup.count(),0);
  assert.equal(await page.locator(".issue-group").filter({has:page.locator("code",{hasText:/^security\.support-ending$/})}).filter({hasText:"Deno Runtime"}).count(),1);
  assert.equal(Object.keys((await exportDocument(page)).decisions).length,1);
  recordCheck("LTS line review remains independent from the Deno product retirement parent and retains one exportable decision");
  await page.clock.setFixedTime(new Date("2027-02-01T03:00:00Z"));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-lifecycle-component="deno-lts"]')?.dataset.lifecycleState === "unknown");
  assert.doesNotMatch(await page.locator('[data-lifecycle-component="deno-lts"]').textContent(), /2027-01-31/);
  recordCheck("the moving LTS selector becomes unverified after its reviewed window instead of asserting an installed expired line");
  await page.clock.setFixedTime(new Date("2026-11-03T03:00:00Z"));
  await fs.rm(path.join(fixture,"deno.jsonc"));
  await fs.rm(path.join(fixture,"deno.lock"));
  for(const folder of ["deno-app","packages/local","locks"]) await fs.mkdir(path.join(fixture,folder),{recursive:true});
  await fs.writeFile(path.join(fixture,"deno-app/deno.json"),JSON.stringify({lock:"../locks/runtime.snapshot",links:["../packages/local"],imports:{lib:"jsr:@example/local"}}));
  await fs.writeFile(path.join(fixture,"packages/local/deno.json"),JSON.stringify({name:"@example/local",imports:{next:"npm:next@^16.4.0"}}));
  await fs.writeFile(path.join(fixture,"locks/runtime.snapshot"),JSON.stringify({version:"5",specifiers:{"npm:next@^16.4.0":"16.4.0"},npm:{"next@16.4.0":{integrity:"synthetic"}},workspace:{dependencies:["jsr:@example/local@*"],links:{"jsr:@example/local":{dependencies:["npm:next@^16.4.0"]}}}}));
  await page.locator("#folderInput").setInputFiles(fixture);
  const customGraph=page.locator('[data-deno-lock="locks/runtime.snapshot"]');
  await page.waitForFunction(() => document.querySelector('[data-deno-lock="locks/runtime.snapshot"]')?.textContent.includes("로컬 패키지 연결 1개"));
  assert.match(await customGraph.textContent(),/packages\/local\/deno\.json/);
  assert.doesNotMatch(await page.locator("#scopeExclusions").textContent(),/runtime.snapshot/);
  const customAdvisory=page.locator(".finding-item").filter({has:page.locator("code",{hasText:/^security\.rsc-typed-array-rce$/})});
  assert.equal(await customAdvisory.count(),1);
  assert.match(await customAdvisory.textContent(),/deno-app\/deno\.json/);
  await page.locator("#securityContext").evaluate(node=>{node.open=true;node.querySelectorAll("details").forEach(item=>item.open=true);});
  for(const width of [320,390]) {
    await page.setViewportSize({width,height:1000});
    await customGraph.scrollIntoViewIfNeeded();await settleView(page);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),"custom/local graph overflow at "+width);
    await page.screenshot({path:path.join(values.output,"dashboard-deno-custom-local-"+width+".png")});
  }
  recordCheck("declared custom lock is read despite its extension, local manifest and consumer stay distinct, and its transitive advisory fits 320/390px");
  await fs.writeFile(path.join(fixture,"deno-app/deno.json"),JSON.stringify({lock:"../locks/runtime.snapshot",imports:{next:"npm:next@^16.4.0"}}));
  await fs.writeFile(path.join(fixture,"locks/runtime.snapshot"),JSON.stringify({version:"2",npm:{specifiers:{"next@^16.4.0":"next@16.4.0"},packages:{"next@16.4.0":{integrity:"synthetic",dependencies:{}}}},remote:{}}));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-deno-lock="locks/runtime.snapshot"]')?.textContent.includes("Deno lock v2"));
  assert.equal(await customAdvisory.count(),1);
  assert.match(await page.locator("#securityContext").textContent(),/실행 단계 미확인/);
  recordCheck("legacy v2 npm pins retain their advisory while unavailable workspace and optional metadata remain unverified");
  await fs.writeFile(path.join(fixture,"locks/runtime.snapshot"),JSON.stringify({"https://user:private-token@private.invalid/next@16.4.0.ts":"a".repeat(64)}));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-deno-lock="locks/runtime.snapshot"]')?.textContent.includes("Deno lock v1"));
  assert.match(await customGraph.textContent(),/원격 무결성 기록 1개/);
  assert.doesNotMatch(await page.locator("body").textContent(),/private-token|private.invalid|next@16.4.0.ts/);
  assert.equal(await customAdvisory.count(),0);
  assert.ok(await page.locator("code").filter({hasText:/^security\.dependency-coverage$/}).count()>0);
  recordCheck("legacy v1 shows only integrity counts with version coverage gaps and never leaks remote credentials or fabricates npm advisories");
  for(const folder of ["linked/lib","linked/excluded","file-local","deno-app/members/a","deno-app/members/b","deno-app/maps"]) await fs.mkdir(path.join(fixture,folder),{recursive:true});
  await fs.writeFile(path.join(fixture,"deno-app/deno.json"),JSON.stringify({lock:"../locks/runtime.snapshot",workspace:["members/*"],links:["../linked/*","!../linked/excluded"],importMap:"maps/imports.map"}));
  await fs.writeFile(path.join(fixture,"deno-app/package.json"),JSON.stringify({dependencies:{"file-lib-alias":"file:../file-local"}}));
  await fs.writeFile(path.join(fixture,"deno-app/maps/imports.map"),JSON.stringify({imports:{lib:"jsr:@example/lib",module:"../entry.ts"}}));
  await fs.writeFile(path.join(fixture,"deno-app/entry.ts"),"export const value=1;");
  await fs.writeFile(path.join(fixture,"linked/lib/deno.json"),JSON.stringify({name:"@example/lib",imports:{next:"npm:next@^16.4.0"}}));
  await fs.writeFile(path.join(fixture,"linked/excluded/deno.json"),JSON.stringify({name:"@example/lib",imports:{next:"npm:next@^17"}}));
  await fs.writeFile(path.join(fixture,"file-local/package.json"),JSON.stringify({name:"file-lib",version:"1.0.0",dependencies:{next:"^16.4.0"}}));
  await fs.writeFile(path.join(fixture,"deno-app/members/a/package.json"),JSON.stringify({name:"consumer",dependencies:{local:"workspace:*"}}));
  await fs.writeFile(path.join(fixture,"deno-app/members/b/package.json"),JSON.stringify({name:"local",version:"1.0.0",dependencies:{next:"^16.5.0"}}));
  await fs.writeFile(path.join(fixture,"locks/runtime.snapshot"),JSON.stringify({version:"5",specifiers:{"npm:next@^16.4.0":"16.4.0","npm:next@^16.5.0":"16.5.0"},npm:{"next@16.4.0":{integrity:"x"},"next@16.5.0":{integrity:"y"}},workspace:{dependencies:["jsr:@example/lib@*"],packageJson:{dependencies:[]},members:{"members/a":{packageJson:{dependencies:[]}},"members/b":{packageJson:{dependencies:["npm:next@^16.5.0"]}}},links:{"jsr:@example/lib":{dependencies:["npm:next@^16.4.0"]},"npm:file-lib":{dependencies:["npm:next@^16.4.0"]}}}}));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-deno-lock="locks/runtime.snapshot"]')?.textContent.includes("import map 파일 1개"));
  assert.equal(await customGraph.getAttribute("data-graph-complete"),"true");
  assert.match(await customGraph.textContent(),/로컬 패키지 연결 3개/);
  assert.match(await customGraph.textContent(),/deno-app\/maps\/imports.map/);
  assert.match(await customGraph.textContent(),/deno-app\/entry.ts/);
  assert.doesNotMatch(await customGraph.textContent(),/linked\/excluded/);
  assert.equal(await customAdvisory.count(),1);
  assert.doesNotMatch(await customAdvisory.textContent(),/members\/a\/package.json/);
  await page.locator("#securityContext").evaluate(node=>{node.open=true;node.querySelectorAll("details").forEach(item=>item.open=true);});
  for(const width of [320,390]) {
    await page.setViewportSize({width,height:1000});await customGraph.scrollIntoViewIfNeeded();await settleView(page);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),"protocol/map overflow at "+width);
    await page.screenshot({path:path.join(values.output,"dashboard-deno-protocol-map-"+width+".png")});
  }
  recordCheck("glob exclusions, file/workspace protocols and a separate map render the correct consumer evidence without sibling contamination at 320/390px");
  await fs.writeFile(path.join(fixture,"deno-app/maps/imports.map"),'{"imports":{"lib":{"invalid":"jsr:@example/lib"}}}');
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-deno-lock="locks/runtime.snapshot"]')?.dataset.graphComplete === "false");
  assert.equal(await customAdvisory.count(),1);
  recordCheck("a malformed external map makes connections unverified while the known vulnerable locked version remains visible");
  await fs.writeFile(path.join(fixture,"deno-app/maps/imports.map"),JSON.stringify({imports:{lib:"jsr:@example/lib"}}));
  await fs.mkdir(path.join(fixture,"deno-app/members/child"),{recursive:true});
  await fs.writeFile(path.join(fixture,"deno-app/members/child/deno.json"),JSON.stringify({workspace:["nested"]}));
  await page.locator("#folderInput").setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-deno-lock="locks/runtime.snapshot"]')?.textContent.includes("로컬 파일 매핑 0개"));
  assert.ok(await page.locator("code").filter({hasText:/^security\.dependency-coverage$/}).count()>0);
  assert.equal(await customGraph.getAttribute("data-graph-complete"),"false");
  recordCheck("an unsupported member workspace root declaration retains coverage diagnostics instead of being silently flattened");
  await Promise.all(responseChecks);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.deepEqual(browserResponseHashes, previewBefore.diskHashes, "all linked dashboard assets must be observed in browser responses");
  const previewAfter = await verifyDashboardPreview(url, sourceRoot, previewBefore);
  const verificationSourcesAfter = await hashVerificationSources(sourceRoot);
  assert.deepEqual(verificationSourcesAfter, verificationSourcesBefore, "verification script changed during run");
  recordCheck("browser responses and preview after scenarios still match initial checkout; service workers blocked and HTTP cache disabled");
  const sourceHashes = { ...previewAfter.diskHashes, ...verificationSourcesAfter };
  result = { verifiedAt: new Date().toISOString(), browser: browser.version(), platform: process.platform,
    target: "local audit dashboard with synthetic inputs", sourceHashes,
    provenance: { before: previewBefore, after: previewAfter, browserResponseHashes,
      verificationSourceHashes: verificationSourcesAfter, serviceWorkers: "blocked", httpCache: "disabled by routing" },
    checks, pageErrors: errors,
    exclusions: ["production app routes", "all screen states", "real devices", "native directory picker", "visual regression baseline approval", "deployment", "GitHub issue writes"] };
  await fs.writeFile(path.join(values.output, "browser-result.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  await browser.close();
  await fs.rm(fixture, { recursive: true, force: true });
}
