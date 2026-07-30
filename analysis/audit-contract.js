(function () {
  "use strict";

  const analyzer = typeof module !== "undefined" && module.exports
    ? require("./analyzer.js")
    : globalThis.FrontendAnalyzer;

  if (!analyzer) {
    throw new Error("FrontendAnalyzer must be loaded before FrontendAuditContract");
  }

  const AUDIT_SCHEMA_VERSION = "1";
  const PROFILE_SCHEMA_VERSION = "1";
  const TOOL_VERSION = "0.2.0-dev";
  const DETECTOR_CATALOG_VERSION = "1";
  const DEFAULT_CAPABILITIES = ["route-path-inference", "text-patterns"];
  const severityRank = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const evidenceRank = { unknown: 0, candidate: 0, inferred: 1, observed: 2 };
  const exposureRank = { unknown: 0, limited: 1, likely: 2, confirmed: 3 };
  const controlRank = { effective: 0, partial: 1, unverified: 2, missing: 3 };
  const applicabilityRank = { "not-applicable": 0, unknown: 1, conditional: 2, applicable: 3 };

  const detectorCatalog = Object.freeze({
    "rules.package-json-invalid": detector("context.package-integrity", ["governance.codebase-context"]),
    "security.html-sink-boundary": detector("security.html-boundary", ["security-privacy.html-injection"]),
    "security.html-trust-boundary-unknown": detector("security.html-trust-boundary", ["security-privacy.html-injection"]),
    "security.browser-auth-storage": detector("security.browser-auth-storage", ["security-privacy.browser-storage"]),
    "security.postmessage-wildcard-origin": detector("security.cross-window-origin", ["security-privacy.cross-window-messaging"]),
    "rules.mixed-next-router": detector("next.router-model", ["nextjs.router-boundary"], ["text-patterns", "route-path-inference"]),
    "rules.pre-react-18-version-branch": detector("react.version-context", ["react.version-context"]),
    "testing.test-foundation-missing": detector("testing.foundation", ["testing.test-foundation"]),
    "testing.e2e-path-missing": detector("testing.critical-journeys", ["testing.critical-journeys"]),
    "seo.next-metadata-missing": detector("next.metadata-presence", ["nextjs.metadata", "seo.metadata"], ["text-patterns", "route-path-inference"]),
    "seo.sitemap-missing": detector("seo.sitemap-presence", ["seo.sitemap"], ["text-patterns", "route-path-inference"]),
    "seo.robots-missing": detector("seo.robots-presence", ["seo.robots"], ["text-patterns", "route-path-inference"]),
    "seo.indexing-intent-unknown": detector("seo.indexing-intent", ["seo.applicability"]),
    "dead-code.marked-removal-candidate": detector("dead-code.markers", ["dead-code.removal-candidate"]),
    "observability.console-only-catch": detector("observability.console-catch", ["error-handling-observability.error-recovery"]),
    "rules.framework-version-unknown": detector("context.framework-version", ["governance.codebase-context"])
  });

  function detector(id, ruleRefs, capabilities = ["text-patterns"]) {
    return Object.freeze({
      id,
      version: "1",
      ruleRefs: Object.freeze(ruleRefs.slice()),
      capabilities: Object.freeze(capabilities.slice())
    });
  }

  function createAuditBundle(input) {
    const options = input || {};
    const records = Array.isArray(options.records) ? options.records : [];
    const profile = options.profile || null;
    const profileErrors = validateProjectProfile(profile);
    if (profileErrors.length) {
      throw new Error("invalid project profile: " + profileErrors.join("; "));
    }

    const seoScope = resolveSeoScope(options.context?.seoScope, profile);
    const context = { ...(options.context || {}), seoScope };
    const findings = analyzer.analyzeRecords(records, { seoScope });
    const legacy = analyzer.createAuditResult(
      options.name || "project",
      findings,
      records.length,
      options.meta || "",
      options.scope || {},
      context
    );
    const audit = normalizeLegacyAudit(legacy, records, {
      ...options,
      context,
      profile
    });
    return { legacy, audit };
  }

  function normalizeLegacyAudit(legacy, records = [], options = {}) {
    const diagnostics = [];
    const profile = options.profile || null;
    const capabilities = uniqueSorted(options.capabilities || DEFAULT_CAPABILITIES);
    const generatedAt = options.generatedAt || new Date().toISOString();
    const profileDigest = options.profileDigest || null;
    const scopePolicyDigest = options.scopePolicyDigest || "static-lite-default-v1";
    const project = detectProjectContext(
      records,
      legacy.name,
      profile,
      options.profileSource,
      options.context
    );
    const skippedDetectors = uniqueSorted(Object.values(detectorCatalog)
      .filter((detector) => !detector.capabilities.every((capability) => capabilities.includes(capability)))
      .map((detector) => detector.id));
    let findings = legacy.findings
      .filter((item) => detectorCatalog[item.id].capabilities.every((capability) =>
        capabilities.includes(capability)
      ))
      .flatMap((item) =>
      normalizeFindingOccurrences(item, legacy.context, profile)
    );

    findings = applySuppressions(findings, profile, diagnostics, options.now || generatedAt);
    findings.sort(compareFindings);

    const clusters = normalizeClusters(legacy.riskClusters, findings);
    const scope = normalizeScope(legacy.scope);
    if (scope.partial) {
      diagnostics.push({
        id: "analysis.partial",
        level: "warning",
        message: "Analysis coverage is partial.",
        reasons: scope.partialReasons.slice()
      });
    }
    if (profile && !profileDigest) {
      diagnostics.push({
        id: "profile.digest-unavailable",
        level: "warning",
        message: "A project profile was applied without a reproducible digest."
      });
    }
    if (!profile) {
      diagnostics.push({
        id: "project.context-missing",
        level: "info",
        message: "No approved project profile was provided; product-specific journeys, route policies, trust boundaries, and controls were not applied."
      });
    }
    if (skippedDetectors.length) {
      diagnostics.push({
        id: "capability.detectors-omitted",
        level: "warning",
        message: "Detector output was omitted because the analysis surface did not declare required capabilities.",
        detectorIds: skippedDetectors
      });
    }

    const result = {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      toolVersion: TOOL_VERSION,
      generatedAt,
      scopePolicyDigest,
      engine: {
        analysisMode: options.analysisMode || "static-lite",
        capabilities,
        detectorCatalogVersion: DETECTOR_CATALOG_VERSION,
        profileDigest,
        externalTools: normalizeExternalTools(options.externalTools)
      },
      project,
      scope,
      findings,
      clusters,
      diff: emptyDiff(null, findings.map((item) => item.fingerprint)),
      diagnostics: diagnostics.sort((a, b) => a.id.localeCompare(b.id))
    };

    const errors = validateAuditResult(result);
    if (errors.length) {
      throw new Error("invalid audit result: " + errors.join("; "));
    }
    return result;
  }

  function normalizeFindingOccurrences(item, context, profile) {
    const rawEvidence = item.allEvidence || item.evidence;
    const pathEvidence = uniqueSorted(rawEvidence.filter(looksLikePath).map(normalizeRelativePath));
    if (pathEvidence.length) {
      return pathEvidence.map((path) => normalizeFinding(item, context, profile, {
        fingerprintScope: path,
        evidence: [{ kind: "path", path }],
        occurrenceCount: 1
      }));
    }
    return [normalizeFinding(item, context, profile, {
      fingerprintScope: "repository",
      evidence: rawEvidence.map((value) => ({ kind: "context", label: sanitizeLabel(value) })),
      occurrenceCount: item.occurrenceCount
    })];
  }

  function normalizeFinding(item, context, profile, occurrence) {
    const detectorMeta = detectorCatalog[item.id];
    if (!detectorMeta) {
      throw new Error("missing detector catalog entry for finding: " + item.id);
    }
    const applicability = findingApplicability(item, context);
    const fingerprint = item.id + ":" + occurrence.fingerprintScope;
    const paths = occurrence.evidence.filter((item) => item.path).map((item) => item.path);
    const routes = uniqueSorted(paths.map(routeFromPath).filter(Boolean));
    const journeyEntries = matchingJourneyEntries(routes, profile);
    const journeys = journeyEntries.map((journey) => journey.id);
    const materialJourneys = journeyEntries
      .filter((journey) => ["critical", "high"].includes(journey.impact))
      .map((journey) => journey.id);
    const routePolicy = resolveRoutePolicy(routes, profile);
    const trustBoundaries = item.id.startsWith("security.html-")
      ? matchingTrustBoundaries(paths, profile)
      : [];
    const declaredControls = matchingControls(item.area, paths, routes, trustBoundaries, profile);
    const controlState = declaredControls.length ? "partial" : "unverified";
    const exposure = item.evidenceLevel === "candidate"
      ? "limited"
      : trustBoundaries.length || routePolicy?.visibility === "public"
        ? "likely"
        : routePolicy?.visibility === "internal"
          ? "limited"
          : "unknown";
    const profileContext = {
      journeys,
      routePolicy,
      trustBoundaries,
      declaredControls
    };
    const evidence = occurrence.evidence;
    const flow = item.id.startsWith("security.html-")
      ? {
          status: "partial",
          sources: trustBoundaries.map((boundary) => boundary.source),
          transforms: [],
          controls: declaredControls.map((control) => control.id),
          sinks: item.id === "security.html-sink-boundary" ? ["html-rendering"] : [],
          unknowns: [
            trustBoundaries.length ? null : "source trust boundary",
            "sink-level control effectiveness requires repository-aware verification"
          ].filter(Boolean)
        }
      : {
          status: "not-assessed",
          sources: [],
          transforms: [],
          controls: [],
          sinks: [],
          unknowns: []
        };

    return {
      id: item.id,
      fingerprint,
      detectorId: detectorMeta.id,
      detectorVersion: detectorMeta.version,
      ruleRefs: detectorMeta.ruleRefs.slice(),
      sourceRuleRefs: [],
      title: item.title,
      area: item.area,
      type: item.type,
      severity: item.severity,
      evidenceLevel: item.evidenceLevel,
      exposure,
      controlState,
      applicability: applyProfileApplicability(applicability, item, profileContext),
      scope: {
        paths: uniqueSorted(paths),
        routes,
        journeys
      },
      flow,
      priority: {
        decision: item.decision,
        effectiveDecision: item.decision,
        policyId: "static-heuristic-review-v1",
        sortKeys: prioritySortKeys(item, fingerprint, materialJourneys, declaredControls),
        reasons: priorityReasons(item, journeyEntries, trustBoundaries),
        counterEvidence: declaredControls.map((control) =>
          "Declared control `" + control.id + "` requires verification via " + control.verification
        ),
        missingEvidence: [
          item.verification,
          declaredControls.length ? "declared control effectiveness" : null
        ].filter(Boolean),
        affectedJourney: journeys[0] || null,
        verification: item.verification
      },
      evidence,
      occurrenceCount: occurrence.occurrenceCount,
      observedFact: item.observedFact,
      whyRisky: item.whyRisky,
      possibleImpact: item.possibleImpact,
      riskFactors: item.riskFactors,
      mitigatingControls: item.mitigatingControls,
      recommendation: item.recommendation,
      limitation: item.limitation,
      clusterId: item.clusterId,
      diffStatus: "unbaselined",
      suppression: null
    };
  }

  function applyProfileApplicability(base, item, profileContext) {
    if (item.area === "seo" && profileContext.routePolicy) {
      if (profileContext.routePolicy.indexing === "not-applicable") {
        return {
          status: "not-applicable",
          reasons: ["The approved route policy marks matched routes as non-indexable."],
          missingContext: []
        };
      }
      if (profileContext.routePolicy.indexing === "required") {
        return {
          status: "applicable",
          reasons: ["The approved route policy requires indexing for matched routes."],
          missingContext: []
        };
      }
    }
    if (item.id.startsWith("security.html-") && profileContext.trustBoundaries.length) {
      return {
        status: "applicable",
        reasons: ["An approved project trust boundary matches the observed path."],
        missingContext: base.missingContext.filter((value) => !/source|출처/i.test(value))
      };
    }
    return base;
  }

  function findingApplicability(item, context) {
    if (item.id === "seo.indexing-intent-unknown") {
      return {
        status: "unknown",
        reasons: ["Search exposure scope is not confirmed."],
        missingContext: ["public and internal route boundaries"]
      };
    }
    if (item.area === "seo" && context?.seoScope === "mixed") {
      return {
        status: "conditional",
        reasons: ["Only public indexable routes are in scope."],
        missingContext: ["route-level indexing intent"]
      };
    }
    if (item.id === "rules.package-json-invalid") {
      return {
        status: "applicable",
        reasons: ["The selected package file could not be parsed."],
        missingContext: []
      };
    }
    return {
      status: "conditional",
      reasons: ["Static evidence requires repository or runtime confirmation."],
      missingContext: [item.verification].filter(Boolean)
    };
  }

  function prioritySortKeys(item, fingerprint, materialJourneys = [], controls = []) {
    const keys = ["unbaselined"];
    if (severityRank[item.severity] >= severityRank.high) keys.push("material-impact");
    if (materialJourneys.length) keys.push("material-journey");
    if (item.evidenceLevel === "observed") keys.push("observed-evidence");
    keys.push(controls.length ? "declared-control-unverified" : "control-unverified", fingerprint);
    return keys;
  }

  function priorityReasons(item, journeys = [], trustBoundaries = []) {
    const reasons = [];
    if (severityRank[item.severity] >= severityRank.high) {
      reasons.push("The detector describes potentially material impact if the hypothesis is confirmed.");
    }
    reasons.push(item.evidenceLevel === "observed"
      ? "The source pattern was directly observed."
      : "The result is an inference or information gap that still requires verification.");
    if (journeys.length) reasons.push("The finding intersects approved journey context: "
      + journeys.map((journey) => journey.id + " (" + journey.impact + ")").join(", ") + ".");
    if (trustBoundaries.length) reasons.push("The finding intersects approved trust boundary: "
      + trustBoundaries.map((item) => item.id).join(", ") + ".");
    return reasons;
  }

  function normalizeClusters(legacyClusters, findings) {
    return legacyClusters.map((cluster) => {
      const sourceIds = new Set(cluster.findingIds);
      const members = findings.filter((item) => sourceIds.has(item.id));
      const effectiveDecisions = members.map((item) => item.priority.effectiveDecision);
      const journeys = uniqueSorted(members.flatMap((item) => item.scope.journeys));
      const hasMaterialJourney = members.some((item) =>
        item.priority.sortKeys.includes("material-journey")
      );
      const effectiveDecision = effectiveDecisions.every((decision) => decision === "suppressed")
        ? "suppressed"
        : cluster.decision;
      return {
        id: cluster.id,
        title: cluster.title,
        severity: cluster.severity,
        type: cluster.type,
        types: cluster.types.slice(),
        findingIds: cluster.findingIds.slice().sort(),
        occurrenceCount: cluster.occurrenceCount,
        priority: {
          decision: cluster.decision,
          effectiveDecision,
          policyId: "root-cause-cluster-v1",
          sortKeys: [
            ...(hasMaterialJourney ? ["material-journey"] : []),
            ...clusterSortKeys(cluster)
          ],
          reasons: [
            cluster.whyRisky,
            cluster.possibleImpact,
            journeys.length ? "Affected approved journeys: " + journeys.join(", ") : null
          ].filter(Boolean),
          counterEvidence: uniqueSorted(members.flatMap((item) => item.priority.counterEvidence)),
          missingEvidence: uniqueSorted(members.flatMap((item) => item.priority.missingEvidence)),
          affectedJourney: journeys[0] || null,
          verification: cluster.verification
        },
        whyRisky: cluster.whyRisky,
        possibleImpact: cluster.possibleImpact,
        riskFactors: cluster.riskFactors,
        mitigatingControls: cluster.mitigatingControls,
        verification: cluster.verification,
        recommendation: cluster.recommendation,
        evidence: cluster.evidence.map((value) => looksLikePath(value)
          ? { kind: "path", path: normalizeRelativePath(value) }
          : { kind: "context", label: sanitizeLabel(value) })
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  function clusterSortKeys(cluster) {
    const keys = ["unbaselined"];
    if (severityRank[cluster.severity] >= severityRank.high) keys.push("material-impact");
    keys.push(cluster.id);
    return keys;
  }

  function normalizeScope(scope) {
    const partialReasons = Object.entries(scope.excludedByReason || {})
      .filter(([reason]) => [
        "directory-read-failed", "input-budget", "oversized", "read-failed", "stat-failed", "symlink"
      ].includes(reason))
      .map(([reason, count]) => reason + ":" + count)
      .sort();
    return {
      selectedFiles: scope.selected || 0,
      includedFiles: scope.analyzed || 0,
      excludedFiles: scope.excluded || 0,
      includedBytes: scope.analyzedBytes || 0,
      excludedByReason: sortObject(scope.excludedByReason || {}),
      partial: Boolean(scope.partial || partialReasons.length),
      partialReasons
    };
  }

  function detectProjectContext(records, name, profile, profileSource, context) {
    const packageRecord = records.find((record) => /(^|\/)package\.json$/i.test(record.path));
    let pkg = {};
    try {
      pkg = packageRecord ? JSON.parse(packageRecord.content) : {};
    } catch {
      pkg = {};
    }
    const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const paths = records.map((record) => normalizeRelativePath(record.path).toLowerCase());
    const app = paths.some((value) => /(^|\/)app\//.test(value));
    const pages = paths.some((value) => /(^|\/)pages\//.test(value));
    return {
      rootLabel: sanitizeLabel(name || profile?.project?.id || "project"),
      framework: dependencies.next ? "next" : null,
      frameworkVersion: dependencies.next || null,
      routerMode: app && pages ? "mixed" : app ? "app" : pages ? "pages" : "unknown",
      reactVersion: dependencies.react || null,
      typescriptVersion: dependencies.typescript || null,
      visibility: resolveSeoScope(context?.seoScope, profile),
      profileSource: profileSource || null
    };
  }

  function resolveSeoScope(inputScope, profile) {
    if (analyzer.seoScopeLabels[inputScope]) return inputScope;
    const visibility = profile?.project?.visibility;
    if (visibility === "public" || visibility === "mixed" || visibility === "internal") {
      return visibility;
    }
    return "unknown";
  }

  function routeFromPath(inputPath) {
    const path = normalizeRelativePath(inputPath).replace(/^src\//, "");
    let match = path.match(/^pages\/(.+)\.(?:js|jsx|ts|tsx|mdx)$/i);
    if (match) {
      if (/^_(?:app|document|error)$/.test(match[1]) || match[1].startsWith("api/")) {
        return null;
      }
      const route = match[1]
        .replace(/\/index$/, "")
        .replace(/^index$/, "");
      if (!route) return "/";
      return "/" + route;
    }
    match = path.match(/^app\/(.+)\/page\.(?:js|jsx|ts|tsx|mdx)$/i);
    if (match) {
      const route = match[1].split("/").filter((segment) => !/^\(.+\)$/.test(segment)).join("/");
      return "/" + route;
    }
    if (/^app\/page\.(?:js|jsx|ts|tsx|mdx)$/i.test(path)) return "/";
    return null;
  }

  function matchingJourneyEntries(routes, profile) {
    return (profile?.criticalJourneys || [])
      .filter((journey) => routes.some((route) =>
        journey.routes.some((pattern) => matchGlob(route, pattern))
      ))
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function resolveRoutePolicy(routes, profile) {
    const matches = (profile?.routePolicies || []).filter((policy) =>
      routes.some((route) => matchGlob(route, policy.pattern))
    );
    if (!matches.length) return null;
    return matches.slice().sort((a, b) =>
      routePatternSpecificity(b.pattern) - routePatternSpecificity(a.pattern)
      || a.pattern.localeCompare(b.pattern)
    )[0];
  }

  function routePatternSpecificity(pattern) {
    return String(pattern).replace(/\*/g, "").length;
  }

  function matchingTrustBoundaries(paths, profile) {
    return (profile?.trustBoundaries || []).filter((boundary) =>
      paths.some((path) => boundary.paths.some((pattern) => matchGlob(path, pattern)))
    );
  }

  function matchingControls(area, paths, routes, trustBoundaries, profile) {
    const requiredControlIds = new Set(
      trustBoundaries.flatMap((boundary) => boundary.requiredControls)
    );
    return (profile?.controls || []).filter((control) => {
      if (control.area !== area) return false;
      if (requiredControlIds.has(control.id)) return true;
      if (!control.appliesTo?.length) return true;
      return [...paths, ...routes].some((value) =>
        control.appliesTo.some((pattern) => matchGlob(value, pattern))
      );
    });
  }

  function applySuppressions(findings, profile, diagnostics, nowValue) {
    const suppressions = profile?.suppressions || [];
    const now = new Date(nowValue);
    return findings.map((item) => {
      const matched = suppressions.find((suppression) => suppressionMatches(item, suppression));
      if (!matched) return item;
      const expires = new Date(matched.expires);
      if (Number.isNaN(expires.getTime()) || expires <= now) {
        diagnostics.push({
          id: "suppression.expired." + item.fingerprint,
          level: "warning",
          message: "An expired or invalid suppression was not applied.",
          findingId: item.id
        });
        return item;
      }
      return {
        ...item,
        priority: {
          ...item.priority,
          effectiveDecision: "suppressed"
        },
        suppression: {
          owner: sanitizeLabel(matched.owner),
          reason: sanitizeLabel(matched.reason),
          expires: matched.expires
        }
      };
    });
  }

  function suppressionMatches(finding, suppression) {
    if (suppression.fingerprint) return suppression.fingerprint === finding.fingerprint;
    if (!suppression.ruleId || !finding.ruleRefs.includes(suppression.ruleId)) return false;
    if (!suppression.detectorIds.includes(finding.detectorId)) return false;
    const scopes = [...finding.scope.paths, ...finding.scope.routes];
    return scopes.some((value) => suppression.pathScope.some((pattern) => matchGlob(value, pattern)));
  }

  function matchGlob(value, pattern) {
    const escaped = String(pattern)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*");
    return new RegExp("^" + escaped + "$").test(value);
  }

  function createBaseline(result, options = {}) {
    const errors = validateAuditResult(result);
    if (errors.length) throw new Error("invalid audit result: " + errors.join("; "));
    if (result.scope.partial && !options.allowPartial) {
      throw new Error("refusing to create a baseline from a partial audit result");
    }
    if (result.scope.partial && !String(options.reason || "").trim()) {
      throw new Error("partial baseline requires a non-empty reason");
    }
    return {
      schemaVersion: AUDIT_SCHEMA_VERSION,
      toolVersion: result.toolVersion,
      createdAt: options.createdAt || new Date().toISOString(),
      analysisMode: result.engine.analysisMode,
      scopePolicyDigest: result.scopePolicyDigest,
      profileDigest: result.engine.profileDigest,
      detectorCatalogVersion: result.engine.detectorCatalogVersion,
      capabilities: result.engine.capabilities.slice(),
      externalTools: result.engine.externalTools.map((item) => ({ ...item })),
      partial: result.scope.partial,
      partialReasons: result.scope.partialReasons.slice(),
      partialReason: result.scope.partial ? sanitizeLabel(options.reason) : null,
      findings: result.findings.map((item) => ({
        fingerprint: item.fingerprint,
        detectorId: item.detectorId,
        detectorVersion: item.detectorVersion,
        severity: item.severity,
        evidenceLevel: item.evidenceLevel,
        applicability: item.applicability.status,
        exposure: item.exposure,
        controlState: item.controlState,
        journeyIds: item.scope.journeys.slice(),
        decision: item.priority.decision,
        effectiveDecision: item.priority.effectiveDecision
      })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
    };
  }

  function compareWithBaseline(result, baseline) {
    const baselineErrors = validateBaseline(baseline);
    if (baselineErrors.length) throw new Error("invalid baseline: " + baselineErrors.join("; "));
    const output = clone(result);
    const currentMap = new Map(output.findings.map((item) => [item.fingerprint, item]));
    const baselineMap = new Map(baseline.findings.map((item) => [item.fingerprint, item]));
    const diff = emptyDiff(baseline.createdAt || null, []);
    const compatible = baselineCompatibility(result, baseline);

    if (!compatible.ok) {
      diff.unverified = uniqueSorted([...currentMap.keys(), ...baselineMap.keys()]);
      output.findings.forEach((item) => {
        item.diffStatus = "unverified";
      });
      output.diagnostics.push({
        id: "baseline.incompatible",
        level: "warning",
        message: "Baseline comparison is incomplete.",
        reasons: compatible.reasons
      });
      output.diff = diff;
      refreshClusterPriorities(output);
      return output;
    }

    for (const item of output.findings) {
      const previous = baselineMap.get(item.fingerprint);
      if (!previous) {
        item.diffStatus = "new";
        diff.new.push(item.fingerprint);
      } else if (
        previous.detectorId !== item.detectorId
        || previous.detectorVersion !== item.detectorVersion
      ) {
        item.diffStatus = "unverified";
        diff.unverified.push(item.fingerprint);
      } else if (isWorsened(item, previous)) {
        item.diffStatus = "worsened";
        diff.worsened.push(item.fingerprint);
      } else {
        item.diffStatus = "unchanged";
        diff.unchanged.push(item.fingerprint);
      }
    }

    const activeDetectors = new Set(Object.values(detectorCatalog).map((item) => item.id));
    const pairedCurrentFingerprints = new Set();
    for (const previous of baseline.findings) {
      if (currentMap.has(previous.fingerprint)) continue;
      if (!activeDetectors.has(previous.detectorId) || result.scope.partial) {
        diff.unverified.push(previous.fingerprint);
      } else {
        const possibleMove = output.findings.find((item) =>
          item.diffStatus === "new"
          && !pairedCurrentFingerprints.has(item.fingerprint)
          && item.detectorId === previous.detectorId
          && item.detectorVersion === previous.detectorVersion
        );
        if (possibleMove) {
          possibleMove.diffStatus = "unverified";
          pairedCurrentFingerprints.add(possibleMove.fingerprint);
          diff.new = diff.new.filter((fingerprint) => fingerprint !== possibleMove.fingerprint);
          diff.unverified.push(previous.fingerprint, possibleMove.fingerprint);
        } else {
          diff.resolved.push(previous.fingerprint);
        }
      }
    }

    for (const key of ["new", "worsened", "unchanged", "resolved", "unverified"]) {
      diff[key] = uniqueSorted(diff[key]);
    }
    output.diff = diff;
    refreshClusterPriorities(output);
    return output;
  }

  function refreshClusterPriorities(result) {
    for (const cluster of result.clusters) {
      const sourceIds = new Set(cluster.findingIds);
      const members = result.findings.filter((item) => sourceIds.has(item.id));
      const diffKey = ["worsened", "new", "unbaselined", "unverified", "unchanged"]
        .find((status) => members.some((item) => item.diffStatus === status));
      const stableKeys = cluster.priority.sortKeys.filter((key) =>
        !["worsened", "new", "unbaselined", "unverified", "unchanged"].includes(key)
      );
      cluster.priority.sortKeys = [...(diffKey ? [diffKey] : []), ...stableKeys];
      cluster.priority.reasons = [
        ...(diffKey ? ["Baseline status: " + diffKey + "."] : []),
        ...cluster.priority.reasons.filter((reason) => !reason.startsWith("Baseline status: "))
      ];
    }
    result.clusters.sort(compareClusters);
  }

  function baselineCompatibility(result, baseline) {
    const reasons = [];
    if (baseline.schemaVersion !== result.schemaVersion) reasons.push("schema-version");
    if (baseline.analysisMode !== result.engine.analysisMode) reasons.push("analysis-mode");
    if (!sameArray(baseline.capabilities, result.engine.capabilities)) reasons.push("capabilities");
    if (baseline.scopePolicyDigest !== result.scopePolicyDigest) reasons.push("scope-policy");
    if ((baseline.profileDigest || null) !== (result.engine.profileDigest || null)) reasons.push("profile");
    if (!sameExternalTools(baseline.externalTools, result.engine.externalTools)) reasons.push("external-tools");
    return { ok: reasons.length === 0, reasons };
  }

  function isWorsened(current, previous) {
    if (rankIncreased(severityRank, current.severity, previous.severity)) return true;
    if (rankIncreased(evidenceRank, current.evidenceLevel, previous.evidenceLevel)) return true;
    if (rankIncreased(exposureRank, current.exposure, previous.exposure)) return true;
    if (rankIncreased(controlRank, current.controlState, previous.controlState)) return true;
    if (rankIncreased(applicabilityRank, current.applicability.status, previous.applicability)) return true;
    if (current.scope.journeys.some((id) => !previous.journeyIds.includes(id))) return true;
    return previous.effectiveDecision === "suppressed"
      && current.priority.effectiveDecision !== "suppressed";
  }

  function rankIncreased(ranks, current, previous) {
    return (ranks[current] ?? 0) > (ranks[previous] ?? 0);
  }

  function emptyDiff(baselineId, unbaselined) {
    return {
      baselineId,
      unbaselined: uniqueSorted(unbaselined || []),
      new: [],
      worsened: [],
      unchanged: [],
      resolved: [],
      unverified: []
    };
  }

  function buildAuditMarkdown(result) {
    const lines = [
      "# Frontend Audit: " + sanitizeLabel(result.project.rootLabel),
      "",
      "> This report uses static heuristics. Missing findings do not prove safety, quality, or deployment readiness.",
      "",
      "- Tool: " + result.toolVersion,
      "- Analysis mode: " + result.engine.analysisMode,
      "- Capabilities: " + (result.engine.capabilities.join(", ") || "none"),
      "- Files inspected: " + result.scope.includedFiles,
      "- Files excluded: " + result.scope.excludedFiles,
      "- Analysis completeness: " + (result.scope.partial ? "partial" : "complete within configured limits"),
      "- Diff: " + formatDiffCounts(result.diff),
      "",
      "## Priority Review Candidates",
      ""
    ];
    const candidates = result.clusters
      .filter((cluster) => ["act-now", "verify-first"].includes(cluster.priority.effectiveDecision))
      .sort(compareClusters)
      .slice(0, 3);
    if (!candidates.length) lines.push("No priority candidate was detected. Manual review remains required.", "");
    candidates.forEach((cluster, index) => {
      lines.push(
        (index + 1) + ". **" + sanitizeLabel(cluster.title) + "**",
        "   - Cluster ID: `" + cluster.id + "`",
        "   - Decision: " + cluster.priority.effectiveDecision,
        "   - Why it may matter: " + sanitizeLabel(cluster.whyRisky),
        "   - Possible impact: " + sanitizeLabel(cluster.possibleImpact),
        "   - Priority reasons: " + cluster.priority.reasons.map(sanitizeLabel).join(" / "),
        "   - Missing evidence: " + (cluster.priority.missingEvidence.map(sanitizeLabel).join(" / ") || "none"),
        "   - Cheapest next verification: " + sanitizeLabel(cluster.priority.verification),
        ""
      );
    });
    lines.push("## Findings", "");
    if (!result.findings.length) lines.push("No automated finding. Manual review remains required.", "");
    result.findings.forEach((item) => {
      lines.push(
        "- **[" + item.severity.toUpperCase() + "] " + sanitizeLabel(item.title) + "**",
        "  - Finding ID: `" + item.id + "`",
        "  - Detector: `" + item.detectorId + "@" + item.detectorVersion + "`",
        "  - Rules: " + (item.ruleRefs.map((id) => "`" + id + "`").join(", ") || "unmapped"),
        "  - Evidence level: " + item.evidenceLevel,
        "  - Applicability: " + item.applicability.status,
        "  - Diff status: " + item.diffStatus,
        "  - Decision: " + item.priority.decision,
        "  - Effective decision: " + item.priority.effectiveDecision,
        "  - Evidence: " + formatEvidence(item.evidence),
        "  - Limitation: " + sanitizeLabel(item.limitation),
        "  - Verification: " + sanitizeLabel(item.priority.verification),
        ""
      );
    });
    lines.push(
      "## Diagnostics",
      ""
    );
    if (!result.diagnostics.length) lines.push("No analyzer diagnostic.", "");
    result.diagnostics.forEach((item) => {
      lines.push("- **" + item.id + "**: " + sanitizeLabel(item.message), "");
    });
    return lines.join("\n");
  }

  function buildAuditSummary(result) {
    const diff = result.diff;
    return [
      "Frontend audit: " + result.project.rootLabel,
      "files " + result.scope.includedFiles + " inspected, " + result.scope.excludedFiles + " excluded",
      "findings " + result.findings.length,
      "new " + diff.new.length + ", worsened " + diff.worsened.length + ", unverified " + diff.unverified.length,
      "coverage " + (result.scope.partial ? "partial" : "complete within configured limits")
    ].join("\n");
  }

  function validateAuditResult(value) {
    const errors = [];
    if (!isObject(value)) return ["result must be an object"];
    if (value.schemaVersion !== AUDIT_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
    if (!nonEmpty(value.toolVersion)) errors.push("toolVersion is required");
    if (!validDateTime(value.generatedAt)) errors.push("generatedAt must be a date-time");
    if (!nonEmpty(value.scopePolicyDigest)) errors.push("scopePolicyDigest is required");
    if (!isObject(value.engine)) errors.push("engine is required");
    if (!isObject(value.project)) errors.push("project is required");
    if (!isObject(value.scope)) errors.push("scope is required");
    if (!Array.isArray(value.findings)) errors.push("findings must be an array");
    if (!Array.isArray(value.clusters)) errors.push("clusters must be an array");
    if (!isObject(value.diff)) errors.push("diff is required");
    if (!Array.isArray(value.diagnostics)) errors.push("diagnostics must be an array");
    if (errors.length) return errors;
    if (!["static-lite", "static", "deep"].includes(value.engine.analysisMode)) {
      errors.push("engine.analysisMode is invalid");
    }
    if (!Array.isArray(value.engine.capabilities)) errors.push("engine.capabilities must be an array");
    if (!nonEmpty(value.engine.detectorCatalogVersion)) errors.push("engine.detectorCatalogVersion is required");
    if (!Array.isArray(value.engine.externalTools)) errors.push("engine.externalTools must be an array");
    if (!["public", "mixed", "internal", "unknown"].includes(value.project.visibility)) {
      errors.push("project.visibility is invalid");
    }
    for (const key of ["selectedFiles", "includedFiles", "excludedFiles", "includedBytes"]) {
      if (!Number.isInteger(value.scope[key]) || value.scope[key] < 0) errors.push("scope." + key + " is invalid");
    }
    if (typeof value.scope.partial !== "boolean" || !Array.isArray(value.scope.partialReasons)) {
      errors.push("scope partial metadata is invalid");
    }

    const fingerprints = new Set();
    for (const item of value.findings) {
      if (!isObject(item)) {
        errors.push("finding must be an object");
        continue;
      }
      if (!item.id) errors.push("finding ID is required");
      if (!item.fingerprint || fingerprints.has(item.fingerprint)) errors.push("finding fingerprints must be unique");
      fingerprints.add(item.fingerprint);
      if (!item.detectorId || !item.detectorVersion) errors.push("finding detector metadata is required");
      if (!Object.hasOwn(severityRank, item.severity)) errors.push("finding severity is invalid");
      if (!Object.hasOwn(evidenceRank, item.evidenceLevel)) errors.push("finding evidenceLevel is invalid");
      if (!Object.hasOwn(exposureRank, item.exposure)) errors.push("finding exposure is invalid");
      if (!Object.hasOwn(controlRank, item.controlState)) errors.push("finding controlState is invalid");
      if (!Array.isArray(item.ruleRefs) || !Array.isArray(item.sourceRuleRefs)) {
        errors.push("finding rule references must be arrays");
      }
      if (!isObject(item.applicability)
        || !Object.hasOwn(applicabilityRank, item.applicability.status)) {
        errors.push("finding applicability is invalid");
      }
      if (!isObject(item.scope)
        || !Array.isArray(item.scope.paths)
        || !Array.isArray(item.scope.routes)
        || !Array.isArray(item.scope.journeys)) {
        errors.push("finding scope is invalid");
      }
      if (!isObject(item.priority) || !item.priority.decision || !item.priority.effectiveDecision) {
        errors.push("finding priority trace is required");
      } else if (
        !["act-now", "verify-first", "observe", "information-gap"].includes(item.priority.decision)
        || !["act-now", "verify-first", "observe", "information-gap", "suppressed"]
          .includes(item.priority.effectiveDecision)
      ) {
        errors.push("finding priority decision is invalid");
      }
    }
    for (const key of ["unbaselined", "new", "worsened", "unchanged", "resolved", "unverified"]) {
      if (!Array.isArray(value.diff[key])) errors.push("diff." + key + " must be an array");
    }
    return uniqueSorted(errors);
  }

  function validateBaseline(value) {
    const errors = [];
    if (!isObject(value)) return ["baseline must be an object"];
    if (value.schemaVersion !== AUDIT_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
    if (!nonEmpty(value.toolVersion)) errors.push("toolVersion is required");
    if (!validDateTime(value.createdAt)) errors.push("createdAt must be a date-time");
    if (!["static-lite", "static", "deep"].includes(value.analysisMode)) errors.push("analysisMode is invalid");
    if (!Array.isArray(value.capabilities)) errors.push("capabilities must be an array");
    if (!Array.isArray(value.externalTools)) errors.push("externalTools must be an array");
    if (!Array.isArray(value.findings)) errors.push("findings must be an array");
    if (typeof value.scopePolicyDigest !== "string") errors.push("scopePolicyDigest is required");
    if (!nonEmpty(value.detectorCatalogVersion)) errors.push("detectorCatalogVersion is required");
    if (typeof value.partial !== "boolean") errors.push("partial must be boolean");
    if (!Array.isArray(value.partialReasons)) errors.push("partialReasons must be an array");
    if (value.partial && !nonEmpty(value.partialReason)) errors.push("partialReason is required for partial baseline");
    if (errors.length) return errors;
    const fingerprints = new Set();
    for (const item of value.findings) {
      if (!isObject(item)) {
        errors.push("baseline finding must be an object");
        continue;
      }
      if (!item.fingerprint || !item.detectorId || !item.detectorVersion) {
        errors.push("baseline finding identity is incomplete");
      }
      if (fingerprints.has(item.fingerprint)) errors.push("baseline finding fingerprints must be unique");
      fingerprints.add(item.fingerprint);
      if (!Object.hasOwn(severityRank, item.severity)) errors.push("baseline finding severity is invalid");
      if (!Object.hasOwn(evidenceRank, item.evidenceLevel)) errors.push("baseline evidenceLevel is invalid");
      if (!Object.hasOwn(applicabilityRank, item.applicability)) errors.push("baseline applicability is invalid");
      if (!Object.hasOwn(exposureRank, item.exposure)) errors.push("baseline exposure is invalid");
      if (!Object.hasOwn(controlRank, item.controlState)) errors.push("baseline controlState is invalid");
      if (!Array.isArray(item.journeyIds)) errors.push("baseline journeyIds must be an array");
      if (!["act-now", "verify-first", "observe", "information-gap"].includes(item.decision)
        || !["act-now", "verify-first", "observe", "information-gap", "suppressed"]
          .includes(item.effectiveDecision)) {
        errors.push("baseline decision is invalid");
      }
    }
    return uniqueSorted(errors);
  }

  function validateProjectProfile(value) {
    const errors = [];
    if (value === null || value === undefined) return errors;
    if (!isObject(value)) return ["profile must be an object"];
    if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) errors.push("unsupported profile schemaVersion");
    const allowedTop = new Set([
      "schemaVersion", "project", "criticalJourneys", "routePolicies",
      "trustBoundaries", "controls", "suppressions", "ci"
    ]);
    for (const key of Object.keys(value)) {
      if (!allowedTop.has(key)) errors.push("unsupported profile field: " + key);
    }
    if (!isObject(value.project) || !nonEmpty(value.project.id)) {
      errors.push("project.id is required");
    }
    if (isObject(value.project)) {
      rejectUnknownFields(value.project, new Set(["id", "visibility"]), "project", errors);
    }
    if (value.project?.visibility && !["public", "mixed", "internal", "unknown"].includes(value.project.visibility)) {
      errors.push("project.visibility is invalid");
    }
    for (const key of ["criticalJourneys", "routePolicies", "trustBoundaries", "controls", "suppressions"]) {
      if (value[key] !== undefined && !Array.isArray(value[key])) errors.push(key + " must be an array");
    }
    validateIdentifiedEntries(
      value.criticalJourneys,
      "criticalJourneys",
      new Set(["id", "routes", "impact", "owners"]),
      (item) => {
        if (!nonEmptyArray(item.routes)) errors.push("critical journey routes are required");
        if (!["critical", "high", "medium", "low"].includes(item.impact)) {
          errors.push("critical journey impact is invalid");
        }
      },
      errors
    );
    const routePatterns = new Set();
    const routePolicies = [];
    for (const policy of value.routePolicies || []) {
      if (!isObject(policy)) {
        errors.push("route policy must be an object");
        continue;
      }
      rejectUnknownFields(policy, new Set(["pattern", "visibility", "indexing"]), "route policy", errors);
      if (!nonEmpty(policy.pattern) || !policy.pattern.startsWith("/")) {
        errors.push("route policy pattern must start with /");
      } else if (routePatterns.has(policy.pattern)) {
        errors.push("route policy patterns must be unique");
      }
      routePatterns.add(policy.pattern);
      if (!["public", "internal", "mixed"].includes(policy.visibility)) {
        errors.push("route policy visibility is invalid");
      }
      if (!["required", "not-applicable", "unknown"].includes(policy.indexing)) {
        errors.push("route policy indexing is invalid");
      }
      for (const previous of routePolicies) {
        const samePriority = routePatternSpecificity(previous.pattern)
          === routePatternSpecificity(policy.pattern);
        const conflicting = previous.visibility !== policy.visibility
          || previous.indexing !== policy.indexing;
        if (samePriority && conflicting && routePatternsMayOverlap(previous.pattern, policy.pattern)) {
          errors.push("overlapping route policies with equal specificity cannot conflict");
        }
      }
      routePolicies.push(policy);
    }
    validateIdentifiedEntries(
      value.trustBoundaries,
      "trustBoundaries",
      new Set(["id", "source", "paths", "requiredControls"]),
      (item) => {
        if (!nonEmpty(item.source)) errors.push("trust boundary source is required");
        if (!nonEmptyArray(item.paths)) errors.push("trust boundary paths are required");
        if (!nonEmptyArray(item.requiredControls)) errors.push("trust boundary requiredControls are required");
        validateRelativePatterns(item.paths, "trust boundary", errors);
      },
      errors
    );
    validateIdentifiedEntries(
      value.controls,
      "controls",
      new Set(["id", "area", "appliesTo", "verification"]),
      (item) => {
        if (!nonEmpty(item.area) || !nonEmpty(item.verification)) {
          errors.push("control area and verification are required");
        }
        if (item.appliesTo !== undefined && !nonEmptyArray(item.appliesTo)) {
          errors.push("control appliesTo must be a non-empty string array");
        }
      },
      errors
    );
    const controlIds = new Set((value.controls || []).filter(isObject).map((item) => item.id));
    for (const boundary of value.trustBoundaries || []) {
      for (const controlId of boundary.requiredControls || []) {
        if (!controlIds.has(controlId)) errors.push("trust boundary references unknown control: " + controlId);
      }
    }
    for (const suppression of value.suppressions || []) {
      if (!isObject(suppression)) {
        errors.push("suppression must be an object");
        continue;
      }
      rejectUnknownFields(
        suppression,
        new Set(["fingerprint", "ruleId", "detectorIds", "pathScope", "owner", "reason", "expires"]),
        "suppression",
        errors
      );
      if (!nonEmpty(suppression.owner) || !nonEmpty(suppression.reason) || !validDate(suppression.expires)) {
        errors.push("suppression owner, reason, and valid expires are required");
      }
      const fingerprintMode = nonEmpty(suppression.fingerprint);
      const ruleMode = nonEmpty(suppression.ruleId)
        && nonEmptyArray(suppression.detectorIds)
        && nonEmptyArray(suppression.pathScope);
      if (fingerprintMode === ruleMode) {
        errors.push("suppression must use fingerprint or scoped rule mode");
      }
      if (ruleMode) {
        validateScopePatterns(suppression.pathScope, "suppression", errors);
        const knownDetectorIds = new Set(Object.values(detectorCatalog).map((item) => item.id));
        for (const detectorId of suppression.detectorIds) {
          if (!knownDetectorIds.has(detectorId)) errors.push("suppression references unknown detector: " + detectorId);
        }
      }
    }
    if (value.ci !== undefined) {
      if (!isObject(value.ci)) {
        errors.push("ci must be an object");
      } else {
        rejectUnknownFields(value.ci, new Set(["mode", "failOn", "requireComplete"]), "ci", errors);
        if (!["report-only", "blocking"].includes(value.ci.mode || "report-only")) {
          errors.push("ci.mode is invalid");
        }
        if (value.ci.failOn !== undefined && !Array.isArray(value.ci.failOn)) {
          errors.push("ci.failOn must be an array");
        } else {
          for (const policy of value.ci.failOn || []) {
            if (!validFailPolicy(policy)) errors.push("ci.failOn policy is invalid");
          }
        }
        if (value.ci.requireComplete !== undefined && typeof value.ci.requireComplete !== "boolean") {
          errors.push("ci.requireComplete must be boolean");
        }
      }
    }
    return uniqueSorted(errors);
  }

  function validateIdentifiedEntries(entries, label, allowedFields, validate, errors) {
    const ids = new Set();
    for (const item of entries || []) {
      if (!isObject(item)) {
        errors.push(label + " entry must be an object");
        continue;
      }
      rejectUnknownFields(item, allowedFields, label + " entry", errors);
      if (!nonEmpty(item.id) || ids.has(item.id)) errors.push(label + " IDs must be non-empty and unique");
      ids.add(item.id);
      validate(item);
    }
  }

  function rejectUnknownFields(value, allowed, label, errors) {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) errors.push(label + " has unsupported field: " + key);
    }
  }

  function validateRelativePatterns(patterns, label, errors) {
    for (const pattern of patterns || []) {
      if (!nonEmpty(pattern) || pattern.startsWith("/") || pattern.split("/").includes("..")) {
        errors.push(label + " path patterns must be relative and cannot traverse parents");
      }
    }
  }

  function validateScopePatterns(patterns, label, errors) {
    for (const pattern of patterns || []) {
      if (!nonEmpty(pattern) || pattern.split("/").includes("..")) {
        errors.push(label + " scope patterns cannot be empty or traverse parents");
      }
    }
  }

  function routePatternsMayOverlap(a, b) {
    const aPrefix = String(a).split("*", 1)[0];
    const bPrefix = String(b).split("*", 1)[0];
    return aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix);
  }

  function validFailPolicy(value) {
    if (!nonEmpty(value)) return false;
    if (!value.includes(":")) return Boolean(detectorCatalog[value]);
    const [kind, ...rest] = value.split(":");
    const target = rest.join(":");
    if (kind === "finding") return Boolean(detectorCatalog[target]);
    if (kind === "severity") return Object.hasOwn(severityRank, target);
    if (kind === "decision") {
      return ["act-now", "verify-first", "observe", "information-gap"].includes(target);
    }
    return false;
  }

  function compareFindings(a, b) {
    return a.fingerprint.localeCompare(b.fingerprint);
  }

  function compareClusters(a, b) {
    const diffOrder = ["worsened", "new", "unbaselined", "unverified", "unchanged"];
    const aDiff = diffOrder.findIndex((key) => a.priority.sortKeys.includes(key));
    const bDiff = diffOrder.findIndex((key) => b.priority.sortKeys.includes(key));
    if (aDiff !== bDiff) return normalizedIndex(aDiff) - normalizedIndex(bDiff);
    const aJourney = a.priority.sortKeys.includes("material-journey") ? 0 : 1;
    const bJourney = b.priority.sortKeys.includes("material-journey") ? 0 : 1;
    if (aJourney !== bJourney) return aJourney - bJourney;
    const aMaterial = severityRank[a.severity] >= severityRank.high ? 0 : 1;
    const bMaterial = severityRank[b.severity] >= severityRank.high ? 0 : 1;
    return aMaterial - bMaterial || a.id.localeCompare(b.id);
  }

  function normalizedIndex(value) {
    return value === -1 ? Number.MAX_SAFE_INTEGER : value;
  }

  function normalizeExternalTools(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => ({
      name: sanitizeLabel(item.name),
      version: sanitizeLabel(item.version),
      rulesetDigest: sanitizeLabel(item.rulesetDigest)
    })).sort((a, b) => (a.name + a.version + a.rulesetDigest)
      .localeCompare(b.name + b.version + b.rulesetDigest));
  }

  function sameExternalTools(a, b) {
    return JSON.stringify(normalizeExternalTools(a)) === JSON.stringify(normalizeExternalTools(b));
  }

  function sameArray(a, b) {
    return JSON.stringify(uniqueSorted(a || [])) === JSON.stringify(uniqueSorted(b || []));
  }

  function formatEvidence(evidence) {
    if (!evidence.length) return "none";
    return evidence.map((item) => item.path || item.label || item.kind).join(", ");
  }

  function formatDiffCounts(diff) {
    return ["unbaselined", "new", "worsened", "unchanged", "resolved", "unverified"]
      .map((key) => key + " " + diff[key].length)
      .join(", ");
  }

  function looksLikePath(value) {
    return /[/.]/.test(value) && !/\s미발견$/.test(value);
  }

  function normalizeRelativePath(value) {
    return String(value).replace(/\\/g, "/").replace(/^\.?\//, "").replace(/[\r\n]+/g, " ");
  }

  function sanitizeLabel(value) {
    return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  }

  function sortObject(value) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  }

  function uniqueSorted(values) {
    return [...new Set((values || []).filter((value) => value !== undefined && value !== null))]
      .sort((a, b) => String(a).localeCompare(String(b)));
  }

  function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function nonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
  }

  function validDate(value) {
    if (!nonEmpty(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00.000Z");
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validDateTime(value) {
    return nonEmpty(value) && !Number.isNaN(new Date(value).getTime());
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const api = {
    AUDIT_SCHEMA_VERSION,
    DETECTOR_CATALOG_VERSION,
    PROFILE_SCHEMA_VERSION,
    TOOL_VERSION,
    buildAuditMarkdown,
    buildAuditSummary,
    compareWithBaseline,
    createAuditBundle,
    createBaseline,
    detectorCatalog,
    normalizeLegacyAudit,
    validateAuditResult,
    validateBaseline,
    validateProjectProfile
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.FrontendAuditContract = api;
  }
})();
