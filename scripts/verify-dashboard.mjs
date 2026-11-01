#!/usr/bin/env node
// Optional real-browser verification. Playwright is supplied by the caller,
// not installed or executed by the static analyzer or dependency-free CI.
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
