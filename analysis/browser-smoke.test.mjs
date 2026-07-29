import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function fakeElement(dataset = {}) {
  return {
    dataset,
    textContent: "",
    innerHTML: "",
    value: "",
    classList: {
      add() {},
      remove() {}
    },
    addEventListener() {},
    click() {}
  };
}

test("loads analyzer and dashboard scripts in browser order and renders findings", () => {
  const ids = [
    "folderInput", "toast", "copyReport", "downloadReport", "projectName",
    "projectMeta", "selectedFileCount", "analyzedFileCount", "excludedFileCount",
    "observedCount", "inferredCount", "unknownCount", "candidateCount",
    "findingCount", "scopeExclusions", "urgentList", "coverageList", "findingsTable"
  ];
  const nodes = new Map(ids.map((id) => [id, fakeElement()]));
  const filterButtons = [
    fakeElement({ filter: "all" }),
    fakeElement({ filter: "risk" }),
    fakeElement({ filter: "gap" })
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
        throw new Error("Unexpected selector: " + selector);
      },
      createElement() {
        return fakeElement();
      }
    }
  });
  context.globalThis = context;

  const analyzerSource = fs.readFileSync(new URL("./analyzer.js", import.meta.url), "utf8");
  const appSource = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");

  vm.runInContext(analyzerSource, context, { filename: "analyzer.js" });
  vm.runInContext(appSource, context, { filename: "app.js" });

  assert.match(nodes.get("urgentList").innerHTML, /HTML 렌더링 신뢰경계 확인/);
  assert.match(nodes.get("urgentList").innerHTML, /왜 위험한가/);
  assert.match(nodes.get("findingsTable").innerHTML, /security\.html-sink-boundary/);
  assert.match(nodes.get("scopeExclusions").textContent, /181 B 분석/);
});
