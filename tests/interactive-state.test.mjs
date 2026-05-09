import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const stateModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/state.js")).href
);
const autoFlowModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/auto-flow.js")).href
);

describe("interactive state bootstrap", () => {
  it("derives the initial selection and summary visibility from session options", () => {
    const state = stateModule.createInitialInteractiveState({
      scopeKey: "ag-86",
      jiraIssueKey: "AG-86",
      summaryText: "Existing summary",
      cwd: process.cwd(),
      gitBranchName: "feature/ink",
      version: "0.1.15",
      getRunConfirmation: async () => ({
        hasExistingState: false,
        requiresExplicitChoice: false,
        resume: { available: false, reason: "No saved state found." },
        continue: { available: false, reason: "No saved state found." },
        restart: { available: true, reason: "Start a fresh attempt." },
      }),
      onRun: async () => {},
      onInterrupt: async () => {},
      onExit: () => {},
      flows: [
        {
          id: "auto-common",
          label: "Auto Common",
          description: "Run the common auto flow.",
          source: "built-in",
          treePath: ["default", "auto-common"],
          phases: [],
        },
      ],
    });

    assert.equal(state.selectedFlowId, "auto-common");
    assert.equal(state.selectedFlowItemKey, "flow:auto-common");
    assert.equal(state.focusedPane, "flows");
    assert.equal(state.summaryVisible, true);
    assert.equal(state.flowTreeKeys[0], "folder:default");
    assert.equal(state.gitBranchName, "feature/ink");
  });

  it("keeps technical subfolders collapsed by default and selects the first visible flow", () => {
    const state = stateModule.createInitialInteractiveState({
      scopeKey: "ag-86",
      jiraIssueKey: "AG-86",
      summaryText: "",
      cwd: process.cwd(),
      gitBranchName: "feature/ink",
      version: "0.1.15",
      getRunConfirmation: async () => ({
        hasExistingState: false,
        requiresExplicitChoice: false,
        resume: { available: false, reason: "No saved state found." },
        continue: { available: false, reason: "No saved state found." },
        restart: { available: true, reason: "Start a fresh attempt." },
      }),
      onRun: async () => {},
      onInterrupt: async () => {},
      onExit: () => {},
      flows: [
        {
          id: "custom-review",
          label: "Custom Review",
          description: "Run the custom review flow.",
          source: "project-local",
          treePath: ["custom", "review", "custom-review"],
          phases: [],
        },
        {
          id: "auto-common",
          label: "Auto Common",
          description: "Run the common auto flow.",
          source: "built-in",
          treePath: ["default", "auto-common"],
          phases: [],
        },
      ],
    });

    assert.equal(state.selectedFlowId, "auto-common");
    assert.equal(state.selectedFlowItemKey, "flow:auto-common");
  });
});

describe("interactive auto-flow model", () => {
  it("renders the simple preset as all eight fixed slots", () => {
    const definition = autoFlowModule.createPresetAutoFlowDefinition("simple");
    const model = autoFlowModule.buildAutoFlowEditorViewModel(definition);

    assert.equal(model.status.canReset, false);
    assert.deepEqual(model.slots.map((slot) => slot.slotId), [
      "source",
      "normalize",
      "planning",
      "designReview",
      "implementation",
      "postImplementationChecks",
      "review",
      "final",
    ]);
    assert.equal(model.slots.find((slot) => slot.slotId === "source").blocks[0].blockId, "source.jira");
    assert.equal(model.slots.find((slot) => slot.slotId === "designReview").status, "empty");
    assert.equal(model.slots.find((slot) => slot.slotId === "postImplementationChecks").status, "empty");
    assert.equal(model.slots.find((slot) => slot.slotId === "final").status, "empty");
    assert.equal(model.slots.find((slot) => slot.slotId === "review").blocks[0].blockId, "review.loop");
  });

  it("renders the standard preset review blocks and locked core actions", () => {
    const definition = autoFlowModule.createPresetAutoFlowDefinition("standard");
    const model = autoFlowModule.buildAutoFlowEditorViewModel(definition);

    assert.equal(model.status.canReset, false);
    assert.equal(model.slots.find((slot) => slot.slotId === "designReview").blocks[0].blockId, "review.design-loop");
    assert.equal(model.slots.find((slot) => slot.slotId === "review").blocks[0].blockId, "review.loop");

    const lockedCore = model.slots.find((slot) => slot.slotId === "implementation").blocks[0];
    assert.equal(lockedCore.locked, true);
    assert.equal(lockedCore.actions.canDisable, false);
    assert.equal(lockedCore.actions.canRemove, false);
  });

  it("keeps locked core blocks immutable and exposes invalid maxIterations diagnostics", () => {
    const definition = autoFlowModule.createPresetAutoFlowDefinition("standard");
    const locked = autoFlowModule.setAutoFlowBlockEnabled(definition.config, "implementation.default", false);
    assert.equal(locked.diagnostics[0].code, "locked-block-disabled");
    const blockedModel = autoFlowModule.buildAutoFlowEditorViewModel(definition, {
      config: locked.config,
      diagnostics: locked.diagnostics,
    });
    assert.equal(blockedModel.slots.find((slot) => slot.slotId === "implementation").blocks[0].status, "blocked");

    const invalidParam = autoFlowModule.updateAutoFlowBlockParameter(definition.config, "review.loop", "maxIterations", 6);
    const model = autoFlowModule.buildAutoFlowEditorViewModel(definition, {
      config: invalidParam.config,
      diagnostics: invalidParam.diagnostics,
    });
    assert.equal(model.status.canRun, false);
    assert.equal(model.status.canSave, false);
    assert.equal(model.status.canReset, true);
    assert.match(model.diagnostics[0].message, /between 1 and 5; received 6/);
    assert.equal(model.slots.find((slot) => slot.slotId === "review").blocks[0].status, "invalid");
  });

  it("edits and removes repeated optional block ids by slot", () => {
    const definition = autoFlowModule.createPresetAutoFlowDefinition("standard");
    const config = {
      ...definition.config,
      slots: {
        postImplementationChecks: {
          blocks: [{ id: "checks.go.linter", enabled: true, maxIterations: 5 }],
        },
        final: {
          blocks: [{ id: "checks.go.linter", enabled: true, maxIterations: 5 }],
        },
      },
    };

    const disabledFinal = autoFlowModule.setAutoFlowBlockEnabled(config, "checks.go.linter", false, "final");
    assert.equal(disabledFinal.diagnostics.length, 0);
    assert.equal(disabledFinal.config.slots.postImplementationChecks.blocks[0].enabled, true);
    assert.equal(disabledFinal.config.slots.final.blocks[0].enabled, false);

    const updatedFinal = autoFlowModule.updateAutoFlowBlockParameter(disabledFinal.config, "checks.go.linter", "maxIterations", 4, "final");
    assert.equal(updatedFinal.diagnostics.length, 0);
    assert.equal(updatedFinal.config.slots.postImplementationChecks.blocks[0].maxIterations, 5);
    assert.equal(updatedFinal.config.slots.final.blocks[0].maxIterations, 4);

    const removedFinal = autoFlowModule.removeAutoFlowBlock(updatedFinal.config, "final", "checks.go.linter");
    assert.equal(removedFinal.removed, true);
    assert.equal(removedFinal.config.slots.postImplementationChecks.blocks.some((block) => block.id === "checks.go.linter"), true);
    assert.equal(removedFinal.config.slots.final.blocks.some((block) => block.id === "checks.go.linter"), false);
  });
});
