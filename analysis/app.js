(function () {
const {
  analysisLimits,
  analyzeRecords,
  buildMarkdown,
  createAuditResult,
  decisionLabels,
  evidenceLevels,
  isGeneratedRecord,
  selectFilesWithinBudget,
  selectPriorityCandidates
} = globalThis.FrontendAnalyzer;

const sampleRecords = [
  {
    path: "package.json",
    content: JSON.stringify({
      dependencies: { next: "13.5.0", react: "18.2.0" },
      scripts: { test: "vitest" }
    })
  },
  {
    path: "pages/content.tsx",
    content: "<div dangerouslySetInnerHTML={{ __html: value }} />\n// TODO remove after migration"
  },
  { path: "tests/content.test.tsx", content: "export {};" },
  { path: "e2e/smoke.spec.ts", content: "export {};" }
];
const sampleFindings = analyzeRecords(sampleRecords);
const sampleBytes = sampleRecords.reduce(
  (sum, record) => sum + new Blob([record.content]).size,
  0
);

let state = createAuditResult(
  "분석 예시",
  sampleFindings,
  4,
  "폴더를 선택하면 실제 결과로 교체됩니다",
  { selected: 4, analyzed: 4, excluded: 0, analyzedBytes: sampleBytes }
);
const input = document.querySelector("#folderInput");
const toast = document.querySelector("#toast");

input.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  try {
    const { records, scope } = await readFiles(files);
    const name = files[0].webkitRelativePath.split("/")[0] || "선택한 프로젝트";
    state = createAuditResult(
      name,
      analyzeRecords(records),
      records.length,
      scope.analyzed + "개 텍스트 파일 분석 · " + scope.excluded + "개 제외",
      scope
    );
    render();
    notify(scope.partial ? "일부 입력을 제외한 부분 분석이 완료되었습니다." : "분석이 완료되었습니다.");
  } catch (error) {
    console.error(error);
    notify("분석 중 오류가 발생했습니다.");
  }
  input.value = "";
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    renderPriority(button.dataset.filter);
  });
});

document.querySelector("#copyReport").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildMarkdown(state));
    notify("Markdown 보고서를 복사했습니다.");
  } catch {
    download();
    notify("클립보드 권한이 없어 파일로 저장했습니다.");
  }
});
document.querySelector("#downloadReport").addEventListener("click", download);

async function readFiles(files) {
  const selection = selectFilesWithinBudget(files);
  const loaded = await readWithConcurrency(selection.accepted, analysisLimits.readConcurrency);
  const failed = loaded.filter((result) => result.status === "rejected").length;
  const readable = loaded.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const generated = readable.filter((record) => isGeneratedRecord(record)).length;
  const records = readable.filter((record) => !isGeneratedRecord(record));
  const excludedByReason = { ...selection.excludedByReason };
  if (generated) excludedByReason["generated-header"] = generated;
  if (failed) excludedByReason["read-failed"] = failed;

  return {
    records,
    scope: {
      selected: files.length,
      analyzed: records.length,
      excluded: files.length - records.length,
      analyzedBytes: records.reduce((sum, record) => sum + record.size, 0),
      excludedByReason,
      partial: selection.coverageIncomplete || failed > 0
    }
  };
}

async function readWithConcurrency(files, concurrency) {
  const results = new Array(files.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex++;
      const file = files[index];
      try {
        results[index] = {
          status: "fulfilled",
          value: {
            path: file.webkitRelativePath || file.name,
            content: await file.text(),
            size: file.size
          }
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, files.length) },
    () => worker()
  ));
  return results;
}

function render() {
  document.querySelector("#projectName").textContent = state.name;
  document.querySelector("#projectMeta").textContent = state.meta;
  document.querySelector("#selectedFileCount").textContent = state.scope.selected;
  document.querySelector("#analyzedFileCount").textContent = state.scope.analyzed;
  document.querySelector("#excludedFileCount").textContent = state.scope.excluded;
  document.querySelector("#observedCount").textContent = state.summary.observed;
  document.querySelector("#inferredCount").textContent = state.summary.inferred;
  document.querySelector("#unknownCount").textContent = state.summary.unknown;
  document.querySelector("#candidateCount").textContent = state.summary.candidate;
  document.querySelector("#findingCount").textContent = state.findings.length + "건";
  document.querySelector("#scopeExclusions").textContent = formatScope(state.scope);
  renderPriority("all");
  renderCoverage();
  renderTable();
}

function renderPriority(filter) {
  const rows = selectPriorityCandidates(state.findings, filter);

  document.querySelector("#urgentList").innerHTML = rows.length
    ? rows.map((cluster, index) =>
      '<article class="urgent" data-severity="' + cluster.severity + '">' +
        '<i>' + (index + 1) + '</i><div><h3>' + escapeHtml(cluster.title) + '</h3>' +
        '<span class="decision ' + cluster.decision + '">' +
          decisionLabels[cluster.decision] + '</span>' +
        '<p><b>왜 위험한가</b>' + escapeHtml(cluster.whyRisky) + '</p>' +
        '<p><b>가능한 영향</b>' + escapeHtml(cluster.possibleImpact) + '</p>' +
        '<p><b>다음 확인</b>' + escapeHtml(cluster.verification) + '</p></div>' +
        '<span class="pill ' + cluster.severity + '">' + cluster.severity + '</span>' +
      '</article>'
    ).join("")
    : '<div class="empty">해당하는 우선 검토 후보가 없습니다. 수동 감사가 끝났다는 의미는 아닙니다.</div>';
}

function renderCoverage() {
  const labels = {
    rules: "프로젝트 컨텍스트", testing: "테스트", seo: "SEO",
    security: "보안", "dead-code": "데드코드", observability: "오류 처리"
  };
  const maxCount = Math.max(1, ...state.areaCounts.map((row) => row.count));
  document.querySelector("#coverageList").innerHTML = state.areaCounts.map((row) =>
    '<div class="coverage-row"><span>' + labels[row.area] + '</span>' +
    '<div class="bar"><i style="width:' + (row.count / maxCount * 100) + '%"></i></div>' +
    '<span>' + row.count + '</span></div>'
  ).join("");
}

function renderTable() {
  document.querySelector("#findingsTable").innerHTML = state.findings.length
    ? state.findings.map((finding) =>
      '<tr><td><span class="evidence-label ' + finding.evidenceLevel + '">' +
        evidenceLevels[finding.evidenceLevel] + '</span></td>' +
      '<td><span class="pill ' + finding.severity + '">' + finding.severity + '</span></td>' +
      '<td><code>' + escapeHtml(finding.id) + '</code></td>' +
      '<td>' + escapeHtml(finding.area) + '</td><td class="finding-cell">' +
        '<strong>' + escapeHtml(finding.title) + '</strong>' +
        '<details><summary>판정 상세</summary>' +
          '<div><b>왜 위험한가</b><p>' + escapeHtml(finding.whyRisky) + '</p></div>' +
          '<div><b>가능한 영향</b><p>' + escapeHtml(finding.possibleImpact) + '</p></div>' +
          '<div><b>위험 증가 조건</b><p>' + escapeHtml(finding.riskFactors) + '</p></div>' +
          '<div><b>완화 통제</b><p>' + escapeHtml(finding.mitigatingControls) + '</p></div>' +
          '<div><b>다음 확인</b><p>' + escapeHtml(finding.verification) + '</p></div>' +
          '<div><b>한계</b><p>' + escapeHtml(finding.limitation) + '</p></div>' +
          '<div><b>권장 조치</b><p>' + escapeHtml(finding.recommendation) + '</p></div>' +
        '</details></td>' +
      '<td>' + escapeHtml(formatEvidence(finding)) + '</td></tr>'
    ).join("")
    : '<tr><td colspan="6" class="empty">자동 탐지 결과가 없습니다. 수동 검토는 여전히 필요합니다.</td></tr>';
}

function formatEvidence(finding) {
  const hiddenCount = Math.max(0, finding.occurrenceCount - finding.evidence.length);
  return finding.evidence.join(", ") + (hiddenCount ? " 외 " + hiddenCount + "건" : "");
}

function formatScope(scope) {
  const reasons = Object.entries(scope.excludedByReason || {})
    .map(([reason, count]) => reason + " " + count)
    .join(" · ");
  const coverage = formatBytes(scope.analyzedBytes) + " 분석";
  const completeness = scope.partial ? " · 일부 입력은 예산 또는 읽기 실패로 미분석" : "";
  return coverage + (reasons ? " · 제외: " + reasons : "") + completeness;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function download() {
  const blob = new Blob([buildMarkdown(state)], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = (state.name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-") || "frontend") + "-audit.md";
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]
  );
}

let timer;
function notify(message) {
  clearTimeout(timer);
  toast.textContent = message;
  toast.classList.add("show");
  timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

render();
})();
