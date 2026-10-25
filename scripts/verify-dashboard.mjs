#!/usr/bin/env node
// Optional real-browser verification. Playwright is supplied by the caller,
// not installed or executed by the static analyzer or dependency-free CI.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const values = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, args) => {
  if (index % 2 === 0) pairs.push([value.replace(/^--/, ""), args[index + 1]]);
  return pairs;
}, []));
if (!values.url || !values.output) throw new Error("usage: node scripts/verify-dashboard.mjs --url http://127.0.0.1:PORT/analysis/ --output DIRECTORY [--channel chrome]");
const url = new URL(values.url);
if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("use a local HTTP preview of this dashboard");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
await fs.mkdir(values.output, { recursive: true });
await fs.rm(path.join(values.output, "browser-result.json"), { force: true });
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-audit-ui-"));
await fs.mkdir(path.join(fixture, "src"), { recursive: true });
await fs.writeFile(path.join(fixture, "package.json"), JSON.stringify({ dependencies: { react: "19.0.0" }, scripts: { test: "node --test" } }));
const stylesheet = path.join(fixture, "src", "modal.css");
await fs.writeFile(stylesheet, ".modal{position:fixed;overflow:hidden;transform:translateZ(0);height:40px;width:1200px}");
const browser = await chromium.launch({ headless: true, ...(values.channel ? { channel: values.channel } : {}) });
const errors = [];
const checks = [];
const recordCheck = (description) => { checks.push(description); process.stderr.write("verified: " + description + "\n"); };
let result;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("불러왔습니다"));
  recordCheck("decision export/import roundtrip works through keyboard-accessible file chooser");

  // Real directory selection, CSS candidate discovery, and source-change recheck.
  await fs.mkdir(path.join(fixture, "src", "public"), { recursive: true });
  await fs.writeFile(path.join(fixture, "src", "public", "modal.css"), ".modal{position:fixed;width:1200px}");
  await page.locator("#chooseFolder").focus();
  const folderChooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await folderChooserPromise).setFiles(fixture);
  await page.waitForFunction(() => document.querySelector("#projectName").textContent.startsWith("frontend-audit-ui-"));
  await page.locator("#projectIdentity").fill("synthetic/css-project");
  await page.getByRole("button", { name: "상태 연결", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#exportTriage").disabled);
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
    await page.screenshot({ path: path.join(values.output, "dashboard-" + width + ".png") });
    await page.locator(".all").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(values.output, "dashboard-review-" + width + ".png") });
    recordCheck("no document horizontal overflow at " + width + "px (dashboard only)");
  }
  const group = page.locator(".issue-group").filter({ hasText: "styling.overlay-clipping-context" }).first();
  if (await group.getAttribute("open") === null) await group.locator(":scope > summary").click();
  await group.locator(".finding-item").filter({ hasText: "styling.overlay-clipping-context" }).getByRole("button", { name: "재검증 요청", exact: true }).click();
  assert.match(await page.locator("#findingsTable").textContent(), /재검증 요청/);
  assert.equal(errors.length, 0, errors.join("\n"));
  recordCheck("normal clicks reach controls and verification request remains visible; no page errors");
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

  const blockedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
  assert.equal(errors.length, 0, errors.join("\n"));
  recordCheck("denied browser storage preserves in-memory review and enables explicit export");
  await blockedContext.close();
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourceHashes = {};
  for (const file of ["analysis/analyzer.js", "analysis/audit-contract.js", "analysis/triage-state.js", "analysis/app.js", "analysis/index.html", "analysis/styles.css", "scripts/verify-dashboard.mjs"]) {
    sourceHashes[file] = createHash("sha256").update(await fs.readFile(path.join(sourceRoot, file))).digest("hex");
  }
  result = { verifiedAt: new Date().toISOString(), browser: browser.version(), platform: process.platform, target: "local audit dashboard with synthetic inputs", sourceHashes, checks, pageErrors: errors, exclusions: ["production app routes", "all screen states", "real devices", "visual regression baseline approval", "deployment", "GitHub issue writes"] };
  await fs.writeFile(path.join(values.output, "browser-result.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  await browser.close();
  await fs.rm(fixture, { recursive: true, force: true });
}
