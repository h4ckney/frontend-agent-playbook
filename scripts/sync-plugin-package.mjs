#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "frontend-agent-playbook");
const directorySources = ["playbooks", "rules", "skills", "templates"];
const fileSources = ["LICENSE", "scripts/guidance-approval.mjs"];
const checkOnly = process.argv.includes("--check");

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

function assertDirectoryMatches(source, target) {
  const sourceFiles = listFiles(source).map((file) => path.relative(source, file)).sort();
  const targetFiles = listFiles(target).map((file) => path.relative(target, file)).sort();
  if (JSON.stringify(sourceFiles) !== JSON.stringify(targetFiles)) {
    throw new Error("plugin package file list is stale: " + path.relative(root, target));
  }
  for (const relative of sourceFiles) {
    const sourceContent = fs.readFileSync(path.join(source, relative));
    const targetContent = fs.readFileSync(path.join(target, relative));
    if (!sourceContent.equals(targetContent)) {
      throw new Error("plugin package content is stale: " + path.join(path.relative(root, target), relative));
    }
  }
}

for (const relative of directorySources) {
  const source = path.join(root, relative);
  const target = path.join(pluginRoot, relative);
  if (checkOnly) {
    assertDirectoryMatches(source, target);
  } else {
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
  }
}

for (const relative of fileSources) {
  const source = path.join(root, relative);
  const target = path.join(pluginRoot, relative);
  if (checkOnly) {
    if (!fs.existsSync(target) || !fs.readFileSync(source).equals(fs.readFileSync(target))) {
      throw new Error("plugin package content is stale: " + path.relative(root, target));
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

console.log(checkOnly ? "Plugin package is synchronized." : "Plugin package synchronized.");
