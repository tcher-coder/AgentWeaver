import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TaskRunnerError } from "../errors.js";
import { agentweaverConfigDir } from "../runtime/env-loader.js";
import { resolveBuiltInAutoFlowSpecByFileName } from "./auto-flow-resolver.js";
import { VIRTUAL_BUILT_IN_AUTO_FLOW_FILE_NAMES } from "./auto-flow-presets.js";
import type { DeclarativeFlowSpec } from "./spec-types.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BUILT_IN_FLOW_SPECS_DIR = path.join(MODULE_DIR, "flow-specs");

export type FlowSpecSource =
  | { source: "built-in"; fileName: string }
  | { source: "global"; filePath: string }
  | { source: "project-local"; filePath: string };

function parseFlowSpec(filePath: string): DeclarativeFlowSpec {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as DeclarativeFlowSpec;
  } catch (error) {
    throw new TaskRunnerError(`Failed to load flow spec ${filePath}: ${(error as Error).message}`);
  }
}

export function resolveBuiltInFlowSpecPath(fileName: string): string {
  return path.join(BUILT_IN_FLOW_SPECS_DIR, fileName);
}

export function projectFlowSpecsDir(cwd: string): string {
  return path.join(cwd, ".agentweaver", ".flows");
}

export function globalFlowSpecsDir(): string {
  return path.join(agentweaverConfigDir(), ".flows");
}

export function listBuiltInFlowSpecFiles(): string[] {
  const files = new Set<string>(VIRTUAL_BUILT_IN_AUTO_FLOW_FILE_NAMES);
  if (!existsSync(BUILT_IN_FLOW_SPECS_DIR)) {
    return [...files].sort((left, right) => left.localeCompare(right));
  }
  for (const filePath of collectJsonFilesRecursively(BUILT_IN_FLOW_SPECS_DIR)) {
    files.add(path.relative(BUILT_IN_FLOW_SPECS_DIR, filePath));
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function collectJsonFilesRecursively(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFilesRecursively(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}

export function listProjectFlowSpecFiles(cwd: string): string[] {
  const directory = projectFlowSpecsDir(cwd);
  if (!existsSync(directory)) {
    return [];
  }
  return collectJsonFilesRecursively(directory);
}

export function listGlobalFlowSpecFiles(): string[] {
  const directory = globalFlowSpecsDir();
  if (!existsSync(directory)) {
    return [];
  }
  return collectJsonFilesRecursively(directory);
}

export function loadFlowSpecSync(source: FlowSpecSource): DeclarativeFlowSpec {
  if (source.source === "built-in") {
    const resolvedAutoFlowSpec = resolveBuiltInAutoFlowSpecByFileName(source.fileName);
    if (resolvedAutoFlowSpec) {
      return resolvedAutoFlowSpec;
    }
  }
  return parseFlowSpec(source.source === "built-in" ? resolveBuiltInFlowSpecPath(source.fileName) : source.filePath);
}

export function loadBuiltInFlowSpecSync(fileName: string): DeclarativeFlowSpec {
  return loadFlowSpecSync({ source: "built-in", fileName });
}

export function loadProjectFlowSpecSync(filePath: string): DeclarativeFlowSpec {
  return loadFlowSpecSync({ source: "project-local", filePath });
}

export function loadGlobalFlowSpecSync(filePath: string): DeclarativeFlowSpec {
  return loadFlowSpecSync({ source: "global", filePath });
}
