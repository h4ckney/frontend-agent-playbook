#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ignoredDirectories = new Set(['.git', 'node_modules', 'plugins']);
const errors = [];

function relative(filePath) {
  return path.relative(root, filePath) || '.';
}

function collectMarkdownFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }

  return files;
}

function validateLocalLinks(filePath, content) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|data:|#)/.test(rawTarget)) {
      continue;
    }

    const targetWithoutFragment = rawTarget.split('#', 1)[0].split('?', 1)[0];
    if (!targetWithoutFragment) {
      continue;
    }

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(targetWithoutFragment);
    } catch {
      errors.push(`${relative(filePath)}: invalid encoded link ${rawTarget}`);
      continue;
    }

    const targetPath = path.resolve(path.dirname(filePath), decodedTarget);
    if (!fs.existsSync(targetPath)) {
      errors.push(`${relative(filePath)}: broken local link ${rawTarget}`);
    }
  }
}

function validateRule(filePath, content) {
  for (const heading of ['## Purpose', '## AI Agent Checklist']) {
    if (!content.includes(heading)) {
      errors.push(`${relative(filePath)}: missing required heading ${heading}`);
    }
  }

  validateRuleLevels(filePath, content);
}

function validateDetectorRuleLinks(ruleFiles) {
  const ruleIds = new Map();
  const ruleIdPattern = /^Rule ID: `([a-z0-9]+(?:[.-][a-z0-9]+)*)`$/gm;

  for (const filePath of ruleFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(ruleIdPattern)) {
      const existing = ruleIds.get(match[1]);
      if (existing) {
        errors.push(`${relative(filePath)}: duplicate rule ID ${match[1]} also declared in ${relative(existing)}`);
      } else {
        ruleIds.set(match[1], filePath);
      }
    }
  }

  const { detectorCatalog } = require(path.join(root, 'analysis', 'audit-contract.js'));
  const detectorIds = new Set();
  for (const [findingId, detector] of Object.entries(detectorCatalog)) {
    if (!detector.id || !detector.version) {
      errors.push(`analysis/audit-contract.js: detector metadata incomplete for ${findingId}`);
    }
    if (!Array.isArray(detector.capabilities) || detector.capabilities.length === 0) {
      errors.push(`analysis/audit-contract.js: detector capabilities missing for ${findingId}`);
    }
    const identity = `${detector.id}@${detector.version}`;
    if (detectorIds.has(identity)) {
      errors.push(`analysis/audit-contract.js: duplicate detector identity ${identity}`);
    }
    detectorIds.add(identity);
    for (const ruleId of detector.ruleRefs) {
      if (!ruleIds.has(ruleId)) {
        errors.push(`analysis/audit-contract.js: detector ${detector.id} references missing rule ID ${ruleId}`);
      }
    }
  }
}

function validateRuleLevels(filePath, content) {
  const exemptSections = new Set([
    'Purpose',
    'Source Priority',
    'References',
    'Requirement Levels',
    'Applicability Decisions',
    'AI Agent Checklist',
    'Examples',
    'App Router Examples',
    'Expansion Notes',
    'Review Model',
    'Feedback Format',
    'What Counts As A Candidate',
  ]);
  let section = '';
  let inFence = false;
  let inReportList = false;

  for (const [index, line] of content.split('\n').entries()) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.startsWith('## ')) {
      section = line.slice(3).trim();
      inReportList = false;
      continue;
    }
    if (!inFence && line === 'Report:') {
      inReportList = true;
      continue;
    }
    if (inReportList && (line === '' || line.startsWith('- '))) {
      continue;
    }
    inReportList = false;
    if (inFence || exemptSections.has(section) || !line.startsWith('- ')) {
      continue;
    }
    if (!/^- \*\*(?:MUST|SHOULD|MAY)\*\*: \S/.test(line)) {
      errors.push(`${relative(filePath)}:${index + 1}: actionable rule bullet must start with **MUST**, **SHOULD**, or **MAY**`);
    }
  }
}

function parseSimpleFrontmatter(filePath, content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    errors.push(`${relative(filePath)}: invalid or missing YAML frontmatter`);
    return null;
  }

  const values = new Map();
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      errors.push(`${relative(filePath)}: unsupported frontmatter line ${line}`);
      continue;
    }

    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  return values;
}

function validateSkill(filePath, content) {
  const frontmatter = parseSimpleFrontmatter(filePath, content);
  if (!frontmatter) {
    return;
  }

  const keys = [...frontmatter.keys()].sort();
  if (keys.join(',') !== 'description,name') {
    errors.push(`${relative(filePath)}: frontmatter must contain only name and description`);
  }

  const name = frontmatter.get('name') ?? '';
  const description = frontmatter.get('description') ?? '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    errors.push(`${relative(filePath)}: invalid skill name ${name}`);
  }
  if (!description || description.length > 1024 || /[<>]/.test(description)) {
    errors.push(`${relative(filePath)}: invalid skill description`);
  }

  const openaiYaml = path.join(path.dirname(filePath), 'agents', 'openai.yaml');
  if (!fs.existsSync(openaiYaml)) {
    errors.push(`${relative(filePath)}: missing agents/openai.yaml`);
    return;
  }

  const metadata = fs.readFileSync(openaiYaml, 'utf8');
  if (!metadata.includes(`$${name}`)) {
    errors.push(`${relative(openaiYaml)}: default prompt must reference $${name}`);
  }

  if (name === 'audit-frontend-rules') {
    const reportOrder = '## Urgent Recommendations\n## Guidance Proposals\n## Issue Drafts\n## Proposed Changes\n```';
    if (!content.includes(reportOrder)) {
      errors.push(`${relative(filePath)}: audit report headings are missing or out of order`);
    }
  }
}

function validateDecisionTemplate(filePath, content) {
  const requiredHeadings = [
    '## Metadata',
    '## Codebase Context',
    '## Selected Guidance',
    '## Rule Decisions',
    '## Project Exceptions',
    '## Guidance Proposal Decisions',
    '## Urgent Recommendation Decisions',
    '## Information Gaps',
    '## Revalidation Triggers',
    '## Maintenance Rules',
  ];

  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) {
      errors.push(`${relative(filePath)}: missing required heading ${heading}`);
    }
  }

  for (const decision of ['Keep', 'Conditional', 'Disable', 'Removal candidate']) {
    if (!content.includes(`**${decision}**`)) {
      errors.push(`${relative(filePath)}: missing allowed decision ${decision}`);
    }
  }

  if (!content.includes('.frontend-rules-decisions.md')) {
    errors.push(`${relative(filePath)}: missing destination filename`);
  }
}

function validateRequiredHeadings(filePath, content, headings) {
  for (const heading of headings) {
    if (!content.includes(heading)) {
      errors.push(`${relative(filePath)}: missing required heading ${heading}`);
    }
  }
}

function validateGuidanceProposalTemplate(filePath, content) {
  validateRequiredHeadings(filePath, content, [
    '## Proposal Identity',
    '## Evidence',
    '## Existing Coverage',
    '## Proposed Artifact',
    '## Proportionality Check',
    '## Validation',
    '## Decision',
    '## Safety Rules',
  ]);

  for (const field of ['Source finding IDs:', 'Exact target files:', 'Proposed artifact fingerprint:', 'Approved target files:', 'Approved artifact fingerprint:']) {
    if (!content.includes(field)) {
      errors.push(`${relative(filePath)}: missing proposal field ${field}`);
    }
  }

  for (const decision of ['Approve', 'Revise', 'Defer', 'Reject']) {
    if (!content.includes(decision)) {
      errors.push(`${relative(filePath)}: missing proposal decision ${decision}`);
    }
  }
}

function validateAuditIssueTemplate(filePath, content) {
  validateRequiredHeadings(filePath, content, [
    '## Draft Identity',
    '## Title',
    '## Problem And Impact',
    '## Evidence',
    '## Scope',
    '## Out Of Scope',
    '## Proposed Approach',
    '## Acceptance Criteria',
    '## Verification',
    '## Dependencies And Blockers',
    '## Publication Decision',
  ]);

  if (!content.includes('Source proposal IDs and finding IDs:')) {
    errors.push(`${relative(filePath)}: missing source ID field`);
  }
}

function validateProductionFeatureExample(filePath, content) {
  validateRequiredHeadings(filePath, content, ['## Audit Handoff', '## Guidance Decision', '## Implementation Shape', '## UI State Contract', '## Test Matrix', '## Approval Gate Example', '## Verification']);
}

function validateAdoptionForwardTest(filePath, content) {
  validateRequiredHeadings(filePath, content, [
    '## Case 1: Pages Router With No New Artifact',
    '## Case 2: App Router Project Rule',
    '## Case 3: Mixed Router Project Skill',
    '## Outcome Matrix',
    '## Rejected Over-Engineering',
    '## Verification',
  ]);
}

const markdownFiles = collectMarkdownFiles(root);
const ruleFiles = markdownFiles.filter((filePath) => path.dirname(filePath) === path.join(root, 'rules'));

for (const filePath of markdownFiles) {
  const content = fs.readFileSync(filePath, 'utf8');

  if (!content.endsWith('\n')) {
    errors.push(`${relative(filePath)}: missing final newline`);
  }
  if (/\[TODO|TODO:/i.test(content)) {
    errors.push(`${relative(filePath)}: unresolved TODO marker`);
  }

  validateLocalLinks(filePath, content);

  if (path.dirname(filePath) === path.join(root, 'rules')) {
    validateRule(filePath, content);
  }
  if (filePath.endsWith(`${path.sep}SKILL.md`)) {
    validateSkill(filePath, content);
  }
  if (filePath === path.join(root, 'templates', 'frontend-rules-decisions.md')) {
    validateDecisionTemplate(filePath, content);
  }
  if (filePath === path.join(root, 'templates', 'guidance-proposal.md')) {
    validateGuidanceProposalTemplate(filePath, content);
  }
  if (filePath === path.join(root, 'templates', 'audit-issue.md')) {
    validateAuditIssueTemplate(filePath, content);
  }
  if (filePath === path.join(root, 'examples', 'adoption', 'forward-test.md')) {
    validateAdoptionForwardTest(filePath, content);
  }
  if (filePath === path.join(root, 'examples', 'production-application', 'feature-workflow.md')) {
    validateProductionFeatureExample(filePath, content);
  }
}

validateDetectorRuleLinks(ruleFiles);

if (errors.length > 0) {
  console.error(`Documentation validation failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Documentation validation passed for ${markdownFiles.length} Markdown files.`);
}
