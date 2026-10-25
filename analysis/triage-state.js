(function () {
  "use strict";

  // Local review decisions only. Never use this document as a baseline,
  // suppression profile, verified resolution, or permission to change code.
  const SCHEMA_VERSION = "1";
  const MAX_DECISIONS = 2000;
  const MAX_DOCUMENT_BYTES = 2000000;
  const actions = new Set(["close", "request-verification", "reopen"]);
  const dispositions = new Set(["false-positive", "accepted-risk"]);
  const reservedKeys = new Set(["__proto__", "prototype", "constructor"]);

  function createDocument(projectKey) {
    requireProjectKey(projectKey);
    return { schemaVersion: SCHEMA_VERSION, projectKey, decisions: {} };
  }

  function validateDocument(value, expectedProjectKey) {
    const errors = [];
    if (!plainObject(value)) return ["triage document must be an object"];
    if (!exactKeys(value, ["schemaVersion", "projectKey", "decisions"])) {
      errors.push("triage document fields are invalid");
    }
    if (value.schemaVersion !== SCHEMA_VERSION) errors.push("unsupported triage schemaVersion");
    if (!validText(value.projectKey, 512)) errors.push("projectKey is required");
    if (expectedProjectKey !== undefined && value.projectKey !== expectedProjectKey) {
      errors.push("triage projectKey does not match the current project");
    }
    if (!plainObject(value.decisions)) return [...errors, "decisions must be an object"];
    const entries = Object.entries(value.decisions);
    if (entries.length > MAX_DECISIONS) errors.push("too many triage decisions");
    for (const [fingerprint, decision] of entries) {
      if (!validFingerprint(fingerprint)) errors.push("invalid finding fingerprint");
      errors.push(...validateDecision(decision));
    }
    try {
      if (utf8Length(JSON.stringify(value)) > MAX_DOCUMENT_BYTES) errors.push("triage document exceeds size limit");
    } catch {
      errors.push("triage document must be serializable");
    }
    return [...new Set(errors)];
  }

  function setDecision(document, finding, input, nowValue = new Date().toISOString()) {
    requireDocument(document);
    requireFinding(finding);
    if (!plainObject(input) || !exactKeys(input, ["action", "reason", "disposition", "expires"], ["action"])) {
      throw new Error("decision input fields are invalid");
    }
    if (!actions.has(input.action)) throw new Error("unsupported triage action");
    const now = parseDateTime(nowValue);
    if (!Number.isFinite(now)) throw new Error("now must be a valid ISO date or timestamp");
    const reason = input.reason === undefined ? "" : input.reason;
    if (typeof reason !== "string" || reason.trim().length > 1000) {
      throw new Error("decision reason must be at most 1000 characters");
    }
    const isClose = input.action === "close";
    if (isClose && (!reason.trim() || !dispositions.has(input.disposition))) {
      throw new Error("closing requires a reason and false-positive or accepted-risk disposition");
    }
    if (isClose && !(parseDateTime(input.expires) > now)) {
      throw new Error("closing requires a future ISO expiry date or timestamp");
    }
    if (!isClose && (input.expires != null || input.disposition != null)) {
      throw new Error("expiry and disposition apply only to a close decision");
    }
    const next = {
      schemaVersion: SCHEMA_VERSION,
      projectKey: document.projectKey,
      decisions: Object.fromEntries(Object.entries(document.decisions).map(([key, value]) => [key, { ...value }]))
    };
    next.decisions[finding.fingerprint] = {
      action: input.action,
      reason: reason.trim(),
      disposition: isClose ? input.disposition : null,
      expires: isClose ? input.expires : null,
      updatedAt: new Date(now).toISOString(),
      signature: findingSignature(finding)
    };
    requireDocument(next);
    return next;
  }

  function getDecision(document, finding, nowValue = new Date().toISOString()) {
    requireFinding(finding);
    // Full import validation belongs at the persistence boundary. Validate the
    // root and selected entry here without walking the whole document per row.
    if (!plainObject(document) || document.schemaVersion !== SCHEMA_VERSION
      || !validText(document.projectKey, 512) || !plainObject(document.decisions)) {
      throw new Error("invalid triage document");
    }
    const now = parseDateTime(nowValue);
    if (!Number.isFinite(now)) throw new Error("now must be a valid ISO date or timestamp");
    const decision = Object.hasOwn(document.decisions, finding.fingerprint)
      ? document.decisions[finding.fingerprint] : null;
    if (!decision) return { state: "open", statusReason: "none", decision: null };
    const errors = validateDecision(decision);
    if (errors.length) throw new Error(errors.join("; "));
    const copy = { ...decision };
    if (decision.signature !== findingSignature(finding)) {
      return { state: "open", statusReason: "changed", decision: copy };
    }
    if (decision.action === "close" && parseDateTime(decision.expires) <= now) {
      return { state: "open", statusReason: "expired", decision: copy };
    }
    if (decision.action === "close") return { state: "closed", statusReason: "active", decision: copy };
    if (decision.action === "request-verification") {
      return { state: "verification-requested", statusReason: "active", decision: copy };
    }
    return { state: "open", statusReason: "reopened", decision: copy };
  }

  function findingSignature(finding) {
    requireFinding(finding);
    // No source snippets or report prose are retained. A non-cryptographic
    // change detector is sufficient here: this state never authorizes writes
    // or changes a scanner/CI verdict.
    const metadata = stableStringify({
      id: finding.id,
      reviewContextDigest: finding.reviewContextDigest || null,
      detectorId: finding.detectorId,
      detectorVersion: finding.detectorVersion,
      ruleRefs: sortedStrings(finding.ruleRefs),
      severity: finding.severity,
      evidenceLevel: finding.evidenceLevel,
      exposure: finding.exposure,
      controlState: finding.controlState,
      applicability: finding.applicability?.status,
      scope: {
        paths: sortedStrings(finding.scope?.paths),
        routes: sortedStrings(finding.scope?.routes),
        journeys: sortedStrings(finding.scope?.journeys),
        boundaryIds: sortedStrings(finding.scope?.boundaryIds)
      },
      occurrenceCount: finding.occurrenceCount,
      evidence: (finding.evidence || []).map((entry) => ({
        kind: entry.kind, path: entry.path, symbol: entry.symbol
      })).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
      flow: {
        status: finding.flow?.status,
        sources: sortedStrings(finding.flow?.sources),
        controls: sortedStrings(finding.flow?.controls),
        transforms: sortedStrings(finding.flow?.transforms),
        sinks: sortedStrings(finding.flow?.sinks)
      }
    });
    if (metadata.length > 100000) throw new Error("finding metadata exceeds size limit");
    let hash = 14695981039346656037n;
    for (let index = 0; index < metadata.length; index += 1) {
      hash ^= BigInt(metadata.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 1099511628211n);
    }
    return "metadata-v1:" + hash.toString(16).padStart(16, "0");
  }

  function groupFindings(findings) {
    if (!Array.isArray(findings)) throw new Error("findings must be an array");
    const groups = new Map();
    const seen = new Set();
    for (const finding of findings) {
      requireFinding(finding);
      if (seen.has(finding.fingerprint)) continue;
      seen.add(finding.fingerprint);
      const family = validText(finding.clusterId, 2000) ? finding.clusterId : finding.id;
      if (!validText(family, 2000)) throw new Error("finding clusterId or id is required for grouping");
      // Optional explicit boundary IDs must come from approved project context.
      // Existing static-lite findings do not supply them. Directory fallback is
      // a presentation group, never a claim of a proven common root cause.
      const boundaries = sortedStrings(finding.scope?.boundaryIds);
      const directories = sortedStrings(finding.scope?.paths).map((path) => {
        const relative = path.replace(/\\/g, "/");
        return relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : ".";
      });
      const scope = boundaries.length ? ["boundary", ...boundaries]
        : directories.length ? ["directory", ...[...new Set(directories)].sort()]
          : ["repository"];
      const id = JSON.stringify([family, scope]);
      if (!groups.has(id)) groups.set(id, { id, findings: [] });
      groups.get(id).findings.push(finding);
    }
    return [...groups.values()].map((group) => ({
      id: group.id,
      findings: group.findings.slice().sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
    })).sort((a, b) => a.id.localeCompare(b.id));
  }

  function validateDecision(value) {
    const errors = [];
    if (!plainObject(value)) return ["decision must be an object"];
    if (!exactKeys(value, ["action", "reason", "disposition", "expires", "updatedAt", "signature"])) {
      errors.push("decision fields are invalid");
    }
    if (!actions.has(value.action)) errors.push("unsupported triage action");
    if (typeof value.reason !== "string" || value.reason.length > 1000) errors.push("decision reason is invalid");
    if (!validTimestamp(value.updatedAt)) errors.push("decision updatedAt is invalid");
    if (typeof value.signature !== "string" || !/^metadata-v1:[0-9a-f]{16}$/.test(value.signature)) {
      errors.push("decision signature is invalid");
    }
    if (value.action === "close") {
      if (!validText(value.reason, 1000) || !dispositions.has(value.disposition)) {
        errors.push("closing requires a reason and disposition");
      }
      if (!(parseDateTime(value.expires) > parseDateTime(value.updatedAt))) {
        errors.push("closing expiry must follow the decision time");
      }
    } else if (value.expires !== null || value.disposition !== null) {
      errors.push("expiry and disposition apply only to a close decision");
    }
    return errors;
  }

  function requireDocument(value) {
    const errors = validateDocument(value);
    if (errors.length) throw new Error(errors.join("; "));
  }

  function requireProjectKey(value) {
    if (!validText(value, 512)) throw new Error("projectKey must be a non-empty string of at most 512 characters");
  }

  function requireFinding(value) {
    if (!plainObject(value) || !validFingerprint(value.fingerprint)) throw new Error("valid finding fingerprint is required");
    if (value.reviewContextDigest != null && !validText(value.reviewContextDigest, 200)) {
      throw new Error("reviewContextDigest must be a non-empty digest string");
    }
  }

  function validFingerprint(value) {
    return validText(value, 2000) && !reservedKeys.has(value);
  }

  function plainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  }

  function validText(value, max) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= max;
  }

  function exactKeys(value, allowed, required = allowed) {
    return required.every((key) => Object.hasOwn(value, key))
      && Object.keys(value).every((key) => allowed.includes(key));
  }

  function parseDateTime(value) {
    if (typeof value !== "string") return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = Date.parse(value + "T00:00:00.000Z");
      return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return NaN;
    return new Date(parsed).toISOString().replace(/\.000Z$/, "Z") === value.replace(/\.000Z$/, "Z") ? parsed : NaN;
  }

  function validTimestamp(value) {
    return typeof value === "string" && value.includes("T") && Number.isFinite(parseDateTime(value));
  }

  function sortedStrings(values) {
    return Array.isArray(values) ? [...new Set(values.filter((value) => typeof value === "string"))].sort() : [];
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    if (plainObject(value)) {
      return "{" + Object.keys(value).filter((key) => value[key] !== undefined).sort()
        .map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
    }
    return JSON.stringify(value) || "null";
  }

  function utf8Length(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff
        && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
      if (bytes > MAX_DOCUMENT_BYTES) return bytes;
    }
    return bytes;
  }

  const api = Object.freeze({
    SCHEMA_VERSION, MAX_DECISIONS, MAX_DOCUMENT_BYTES,
    createDocument, validateDocument, setDecision, getDecision, findingSignature, groupFindings
  });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.FrontendTriage = api;
}());
