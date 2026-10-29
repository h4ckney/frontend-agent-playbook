import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

function fakeElement(dataset = {}) {
  return {
    dataset,
    checked: false,
    listeners: {},
    textContent: "",
    innerHTML: "",
    value: "",
    classList: {
      add() {},
      remove() {}
    },
    addEventListener(type, listener) {
      this.listeners[type] = listener;
    },
    querySelectorAll() { return []; },
    click() {}
  };
}

test("loads analyzer and dashboard scripts in browser order and renders findings", () => {
  const ids = [
    "securityContext", "folderInput", "toast", "copyReport", "downloadReport", "projectName",
    "projectMeta", "selectedFileCount", "analyzedFileCount", "excludedFileCount",
    "observedCount", "inferredCount", "unknownCount", "candidateCount",
    "findingCount", "scopeExclusions", "seoScopeStatus", "urgentList", "coverageList", "findingsTable",
    "projectIdentityForm", "projectIdentity", "showClosed", "triageDialog", "triageForm", "cancelTriage",
    "exportTriage", "importTriage", "triageStorageStatus", "chooseFolder", "chooseTriage"
  ];
  const nodes = new Map(ids.map((id) => [id, fakeElement()]));
  const filterButtons = [
    fakeElement({ filter: "all" }),
    fakeElement({ filter: "risk" }),
    fakeElement({ filter: "gap" })
  ];
  const seoScopeInputs = [
    Object.assign(fakeElement(), { checked: true, value: "unknown" }),
    Object.assign(fakeElement(), { value: "public" }),
    Object.assign(fakeElement(), { value: "mixed" }),
    Object.assign(fakeElement(), { value: "internal" })
  ];
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Blob,
    URL: {
      createObjectURL: () => "blob:fixture",
      revokeObjectURL() {}
    },
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    },
    document: {
      querySelector(selector) {
        if (selector.startsWith("#")) return nodes.get(selector.slice(1));
        throw new Error("Unexpected selector: " + selector);
      },
      querySelectorAll(selector) {
        if (selector === "[data-filter]") return filterButtons;
        if (selector === "[name=seoScope]") return seoScopeInputs;
        throw new Error("Unexpected selector: " + selector);
      },
      createElement() {
        return fakeElement();
      }
    }
  });
  context.globalThis = context;

  const analyzerSource = fs.readFileSync(new URL("./analyzer.js", import.meta.url), "utf8");
  const contractSource = fs.readFileSync(new URL("./audit-contract.js", import.meta.url), "utf8");
  const appSource = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const triageSource = fs.readFileSync(new URL("./triage-state.js", import.meta.url), "utf8");

  vm.runInContext(analyzerSource, context, { filename: "analyzer.js" });
  for (const name of ["artifact-schemas.js", "security-context.js"]) {
    vm.runInContext(fs.readFileSync(new URL("./" + name, import.meta.url), "utf8"), context, { filename: name });
  }
  vm.runInContext(contractSource, context, { filename: "audit-contract.js" });
  vm.runInContext(triageSource, context, { filename: "triage-state.js" });
  vm.runInContext(appSource, context, { filename: "app.js" });

  assert.equal(context.FrontendAuditContract.TOOL_VERSION, "0.2.0-dev");
  assert.match(nodes.get("urgentList").innerHTML, /HTML 콘텐츠의 출처·정제 여부 확인/);
  assert.match(nodes.get("urgentList").innerHTML, /왜 위험한가/);
  assert.match(nodes.get("urgentList").innerHTML, /우선순위 근거/);
  assert.match(nodes.get("urgentList").innerHTML, /선정 근거/);
  assert.match(nodes.get("findingsTable").innerHTML, /security\.html-sink-boundary/);
  assert.match(nodes.get("scopeExclusions").textContent, /181 B 분석/);
  assert.match(nodes.get("seoScopeStatus").textContent, /검색 노출 범위 미확인/);
  assert.match(nodes.get("coverageList").innerHTML, /data-status="conditional"/);

  seoScopeInputs[3].checked = true;
  seoScopeInputs[3].listeners.change();

  assert.match(nodes.get("seoScopeStatus").textContent, /SEO 검사는 선택 사항/);
  assert.doesNotMatch(nodes.get("findingsTable").innerHTML, /seo\./);
  assert.match(nodes.get("coverageList").innerHTML, /data-status="not-applicable"/);
});

function reviewHarness(storage) {
  const nodes = new Map();
  const events = new Map();
  let exported;
  const element = () => Object.assign(fakeElement(), { close() {}, reset() {}, focus() {} });
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const scopes = ["unknown", "public", "mixed", "internal"].map((value) => Object.assign(element(), { value, checked: value === "unknown" }));
  const context = vm.createContext({
    console, Blob, TextEncoder, crypto: webcrypto, localStorage: storage,
    setTimeout: () => 0, clearTimeout() {},
    navigator: { clipboard: { writeText: async () => {} } },
    URL: { createObjectURL(blob) { exported = blob; return "blob:review-fixture"; }, revokeObjectURL() {} },
    addEventListener(type, listener) { events.set(type, listener); },
    document: {
      querySelector: (selector) => get(selector.slice(1)),
      querySelectorAll: (selector) => selector === "[name=seoScope]" ? scopes : [],
      createElement: element
    }
  });
  for (const name of ["analyzer.js", "artifact-schemas.js", "security-context.js", "audit-contract.js", "triage-state.js", "app.js"]) {
    vm.runInContext(fs.readFileSync(new URL("./" + name, import.meta.url), "utf8"), context, { filename: name });
  }
  return {
    get, events, scopes,
    async connect(key) {
      get("projectIdentity").value = key;
      await get("projectIdentityForm").listeners.submit({ preventDefault() {} });
      assert.equal(get("exportTriage").disabled, false);
    },
    request(index) {
      const fingerprints = [...get("findingsTable").innerHTML.matchAll(/<article class="finding-item" data-fingerprint="([^"]+)"/g)].map((match) => match[1]);
      const button = { dataset: { triageAction: "request-verification", fingerprint: fingerprints[index] } };
      get("findingsTable").listeners.click({ target: { closest() { return button; } } });
    },
    async exported() {
      get("exportTriage").listeners.click();
      return JSON.parse(await exported.text());
    },
    async import(document) {
      const text = JSON.stringify(document);
      await get("importTriage").listeners.change({ target: { value: "fixture.json", files: [{ size: text.length, text: async () => text }] } });
    },
    async scope(value) {
      const control = scopes.find((entry) => entry.value === value);
      control.checked = true;
      control.listeners.change();
      for (let index = 0; index < 100 && get("exportTriage").disabled; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      assert.equal(get("exportTriage").disabled, false);
    }
  };
}

function reviewStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); }
  };
}

test("dashboard retains independent tab decisions, refreshes storage events and merges an empty stale import", async () => {
  const storage = reviewStorage();
  const a = reviewHarness(storage);
  const b = reviewHarness(storage);
  const key = "regression/tabs";
  await a.connect(key);
  await b.connect(key);
  a.request(0);
  b.request(1);
  const saved = await b.exported();
  assert.equal(Object.keys(saved.decisions).length, 2);
  a.events.get("storage")({ type: "storage", key: storage.key(storage.length - 1) });
  assert.equal(Object.keys((await a.exported()).decisions).length, 2);
  await b.import({ schemaVersion: "1", projectKey: key, decisions: {} });
  assert.deepEqual(await b.exported(), saved);
  assert.match(b.get("toast").textContent, /합쳤습니다/);
});

test("dashboard scope reconnect keeps exportable unsaved decisions when browser storage is denied", async () => {
  const denied = { getItem() { throw new Error("storage denied"); }, setItem() { throw new Error("storage denied"); } };
  const app = reviewHarness(denied);
  await app.connect("regression/denied");
  app.request(0);
  const before = await app.exported();
  assert.equal(Object.keys(before.decisions).length, 1);
  assert.match(app.get("triageStorageStatus").textContent, /보관하지 못했습니다/);
  await app.scope("internal");
  assert.deepEqual(await app.exported(), before);
  assert.match(app.get("triageStorageStatus").textContent, /읽지 못했습니다/);
});
