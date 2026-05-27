import {
  AUTO_FLOW_BLOCK_IDS,
  AUTO_FLOW_SLOT_NAMES,
  allowedAutoFlowBlocksForSlot,
  validateAutoFlowBlockInsertion,
  type AutoFlowBlockId,
  type AutoFlowConfigLocation,
  type AutoFlowSlotName,
  type SavedAutoFlowBlock,
  type SavedAutoFlowConfig,
} from "../pipeline/auto-flow-config.js";
import { getBuiltInAutoFlowBlockDefinition, listBuiltInAutoFlowBlockDefinitions } from "../pipeline/auto-flow-blocks.js";
import { AUTO_FLOW_BASE_FLOW_ID, AUTO_FLOW_CONFIG_FLOW_ID_PREFIX } from "../pipeline/auto-flow-identity.js";
import type { AutoFlowSelection } from "../pipeline/auto-flow-resolver.js";
import {
  AUTO_FLOW_SLOT_IDS,
  type AutoFlowParameterDefinition,
  type AutoFlowSlotId,
  type AutoFlowValidationDiagnostic,
} from "../pipeline/auto-flow-types.js";
import type {
  AutoFlowAvailableBlockViewModel,
  AutoFlowBlockViewModel,
  AutoFlowEditorSource,
  AutoFlowEditorViewModel,
  AutoFlowParameterViewModel,
  AutoFlowSlotViewModel,
  InteractiveAutoFlowDefinition,
} from "./types.js";

const SLOT_TITLES: Record<AutoFlowSlotId, string> = {
  source: "Source",
  normalize: "Normalize",
  planning: "Planning",
  designReview: "Design review",
  implementation: "Implementation",
  postImplementationChecks: "Post-implementation checks",
  review: "Review",
  final: "Final",
};

const OPTIONAL_SLOT_IDS = new Set<AutoFlowSlotId>(AUTO_FLOW_SLOT_NAMES);

const FALLBACK_BLOCK_TITLES: Record<AutoFlowBlockId, string> = {
  "review.design-loop": "Design review loop",
  "checks.go.linter": "Go linter loop",
  "checks.go.tests": "Go tests loop",
  "review.loop": "Review loop",
};

const FALLBACK_MAX_ITERATION_DEFAULTS: Partial<Record<AutoFlowBlockId, number>> = {
  "review.design-loop": 3,
  "checks.go.linter": 5,
  "checks.go.tests": 5,
  "review.loop": 5,
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isOptionalSlot(slotId: AutoFlowSlotId): slotId is AutoFlowSlotName {
  return OPTIONAL_SLOT_IDS.has(slotId);
}

function isSavedBlockId(blockId: string): blockId is AutoFlowBlockId {
  return (AUTO_FLOW_BLOCK_IDS as readonly string[]).includes(blockId);
}

function optionalSlotForBlock(blockId: string): AutoFlowSlotName | null {
  for (const slotName of AUTO_FLOW_SLOT_NAMES) {
    if (allowedAutoFlowBlocksForSlot(slotName).includes(blockId as AutoFlowBlockId)) {
      return slotName;
    }
  }
  return null;
}

function validationDiagnostic(
  validation: ReturnType<typeof validateAutoFlowBlockInsertion>,
  fallback: { slotId?: string; blockId: string },
): AutoFlowValidationDiagnostic {
  return {
    code: validation.message.startsWith("Unknown auto-flow block") ? "unknown-block" : "invalid-slot",
    message: validation.message,
    ...(validation.blockId ? { blockId: validation.blockId } : { blockId: fallback.blockId }),
    ...(validation.slotName ? { slotId: validation.slotName } : fallback.slotId ? { slotId: fallback.slotId } : {}),
  };
}

function resolveOptionalBlockSlot(
  blockId: string,
  slotId?: string,
): { slotName: AutoFlowSlotName; blockId: AutoFlowBlockId } | { diagnostics: AutoFlowValidationDiagnostic[] } {
  if (slotId !== undefined) {
    const validation = validateAutoFlowBlockInsertion(slotId, blockId);
    if (!validation.ok || !validation.slotName || !validation.blockId) {
      return {
        diagnostics: [validationDiagnostic(validation, { slotId, blockId })],
      };
    }
    return {
      slotName: validation.slotName,
      blockId: validation.blockId,
    };
  }
  const slotName = optionalSlotForBlock(blockId);
  if (!slotName || !isSavedBlockId(blockId)) {
    return {
      diagnostics: [{
        code: "unknown-block",
        message: `Unknown optional auto-flow block '${blockId}'.`,
        blockId,
      }],
    };
  }
  return {
    slotName,
    blockId,
  };
}

function defaultOptionalBlocksForSlot(
  slotId: AutoFlowSlotName,
): SavedAutoFlowBlock[] {
  if (slotId === "designReview") {
    return [{ id: "review.design-loop", enabled: "auto" }];
  }
  if (slotId === "review") {
    return [{ id: "review.loop", enabled: "auto" }];
  }
  return [];
}

function coreBlockForSlot(
  slotId: AutoFlowSlotId,
  diagnostics: readonly AutoFlowValidationDiagnostic[],
): AutoFlowBlockViewModel[] {
  const blockIdBySlot: Partial<Record<AutoFlowSlotId, string>> = {
    source: "source.jira",
    normalize: "normalize.task-source",
    planning: "planning.plan",
    implementation: "implementation.default",
  };
  const blockId = blockIdBySlot[slotId];
  if (!blockId) {
    return [];
  }
  const definition = getBuiltInAutoFlowBlockDefinition(blockId);
  const phaseId = phaseIdForBlock(slotId, blockId);
  const blockDiagnostics = diagnosticsFor(diagnostics, { slotId, blockId });
  const status = blockDiagnostics.some((diagnostic) => (
    diagnostic.code === "locked-block-disabled"
    || diagnostic.code === "locked-block-removed"
    || diagnostic.code === "missing-dependency"
  ))
    ? "blocked"
    : blockDiagnostics.length > 0 ? "invalid" : "pending";
  return [
    {
      blockId,
      title: definition?.title ?? blockId,
      slotId,
      status,
      reason: blockDiagnostics[0]?.message ?? "Locked core block.",
      locked: true,
      enabled: true,
      actions: {
        canEnable: false,
        canDisable: false,
        canRemove: false,
        canEditParams: false,
      },
      params: [],
      diagnostics: blockDiagnostics,
      ...(phaseId ? { phaseId } : {}),
    },
  ];
}

function blockTitle(blockId: string): string {
  return getBuiltInAutoFlowBlockDefinition(blockId)?.title
    ?? (isSavedBlockId(blockId) ? FALLBACK_BLOCK_TITLES[blockId] : undefined)
    ?? blockId;
}

function parameterDefinitionForBlock(blockId: AutoFlowBlockId): AutoFlowParameterDefinition | null {
  const definition = getBuiltInAutoFlowBlockDefinition(blockId);
  const builtInParam = definition?.params?.maxIterations;
  if (builtInParam) {
    return builtInParam;
  }
  const fallbackDefault = FALLBACK_MAX_ITERATION_DEFAULTS[blockId];
  if (fallbackDefault === undefined) {
    return null;
  }
  return {
    type: "integer",
    min: 1,
    max: 5,
    default: fallbackDefault,
    supportedExecutableValues: [fallbackDefault],
  };
}

function blockParams(block: SavedAutoFlowBlock): AutoFlowParameterViewModel[] {
  const definition = parameterDefinitionForBlock(block.id);
  if (!definition) {
    return [];
  }
  return [
    {
      name: "maxIterations",
      label: "maxIterations",
      type: "integer",
      value: block.maxIterations ?? definition.default,
      defaultValue: definition.default,
      min: definition.min,
      max: definition.max,
    },
  ];
}

function phaseIdForBlock(slotId: AutoFlowSlotId, blockId: string): string | undefined {
  if (blockId === "source.jira") return "source";
  if (blockId === "normalize.task-source") return "normalize";
  if (blockId === "planning.plan") return "plan";
  if (blockId === "review.design-loop") return "design_review_loop";
  if (blockId === "implementation.default") return "implement";
  if (blockId === "review.loop") return "review-loop";
  if (blockId === "checks.go.linter") return slotId === "final" ? "final_go_linter_loop" : "post_go_linter_loop";
  if (blockId === "checks.go.tests") return slotId === "final" ? "final_go_tests_loop" : "post_go_tests_loop";
  return undefined;
}

function diagnosticsFor(
  diagnostics: readonly AutoFlowValidationDiagnostic[],
  input: { slotId?: AutoFlowSlotId; blockId?: string; paramName?: string },
): AutoFlowValidationDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (input.slotId && diagnostic.slotId !== undefined && diagnostic.slotId !== input.slotId) {
      return false;
    }
    if (input.blockId && diagnostic.blockId !== input.blockId) {
      return false;
    }
    if (input.paramName && diagnostic.paramName !== input.paramName) {
      return false;
    }
    return true;
  });
}

function validateEditorConfig(config: SavedAutoFlowConfig): AutoFlowValidationDiagnostic[] {
  const diagnostics: AutoFlowValidationDiagnostic[] = [];
  for (const slotName of AUTO_FLOW_SLOT_NAMES) {
    const slot = config.slots?.[slotName];
    if (!slot) {
      continue;
    }
    const seen = new Set<string>();
    slot.blocks.forEach((block, index) => {
      if (!allowedAutoFlowBlocksForSlot(slotName).includes(block.id)) {
        diagnostics.push({
          code: "invalid-slot",
          message: `Auto-flow block '${block.id}' cannot be placed in slot '${slotName}'. Allowed blocks: ${allowedAutoFlowBlocksForSlot(slotName).join(", ")}.`,
          blockId: block.id,
          slotId: slotName,
          allowedSlots: [slotName],
        });
      }
      if (seen.has(block.id)) {
        diagnostics.push({
          code: "duplicate-block",
          message: `Auto-flow block '${block.id}' is placed more than once in slot '${slotName}'.`,
          blockId: block.id,
          slotId: slotName,
        });
      }
      seen.add(block.id);
      const paramDefinition = parameterDefinitionForBlock(block.id);
      if (block.maxIterations !== undefined && !paramDefinition) {
        diagnostics.push({
          code: "unknown-parameter",
          message: `Auto-flow block '${block.id}' does not support parameter 'maxIterations'.`,
          blockId: block.id,
          slotId: slotName,
          paramName: "maxIterations",
          value: block.maxIterations,
        });
      }
      if (block.maxIterations !== undefined && paramDefinition && !Number.isInteger(block.maxIterations)) {
        diagnostics.push({
          code: "invalid-parameter-type",
          message: `Auto-flow block '${block.id}' parameter 'maxIterations' must be an integer; received ${JSON.stringify(block.maxIterations)}.`,
          blockId: block.id,
          slotId: slotName,
          paramName: "maxIterations",
          value: block.maxIterations,
        });
      }
      if (
        block.maxIterations !== undefined
        && paramDefinition
        && Number.isInteger(block.maxIterations)
        && (block.maxIterations < paramDefinition.min || block.maxIterations > paramDefinition.max)
      ) {
        diagnostics.push({
          code: "parameter-out-of-range",
          message: `Auto-flow block '${block.id}' parameter 'maxIterations' must be between ${paramDefinition.min} and ${paramDefinition.max}; received ${block.maxIterations}.`,
          blockId: block.id,
          slotId: slotName,
          paramName: "maxIterations",
          value: block.maxIterations,
        });
      }
      if (!isSavedBlockId(block.id)) {
        diagnostics.push({
          code: "unknown-block",
          message: `Unknown auto-flow block '${block.id}' at slots.${slotName}.blocks[${index}].`,
          blockId: block.id,
          slotId: slotName,
        });
      }
    });
  }
  return diagnostics;
}

function optionalBlocksForSlot(
  config: SavedAutoFlowConfig,
  slotId: AutoFlowSlotName,
): Array<{ block: SavedAutoFlowBlock; statusReason: string; canRemove: boolean }> {
  const defaultBlocks = defaultOptionalBlocksForSlot(slotId);
  const configuredBlocks = config.slots?.[slotId]?.blocks;
  if (!configuredBlocks) {
    return defaultBlocks.map((block) => ({
      block,
      statusReason: "Included by base default.",
      canRemove: true,
    }));
  }
  const configuredIds = new Set(configuredBlocks.map((block) => block.id));
  const blocks = configuredBlocks.map((block) => ({
    block,
    statusReason: "Configured in saved auto-flow config.",
    canRemove: true,
  }));
  for (const defaultBlock of defaultBlocks) {
    if (configuredIds.has(defaultBlock.id)) {
      continue;
    }
    blocks.push({
      block: {
        ...defaultBlock,
        enabled: false,
      },
      statusReason: "Skipped because the slot override omitted this base default block.",
      canRemove: false,
    });
  }
  return blocks;
}

function blockStatus(
  block: SavedAutoFlowBlock,
  diagnostics: readonly AutoFlowValidationDiagnostic[],
): AutoFlowBlockViewModel["status"] {
  if (diagnostics.length > 0) {
    if (diagnostics.some((diagnostic) => (
      diagnostic.code === "locked-block-disabled"
      || diagnostic.code === "locked-block-removed"
      || diagnostic.code === "missing-dependency"
    ))) {
      return "blocked";
    }
    return "invalid";
  }
  if (block.enabled === false) {
    return "disabled";
  }
  return "pending";
}

function blockReason(
  block: SavedAutoFlowBlock,
  statusReason: string,
  diagnostics: readonly AutoFlowValidationDiagnostic[],
): string {
  if (diagnostics[0]) {
    return diagnostics[0].message;
  }
  if (block.enabled === false) {
    return "Optional block is disabled.";
  }
  return statusReason;
}

function optionalBlockView(
  slotId: AutoFlowSlotName,
  block: SavedAutoFlowBlock,
  statusReason: string,
  canRemove: boolean,
  diagnostics: readonly AutoFlowValidationDiagnostic[],
): AutoFlowBlockViewModel {
  const blockDiagnostics = diagnosticsFor(diagnostics, { slotId, blockId: block.id });
  const params = blockParams(block);
  const phaseId = phaseIdForBlock(slotId, block.id);
  return {
    blockId: block.id,
    title: blockTitle(block.id),
    slotId,
    status: blockStatus(block, blockDiagnostics),
    reason: blockReason(block, statusReason, blockDiagnostics),
    locked: false,
    enabled: block.enabled !== false,
    actions: {
      canEnable: block.enabled === false,
      canDisable: block.enabled !== false,
      canRemove,
      canEditParams: params.length > 0,
    },
    params,
    diagnostics: blockDiagnostics,
    ...(phaseId ? { phaseId } : {}),
  };
}

function slotStatus(blocks: readonly AutoFlowBlockViewModel[], diagnostics: readonly AutoFlowValidationDiagnostic[]): AutoFlowSlotViewModel["status"] {
  if (diagnostics.length > 0 || blocks.some((block) => block.status === "invalid")) {
    return "invalid";
  }
  if (blocks.length === 0) {
    return "empty";
  }
  if (blocks.every((block) => block.status === "disabled")) {
    return "disabled";
  }
  return "pending";
}

function slotReason(blocks: readonly AutoFlowBlockViewModel[], diagnostics: readonly AutoFlowValidationDiagnostic[]): string {
  if (diagnostics[0]) {
    return diagnostics[0].message;
  }
  if (blocks.length === 0) {
    return "No blocks are configured for this optional slot.";
  }
  if (blocks.every((block) => block.status === "disabled")) {
    return "All optional blocks in this slot are disabled.";
  }
  return "Slot is configured.";
}

function slotView(config: SavedAutoFlowConfig, slotId: AutoFlowSlotId, diagnostics: readonly AutoFlowValidationDiagnostic[]): AutoFlowSlotViewModel {
  const slotDiagnostics = diagnosticsFor(diagnostics, { slotId });
  const blocks = isOptionalSlot(slotId)
    ? optionalBlocksForSlot(config, slotId).map(({ block, statusReason, canRemove }) => optionalBlockView(slotId, block, statusReason, canRemove, diagnostics))
    : coreBlockForSlot(slotId, diagnostics);
  return {
    slotId,
    title: SLOT_TITLES[slotId],
    status: slotStatus(blocks, slotDiagnostics),
    reason: slotReason(blocks, slotDiagnostics),
    blocks,
    diagnostics: slotDiagnostics,
  };
}

function sourceLabel(source: AutoFlowEditorSource): string {
  if (source.type === "base") {
    return "base Auto workflow";
  }
  return `${source.type} ${source.configName}`;
}

export function defaultBaseAutoFlowConfig(name = "auto"): SavedAutoFlowConfig {
  return {
    kind: "auto-flow-config",
    version: 2,
    name,
  };
}

export function createBaseAutoFlowDefinition(): InteractiveAutoFlowDefinition {
  return {
    selection: { kind: "base" },
    config: defaultBaseAutoFlowConfig(),
    source: {
      type: "base",
    },
  };
}

export function createConfigAutoFlowDefinition(input: {
  config: SavedAutoFlowConfig;
  source: Exclude<AutoFlowEditorSource, { type: "base" }>;
}): InteractiveAutoFlowDefinition {
  return {
    selection: { kind: "config", name: input.config.name },
    config: cloneJson(input.config),
    source: input.source,
  };
}

export function buildAutoFlowEditorViewModel(
  definition: InteractiveAutoFlowDefinition,
  options: {
    config?: SavedAutoFlowConfig;
    diagnostics?: AutoFlowValidationDiagnostic[];
    lastMessage?: string;
    saveTarget?: AutoFlowConfigLocation;
  } = {},
): AutoFlowEditorViewModel {
  const config = options.config ?? definition.config;
  const diagnostics = options.diagnostics ?? validateEditorConfig(config);
  const slots = AUTO_FLOW_SLOT_IDS.map((slotId) => slotView(config, slotId, diagnostics));
  const availableBlocks: AutoFlowAvailableBlockViewModel[] = [
    ...listBuiltInAutoFlowBlockDefinitions().filter((block) => !block.locked).map((block) => ({
      blockId: block.id,
      title: block.title,
      allowedSlots: [...block.allowedSlots],
    })),
  ];
  const valid = diagnostics.length === 0;
  const canReset = JSON.stringify(config) !== JSON.stringify(definition.config);
  return {
    selection: definition.selection,
    configName: config.name,
    source: definition.source,
    slots,
    diagnostics: [...diagnostics],
    availableBlocks,
    status: {
      valid,
      canSave: valid && definition.source.type !== "base",
      canSaveAs: valid,
      canReset,
      canRun: valid && (definition.source.type === "base" || !canReset),
      mutable: definition.source.type !== "base",
      saveTarget: options.saveTarget ?? "project",
      sourceLabel: sourceLabel(definition.source),
      ...(options.lastMessage ? { lastMessage: options.lastMessage } : {}),
    },
  };
}

export function autoFlowSelectionForFlowId(flowId: string): AutoFlowSelection | null {
  if (flowId === AUTO_FLOW_BASE_FLOW_ID) {
    return { kind: "base" };
  }
  if (flowId.startsWith(AUTO_FLOW_CONFIG_FLOW_ID_PREFIX)) {
    const name = flowId.slice(AUTO_FLOW_CONFIG_FLOW_ID_PREFIX.length);
    if (/^[A-Za-z0-9._-]+$/.test(name)) {
      return { kind: "config", name };
    }
  }
  return null;
}

function ensureOptionalSlot(config: SavedAutoFlowConfig, slotName: AutoFlowSlotName): SavedAutoFlowBlock[] {
  const nextSlots = {
    ...(config.slots ?? {}),
  };
  const existing = nextSlots[slotName]?.blocks;
  const blocks = existing
    ? existing.map((block) => ({ ...block }))
    : defaultOptionalBlocksForSlot(slotName);
  nextSlots[slotName] = { blocks };
  config.slots = nextSlots;
  return blocks;
}

export function setAutoFlowBlockEnabled(
  config: SavedAutoFlowConfig,
  blockId: string,
  enabled: boolean,
  slotId?: string,
): { config: SavedAutoFlowConfig; diagnostics: AutoFlowValidationDiagnostic[] } {
  const next = cloneJson(config);
  const coreDefinition = getBuiltInAutoFlowBlockDefinition(blockId);
  if (coreDefinition?.locked) {
    return {
      config: next,
      diagnostics: [{
        code: "locked-block-disabled",
        message: `Locked auto-flow block '${blockId}' cannot be disabled.`,
        blockId,
      }],
    };
  }
  const resolved = resolveOptionalBlockSlot(blockId, slotId);
  if ("diagnostics" in resolved) {
    return {
      config: next,
      diagnostics: resolved.diagnostics,
    };
  }
  const blocks = ensureOptionalSlot(next, resolved.slotName);
  const existing = blocks.find((block) => block.id === resolved.blockId);
  if (existing) {
    existing.enabled = enabled ? true : false;
  } else {
    blocks.push({
      id: resolved.blockId,
      enabled: enabled ? true : false,
    });
  }
  return {
    config: next,
    diagnostics: validateEditorConfig(next),
  };
}

export function updateAutoFlowBlockParameter(
  config: SavedAutoFlowConfig,
  blockId: string,
  paramName: string,
  value: number,
  slotId?: string,
): { config: SavedAutoFlowConfig; diagnostics: AutoFlowValidationDiagnostic[] } {
  const next = cloneJson(config);
  if (paramName !== "maxIterations") {
    return {
      config: next,
      diagnostics: [{
        code: "unknown-parameter",
        message: `Auto-flow block '${blockId}' does not support parameter '${paramName}'.`,
        blockId,
        paramName,
        value,
      }],
    };
  }
  const resolved = resolveOptionalBlockSlot(blockId, slotId);
  if ("diagnostics" in resolved) {
    return {
      config: next,
      diagnostics: resolved.diagnostics.map((diagnostic) => ({ ...diagnostic, paramName, value })),
    };
  }
  const blocks = ensureOptionalSlot(next, resolved.slotName);
  let block = blocks.find((candidate) => candidate.id === resolved.blockId);
  if (!block) {
    block = {
      id: resolved.blockId,
      enabled: true,
    };
    blocks.push(block);
  }
  block.maxIterations = value;
  return {
    config: next,
    diagnostics: validateEditorConfig(next),
  };
}

export function insertAutoFlowBlock(
  config: SavedAutoFlowConfig,
  slotId: string,
  blockId: string,
): { config: SavedAutoFlowConfig; diagnostics: AutoFlowValidationDiagnostic[]; inserted: boolean } {
  const next = cloneJson(config);
  const validation = validateAutoFlowBlockInsertion(slotId, blockId);
  if (!validation.ok) {
    return {
      config: next,
      inserted: false,
      diagnostics: [{
        code: validation.message.startsWith("Unknown auto-flow block") ? "unknown-block" : "invalid-slot",
        message: validation.message,
        ...(validation.blockId ? { blockId: validation.blockId } : { blockId }),
        ...(validation.slotName ? { slotId: validation.slotName } : { slotId }),
      }],
    };
  }
  if (!validation.slotName || !validation.blockId) {
    return {
      config: next,
      inserted: false,
      diagnostics: [{
        code: "invalid-slot",
        message: validation.message,
        blockId,
        slotId,
      }],
    };
  }
  const blocks = ensureOptionalSlot(next, validation.slotName);
  if (!blocks.some((block) => block.id === validation.blockId)) {
    blocks.push({
      id: validation.blockId,
      enabled: true,
    });
  }
  return {
    config: next,
    inserted: true,
    diagnostics: validateEditorConfig(next),
  };
}

export function removeAutoFlowBlock(
  config: SavedAutoFlowConfig,
  slotId: string,
  blockId: string,
): { config: SavedAutoFlowConfig; diagnostics: AutoFlowValidationDiagnostic[]; removed: boolean } {
  const next = cloneJson(config);
  const coreDefinition = getBuiltInAutoFlowBlockDefinition(blockId);
  if (coreDefinition?.locked) {
    return {
      config: next,
      removed: false,
      diagnostics: [{
        code: "locked-block-removed",
        message: `Locked auto-flow block '${blockId}' cannot be removed.`,
        blockId,
        slotId,
      }],
    };
  }
  const resolved = resolveOptionalBlockSlot(blockId, slotId);
  if ("diagnostics" in resolved) {
    return {
      config: next,
      removed: false,
      diagnostics: resolved.diagnostics,
    };
  }
  const blocks = ensureOptionalSlot(next, resolved.slotName);
  const retained = blocks.filter((block) => block.id !== resolved.blockId);
  const removed = retained.length !== blocks.length;
  if (!removed) {
    return {
      config: next,
      removed: false,
      diagnostics: [{
        code: "unknown-block",
        message: `Auto-flow block '${resolved.blockId}' is not configured in slot '${resolved.slotName}'.`,
        blockId: resolved.blockId,
        slotId: resolved.slotName,
      }],
    };
  }
  blocks.splice(0, blocks.length, ...retained);
  return {
    config: next,
    removed: true,
    diagnostics: validateEditorConfig(next),
  };
}
