import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  flowConfigYamlFile,
  resolvedFlowJsonFile,
  resolvedFlowSummaryJsonFile,
} from "../artifacts.js";
import { TaskRunnerError } from "../errors.js";
import { getBuiltInAutoFlowBlockDefinition } from "./auto-flow-blocks.js";
import {
  getBuiltInAutoFlowPreset,
} from "./auto-flow-presets.js";
import {
  AUTO_FLOW_SLOT_NAMES,
  loadAutoFlowConfigByName,
  normalizeAutoFlowConfigYaml,
  type AutoFlowBlockEnabled,
  type AutoFlowBlockId,
  type AutoFlowPresetName,
  type AutoFlowSlotName,
  type LoadedAutoFlowConfig,
  type SavedAutoFlowBlock,
  type SavedAutoFlowConfig,
} from "./auto-flow-config.js";
import {
  AUTO_FLOW_SLOT_IDS,
  type AutoFlowParameterValues,
  type AutoFlowPreset,
  type AutoFlowPresetBlockPlacement,
  type AutoFlowPresetId,
  type AutoFlowResolvedBlockDecision,
  type AutoFlowResolvedSummary,
  type AutoFlowResolverResult,
  type AutoFlowSavedConfigOverride,
  type AutoFlowSlotId,
  type AutoFlowValidationDiagnostic,
  type AutoFlowValidationDiagnosticCode,
} from "./auto-flow-types.js";
import {
  loadDeclarativeFlowFromSpec,
  resolveNamedDeclarativeFlowRef,
  type InMemoryDeclarativeFlows,
  type LoadedDeclarativeFlow,
} from "./declarative-flows.js";
import { loadBuiltInFlowSpecSync, loadFlowSpecSync } from "./spec-loader.js";
import type {
  DeclarativeFlowSpec,
  DeclarativePhaseSpec,
  RepeatPhaseSpec,
  ValueSpec,
} from "./spec-types.js";

export type AutoFlowSelection =
  | { kind: "base" }
  | { kind: "config"; name: string };

export type AutoFlowBlockDecision = {
  slot: AutoFlowSlotName;
  blockId: AutoFlowBlockId;
  enabled: AutoFlowBlockEnabled;
  included: boolean;
  reason: string;
  maxIterations?: number;
  defaultMaxIterations?: number;
  flowFileName?: string;
};

export type ResolvedAutoFlowPhase = {
  id: string;
  label: string;
  blockId?: AutoFlowBlockId;
  slot?: AutoFlowSlotName;
};

export type ResolvedAutoFlowSource =
  | {
      type: "base";
    }
  | {
      type: "project-config" | "user-config";
      configName: string;
      path: string;
      shadowedUserPath?: string;
    };

export type ResolvedAutoFlowDocument = {
  schemaVersion: 1;
  source: ResolvedAutoFlowSource;
  requested: AutoFlowSelection;
  phases: ResolvedAutoFlowPhase[];
  blockDecisions: AutoFlowBlockDecision[];
  artifactPolicy: {
    dryRunFlowWritesArtifacts: false;
    nonDryRunWritesArtifacts: true;
    artifactPaths?: {
      flowConfigYaml: string;
      resolvedFlowJson: string;
      resolvedFlowSummaryJson: string;
    };
  };
  executionTarget: {
    kind: "generated";
    fileName: string;
    nestedFlowFiles: string[];
    flowSpec: DeclarativeFlowSpec;
    nestedFlowSpecs: Record<string, DeclarativeFlowSpec>;
  };
  validationDiagnostics: string[];
  fingerprint: string;
};

export type ResolvedAutoFlowSummary = {
  schemaVersion: 1;
  source: ResolvedAutoFlowSource;
  phaseOrder: string[];
  includedBlocks: AutoFlowBlockDecision[];
  skippedBlocks: AutoFlowBlockDecision[];
  executionTarget: "generated";
  artifactPolicy: ResolvedAutoFlowDocument["artifactPolicy"];
  fingerprint: string;
};

export type ResolvedAutoFlowExecution = {
  kind: "generated";
  flow: LoadedDeclarativeFlow;
  inMemoryFlows: InMemoryDeclarativeFlows;
};

export type ResolvedAutoFlow = {
  config: SavedAutoFlowConfig;
  normalizedConfigYaml: string;
  document: ResolvedAutoFlowDocument;
  summary: ResolvedAutoFlowSummary;
  execution: ResolvedAutoFlowExecution;
};

type BlockRegistryEntry = {
  label: string;
  defaultMaxIterations?: number;
  builtInFlowFileName?: string;
  builtInSpecName?: string;
};

type SlotResolution = {
  decisions: AutoFlowBlockDecision[];
  included: AutoFlowBlockDecision[];
};

type WorkingPlacement = {
  blockId: string;
  slot: string;
  enabled: boolean;
  params: AutoFlowParameterValues;
  index: number;
};

const BLOCK_REGISTRY: Record<AutoFlowBlockId, BlockRegistryEntry> = {
  "review.design-loop": {
    label: "design-review loop",
    defaultMaxIterations: 3,
    builtInFlowFileName: "design-review-loop.json",
    builtInSpecName: "design-review-loop.json",
  },
  "checks.go.linter": {
    label: "Go linter loop",
    defaultMaxIterations: 5,
    builtInFlowFileName: "run-go-linter-loop.json",
    builtInSpecName: "run-go-linter-loop.json",
  },
  "checks.go.tests": {
    label: "Go tests loop",
    defaultMaxIterations: 5,
    builtInFlowFileName: "run-go-tests-loop.json",
    builtInSpecName: "run-go-tests-loop.json",
  },
  "review.loop": {
    label: "review loop",
    defaultMaxIterations: 5,
    builtInFlowFileName: "review-loop.json",
    builtInSpecName: "review-loop.json",
  },
};

const DEFAULT_BLOCKS: Record<AutoFlowPresetName, Record<AutoFlowSlotName, AutoFlowBlockId[]>> = {
  simple: {
    designReview: [],
    postImplementationChecks: [],
    review: ["review.loop"],
    final: [],
  },
  standard: {
    designReview: ["review.design-loop"],
    postImplementationChecks: [],
    review: ["review.loop"],
    final: [],
  },
};

const BASE_DEFAULT_BLOCKS: Record<AutoFlowSlotName, AutoFlowBlockId[]> = {
  designReview: ["review.design-loop"],
  postImplementationChecks: [],
  review: ["review.loop"],
  final: [],
};

const slotOrder = new Map<string, number>(AUTO_FLOW_SLOT_IDS.map((slot, index) => [slot, index]));

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isAutoFlowSlotId(value: string): value is AutoFlowSlotId {
  return AUTO_FLOW_SLOT_IDS.includes(value as AutoFlowSlotId);
}

function createSummary(presetId: AutoFlowPresetId): AutoFlowResolvedSummary {
  return {
    presetId,
    enabled: [],
    disabled: [],
    skipped: [],
    autoDisabled: [],
    invalid: [],
  };
}

function addDiagnostic(
  diagnostics: AutoFlowValidationDiagnostic[],
  code: AutoFlowValidationDiagnosticCode,
  message: string,
  details: Omit<AutoFlowValidationDiagnostic, "code" | "message"> = {},
): void {
  diagnostics.push({ code, message, ...details });
}

function decisionFromDiagnostic(diagnostic: AutoFlowValidationDiagnostic): AutoFlowResolvedBlockDecision {
  const decision: AutoFlowResolvedBlockDecision = {
    status: "invalid",
    blockId: diagnostic.blockId ?? "flow",
    reason: diagnostic.message,
    diagnosticCode: diagnostic.code,
  };
  if (diagnostic.slotId && isAutoFlowSlotId(diagnostic.slotId)) {
    decision.slotId = diagnostic.slotId;
  }
  return decision;
}

function defaultParamsForPlacement(placement: AutoFlowPresetBlockPlacement): AutoFlowParameterValues {
  const definition = getBuiltInAutoFlowBlockDefinition(placement.blockId);
  const params: AutoFlowParameterValues = {};
  if (definition?.params) {
    for (const [name, paramDefinition] of Object.entries(definition.params)) {
      params[name] = paramDefinition.default;
    }
  }
  return {
    ...params,
    ...(placement.params ?? {}),
  };
}

function workingPlacementsForPreset(
  preset: AutoFlowPreset,
  override: AutoFlowSavedConfigOverride | undefined,
): WorkingPlacement[] {
  const sourcePlacements = override?.placements ?? preset.blocks;
  return sourcePlacements.map((placement, index) => {
    const presetPlacement = preset.blocks.find((candidate) => candidate.blockId === placement.blockId);
    const defaultParams = presetPlacement ? defaultParamsForPlacement(presetPlacement) : {};
    return {
      blockId: placement.blockId,
      slot: placement.slot,
      enabled: "enabled" in placement ? placement.enabled !== false : true,
      params: {
        ...defaultParams,
        ...(placement.params ?? {}),
        ...(override?.blockParams?.[placement.blockId] ?? {}),
      },
      index,
    };
  });
}

function sortedPlacements(placements: readonly WorkingPlacement[]): WorkingPlacement[] {
  return [...placements].sort((left, right) => {
    const leftSlot = slotOrder.get(left.slot) ?? Number.MAX_SAFE_INTEGER;
    const rightSlot = slotOrder.get(right.slot) ?? Number.MAX_SAFE_INTEGER;
    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }
    return left.index - right.index;
  });
}

function validateDisabledBlocks(
  preset: AutoFlowPreset,
  placements: readonly WorkingPlacement[],
  disabledBlocks: ReadonlySet<string>,
  summary: AutoFlowResolvedSummary,
  diagnostics: AutoFlowValidationDiagnostic[],
): WorkingPlacement[] {
  const activePlacements: WorkingPlacement[] = [];
  for (const placement of placements) {
    const definition = getBuiltInAutoFlowBlockDefinition(placement.blockId);
    if (!definition) {
      addDiagnostic(
        diagnostics,
        "unknown-block",
        `Unknown auto-flow block '${placement.blockId}'.`,
        { blockId: placement.blockId },
      );
      continue;
    }
    const disabled = disabledBlocks.has(placement.blockId) || !placement.enabled;
    if (!disabled) {
      activePlacements.push(placement);
      continue;
    }
    if (definition.locked || preset.blocks.some((candidate) => candidate.blockId === placement.blockId && candidate.locked)) {
      continue;
    }
    summary.disabled.push({
      status: "disabled",
      blockId: placement.blockId,
      ...(isAutoFlowSlotId(placement.slot) ? { slotId: placement.slot } : {}),
      reason: `Optional block '${placement.blockId}' was explicitly disabled.`,
    });
  }

  for (const blockId of disabledBlocks) {
    const definition = getBuiltInAutoFlowBlockDefinition(blockId);
    if (!definition) {
      addDiagnostic(
        diagnostics,
        "unknown-block",
        `Unknown auto-flow block '${blockId}' cannot be disabled.`,
        { blockId },
      );
      continue;
    }
    if (
      definition.locked
      && !placements.some((placement) => placement.blockId === blockId && disabledBlocks.has(placement.blockId))
    ) {
      addDiagnostic(
        diagnostics,
        "locked-block-disabled",
        `Locked auto-flow block '${blockId}' cannot be disabled.`,
        { blockId },
      );
    }
  }

  return activePlacements;
}

function validateLockedPresetBlocks(
  preset: AutoFlowPreset,
  placements: readonly WorkingPlacement[],
  disabledBlocks: ReadonlySet<string>,
  diagnostics: AutoFlowValidationDiagnostic[],
): void {
  for (const presetPlacement of preset.blocks) {
    const definition = getBuiltInAutoFlowBlockDefinition(presetPlacement.blockId);
    if (!definition?.locked && !presetPlacement.locked) {
      continue;
    }
    const matchingPlacement = placements.find((placement) => placement.blockId === presetPlacement.blockId);
    if (!matchingPlacement) {
      addDiagnostic(
        diagnostics,
        "locked-block-removed",
        `Locked auto-flow block '${presetPlacement.blockId}' cannot be removed.`,
        { blockId: presetPlacement.blockId, slotId: presetPlacement.slot },
      );
      continue;
    }
    if (!matchingPlacement.enabled || disabledBlocks.has(matchingPlacement.blockId)) {
      addDiagnostic(
        diagnostics,
        "locked-block-disabled",
        `Locked auto-flow block '${presetPlacement.blockId}' cannot be disabled.`,
        { blockId: presetPlacement.blockId, slotId: matchingPlacement.slot },
      );
    }
  }
}

function validatePlacements(
  placements: readonly WorkingPlacement[],
  diagnostics: AutoFlowValidationDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const placement of placements) {
    const definition = getBuiltInAutoFlowBlockDefinition(placement.blockId);
    if (!definition) {
      continue;
    }
    if (seen.has(placement.blockId)) {
      addDiagnostic(
        diagnostics,
        "duplicate-block",
        `Auto-flow block '${placement.blockId}' is placed more than once.`,
        { blockId: placement.blockId, slotId: placement.slot },
      );
    }
    seen.add(placement.blockId);
    if (!definition.allowedSlots.includes(placement.slot as AutoFlowSlotId)) {
      addDiagnostic(
        diagnostics,
        "invalid-slot",
        `Auto-flow block '${placement.blockId}' cannot be placed in slot '${placement.slot}'. Allowed slots: ${definition.allowedSlots.join(", ")}.`,
        {
          blockId: placement.blockId,
          slotId: placement.slot,
          allowedSlots: definition.allowedSlots,
        },
      );
    }
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `'${value}'`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function defaultConfigForPreset(preset: AutoFlowPresetName): SavedAutoFlowConfig {
  return {
    kind: "auto-flow-config",
    version: 2,
    name: `preset-${preset}`,
  };
}

function defaultBaseConfig(): SavedAutoFlowConfig {
  return {
    kind: "auto-flow-config",
    version: 2,
    name: "auto",
  };
}

function sourceForBase(): ResolvedAutoFlowSource {
  return { type: "base" };
}

function sourceForLoadedConfig(loaded: LoadedAutoFlowConfig): ResolvedAutoFlowSource {
  return {
    type: loaded.source.type === "project" ? "project-config" : "user-config",
    configName: loaded.config.name,
    path: loaded.source.path,
    ...(loaded.source.shadowedUserPath ? { shadowedUserPath: loaded.source.shadowedUserPath } : {}),
  };
}

function resolveSlot(
  config: SavedAutoFlowConfig,
  slot: AutoFlowSlotName,
): SlotResolution {
  const defaults = BASE_DEFAULT_BLOCKS[slot];
  const override = config.slots?.[slot];
  const configuredBlocks = override?.blocks;
  const rawBlocks: SavedAutoFlowBlock[] = configuredBlocks ?? defaults.map((id) => ({ id, enabled: "auto" }));
  const decisions: AutoFlowBlockDecision[] = [];

  for (const block of rawBlocks) {
    const registry = BLOCK_REGISTRY[block.id];
    const enabled = block.enabled ?? "auto";
    const included = enabled !== false;
    const maxIterations = block.maxIterations ?? registry.defaultMaxIterations;
    decisions.push({
      slot,
      blockId: block.id,
      enabled,
      included,
      reason: included
        ? configuredBlocks
          ? "included by saved config"
          : "included by base default"
        : "disabled by saved config",
      ...(maxIterations !== undefined ? { maxIterations } : {}),
      ...(registry.defaultMaxIterations !== undefined ? { defaultMaxIterations: registry.defaultMaxIterations } : {}),
      ...(registry.builtInFlowFileName ? { flowFileName: registry.builtInFlowFileName } : {}),
    });
  }

  if (configuredBlocks) {
    const configuredIds = new Set(configuredBlocks.map((block) => block.id));
    for (const defaultBlockId of defaults) {
      if (configuredIds.has(defaultBlockId)) {
        continue;
      }
      const registry = BLOCK_REGISTRY[defaultBlockId];
      decisions.push({
        slot,
        blockId: defaultBlockId,
        enabled: false,
        included: false,
        reason: "skipped because the slot override omitted this base default block",
        ...(registry.defaultMaxIterations !== undefined ? { defaultMaxIterations: registry.defaultMaxIterations } : {}),
        ...(registry.defaultMaxIterations !== undefined ? { maxIterations: registry.defaultMaxIterations } : {}),
        ...(registry.builtInFlowFileName ? { flowFileName: registry.builtInFlowFileName } : {}),
      });
    }
  }

  return {
    decisions,
    included: decisions.filter((decision) => decision.included),
  };
}

function resolveAllSlots(config: SavedAutoFlowConfig): { decisions: AutoFlowBlockDecision[]; includedBySlot: Record<AutoFlowSlotName, AutoFlowBlockDecision[]> } {
  const includedBySlot: Record<AutoFlowSlotName, AutoFlowBlockDecision[]> = {
    designReview: [],
    postImplementationChecks: [],
    review: [],
    final: [],
  };
  const decisions: AutoFlowBlockDecision[] = [];
  for (const slot of AUTO_FLOW_SLOT_NAMES) {
    const resolution = resolveSlot(config, slot);
    decisions.push(...resolution.decisions);
    includedBySlot[slot] = resolution.included;
  }
  return { decisions, includedBySlot };
}

function usesBuiltInShape(
  preset: AutoFlowPresetName,
  includedBySlot: Record<AutoFlowSlotName, AutoFlowBlockDecision[]>,
): boolean {
  for (const slot of AUTO_FLOW_SLOT_NAMES) {
    const defaults = DEFAULT_BLOCKS[preset][slot];
    const included = includedBySlot[slot];
    if (included.length !== defaults.length) {
      return false;
    }
    for (let index = 0; index < defaults.length; index += 1) {
      const decision = included[index];
      if (!decision || decision.blockId !== defaults[index]) {
        return false;
      }
      const defaultMax = BLOCK_REGISTRY[decision.blockId].defaultMaxIterations;
      if (decision.maxIterations !== undefined && defaultMax !== undefined && decision.maxIterations !== defaultMax) {
        return false;
      }
    }
  }
  return true;
}

function builtInPhase(spec: DeclarativeFlowSpec, id: string): DeclarativePhaseSpec {
  const phase = spec.phases.find((item): item is DeclarativePhaseSpec => !("repeat" in item) && item.id === id);
  if (!phase) {
    throw new TaskRunnerError(`Built-in auto flow phase '${id}' was not found.`);
  }
  return cloneJson(phase);
}

function phaseLabel(id: string): string {
  switch (id) {
    case "source":
      return "source";
    case "normalize":
      return "normalize";
    case "plan":
      return "planning";
    case "design_review_loop":
      return "design review";
    case "implement":
      return "implementation";
    case "review-loop":
      return "review";
    case "post_go_linter_loop":
      return "post-implementation Go linter";
    case "post_go_tests_loop":
      return "post-implementation Go tests";
    case "final_go_linter_loop":
      return "final Go linter";
    case "final_go_tests_loop":
      return "final Go tests";
    default:
      return id;
  }
}

function resolvedPhase(id: string, decision?: AutoFlowBlockDecision): ResolvedAutoFlowPhase {
  return {
    id,
    label: phaseLabel(id),
    ...(decision ? { blockId: decision.blockId, slot: decision.slot } : {}),
  };
}

function setFirstFlowRunFileName(phase: DeclarativePhaseSpec, fileName: string): DeclarativePhaseSpec {
  const next = cloneJson(phase);
  const step = next.steps.find((candidate) => candidate.node === "flow-run");
  if (!step) {
    throw new TaskRunnerError(`Phase '${phase.id}' does not contain a flow-run step.`);
  }
  step.params = {
    ...(step.params ?? {}),
    fileName: { const: fileName },
  };
  return next;
}

function valueRef(ref: string): ValueSpec {
  return { ref };
}

function valueConst(value: string): ValueSpec {
  return { const: value };
}

function checkPhaseId(slot: AutoFlowSlotName, blockId: AutoFlowBlockId): string {
  const prefix = slot === "final" ? "final" : "post";
  if (blockId === "checks.go.linter") {
    return `${prefix}_go_linter_loop`;
  }
  if (blockId === "checks.go.tests") {
    return `${prefix}_go_tests_loop`;
  }
  throw new TaskRunnerError(`Block '${blockId}' cannot be rendered as a check phase.`);
}

function checkPhase(decision: AutoFlowBlockDecision, fileName: string): DeclarativePhaseSpec {
  const isLinter = decision.blockId === "checks.go.linter";
  return {
    id: checkPhaseId(decision.slot, decision.blockId),
    steps: [
      {
        id: isLinter ? "run_go_linter_loop" : "run_go_tests_loop",
        node: "flow-run",
        params: {
          fileName: valueConst(fileName),
          labelText: valueConst(isLinter ? "Running Go linter loop" : "Running Go tests loop"),
          taskKey: valueRef("params.taskKey"),
          workspaceDir: valueRef("params.workspaceDir"),
          extraPrompt: valueRef("params.extraPrompt"),
          llmExecutor: valueRef("params.llmExecutor"),
          llmModel: valueRef("params.llmModel"),
          ...(isLinter
            ? {
                runGoLinterScript: valueRef("params.runGoLinterScript"),
                runGoLinterIteration: valueRef("params.runGoLinterIteration"),
              }
            : {
                runGoTestsScript: valueRef("params.runGoTestsScript"),
                runGoTestsIteration: valueRef("params.runGoTestsIteration"),
              }),
        },
      },
    ],
  };
}

function replaceOldMax(value: unknown, oldMax: number, newMax: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceOldMax(item, oldMax, newMax));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        replaceOldMax(item, oldMax, newMax),
      ]),
    );
  }
  if (typeof value === "number" && value === oldMax) {
    return newMax;
  }
  if (typeof value === "string") {
    return value
      .replaceAll(String(oldMax), String(newMax))
      .replaceAll(`_${oldMax}`, `_${newMax}`);
  }
  return value;
}

function isRepeatPhase(item: DeclarativeFlowSpec["phases"][number]): item is RepeatPhaseSpec {
  return "repeat" in item;
}

function withMaxIterations(spec: DeclarativeFlowSpec, oldMax: number, newMax: number): DeclarativeFlowSpec {
  if (newMax === oldMax) {
    return cloneJson(spec);
  }
  const next = replaceOldMax(cloneJson(spec), oldMax, newMax) as DeclarativeFlowSpec;
  const phases: DeclarativeFlowSpec["phases"] = [];
  for (const item of next.phases) {
    if (!isRepeatPhase(item)) {
      phases.push(item);
      continue;
    }
    if (item.repeat.to !== newMax) {
      phases.push(item);
      continue;
    }
    if (newMax < item.repeat.from) {
      continue;
    }
    phases.push(item);
  }
  next.phases = phases;
  return next;
}

function loadNamedBuiltInSpec(name: string, cwd: string): DeclarativeFlowSpec {
  const ref = resolveNamedDeclarativeFlowRef(name, cwd);
  return ref.source === "built-in"
    ? loadFlowSpecSync({ source: "built-in", fileName: ref.fileName })
    : loadFlowSpecSync(ref);
}

function generatedNestedFileName(blockId: AutoFlowBlockId, maxIterations: number): string {
  return `generated-${blockId.replaceAll(".", "-")}-${maxIterations}.json`;
}

async function resolveNestedFlowName(
  decision: AutoFlowBlockDecision,
  cwd: string,
  inMemoryFlows: InMemoryDeclarativeFlows,
  nestedFlowSpecs: Record<string, DeclarativeFlowSpec>,
): Promise<string> {
  const registry = BLOCK_REGISTRY[decision.blockId];
  if (!registry.builtInFlowFileName || !registry.builtInSpecName || !registry.defaultMaxIterations) {
    throw new TaskRunnerError(`Block '${decision.blockId}' does not have a runnable flow template.`);
  }
  const maxIterations = decision.maxIterations ?? registry.defaultMaxIterations;
  if (maxIterations === registry.defaultMaxIterations) {
    return registry.builtInFlowFileName;
  }
  const fileName = generatedNestedFileName(decision.blockId, maxIterations);
  if (!inMemoryFlows[fileName]) {
    const baseSpec = loadNamedBuiltInSpec(registry.builtInSpecName, cwd);
    const generatedSpec = withMaxIterations(baseSpec, registry.defaultMaxIterations, maxIterations);
    nestedFlowSpecs[fileName] = generatedSpec;
    inMemoryFlows[fileName] = await loadDeclarativeFlowFromSpec(generatedSpec, { fileName }, {
      cwd,
      inMemoryFlows,
    });
  }
  return fileName;
}

async function buildGeneratedFlow(
  config: SavedAutoFlowConfig,
  includedBySlot: Record<AutoFlowSlotName, AutoFlowBlockDecision[]>,
  cwd: string,
): Promise<{
  flow: LoadedDeclarativeFlow;
  inMemoryFlows: InMemoryDeclarativeFlows;
  flowSpec: DeclarativeFlowSpec;
  nestedFlowSpecs: Record<string, DeclarativeFlowSpec>;
  phases: ResolvedAutoFlowPhase[];
}> {
  const createBlockPhase = (blockId: string, slotId: string, params: Record<string, unknown> = {}): DeclarativePhaseSpec => {
    const definition = getBuiltInAutoFlowBlockDefinition(blockId);
    if (!definition) {
      throw new TaskRunnerError(`Unknown auto-flow block '${blockId}'.`);
    }
    return definition.createPhase({ blockId, slotId: slotId as AutoFlowSlotId, params });
  };
  const phases: DeclarativePhaseSpec[] = [
    createBlockPhase("source.jira", "source"),
    createBlockPhase("normalize.task-source", "normalize"),
    createBlockPhase("planning.plan", "planning"),
  ];
  const resolvedPhases: ResolvedAutoFlowPhase[] = [
    resolvedPhase("source"),
    resolvedPhase("normalize"),
    resolvedPhase("plan"),
  ];
  const inMemoryFlows: InMemoryDeclarativeFlows = {};
  const nestedFlowSpecs: Record<string, DeclarativeFlowSpec> = {};

  for (const decision of includedBySlot.designReview) {
    if (decision.blockId !== "review.design-loop") {
      continue;
    }
    const fileName = await resolveNestedFlowName(decision, cwd, inMemoryFlows, nestedFlowSpecs);
    phases.push(setFirstFlowRunFileName(
      createBlockPhase(decision.blockId, decision.slot, { maxIterations: decision.maxIterations }),
      fileName,
    ));
    resolvedPhases.push(resolvedPhase("design_review_loop", decision));
  }

  phases.push(createBlockPhase("implementation.default", "implementation"));
  resolvedPhases.push(resolvedPhase("implement"));

  for (const decision of includedBySlot.postImplementationChecks) {
    if (decision.blockId !== "checks.go.linter" && decision.blockId !== "checks.go.tests") {
      continue;
    }
    const fileName = await resolveNestedFlowName(decision, cwd, inMemoryFlows, nestedFlowSpecs);
    phases.push(setFirstFlowRunFileName(
      createBlockPhase(decision.blockId, decision.slot, { maxIterations: decision.maxIterations }),
      fileName,
    ));
    resolvedPhases.push(resolvedPhase(checkPhaseId(decision.slot, decision.blockId), decision));
  }

  for (const decision of includedBySlot.review) {
    if (decision.blockId !== "review.loop") {
      continue;
    }
    const fileName = await resolveNestedFlowName(decision, cwd, inMemoryFlows, nestedFlowSpecs);
    phases.push(setFirstFlowRunFileName(
      createBlockPhase(decision.blockId, decision.slot, { maxIterations: decision.maxIterations }),
      fileName,
    ));
    resolvedPhases.push(resolvedPhase("review-loop", decision));
  }

  for (const decision of includedBySlot.final) {
    if (decision.blockId !== "checks.go.linter" && decision.blockId !== "checks.go.tests") {
      continue;
    }
    const fileName = await resolveNestedFlowName(decision, cwd, inMemoryFlows, nestedFlowSpecs);
    phases.push(setFirstFlowRunFileName(
      createBlockPhase(decision.blockId, decision.slot, { maxIterations: decision.maxIterations }),
      fileName,
    ));
    resolvedPhases.push(resolvedPhase(checkPhaseId(decision.slot, decision.blockId), decision));
  }

  const flowSpec: DeclarativeFlowSpec = {
    kind: "auto-flow",
    version: 1,
    description: `Generated Auto workflow from config '${config.name}'.`,
    phases,
  };
  const flow = await loadDeclarativeFlowFromSpec(flowSpec, { fileName: "resolved-auto-flow.json" }, {
    cwd,
    inMemoryFlows,
  });
  return { flow, inMemoryFlows, flowSpec, nestedFlowSpecs, phases: resolvedPhases };
}

function artifactPolicy(scopeKey?: string): ResolvedAutoFlowDocument["artifactPolicy"] {
  return {
    dryRunFlowWritesArtifacts: false,
    nonDryRunWritesArtifacts: true,
    ...(scopeKey
      ? {
          artifactPaths: {
            flowConfigYaml: flowConfigYamlFile(scopeKey),
            resolvedFlowJson: resolvedFlowJsonFile(scopeKey),
            resolvedFlowSummaryJson: resolvedFlowSummaryJsonFile(scopeKey),
          },
        }
      : {}),
  };
}

function buildSummary(document: ResolvedAutoFlowDocument): ResolvedAutoFlowSummary {
  return {
    schemaVersion: 1,
    source: document.source,
    phaseOrder: document.phases.map((phase) => phase.label),
    includedBlocks: document.blockDecisions.filter((decision) => decision.included),
    skippedBlocks: document.blockDecisions.filter((decision) => !decision.included),
    executionTarget: document.executionTarget.kind,
    artifactPolicy: document.artifactPolicy,
    fingerprint: document.fingerprint,
  };
}

export async function resolveAutoFlow(
  selection: AutoFlowSelection,
  options: {
    cwd?: string;
    scopeKey?: string;
  } = {},
): Promise<ResolvedAutoFlow> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const loadedConfig = selection.kind === "config" ? loadAutoFlowConfigByName(selection.name, cwd) : null;
  const config = loadedConfig?.config ?? defaultBaseConfig();
  const normalizedConfigYaml = loadedConfig?.normalizedYaml ?? normalizeAutoFlowConfigYaml(config);
  const source = loadedConfig ? sourceForLoadedConfig(loadedConfig) : sourceForBase();
  const { decisions, includedBySlot } = resolveAllSlots(config);
  const policy = artifactPolicy(options.scopeKey);
  const generated = await buildGeneratedFlow(config, includedBySlot, cwd);
  const phases = generated.phases;
  const execution: ResolvedAutoFlowExecution = {
    kind: "generated",
    flow: generated.flow,
    inMemoryFlows: generated.inMemoryFlows,
  };
  const executionTarget: ResolvedAutoFlowDocument["executionTarget"] = {
    kind: "generated",
    fileName: generated.flow.fileName,
    nestedFlowFiles: Object.keys(generated.inMemoryFlows).sort((left, right) => left.localeCompare(right)),
    flowSpec: generated.flowSpec,
    nestedFlowSpecs: Object.fromEntries(
      Object.entries(generated.nestedFlowSpecs).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };

  const documentWithoutFingerprint = {
    schemaVersion: 1 as const,
    source,
    requested: selection,
    phases,
    blockDecisions: decisions,
    artifactPolicy: policy,
    executionTarget,
    validationDiagnostics: [],
  };
  const document: ResolvedAutoFlowDocument = {
    ...documentWithoutFingerprint,
    fingerprint: fingerprint(documentWithoutFingerprint),
  };
  return {
    config,
    normalizedConfigYaml,
    document,
    summary: buildSummary(document),
    execution,
  };
}

export function formatAutoFlowDryRunPreview(resolved: ResolvedAutoFlow): string {
  const lines = [
    "Auto flow dry-run preview",
    `Source: ${resolved.document.source.type}`,
  ];
  if (resolved.document.source.type === "base") {
    lines.push("Base: Auto workflow");
  } else {
    lines.push(`Config: ${resolved.document.source.configName}`);
    lines.push(`Config path: ${resolved.document.source.path}`);
    if (resolved.document.source.shadowedUserPath) {
      lines.push(`Precedence: project config selected; user config shadowed at ${resolved.document.source.shadowedUserPath}`);
    }
  }
  lines.push(`Execution target: ${resolved.document.executionTarget.kind}`);
  lines.push("", "Phases:");
  resolved.document.phases.forEach((phase, index) => {
    lines.push(`  ${index + 1}. ${phase.label} (${phase.id})`);
  });
  lines.push("", "Blocks:");
  for (const decision of resolved.document.blockDecisions) {
    const state = decision.included ? "included" : "skipped";
    const iterationText = decision.maxIterations ? `, maxIterations=${decision.maxIterations}` : "";
    lines.push(`  - ${decision.slot}/${decision.blockId}: ${state} (${decision.reason}${iterationText})`);
  }
  lines.push(
    "",
    "Artifact policy:",
    "  - --dry-run-flow writes no resolver artifacts.",
    "  - Non-dry configurable auto runs write flow-config.yaml, resolved-flow.json, and resolved-flow-summary.json.",
    "",
    "No workflow steps were run.",
  );
  return `${lines.join("\n")}\n`;
}

function writeTextAtomic(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, filePath);
}

export function persistResolvedAutoFlowArtifacts(scopeKey: string, resolved: ResolvedAutoFlow): void {
  writeTextAtomic(flowConfigYamlFile(scopeKey), resolved.normalizedConfigYaml);
  writeTextAtomic(resolvedFlowJsonFile(scopeKey), `${JSON.stringify(resolved.document, null, 2)}\n`);
  writeTextAtomic(resolvedFlowSummaryJsonFile(scopeKey), `${JSON.stringify(resolved.summary, null, 2)}\n`);
}

function validateParameters(
  placements: readonly WorkingPlacement[],
  diagnostics: AutoFlowValidationDiagnostic[],
): void {
  for (const placement of placements) {
    const definition = getBuiltInAutoFlowBlockDefinition(placement.blockId);
    if (!definition) {
      continue;
    }
    const paramDefinitions = definition.params ?? {};
    for (const paramName of Object.keys(placement.params)) {
      if (!paramDefinitions[paramName]) {
        addDiagnostic(
          diagnostics,
          "unknown-parameter",
          `Auto-flow block '${placement.blockId}' does not support parameter '${paramName}'.`,
          { blockId: placement.blockId, slotId: placement.slot, paramName },
        );
      }
    }
    for (const [paramName, paramDefinition] of Object.entries(paramDefinitions)) {
      const value = Object.prototype.hasOwnProperty.call(placement.params, paramName)
        ? placement.params[paramName]
        : paramDefinition.default;
      if (!Number.isInteger(value)) {
        addDiagnostic(
          diagnostics,
          "invalid-parameter-type",
          `Auto-flow block '${placement.blockId}' parameter '${paramName}' must be an integer; received ${formatValue(value)}.`,
          { blockId: placement.blockId, slotId: placement.slot, paramName, value },
        );
        continue;
      }
      const numericValue = value as number;
      if (numericValue < paramDefinition.min || numericValue > paramDefinition.max) {
        addDiagnostic(
          diagnostics,
          "parameter-out-of-range",
          `Auto-flow block '${placement.blockId}' parameter '${paramName}' must be between ${paramDefinition.min} and ${paramDefinition.max}; received ${numericValue}.`,
          { blockId: placement.blockId, slotId: placement.slot, paramName, value: numericValue },
        );
        continue;
      }
      if (!paramDefinition.supportedExecutableValues.includes(numericValue)) {
        addDiagnostic(
          diagnostics,
          "unsupported-override",
          `Auto-flow block '${placement.blockId}' parameter '${paramName}' value ${numericValue} is not executable in this implementation; supported executable values: ${paramDefinition.supportedExecutableValues.join(", ")}.`,
          { blockId: placement.blockId, slotId: placement.slot, paramName, value: numericValue },
        );
      }
    }
  }
}

function validateOverrideBlockParams(
  override: AutoFlowSavedConfigOverride | undefined,
  diagnostics: AutoFlowValidationDiagnostic[],
): void {
  if (!override?.blockParams) {
    return;
  }
  for (const blockId of Object.keys(override.blockParams)) {
    if (!getBuiltInAutoFlowBlockDefinition(blockId)) {
      addDiagnostic(
        diagnostics,
        "unknown-block",
        `Unknown auto-flow block '${blockId}' has parameter overrides.`,
        { blockId },
      );
    }
  }
}

function validateDependencies(
  placements: readonly WorkingPlacement[],
  diagnostics: AutoFlowValidationDiagnostic[],
): void {
  const provided = new Set<string>();
  for (const placement of sortedPlacements(placements)) {
    const definition = getBuiltInAutoFlowBlockDefinition(placement.blockId);
    if (!definition) {
      continue;
    }
    const missing = definition.requires.filter((contract) => !provided.has(contract));
    for (const contract of missing) {
      addDiagnostic(
        diagnostics,
        "missing-dependency",
        `Auto-flow block '${placement.blockId}' requires contract '${contract}' before slot '${placement.slot}'.`,
        {
          blockId: placement.blockId,
          slotId: placement.slot,
          missingContract: contract,
        },
      );
    }
    if (missing.length === 0) {
      for (const contract of definition.provides) {
        provided.add(contract);
      }
    }
  }
}

function buildSpec(preset: AutoFlowPreset, placements: readonly WorkingPlacement[]): DeclarativeFlowSpec {
  return {
    kind: preset.kind,
    version: preset.version,
    description: preset.description,
    phases: sortedPlacements(placements).map((placement) => {
      const definition = getBuiltInAutoFlowBlockDefinition(placement.blockId);
      if (!definition || !isAutoFlowSlotId(placement.slot)) {
        throw new TaskRunnerError(`Cannot generate phase for invalid auto-flow block '${placement.blockId}'.`);
      }
      return definition.createPhase({
        blockId: placement.blockId,
        slotId: placement.slot,
        params: placement.params,
      });
    }),
  };
}

export function resolveAutoFlowPreset(
  presetOrId: AutoFlowPresetId | AutoFlowPreset,
  override?: AutoFlowSavedConfigOverride,
): AutoFlowResolverResult {
  const preset = typeof presetOrId === "string" ? getBuiltInAutoFlowPreset(presetOrId) : presetOrId;
  const summary = createSummary(preset.id);
  const diagnostics: AutoFlowValidationDiagnostic[] = [];
  const disabledBlocks = new Set(override?.disabledBlocks ?? []);
  const placements = workingPlacementsForPreset(preset, override);

  validateOverrideBlockParams(override, diagnostics);
  validateLockedPresetBlocks(preset, placements, disabledBlocks, diagnostics);
  const activePlacements = validateDisabledBlocks(preset, placements, disabledBlocks, summary, diagnostics);
  validatePlacements(activePlacements, diagnostics);
  validateParameters(activePlacements, diagnostics);
  validateDependencies(activePlacements, diagnostics);

  summary.invalid.push(...diagnostics.map(decisionFromDiagnostic));
  if (diagnostics.length > 0) {
    return { preset, summary, diagnostics };
  }

  for (const placement of sortedPlacements(activePlacements)) {
    summary.enabled.push({
      status: "enabled",
      blockId: placement.blockId,
      slotId: placement.slot as AutoFlowSlotId,
      reason: `Block '${placement.blockId}' is enabled.`,
    });
  }

  return {
    preset,
    summary,
    diagnostics,
    spec: buildSpec(preset, activePlacements),
  };
}

export function resolveBuiltInAutoFlowSpecByFileName(fileName: string): DeclarativeFlowSpec | null {
  return null;
}
