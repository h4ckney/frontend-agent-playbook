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
const { createDocument, validateDocument, setDecision, getDecision, groupFindings } = globalThis.FrontendTriage;
const TRIAGE_STORAGE_PREFIX = "frontend-audit-triage-v1:";
let triageDocument = null;
let reviewDigests = null;
let pendingClose = [];
let showClosed = false;
let activeFilter = "all";
let identityGeneration = 0;
let scanGeneration = 0;
let scanPending = false;

const areaLabels = {
  rules: "프로젝트 환경",
  testing: "테스트",
  seo: "SEO",
  security: "보안",
  "dead-code": "삭제 후보",
  observability: "오류 처리",
  styling: "CSS 위험 후보"
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
  const generation = ++scanGeneration;
  identityGeneration += 1;
  scanPending = true;
  triageDocument = null;
  reviewDigests = null;
  pendingClose = [];
  document.querySelector("#triageDialog").close();
  document.querySelector("#projectIdentity").value = "";
  document.querySelector("#triageStorageStatus").textContent = "폴더 분석을 마친 뒤 프로젝트 ID를 연결해주세요.";
  render();

  try {
    const { records, scope } = await readFiles(files);
    if (generation !== scanGeneration) return;
    const name = files[0].webkitRelativePath.split("/")[0] || "선택한 프로젝트";
    currentAudit = {
      name,
      records,
      meta: scope.analyzed + "개 텍스트 파일 분석 · " + scope.excluded + "개 제외",
      scope
    };
    scanPending = false;
    document.querySelector("#triageStorageStatus").textContent = "프로젝트 ID를 연결하면 검토 상태를 불러옵니다.";
    state = createState();
    render();
    notify(scope.partial ? "일부 파일을 제외하고 분석을 마쳤습니다." : "분석이 완료되었습니다.");
  } catch (error) {
    if (generation !== scanGeneration) return;
    scanPending = false;
    console.error(error);
    notify("분석 중 오류가 발생했습니다.");
  }
  if (generation === scanGeneration) input.value = "";
});

seoScopeInputs.forEach((control) => {
  control.addEventListener("change", () => {
    if (!control.checked) return;
    const reconnect = triageDocument?.projectKey;
    identityGeneration += 1;
    triageDocument = null;
    reviewDigests = null;
    selectedSeoScope = control.value;
    state = createState();
    render();
    if (reconnect) void connectProject({ preventDefault() {} }, reconnect);
  });
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-filter]").forEach((node) => node.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    renderPriority(activeFilter);
  });
});

document.querySelector("#copyReport").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(buildReport());
    notify("Markdown 보고서를 복사했습니다.");
  } catch {
    download();
    notify("클립보드 권한이 없어 파일로 저장했습니다.");
  }
});
document.querySelector("#downloadReport").addEventListener("click", download);
document.querySelector("#chooseFolder").addEventListener("click", () => input.click());
document.querySelector("#chooseTriage").addEventListener("click", () => document.querySelector("#importTriage").click());
document.querySelector("#projectIdentityForm").addEventListener("submit", connectProject);
document.querySelector("#showClosed").addEventListener("change", (event) => {
  showClosed = event.target.checked;
  render();
});
document.querySelector("#findingsTable").addEventListener("click", handleTriageAction);
document.querySelector("#cancelTriage").addEventListener("click", () => document.querySelector("#triageDialog").close());
document.querySelector("#triageForm").addEventListener("submit", closeFindings);
document.querySelector("#exportTriage").addEventListener("click", exportTriage);
document.querySelector("#importTriage").addEventListener("change", importTriage);

function createState() {
  const bundle = createAuditBundle({
    name: currentAudit.name,
    records: currentAudit.records,
    meta: currentAudit.meta,
    scope: currentAudit.scope,
    context: { seoScope: selectedSeoScope },
    analysisMode: "static-lite",
    capabilities: ["route-path-inference", "text-patterns"],
    scopePolicyDigest: "browser-static-lite-relative-v2"
  });
  currentAuditResult = bundle.audit;
  return createUiState(bundle.audit, currentAudit.meta);
}

function createUiState(audit, meta) {
  const findings = audit.findings.map((finding) => ({
    ...finding,
    reviewContextDigest: reviewDigests?.get(finding.fingerprint) || null,
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
  const areas = ["rules", "testing", "seo", "security", "dead-code", "observability", "styling"];
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
            path: file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name,
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
  const groups = currentGroups();
  document.querySelector("#findingCount").textContent = groups.filter((group) => group.visible.length).length + "묶음 · " + state.findings.length + "개 발견";
  document.querySelector("#exportTriage").disabled = !triageDocument;
  document.querySelector("#scopeExclusions").textContent = formatScope(state.scope);
  document.querySelector("#seoScopeStatus").textContent = formatSeoStatus(state.context.seoScope);
  renderPriority(activeFilter);
  renderCoverage();
  renderTable();
}

function renderPriority(filter) {
  const severityOrder = ["critical", "high", "medium", "low", "info"];
  const rows = currentGroups().filter((group) => group.open.length).map((group) => ({
    ...group.cluster,
    id: group.id,
    title: group.cluster.title + " · " + group.scopeLabel
  }))
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
  const table = document.querySelector("#findingsTable");
  const expanded = new Set(Array.from(table.querySelectorAll(".issue-group[open]"), (node) => node.dataset.groupId));
  const focused = document.activeElement;
  const focusFingerprint = focused?.dataset?.fingerprint;
  const focusAction = focused?.dataset?.triageAction;
  const focusGroup = focused?.closest?.(".issue-group")?.dataset.groupId;
  const groups = currentGroups().filter((group) => group.visible.length);
  table.innerHTML = groups.length
    ? groups.map((group) => '<details class="issue-group" data-group-id="' + escapeHtml(group.id) + '"' + (expanded.has(group.id) ? ' open' : '') + '><summary><span>' + escapeHtml(group.cluster.title) + '</span><span class="count">' + group.open.length + '개 열림 / ' + group.findings.length + '개 발견</span><small>' + escapeHtml(group.scopeLabel) + '</small></summary>' +
      '<div class="group-body"><button class="secondary compact" data-triage-action="close-group" data-group-id="' + escapeHtml(group.id) + '"' + (group.open.length ? disabledTriage() : ' disabled') + '>열린 항목 묶음 닫기</button>' +
      group.visible.map(renderFinding).join("") + '</div></details>').join("")
    : '<div class="empty">표시할 열린 항목이 없습니다. 닫은 항목은 다시 펼칠 수 있으며, 미발견은 안전을 뜻하지 않습니다.</div>';
  if (focusAction || (focused?.tagName === "SUMMARY" && focusGroup)) {
    const action = Array.from(table.querySelectorAll("[data-triage-action]")).find((node) =>
      !node.disabled && node.dataset.triageAction === focusAction && node.dataset.fingerprint === focusFingerprint && node.closest(".issue-group")?.dataset.groupId === focusGroup);
    const group = Array.from(table.querySelectorAll(".issue-group")).find((node) => node.dataset.groupId === focusGroup);
    (action || group?.querySelector("summary") || document.querySelector("#showClosed")).focus();
  }
}

function currentGroups() {
  return groupFindings(state.findings).map((group) => {
    const open = group.findings.filter((finding) => reviewState(finding).state !== "closed");
    const members = open.length ? open : group.findings;
    const severityOrder = ["critical", "high", "medium", "low", "info"];
    const primary = members.slice().sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity))[0];
    const base = state.riskClusters.find((cluster) => cluster.id === primary.clusterId);
    const decisions = members.map((finding) => finding.decision);
    const decision = ["act-now", "verify-first", "information-gap", "observe", "suppressed"].find((value) => decisions.includes(value));
    const unique = (values) => [...new Set(values)];
    const cluster = {
      id: group.id,
      title: base?.title || primary.title,
      severity: primary.severity,
      decision,
      types: unique(members.map((finding) => finding.type)),
      whyRisky: primary.whyRisky,
      possibleImpact: primary.possibleImpact,
      verification: unique(members.map((finding) => finding.verification)).join(" / "),
      priority: {
        sortKeys: unique(members.flatMap((finding) => finding.priority.sortKeys)),
        reasons: unique(members.flatMap((finding) => finding.priority.reasons)),
        counterEvidence: unique(members.flatMap((finding) => finding.priority.counterEvidence)),
        missingEvidence: unique(members.flatMap((finding) => finding.priority.missingEvidence))
      }
    };
    const path = group.findings[0].scope.paths[0] || "";
    const scopeLabel = path ? path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "프로젝트 루트" : "프로젝트 전체";
    return { ...group, scopeLabel, cluster, open, visible: showClosed ? group.findings : open };
  });
}

function reviewState(finding) {
  return triageDocument ? getDecision(triageDocument, finding) : { state: "open", statusReason: "none", decision: null };
}

function disabledTriage() {
  return triageDocument ? "" : ' disabled title="프로젝트 ID를 먼저 연결해주세요"';
}

function renderFinding(finding) {
  const review = reviewState(finding);
  const labels = { open: "열림", closed: "검토 후 닫음", "verification-requested": "재검증 요청" };
  const resurfaced = review.statusReason === "expired" ? " · 재검토 기한 만료" : review.statusReason === "changed" ? " · 근거 변경" : "";
  return '<article class="finding-item" data-fingerprint="' + escapeHtml(finding.fingerprint) + '"><div class="finding-meta"><span class="evidence-label ' + finding.evidenceLevel + '">' + evidenceLevels[finding.evidenceLevel] + '</span><span class="pill ' + finding.severity + '">' + finding.severity + '</span><span>' + labels[review.state] + resurfaced + '</span></div>' +
    '<h3>' + escapeHtml(finding.title) + '</h3><code>' + escapeHtml(finding.id) + '</code><p class="finding-path">' + escapeHtml(formatEvidence(finding)) + '</p>' +
    '<details class="finding-reason"><summary>판단 근거</summary><p><b>왜 위험한가</b> ' + escapeHtml(finding.whyRisky) + '</p><p><b>다음으로 확인할 것</b> ' + escapeHtml(finding.verification) + '</p><p><b>분석 한계</b> ' + escapeHtml(finding.limitation) + '</p></details>' +
    (review.decision?.reason ? '<p>검토 이유: ' + escapeHtml(review.decision.reason) + '</p>' : '') +
    (review.decision?.expires ? '<p>재검토 기한: ' + escapeHtml(review.decision.expires) + ' (UTC)</p>' : '') +
    '<div class="finding-actions">' + (review.state === "closed" ? actionButton("reopen", "다시 열기", finding) : actionButton("close", "검토 후 닫기", finding) + actionButton("request-verification", "재검증 요청", finding)) + '</div></article>';
}

function actionButton(action, label, finding) {
  return '<button class="secondary compact" data-triage-action="' + action + '" data-fingerprint="' + escapeHtml(finding.fingerprint) + '"' + disabledTriage() + '>' + label + '</button>';
}

async function connectProject(event, boundProjectKey) {
  event.preventDefault();
  if (scanPending) return;
  const projectKey = boundProjectKey || document.querySelector("#projectIdentity").value.trim();
  const generation = ++identityGeneration;
  try {
    const empty = createDocument(projectKey);
    triageDocument = null;
    reviewDigests = null;
    pendingClose = [];
    document.querySelector("#triageDialog").close();
    render();
    document.querySelector("#triageStorageStatus").textContent = "관련 근거를 확인하고 검토 상태를 불러오는 중입니다.";
    const digests = await computeReviewDigests(currentAudit.records, currentAuditResult);
    if (generation !== identityGeneration) return;
    let documentValue = empty;
    let storageNote = "";
    try {
      const stored = globalThis.localStorage.getItem(TRIAGE_STORAGE_PREFIX + projectKey);
      if (stored) {
        if (stored.length > 2_000_000) throw new Error("oversized state");
        const parsed = JSON.parse(stored);
        if (validateDocument(parsed, projectKey).length) throw new Error("invalid state");
        documentValue = parsed;
      }
    } catch {
      storageNote = " 이전 상태를 읽지 못했습니다. 가져오기·내보내기를 사용할 수 있습니다.";
    }
    reviewDigests = digests;
    triageDocument = documentValue;
    state = createUiState(currentAuditResult, currentAudit.meta);
    render();
    document.querySelector("#triageStorageStatus").textContent = projectKey + "에 연결했습니다." + storageNote;
  } catch {
    if (generation !== identityGeneration) return;
    triageDocument = null;
    render();
    document.querySelector("#triageStorageStatus").textContent = "프로젝트 ID와 브라우저의 보안 연결을 확인해주세요. 근거 확인 전에는 상태를 적용하지 않습니다.";
  }
}

async function computeReviewDigests(records, audit) {
  if (!globalThis.crypto?.subtle) throw new Error("source digest unavailable");
  const digest = async (value) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const fileDigests = new Map();
  for (const record of records) fileDigests.set(record.path, await digest(record.content));
  const manifests = [...fileDigests].filter(([path]) => /(^|\/)package\.json$/.test(path));
  const result = new Map();
  for (const finding of audit.findings) {
    const relevant = finding.scope.paths.length
      ? finding.scope.paths.map((path) => [path, fileDigests.get(path) || "missing"])
      : [...fileDigests];
    result.set(finding.fingerprint, await digest(JSON.stringify([...relevant, ...manifests].sort((a, b) => a[0].localeCompare(b[0])))));
  }
  return result;
}

function handleTriageAction(event) {
  const button = event.target.closest("[data-triage-action]");
  if (!button || !triageDocument) return;
  const action = button.dataset.triageAction;
  const findings = action === "close-group"
    ? currentGroups().find((group) => group.id === button.dataset.groupId)?.open || []
    : state.findings.filter((finding) => finding.fingerprint === button.dataset.fingerprint);
  if (!findings.length) return;
  if (action === "close" || action === "close-group") {
    pendingClose = findings.map((finding) => finding.fingerprint);
    document.querySelector("#triageForm").reset();
    document.querySelector("#triageError").textContent = "";
    document.querySelector("#closeExpires").min = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    document.querySelector("#triageDialog").showModal();
    return;
  }
  try {
    for (const finding of findings) triageDocument = setDecision(triageDocument, finding, { action });
    persistTriage();
    render();
  } catch {
    notify("검토 상태를 변경하지 못했습니다.");
  }
}

function closeFindings(event) {
  event.preventDefault();
  if (!triageDocument) return;
  try {
    let next = triageDocument;
    for (const fingerprint of pendingClose) {
      const finding = state.findings.find((item) => item.fingerprint === fingerprint);
      if (!finding) throw new Error("finding changed");
      next = setDecision(next, finding, {
        action: "close",
        disposition: document.querySelector("#closeDisposition").value,
        reason: document.querySelector("#closeReason").value.trim(),
        expires: document.querySelector("#closeExpires").value
      });
    }
    triageDocument = next;
    persistTriage();
    document.querySelector("#triageDialog").close();
    pendingClose = [];
    render();
  } catch {
    document.querySelector("#triageError").textContent = "이유와 미래의 재검토 날짜를 입력해주세요.";
  }
}

function persistTriage() {
  try {
    globalThis.localStorage.setItem(TRIAGE_STORAGE_PREFIX + triageDocument.projectKey, JSON.stringify(triageDocument));
    document.querySelector("#triageStorageStatus").textContent = "이 브라우저에 검토 상태를 보관했습니다. 원본 분석 결과와 CI 판정은 유지됩니다.";
  } catch {
    document.querySelector("#triageStorageStatus").textContent = "브라우저에 보관하지 못했습니다. 현재 상태를 내보내서 보관해주세요.";
  }
}

function exportTriage() {
  if (triageDocument) downloadBlob(JSON.stringify(triageDocument, null, 2) + "\n", "application/json", "frontend-audit-triage.json");
}

async function importTriage(event) {
  const file = event.target.files?.[0];
  const generation = identityGeneration;
  const projectKey = triageDocument?.projectKey;
  try {
    if (!projectKey || !file || file.size > 2_000_000) throw new Error("project or state invalid");
    const parsed = JSON.parse(await file.text());
    if (generation !== identityGeneration || validateDocument(parsed, projectKey).length) throw new Error("project mismatch or state invalid");
    triageDocument = parsed;
    persistTriage();
    render();
    notify("검토 상태를 불러왔습니다.");
  } catch {
    notify("현재 프로젝트와 일치하는 유효한 상태 파일을 선택해주세요.");
  }
  event.target.value = "";
}

function buildReport() {
  let report = buildAuditMarkdown(currentAuditResult, { locale: "ko" });
  if (!triageDocument) return report;
  const cell = (value) => String(value || "").replace(/[\\|`<>\[\]()!]/g, " ").replace(/[\r\n]+/g, " ");
  report += "\n\n## 로컬 검토 결정\n\n닫기는 검토 결정이며 수정 완료·CI 예외·GitHub 이슈 종료를 뜻하지 않습니다. 원본 발견은 위에 모두 포함되어 있습니다.\n\n";
  report += "프로젝트: " + cell(triageDocument.projectKey) + "\n\n| 항목 | 현재 상태 | 이유 | 재검토 날짜 |\n| --- | --- | --- | --- |\n";
  for (const [fingerprint, decision] of Object.entries(triageDocument.decisions)) {
    const finding = state.findings.find((item) => item.fingerprint === fingerprint);
    const labels = { open: "열림", closed: "검토 후 닫음", "verification-requested": "재검증 요청" };
    const status = finding ? labels[reviewState(finding).state] : "현재 분석에 없음·미검증";
    report += "| " + [fingerprint, status, decision.reason, decision.expires].map(cell).join(" | ") + " |\n";
  }
  return report;
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
  downloadBlob(buildReport(), "text/markdown;charset=utf-8", (state.name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-") || "frontend") + "-audit.md");
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
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
globalThis.addEventListener?.("focus", render);
})();
