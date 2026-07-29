#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WRITABLE_STATUSES = new Set(["Approved", "Applied"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function sortedUnique(values = []) {
  return [...new Set(values)].sort();
}

function sameValues(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function block(reasons) {
  return { allowed: false, action: "block", reasons };
}

export function evaluateGuidanceApplication({ approval, request, existingArtifacts = [] }) {
  const reasons = [];

  if (!approval || !request) {
    return block(["approval and request are required"]);
  }
  if (!WRITABLE_STATUSES.has(approval.status)) {
    reasons.push(`status ${approval.status || "missing"} is not writable`);
  }
  if (approval.repository !== request.repository) {
    reasons.push("target repository does not match approval");
  }
  if (approval.proposalId !== request.proposalId) {
    reasons.push("proposal ID does not match approval");
  }
  if (approval.type !== request.type) {
    reasons.push("artifact type does not match approval");
  }
  if (approval.scope !== request.scope) {
    reasons.push("material scope does not match approval");
  }
  if (approval.behavior !== request.behavior) {
    reasons.push("intended behavior does not match approval");
  }
  if (!sameValues(approval.targetFiles, request.targetFiles)) {
    reasons.push("target files differ from approved paths");
  }
  if (!sameValues(approval.dependencies, request.dependencies)) {
    reasons.push("dependency changes differ from approval");
  }
  if (!sameValues(approval.enforcement, request.enforcement)) {
    reasons.push("enforcement changes differ from approval");
  }
  if (approval.artifactFingerprint !== request.fingerprint) {
    reasons.push("artifact content fingerprint does not match approval");
  }
  if (reasons.length) {
    return block(reasons);
  }

  const targets = sortedUnique(request.targetFiles);
  if (!SHA256_PATTERN.test(approval.artifactFingerprint || "") || !SHA256_PATTERN.test(request.fingerprint || "")) {
    return block(["approval and request require sha256:<64 lowercase hex characters> fingerprints"]);
  }
  if (!targets.length) {
    return block(["file-level approval is required before writing"]);
  }

  const relevant = existingArtifacts.filter((artifact) => targets.includes(artifact.path));
  const misplaced = existingArtifacts.filter((artifact) =>
    artifact.proposalId === request.proposalId && !targets.includes(artifact.path)
  );
  if (misplaced.length) {
    return block(misplaced.map((artifact) => `proposal already exists at unapproved path ${artifact.path}`));
  }
  const conflicting = relevant.filter((artifact) =>
    artifact.proposalId !== request.proposalId
    || artifact.fingerprint !== request.fingerprint
  );
  if (conflicting.length) {
    return block(conflicting.map((artifact) => `approved target conflicts with ${artifact.path}`));
  }

  const completed = new Set(relevant.map((artifact) => artifact.path));
  if (targets.every((target) => completed.has(target))) {
    return {
      allowed: true,
      action: "noop",
      reasons: ["approved artifacts already match; do not create duplicates"]
    };
  }

  return {
    allowed: true,
    action: "apply",
    reasons: [],
    targetFiles: targets.filter((target) => !completed.has(target))
  };
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/guidance-approval.mjs <approval-request.json>");
    process.exitCode = 2;
    return;
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const input = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const result = evaluateGuidanceApplication(input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.allowed) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
