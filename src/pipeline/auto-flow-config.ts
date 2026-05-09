import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import YAML from "yaml";

import { TaskRunnerError } from "../errors.js";
import { agentweaverConfigDir } from "../runtime/env-loader.js";

export const AUTO_FLOW_PRESETS = ["simple", "standard"] as const;
export type AutoFlowPresetName = (typeof AUTO_FLOW_PRESETS)[number];

export const AUTO_FLOW_SLOT_NAMES = [
  "designReview",
  "postImplementationChecks",
  "review",
  "final",
] as const;
export type AutoFlowSlotName = (typeof AUTO_FLOW_SLOT_NAMES)[number];

export const AUTO_FLOW_BLOCK_IDS = [
  "review.design-loop",
  "checks.go.linter",
  "checks.go.tests",
  "review.loop",
] as const;
export type AutoFlowBlockId = (typeof AUTO_FLOW_BLOCK_IDS)[number];

export type AutoFlowBlockEnabled = true | false | "auto";

export type SavedAutoFlowBlock = {
  id: AutoFlowBlockId;
  enabled?: AutoFlowBlockEnabled;
  maxIterations?: number;
};

export type SavedAutoFlowSlot = {
  blocks: SavedAutoFlowBlock[];
};

export type SavedAutoFlowConfig = {
  kind: "auto-flow-config";
  version: 1;
  name: string;
  basePreset: AutoFlowPresetName;
  slots?: Partial<Record<AutoFlowSlotName, SavedAutoFlowSlot>>;
};

export type AutoFlowConfigLocation = "project" | "user";

export type AutoFlowConfigSource = {
  type: AutoFlowConfigLocation;
  path: string;
  shadowedUserPath?: string;
};

export type LoadedAutoFlowConfig = {
  config: SavedAutoFlowConfig;
  rawYaml: string;
  normalizedYaml: string;
  source: AutoFlowConfigSource;
};

const SLOT_BLOCKS: Record<AutoFlowSlotName, readonly AutoFlowBlockId[]> = {
  designReview: ["review.design-loop"],
  postImplementationChecks: ["checks.go.linter", "checks.go.tests"],
  review: ["review.loop"],
  final: ["checks.go.linter", "checks.go.tests"],
};

const ITERATIVE_BLOCKS = new Set<AutoFlowBlockId>([
  "review.design-loop",
  "checks.go.linter",
  "checks.go.tests",
  "review.loop",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatConfigError(configName: string, configPath: string | undefined, issue: string): TaskRunnerError {
  const location = configPath ? ` at ${configPath}` : "";
  return new TaskRunnerError(`Auto flow config '${configName}'${location}: ${issue}`);
}

function assertConfig(
  condition: boolean,
  configName: string,
  configPath: string | undefined,
  issue: string,
): asserts condition {
  if (!condition) {
    throw formatConfigError(configName, configPath, issue);
  }
}

function validateConfigNameForPath(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new TaskRunnerError(
      `Auto flow config name '${name}' is invalid. Use only letters, numbers, dots, underscores, and dashes.`,
    );
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  configName: string,
  configPath: string | undefined,
  objectPath: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    assertConfig(allowedSet.has(key), configName, configPath, `unsupported key '${key}' at ${objectPath}`);
  }
}

function isPreset(value: unknown): value is AutoFlowPresetName {
  return typeof value === "string" && (AUTO_FLOW_PRESETS as readonly string[]).includes(value);
}

function isSlotName(value: string): value is AutoFlowSlotName {
  return (AUTO_FLOW_SLOT_NAMES as readonly string[]).includes(value);
}

function isBlockId(value: unknown): value is AutoFlowBlockId {
  return typeof value === "string" && (AUTO_FLOW_BLOCK_IDS as readonly string[]).includes(value);
}

function isEnabled(value: unknown): value is AutoFlowBlockEnabled {
  return value === true || value === false || value === "auto";
}

function validateBlock(
  rawBlock: unknown,
  slotName: AutoFlowSlotName,
  index: number,
  configName: string,
  configPath: string | undefined,
): SavedAutoFlowBlock {
  const objectPath = `slots.${slotName}.blocks[${index}]`;
  assertConfig(isRecord(rawBlock), configName, configPath, `${objectPath} must be an object`);
  assertOnlyKeys(rawBlock, ["id", "enabled", "maxIterations"], configName, configPath, objectPath);
  const blockId = rawBlock["id"];
  assertConfig(isBlockId(blockId), configName, configPath, `${objectPath}.id must be a known block id`);
  assertConfig(
    SLOT_BLOCKS[slotName].includes(blockId),
    configName,
    configPath,
    `${objectPath}.id '${blockId}' is not supported in slot '${slotName}'`,
  );
  const enabled = rawBlock["enabled"];
  assertConfig(
    enabled === undefined || isEnabled(enabled),
    configName,
    configPath,
    `${objectPath}.enabled must be true, false, or auto`,
  );
  const maxIterations = rawBlock["maxIterations"];
  assertConfig(
    maxIterations === undefined || (Number.isInteger(maxIterations) && Number(maxIterations) > 0),
    configName,
    configPath,
    `${objectPath}.maxIterations must be a positive integer`,
  );
  assertConfig(
    maxIterations === undefined || ITERATIVE_BLOCKS.has(blockId),
    configName,
    configPath,
    `${objectPath}.maxIterations is not supported by block '${blockId}'`,
  );

  return {
    id: blockId,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(maxIterations !== undefined ? { maxIterations: Number(maxIterations) } : {}),
  };
}

export function validateAutoFlowConfigValue(
  value: unknown,
  requestedName: string,
  configPath?: string,
): SavedAutoFlowConfig {
  const configNameForErrors = isRecord(value) && typeof value["name"] === "string" && value["name"].trim()
    ? value["name"].trim()
    : requestedName;
  assertConfig(isRecord(value), configNameForErrors, configPath, "config root must be an object");
  assertOnlyKeys(value, ["kind", "version", "name", "basePreset", "slots"], configNameForErrors, configPath, "root");

  assertConfig(value["kind"] === "auto-flow-config", configNameForErrors, configPath, "kind must be 'auto-flow-config'");
  assertConfig(value["version"] === 1, configNameForErrors, configPath, "version must be 1");
  assertConfig(typeof value["name"] === "string" && value["name"].trim().length > 0, configNameForErrors, configPath, "name must be a non-empty string");
  const name = String(value["name"]).trim();
  assertConfig(name === requestedName, name, configPath, `name must match requested config name '${requestedName}'`);
  assertConfig(isPreset(value["basePreset"]), name, configPath, "basePreset must be simple or standard");

  let slots: SavedAutoFlowConfig["slots"];
  const rawSlots = value["slots"];
  if (rawSlots !== undefined) {
    assertConfig(isRecord(rawSlots), name, configPath, "slots must be an object");
    slots = {};
    for (const [slotName, rawSlot] of Object.entries(rawSlots)) {
      assertConfig(isSlotName(slotName), name, configPath, `unknown slot '${slotName}'`);
      assertConfig(isRecord(rawSlot), name, configPath, `slots.${slotName} must be an object`);
      assertOnlyKeys(rawSlot, ["blocks"], name, configPath, `slots.${slotName}`);
      const rawBlocks = rawSlot["blocks"];
      assertConfig(Array.isArray(rawBlocks), name, configPath, `slots.${slotName}.blocks must be an array`);
      slots[slotName] = {
        blocks: rawBlocks.map((block, index) => validateBlock(block, slotName, index, name, configPath)),
      };
    }
  }

  return {
    kind: "auto-flow-config",
    version: 1,
    name,
    basePreset: value["basePreset"],
    ...(slots !== undefined ? { slots } : {}),
  };
}

export function normalizeAutoFlowConfigYaml(config: SavedAutoFlowConfig): string {
  return YAML.stringify(config);
}

export function projectAutoFlowConfigPath(name: string, cwd = process.cwd()): string {
  validateConfigNameForPath(name);
  return path.join(cwd, ".agentweaver", "flow-configs", `${name}.yaml`);
}

export function userAutoFlowConfigPath(name: string): string {
  validateConfigNameForPath(name);
  return path.join(agentweaverConfigDir(), "flow-configs", `${name}.yaml`);
}

export function autoFlowConfigSearchPaths(name: string, cwd = process.cwd()): { projectPath: string; userPath: string } {
  return {
    projectPath: projectAutoFlowConfigPath(name, cwd),
    userPath: userAutoFlowConfigPath(name),
  };
}

export function loadAutoFlowConfigByName(name: string, cwd = process.cwd()): LoadedAutoFlowConfig {
  const requestedName = name.trim();
  validateConfigNameForPath(requestedName);
  const { projectPath, userPath } = autoFlowConfigSearchPaths(requestedName, cwd);
  const projectExists = existsSync(projectPath);
  const userExists = existsSync(userPath);
  const selectedPath = projectExists ? projectPath : userExists ? userPath : null;
  if (!selectedPath) {
    throw new TaskRunnerError(
      `Auto flow config '${requestedName}' was not found. Searched ${projectPath} and ${userPath}.`,
    );
  }

  const rawYaml = readFileSync(selectedPath, "utf8");
  let parsed: unknown;
  try {
    parsed = YAML.parse(rawYaml);
  } catch (error) {
    throw formatConfigError(requestedName, selectedPath, `YAML parse failed: ${(error as Error).message}`);
  }
  const config = validateAutoFlowConfigValue(parsed, requestedName, selectedPath);
  return {
    config,
    rawYaml,
    normalizedYaml: normalizeAutoFlowConfigYaml(config),
    source: {
      type: projectExists ? "project" : "user",
      path: selectedPath,
      ...(projectExists && userExists ? { shadowedUserPath: userPath } : {}),
    },
  };
}
