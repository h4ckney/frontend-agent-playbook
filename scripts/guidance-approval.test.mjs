import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateGuidanceApplication } from "./guidance-approval.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const approvedFingerprint = "sha256:" + "a".repeat(64);

const approval = {
  repository: "h4ckney/example",
  proposalId: "guidance-checkout-001",
  status: "Approved",
  type: "Project rule",
  scope: "checkout mutation flow",
  behavior: "Require schema validation and rollback verification.",
  targetFiles: [".agents/rules/checkout-mutations.md"],
  dependencies: [],
  enforcement: [],
  artifactFingerprint: approvedFingerprint
};

const request = {
  repository: approval.repository,
  proposalId: approval.proposalId,
  type: approval.type,
  scope: approval.scope,
  behavior: approval.behavior,
  targetFiles: [...approval.targetFiles],
  dependencies: [],
  enforcement: [],
  fingerprint: approvedFingerprint
};

test("blocks a proposal that is not explicitly approved", () => {
  const result = evaluateGuidanceApplication({
    approval: { ...approval, status: "Proposed" },
    request
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons[0], /not writable/);
});

test("blocks deferred and rejected proposals", () => {
  for (const status of ["Deferred", "Rejected"]) {
    const result = evaluateGuidanceApplication({
      approval: { ...approval, status },
      request
    });
    assert.equal(result.allowed, false);
  }
});

test("blocks path drift after approval", () => {
  const result = evaluateGuidanceApplication({
    approval,
    request: { ...request, targetFiles: [".agents/rules/all-frontend.md"] }
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes("target files differ from approved paths"));
});

test("blocks scope, dependency, and enforcement drift", () => {
  const result = evaluateGuidanceApplication({
    approval,
    request: {
      ...request,
      scope: "all mutations",
      dependencies: ["zod"],
      enforcement: ["new CI gate"],
      fingerprint: "sha256:" + "b".repeat(64)
    }
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes("material scope does not match approval"));
  assert.ok(result.reasons.includes("dependency changes differ from approval"));
  assert.ok(result.reasons.includes("enforcement changes differ from approval"));
  assert.ok(result.reasons.includes("artifact content fingerprint does not match approval"));
});

test("allows only missing approved targets", () => {
  const result = evaluateGuidanceApplication({ approval, request });

  assert.deepEqual(result, {
    allowed: true,
    action: "apply",
    reasons: [],
    targetFiles: [".agents/rules/checkout-mutations.md"]
  });
});

test("returns noop when an approved artifact already matches", () => {
  const result = evaluateGuidanceApplication({
    approval: { ...approval, status: "Applied" },
    request,
    existingArtifacts: [{
      path: ".agents/rules/checkout-mutations.md",
      proposalId: approval.proposalId,
      fingerprint: request.fingerprint
    }]
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, "noop");
  assert.match(result.reasons[0], /do not create duplicates/);
});

test("blocks a duplicate proposal at an unapproved path", () => {
  const result = evaluateGuidanceApplication({
    approval,
    request,
    existingArtifacts: [{
      path: ".agents/rules/duplicate-checkout.md",
      proposalId: approval.proposalId,
      fingerprint: request.fingerprint
    }]
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons[0], /unapproved path/);
});

test("blocks overwrite when an approved target conflicts", () => {
  const result = evaluateGuidanceApplication({
    approval,
    request,
    existingArtifacts: [{
      path: ".agents/rules/checkout-mutations.md",
      proposalId: "another-proposal",
      fingerprint: "sha256:" + "c".repeat(64)
    }]
  });

  assert.equal(result.allowed, false);
  assert.match(result.reasons[0], /conflicts/);
});

test("example approval fingerprints match the checked-in artifact", () => {
  const artifactPath = path.join(
    root,
    "examples/production-application/fixtures/.agents/rules/application-submission.md"
  );
  const firstRun = JSON.parse(fs.readFileSync(
    path.join(root, "examples/production-application/approval-request.json"),
    "utf8"
  ));
  const rerun = JSON.parse(fs.readFileSync(
    path.join(root, "examples/production-application/approval-rerun.json"),
    "utf8"
  ));
  const actual = "sha256:" + crypto.createHash("sha256")
    .update(fs.readFileSync(artifactPath))
    .digest("hex");

  assert.equal(firstRun.approval.artifactFingerprint, actual);
  assert.equal(firstRun.request.fingerprint, actual);
  assert.equal(rerun.approval.artifactFingerprint, actual);
  assert.equal(rerun.request.fingerprint, actual);
  assert.equal(rerun.existingArtifacts[0].fingerprint, actual);
  assert.equal(evaluateGuidanceApplication(firstRun).action, "apply");
  assert.equal(evaluateGuidanceApplication(rerun).action, "noop");
});
