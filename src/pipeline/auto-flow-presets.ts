import type { AutoFlowPreset, AutoFlowPresetId } from "./auto-flow-types.js";

export const VIRTUAL_BUILT_IN_AUTO_FLOW_FILE_NAMES = ["auto-simple.json", "auto-common.json"] as const;

export const BUILT_IN_AUTO_FLOW_PRESETS = [
  {
    id: "simple",
    title: "Simple auto flow",
    fileName: "auto-simple.json",
    kind: "auto-flow",
    version: 1,
    description: "End-to-end resumable pipeline without language-specific checks. Runs: task source collection -> task source normalization -> plan -> implement -> review loop.",
    blocks: [
      { blockId: "source.jira", slot: "source", locked: true, defaultEnabled: true },
      { blockId: "normalize.task-source", slot: "normalize", locked: true, defaultEnabled: true },
      { blockId: "planning.plan", slot: "planning", locked: true, defaultEnabled: true },
      { blockId: "implementation.default", slot: "implementation", locked: true, defaultEnabled: true },
      { blockId: "review.loop", slot: "review", defaultEnabled: true },
    ],
  },
  {
    id: "standard",
    title: "Standard auto flow",
    fileName: "auto-common.json",
    kind: "auto-flow",
    version: 1,
    description: "End-to-end resumable pipeline without language-specific checks. Runs: task source collection -> task source normalization -> plan -> design-review loop -> implement -> review loop.",
    blocks: [
      { blockId: "source.jira", slot: "source", locked: true, defaultEnabled: true },
      { blockId: "normalize.task-source", slot: "normalize", locked: true, defaultEnabled: true },
      { blockId: "planning.plan", slot: "planning", locked: true, defaultEnabled: true },
      { blockId: "review.design-loop", slot: "designReview", defaultEnabled: true },
      { blockId: "implementation.default", slot: "implementation", locked: true, defaultEnabled: true },
      { blockId: "review.loop", slot: "review", defaultEnabled: true },
    ],
  },
] as const satisfies readonly AutoFlowPreset[];

const presetById = new Map<AutoFlowPresetId, AutoFlowPreset>(
  BUILT_IN_AUTO_FLOW_PRESETS.map((preset) => [preset.id, preset]),
);

const presetByFileName = new Map<string, AutoFlowPreset>(
  BUILT_IN_AUTO_FLOW_PRESETS.map((preset) => [preset.fileName, preset]),
);

export function listBuiltInAutoFlowPresets(): AutoFlowPreset[] {
  return [...BUILT_IN_AUTO_FLOW_PRESETS];
}

export function getBuiltInAutoFlowPreset(presetId: AutoFlowPresetId): AutoFlowPreset {
  const preset = presetById.get(presetId);
  if (!preset) {
    throw new Error(`Unknown built-in auto-flow preset '${presetId}'.`);
  }
  return preset;
}

export function getBuiltInAutoFlowPresetByFileName(fileName: string): AutoFlowPreset | null {
  return presetByFileName.get(fileName) ?? null;
}

export function isVirtualBuiltInAutoFlowFileName(fileName: string): boolean {
  return VIRTUAL_BUILT_IN_AUTO_FLOW_FILE_NAMES.includes(fileName as (typeof VIRTUAL_BUILT_IN_AUTO_FLOW_FILE_NAMES)[number]);
}
