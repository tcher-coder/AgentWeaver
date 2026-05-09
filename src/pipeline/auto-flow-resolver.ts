import { TaskRunnerError } from "../errors.js";
import { getBuiltInAutoFlowBlockDefinition } from "./auto-flow-blocks.js";
import {
  getBuiltInAutoFlowPreset,
  getBuiltInAutoFlowPresetByFileName,
} from "./auto-flow-presets.js";
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
import type { DeclarativeFlowSpec } from "./spec-types.js";

type WorkingPlacement = {
  blockId: string;
  slot: string;
  enabled: boolean;
  params: AutoFlowParameterValues;
  index: number;
};

const slotOrder = new Map<string, number>(AUTO_FLOW_SLOT_IDS.map((slot, index) => [slot, index]));

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
        presetId: preset.id,
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
  const preset = getBuiltInAutoFlowPresetByFileName(fileName);
  if (!preset) {
    return null;
  }
  const result = resolveAutoFlowPreset(preset);
  if (!result.spec) {
    const details = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    throw new TaskRunnerError(`Failed to resolve built-in auto-flow '${fileName}'.\n${details}`);
  }
  return result.spec;
}
