(function () {
const {
  analyzeRecords,
  buildMarkdown,
  createAuditResult,
  evidenceLevels,
  isGeneratedRecord,
  isAnalyzableFile,
  selectUrgentFindings
} = globalThis.FrontendAnalyzer;

const sampleFindings = [
  {
    id: "security.html-sink-boundary",
    severity: "high", area: "security", type: "risk", evidenceLevel: "observed",
    title: "여러 HTML 삽입 지점에서 sanitizer 의존성·import 미발견",
    evidence: ["components/Content.tsx", "features/rich-content/Html.tsx"],
    occurrenceCount: 8,
    limitation: "패턴 존재만 확인하며 실제 악용 가능성이나 런타임 영향은 확정하지 않음",
    recommendation: "콘텐츠 출처별 신뢰경계를 문서화하고 검증된 SafeHtml 경계에서 정제를 통일합니다."
  },
  {
    id: "security.html-trust-boundary-unknown",
    severity: "medium", area: "security", type: "gap", evidenceLevel: "unknown",
    title: "HTML 콘텐츠의 서버 정제와 신뢰경계는 자동 확인 불가",
    evidence: ["components/Content.tsx"], occurrenceCount: 8,
    limitation: "정적 분석 범위 밖의 설정, 데이터 출처 또는 런타임 확인이 필요함",
    recommendation: "백엔드 정제, 제3자 콘텐츠, 사용자 입력 경계를 담당자와 런타임 검증으로 확인합니다."
  },
  {
    id: "testing.critical-journey-coverage-review",
    severity: "high", area: "testing", type: "gap", evidenceLevel: "inferred",
    title: "고위험 전환 여정의 E2E 검토 필요",
    evidence: ["playwright.config.ts"], occurrenceCount: 1,
    limitation: "정적 근거에 기반한 검토 우선순위이며 결함 확정이 아님",
    recommendation: "결제, 가입, 제출 등 실패 비용이 큰 여정의 실제 커버리지를 확인합니다."
  },
  {
    id: "dead-code.marked-removal-candidate",
    severity: "low", area: "dead-code", type: "risk", evidenceLevel: "candidate",
    title: "삭제 가능성이 표시된 코드 후보 1개 파일",
    evidence: ["legacy/adapter.ts"], occurrenceCount: 1,
    limitation: "참조와 부작용 검증 전에는 삭제할 수 없음",
    recommendation: "참조와 부작용을 확인합니다. 이 결과는 삭제 승인이 아닙니다."
  }
];

let state = createAuditResult(
  "분석 예시",
  sampleFindings,
  24,
  "폴더를 선택하면 실제 결과로 교체됩니다",
  { selected: 24, analyzed: 24, excluded: 0 }
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
    notify("분석이 완료되었습니다.");
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
    renderUrgent(button.dataset.filter);
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
  const selected = files.filter(isAnalyzableFile);
  const loaded = await Promise.all(selected.map(async (file) => ({
    path: file.webkitRelativePath || file.name,
    content: await file.text()
  })));
  const records = loaded.filter((record) => !isGeneratedRecord(record));
  return {
    records,
    scope: {
      selected: files.length,
      analyzed: records.length,
      excluded: files.length - records.length
    }
  };
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
  renderUrgent("all");
  renderCoverage();
  renderTable();
}

function renderUrgent(filter) {
  const rows = selectUrgentFindings(state.findings, filter);

  document.querySelector("#urgentList").innerHTML = rows.length
    ? rows.map((finding, index) =>
      '<article class="urgent" data-severity="' + finding.severity + '">' +
        '<i>' + (index + 1) + '</i><div><h3>' + escapeHtml(finding.title) + '</h3>' +
        '<span class="evidence-label ' + finding.evidenceLevel + '">' +
          evidenceLevels[finding.evidenceLevel] + '</span>' +
        '<p>' + escapeHtml(finding.recommendation) + '</p></div>' +
        '<span class="pill ' + finding.severity + '">' + finding.severity + '</span>' +
      '</article>'
    ).join("")
    : '<div class="empty">해당하는 긴급 항목이 없습니다.</div>';
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
