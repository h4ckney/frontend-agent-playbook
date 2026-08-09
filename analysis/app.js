(function () {
const {
  analysisLimits,
  decisionLabels,
  evidenceLevels,
  isGeneratedRecord,
  selectFilesWithinBudget
} = globalThis.FrontendAnalyzer;
const {
  buildAuditMarkdown,
  createAuditBundle
} = globalThis.FrontendAuditContract;

const areaLabels = {
  rules: "프로젝트 환경",
  testing: "테스트",
  seo: "SEO",
  security: "보안",
  "dead-code": "삭제 후보",
  observability: "오류 처리"
};

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
const sampleBytes = sampleRecords.reduce(
  (sum, record) => sum + new Blob([record.content]).size,
  0
);
let selectedSeoScope = "unknown";
let currentAudit = {
  name: "분석 예시",
  records: sampleRecords,
  meta: "폴더를 선택하면 실제 결과로 교체됩니다",
  scope: { selected: 4, analyzed: 4, excluded: 0, analyzedBytes: sampleBytes }
};
let currentAuditResult;
let state = createState();
const input = document.querySelector("#folderInput");
const toast = document.querySelector("#toast");
const seoScopeInputs = document.querySelectorAll("[name=seoScope]");

input.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files);
  if (!files.length) return;

  try {
    const { records, scope } = await readFiles(files);
    const name = files[0].webkitRelativePath.split("/")[0] || "선택한 프로젝트";
    currentAudit = {
      name,
      records,
      meta: scope.analyzed + "개 텍스트 파일 분석 · " + scope.excluded + "개 제외",
      scope
    };
    state = createState();
    render();
    notify(scope.partial ? "일부 파일을 제외하고 분석을 마쳤습니다." : "분석이 완료되었습니다.");
  } catch (error) {
    console.error(error);
    notify("분석 중 오류가 발생했습니다.");
  }
  input.value = "";
});

seoScopeInputs.forEach((control) => {
  control.addEventListener("change", () => {
    if (!control.checked) return;
    selectedSeoScope = control.value;
    state = createState();
    render();
  });
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
    await navigator.clipboard.writeText(buildAuditMarkdown(currentAuditResult, { locale: "ko" }));
    notify("Markdown 보고서를 복사했습니다.");
  } catch {
    download();
    notify("클립보드 권한이 없어 파일로 저장했습니다.");
  }
});
document.querySelector("#downloadReport").addEventListener("click", download);

function createState() {
  const bundle = createAuditBundle({
    name: currentAudit.name,
    records: currentAudit.records,
    meta: currentAudit.meta,
    scope: currentAudit.scope,
    context: { seoScope: selectedSeoScope },
    analysisMode: "static-lite",
    capabilities: ["route-path-inference", "text-patterns"],
    scopePolicyDigest: "browser-static-lite-v1"
  });
  currentAuditResult = bundle.audit;
  return createUiState(bundle.audit, currentAudit.meta);
}

function createUiState(audit, meta) {
  const findings = audit.findings.map((finding) => ({
    ...finding,
    decision: finding.priority.effectiveDecision,
    verification: finding.priority.verification,
    evidence: finding.evidence.map((item) => item.path || item.label || item.kind)
  }));
  const riskClusters = audit.clusters.map((cluster) => ({
    ...cluster,
    decision: cluster.priority.effectiveDecision,
    verification: cluster.priority.verification,
    evidence: cluster.evidence.map((item) => item.path || item.label || item.kind)
  }));
  const summary = Object.fromEntries(
    Object.keys(evidenceLevels).map((level) => [
      level,
      findings.filter((finding) => finding.evidenceLevel === level).length
    ])
  );
  const areas = ["rules", "testing", "seo", "security", "dead-code", "observability"];
  const areaCounts = areas.map((area) => ({
    area,
    count: findings.filter((finding) => finding.area === area).length,
    status: area === "seo" && audit.project.visibility === "internal"
      ? "not-applicable"
      : area === "seo" && ["unknown", "mixed"].includes(audit.project.visibility)
        ? "conditional"
        : "active"
  }));
  return {
    name: audit.project.rootLabel,
    meta,
    findings,
    riskClusters,
    summary,
    areaCounts,
    scope: {
      selected: audit.scope.selectedFiles,
      analyzed: audit.scope.includedFiles,
      excluded: audit.scope.excludedFiles,
      analyzedBytes: audit.scope.includedBytes,
      excludedByReason: audit.scope.excludedByReason,
      partial: audit.scope.partial
    },
    context: { seoScope: audit.project.visibility }
  };
}

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
  document.querySelector("#seoScopeStatus").textContent = formatSeoStatus(state.context.seoScope);
  renderPriority("all");
  renderCoverage();
  renderTable();
}

function renderPriority(filter) {
  const severityOrder = ["critical", "high", "medium", "low", "info"];
  const rows = state.riskClusters
    .filter((cluster) => ["act-now", "verify-first"].includes(cluster.decision))
    .filter((cluster) => filter === "all" || cluster.types.includes(filter))
    .slice()
    .sort((a, b) => comparePriorityClusters(a, b, severityOrder))
    .slice(0, 3);

  document.querySelector("#urgentList").innerHTML = rows.length
    ? rows.map((cluster, index) =>
      '<article class="urgent" data-severity="' + cluster.severity + '">' +
        '<i>' + (index + 1) + '</i><div><h3>' + escapeHtml(cluster.title) + '</h3>' +
        '<span class="decision ' + cluster.decision + '">' +
          decisionLabels[cluster.decision] + '</span>' +
        '<p><b>왜 위험한가</b>' + escapeHtml(cluster.whyRisky) + '</p>' +
        '<p><b>가능한 영향</b>' + escapeHtml(cluster.possibleImpact) + '</p>' +
        '<p><b>다음으로 확인할 것</b>' + escapeHtml(cluster.verification) + '</p>' +
        '<details><summary>우선순위 근거</summary>' +
          '<p><b>선정 근거</b>' + escapeHtml(cluster.priority.reasons.map(formatPriorityText).join(" / ")) + '</p>' +
          '<p><b>우선순위를 낮출 수 있는 근거</b>' + escapeHtml(cluster.priority.counterEvidence.map(formatPriorityText).join(" / ") || "현재 확인된 내용 없음") + '</p>' +
          '<p><b>아직 필요한 정보</b>' + escapeHtml(cluster.priority.missingEvidence.map(formatPriorityText).join(" / ") || "없음") + '</p>' +
        '</details></div>' +
        '<span class="pill ' + cluster.severity + '">' + cluster.severity + '</span>' +
      '</article>'
    ).join("")
    : '<div class="empty">조건에 맞는 우선 검토 항목이 없습니다. 추가 검토가 필요 없다는 뜻은 아닙니다.</div>';
}

function comparePriorityClusters(a, b, severityOrder) {
  const diffOrder = ["worsened", "new", "unbaselined", "unverified", "unchanged"];
  const aDiff = diffOrder.findIndex((key) => a.priority.sortKeys.includes(key));
  const bDiff = diffOrder.findIndex((key) => b.priority.sortKeys.includes(key));
  const normalizedA = aDiff === -1 ? Number.MAX_SAFE_INTEGER : aDiff;
  const normalizedB = bDiff === -1 ? Number.MAX_SAFE_INTEGER : bDiff;
  if (normalizedA !== normalizedB) return normalizedA - normalizedB;
  const aJourney = a.priority.sortKeys.includes("material-journey") ? 0 : 1;
  const bJourney = b.priority.sortKeys.includes("material-journey") ? 0 : 1;
  return aJourney - bJourney
    || severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
    || a.id.localeCompare(b.id);
}

function renderCoverage() {
  const maxCount = Math.max(1, ...state.areaCounts.map((row) => row.count));
  document.querySelector("#coverageList").innerHTML = state.areaCounts.map((row) =>
    '<div class="coverage-row" data-status="' + row.status + '"><span>' + areaLabels[row.area] + '</span>' +
    '<div class="bar"><i style="width:' + (row.count / maxCount * 100) + '%"></i></div>' +
    '<span>' + formatAreaCount(row) + '</span></div>'
  ).join("");
}

function formatAreaCount(row) {
  if (row.status === "not-applicable") return "제외";
  if (row.status === "conditional" && row.count === 0) return "조건부";
  return row.count;
}

function formatSeoStatus(seoScope) {
  const status = {
    unknown: "검색 노출 범위 미확인",
    public: "검색 노출 URL에 검사 적용",
    mixed: "공개 URL에만 검사 적용",
    internal: "내부 전용 · SEO 검사는 선택 사항"
  };
  return "SEO · " + status[seoScope];
}

function renderTable() {
  document.querySelector("#findingsTable").innerHTML = state.findings.length
    ? state.findings.map((finding) =>
      '<tr><td><span class="evidence-label ' + finding.evidenceLevel + '">' +
        evidenceLevels[finding.evidenceLevel] + '</span></td>' +
      '<td><span class="pill ' + finding.severity + '">' + finding.severity + '</span></td>' +
      '<td><code>' + escapeHtml(finding.id) + '</code></td>' +
      '<td>' + escapeHtml(areaLabels[finding.area] || finding.area) + '</td><td class="finding-cell">' +
        '<strong>' + escapeHtml(finding.title) + '</strong>' +
        '<details><summary>판단 근거</summary>' +
          '<div><b>왜 위험한가</b><p>' + escapeHtml(finding.whyRisky) + '</p></div>' +
          '<div><b>가능한 영향</b><p>' + escapeHtml(finding.possibleImpact) + '</p></div>' +
          '<div><b>위험이 커지는 조건</b><p>' + escapeHtml(finding.riskFactors) + '</p></div>' +
          '<div><b>다음으로 확인할 것</b><p>' + escapeHtml(finding.verification) + '</p></div>' +
          '<div><b>분석 한계</b><p>' + escapeHtml(finding.limitation) + '</p></div>' +
          '<div><b>권장 조치</b><p>' + escapeHtml(finding.recommendation) + '</p></div>' +
        '</details></td>' +
      '<td>' + escapeHtml(formatEvidence(finding)) + '</td></tr>'
    ).join("")
    : '<tr><td colspan="6" class="empty">자동으로 찾은 항목이 없습니다. 사람의 추가 검토는 여전히 필요합니다.</td></tr>';
}

function formatEvidence(finding) {
  const hiddenCount = Math.max(0, finding.occurrenceCount - finding.evidence.length);
  return finding.evidence.join(", ") + (hiddenCount ? " 외 " + hiddenCount + "건" : "");
}

function formatScope(scope) {
  const reasonLabels = {
    environment: "환경 변수 파일",
    generated: "생성된 파일",
    "generated-header": "생성 코드 표시",
    "excluded-path": "제외 경로",
    "unsupported-type": "지원하지 않는 파일 형식",
    oversized: "큰 파일",
    "input-budget": "분석 한도 초과",
    "read-failed": "읽기 실패"
  };
  const reasons = Object.entries(scope.excludedByReason || {})
    .map(([reason, count]) => (reasonLabels[reason] || reason) + " " + count)
    .join(" · ");
  const coverage = formatBytes(scope.analyzedBytes) + " 분석";
  const completeness = scope.partial ? " · 일부 파일은 크기·개수 제한 또는 읽기 실패로 분석하지 못함" : "";
  return coverage + (reasons ? " · 제외: " + reasons : "") + completeness;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function formatPriorityText(value) {
  const text = String(value);
  const exact = {
    "The detector describes potentially material impact if the hypothesis is confirmed.":
      "가정이 사실로 확인되면 영향이 클 수 있는 항목입니다.",
    "The source pattern was directly observed.":
      "해당 코드 패턴을 실제 파일에서 찾았습니다.",
    "The result is an inference or information gap that still requires verification.":
      "위험 가능성 또는 정보 부족 항목이므로 추가 확인이 필요합니다.",
    "declared control effectiveness":
      "선언된 방어 수단이 실제로 작동하는지",
    "source trust boundary":
      "입력 출처의 신뢰 경계",
    "sink-level control effectiveness requires repository-aware verification":
      "HTML 출력 위치의 방어 수단이 실제로 작동하는지 코드베이스에서 확인해야 함"
  };
  if (exact[text]) return exact[text];
  if (text.startsWith("Baseline status: ")) {
    return "기준선 비교 상태: " + formatDiffStatus(
      text.slice("Baseline status: ".length).replace(/\.$/, "")
    );
  }
  if (text.startsWith("Affected approved journeys: ")) {
    return "영향받는 중요 사용자 여정: " + text.slice("Affected approved journeys: ".length);
  }
  if (text.startsWith("The finding intersects approved journey context: ")) {
    return "등록된 중요 사용자 여정과 관련됨: "
      + text.slice("The finding intersects approved journey context: ".length);
  }
  if (text.startsWith("The finding intersects approved trust boundary: ")) {
    return "등록된 신뢰 경계와 관련됨: "
      + text.slice("The finding intersects approved trust boundary: ".length);
  }
  const control = text.match(/^Declared control `([^`]+)` requires verification via (.+)$/);
  if (control) {
    return "등록된 방어 수단 `" + control[1] + "`의 동작을 확인해야 함: " + control[2];
  }
  return text;
}

function formatDiffStatus(value) {
  return {
    unbaselined: "기준선 없음",
    new: "새로 발견",
    worsened: "악화",
    unchanged: "변화 없음",
    resolved: "해결됨",
    unverified: "비교할 수 없음"
  }[value] || value;
}

function download() {
  const blob = new Blob([buildAuditMarkdown(currentAuditResult, { locale: "ko" })], { type: "text/markdown;charset=utf-8" });
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
