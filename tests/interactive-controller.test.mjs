import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const controllerModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/controller.js")).href
);
const sessionFactoryModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/create-interactive-session.js")).href
);
const inkSessionModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/ink/index.js")).href
);
const autoFlowModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/auto-flow.js")).href
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readyToRunConfirmation() {
  return {
    hasExistingState: false,
    requiresExplicitChoice: false,
    resume: { available: false, reason: "No saved state found." },
    continue: { available: false, reason: "No saved state found." },
    restart: { available: true, reason: "Start a fresh attempt." },
    details: "Ready to run.",
  };
}

function createController() {
  return new controllerModule.InteractiveSessionController({
    scopeKey: "ag-86",
    jiraIssueKey: "AG-86",
    summaryText: "Existing summary",
    cwd: process.cwd(),
    gitBranchName: "feature/ink-model",
    version: "0.1.15",
    getRunConfirmation: async () => readyToRunConfirmation(),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    flows: [
      {
        id: "auto-common",
        label: "Auto Common",
        description: "Run the common auto flow.",
        source: "built-in",
        treePath: ["recommended", "auto-common"],
        catalogRole: "recipe",
        phases: [],
      },
      {
        id: "custom-review",
        label: "Custom Review",
        description: "Run the custom review flow.",
        source: "project-local",
        treePath: ["custom", "project-flows", "review", "custom-review"],
        sourcePath: "flows/custom-review.json",
        phases: [],
      },
    ],
  });
}

function createBusyController(overrides = {}) {
  return new controllerModule.InteractiveSessionController({
    scopeKey: "ag-86",
    jiraIssueKey: "AG-86",
    summaryText: "Existing summary",
    cwd: process.cwd(),
    gitBranchName: "feature/ink-model",
    version: "0.1.15",
    getRunConfirmation: async () => readyToRunConfirmation(),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    flows: [
      {
        id: "first-flow",
        label: "First Flow",
        description: "First flow.",
        source: "built-in",
        treePath: ["recommended", "first-flow"],
        phases: [],
      },
      {
        id: "second-flow",
        label: "Second Flow",
        description: "Second flow.",
        source: "built-in",
        treePath: ["recommended", "second-flow"],
        phases: [],
      },
    ],
    ...overrides,
  });
}

function createProgressController() {
  return new controllerModule.InteractiveSessionController({
    scopeKey: "ag-120",
    jiraIssueKey: "AG-120",
    summaryText: "Existing summary",
    cwd: process.cwd(),
    gitBranchName: "feature/progress-tree",
    version: "0.1.19",
    getRunConfirmation: async () => readyToRunConfirmation(),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    flows: [
      {
        id: "progress-flow",
        label: "Progress Flow",
        description: "Flow with progress rows.",
        source: "built-in",
        treePath: ["recommended", "progress-flow"],
        phases: [
          {
            id: "phase_one_1",
            repeatVars: { item: 1 },
            steps: [{ id: "step-done" }, { id: "step-running" }],
          },
          {
            id: "phase_two_1",
            repeatVars: { item: 1 },
            steps: [{ id: "step-pending" }, { id: "step-skipped" }],
          },
        ],
      },
    ],
  });
}

function createAutoFlowDefinition() {
  const definition = autoFlowModule.createBaseAutoFlowDefinition();
  return {
    ...definition,
    config: {
      ...definition.config,
      name: "preset-standard",
    },
  };
}

function createAutoFlowController(overrides = {}) {
  return new controllerModule.InteractiveSessionController({
    scopeKey: "ag-127",
    jiraIssueKey: "AG-127",
    summaryText: "Existing summary",
    cwd: process.cwd(),
    gitBranchName: "feature/auto-flow",
    version: "0.1.19",
    getRunConfirmation: async () => readyToRunConfirmation(),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    flows: [
      {
        id: "auto-common",
        label: "Auto Common",
        description: "Run configurable standard auto flow.",
        source: "built-in",
        treePath: ["recommended", "auto-common"],
        catalogRole: "recipe",
        autoFlow: createAutoFlowDefinition(),
        phases: [
          { id: "source", repeatVars: {}, steps: [{ id: "fetch_jira_source" }] },
          { id: "normalize", repeatVars: {}, steps: [{ id: "run_normalize_source" }] },
          { id: "plan", repeatVars: {}, steps: [{ id: "run_plan_flow" }] },
          { id: "design_review_loop", repeatVars: {}, steps: [{ id: "run_design_review_loop" }] },
          { id: "implement", repeatVars: {}, steps: [{ id: "run_implement" }] },
          { id: "review-loop", repeatVars: {}, steps: [{ id: "run_review_loop" }] },
        ],
      },
    ],
    ...overrides,
  });
}

function gitSnapshot(overrides = {}) {
  return {
    available: true,
    repositoryRoot: "/repo",
    branch: "main",
    detachedHead: false,
    clean: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    lastCommit: { hash: "abc1234567", shortHash: "abc1234", subject: "Initial", authoredAt: "2026-01-01" },
    changedFiles: [
      { path: "--option-like.ts", file: "--option-like.ts", xy: " M", indexStatus: " ", workTreeStatus: "M", staged: false, type: "modified" },
    ],
    branches: [{ name: "main", current: true }],
    remotes: [],
    canPush: false,
    pushDisabledReason: "No Git remote is configured.",
    warnings: [],
    error: null,
    refreshedAt: "2026-01-01T00:00:00.000Z",
    selectedPaths: [],
    commitMessage: "",
    operation: { status: "idle" },
    ...overrides,
  };
}

function createGitController(gitService) {
  return createBusyController({
    gitService,
  });
}

describe("interactive controller", () => {
  it("drives flow tree expansion and pane focus through the shared model", async () => {
    const controller = createController();
    controller.mount();

    let view = controller.getViewModel();
    assert.ok(view.flowItems.length > 2);
    assert.equal(view.flowItems[0]?.label, "▾ Recommended");
    assert.equal(view.flowItems[0]?.kind, "folder");
    assert.equal(view.flowItems[0]?.depth, 0);
    assert.equal(view.flowItems[0]?.expanded, true);
    assert.equal(view.flowItems[1]?.label, "  • Auto Common");
    assert.equal(view.flowItems[2]?.label, "▾ Custom");
    assert.equal(view.flowItems[2]?.expanded, true);
    assert.equal(view.flowItems.some((item) => item.label.includes("Custom Review")), false);

    controller.selectFlowKey("folder:custom/project-flows");
    await controller.handleKeypress("", { name: "right" });
    view = controller.getViewModel();
    const projectFlows = view.flowItems.find((item) => item.key === "folder:custom/project-flows");
    assert.equal(projectFlows?.label, "  ▾ Project flows");
    assert.equal(projectFlows?.expanded, true);
    const reviewFolder = view.flowItems.find((item) => item.key === "folder:custom/project-flows/review");
    assert.equal(reviewFolder?.label, "    ▸ review");
    assert.equal(reviewFolder?.depth, 2);

    controller.selectFlowKey("folder:custom/project-flows/review");
    await controller.handleKeypress("", { name: "right" });
    view = controller.getViewModel();
    assert.ok(view.flowItems.some((item) => item.label.includes("Custom Review")));

    await controller.handleKeypress("", { name: "tab" });
    view = controller.getViewModel();
    assert.equal(view.progressTitle, "▶ Current Flow");

    controller.destroy();
  });

  it("exposes structured progress alongside the plain text progress snapshot", () => {
    const controller = createProgressController();
    controller.mount();
    controller.selectFlowId("progress-flow");
    controller.createAdapter().setFlowState({
      flowId: "progress-flow",
      executionState: {
        flowKind: "demo",
        flowVersion: 1,
        terminated: true,
        terminationOutcome: "success",
        terminationReason: "completed",
        phases: [
          {
            id: "phase_one_1",
            status: "done",
            repeatVars: { item: 1 },
            steps: [
              { id: "step-done", status: "done" },
              { id: "step-running", status: "running" },
            ],
          },
          {
            id: "phase_two_1",
            status: "pending",
            repeatVars: { item: 1 },
            steps: [
              { id: "step-pending", status: "pending" },
              { id: "step-skipped", status: "skipped" },
            ],
          },
        ],
      },
    });

    const view = controller.getViewModel();
    assert.equal(view.progress.flow.id, "progress-flow");
    assert.match(view.progressText, /Progress Flow/);
    assert.equal(view.progress.items[0].kind, "group");
    assert.equal(view.progress.items[0].status, "pending");
    assert.deepEqual(
      view.progress.items.map((item) => [item.kind, item.label, item.depth, item.status]),
      [
        ["group", "item 1", 0, "pending"],
        ["phase", "phase_one", 1, "done"],
        ["step", "step-done", 2, "done"],
        ["step", "step-running", 2, "running"],
        ["phase", "phase_two", 1, "pending"],
        ["step", "step-pending", 2, "pending"],
        ["step", "step-skipped", 2, "skipped"],
        ["termination", "Flow completed successfully", 0, "done"],
      ],
    );
    assert.equal(view.progress.anchorIndex, 3);
    controller.destroy();
  });

  it("maps configurable auto-flow slots and blocks from runtime state", async () => {
    const controller = createAutoFlowController();
    controller.mount();
    controller.selectFlowId("auto-common");
    controller.createAdapter().setFlowState({
      flowId: "auto-common",
      executionState: {
        flowKind: "auto-flow",
        flowVersion: 1,
        terminated: false,
        phases: [
          { id: "source", status: "done", repeatVars: {}, steps: [{ id: "fetch_jira_source", status: "done" }] },
          { id: "normalize", status: "running", repeatVars: {}, steps: [{ id: "run_normalize_source", status: "running" }] },
          { id: "plan", status: "pending", repeatVars: {}, steps: [] },
          { id: "design_review_loop", status: "skipped", repeatVars: {}, steps: [] },
        ],
      },
    });

    let view = controller.getViewModel();
    assert.equal(view.progress.items.find((item) => item.kind === "slot" && item.slotId === "source").status, "success");
    assert.equal(view.progress.items.find((item) => item.kind === "block" && item.blockId === "normalize.task-source").status, "running");
    assert.equal(view.progress.items.find((item) => item.kind === "block" && item.blockId === "review.design-loop").status, "skipped");
    assert.equal(view.progress.items.find((item) => item.kind === "slot" && item.slotId === "postImplementationChecks").status, "empty");

    const waitRequest = controller.requestUserInput({
      formId: "wait",
      title: "Wait",
      fields: [{ id: "answer", type: "text", label: "Answer", required: true }],
    });
    view = controller.getViewModel();
    assert.equal(view.progress.items.find((item) => item.kind === "block" && item.blockId === "normalize.task-source").status, "waiting-user");
    controller.interruptActiveForm();
    await assert.rejects(waitRequest);
    controller.destroy();
  });

  it("shows stopped, failed, disabled, invalid, and blocked auto-flow states", async () => {
    const controller = createAutoFlowController();
    controller.mount();
    controller.selectFlowId("auto-common");
    controller.toggleAutoFlowBlock("auto-common", "review.design-loop", false);
    controller.updateAutoFlowParameter("auto-common", "review.loop", "maxIterations", 6);

    let view = controller.getViewModel();
    assert.equal(view.autoFlow.status.canRun, false);
    assert.equal(view.autoFlow.slots.find((slot) => slot.slotId === "designReview").blocks[0].status, "disabled");
    assert.equal(view.autoFlow.slots.find((slot) => slot.slotId === "review").blocks[0].status, "invalid");
    assert.equal(view.progress.items.find((item) => item.kind === "block" && item.blockId === "review.design-loop").status, "disabled");
    assert.equal(view.progress.items.find((item) => item.kind === "block" && item.blockId === "review.loop").status, "invalid");
    await controller.openRunConfirm("auto-common");
    assert.equal(controller.getViewModel().confirmation, null);
    assert.match(controller.getViewModel().logText, /between 1 and 5; received 6/);

    controller.updateAutoFlowParameter("auto-common", "review.loop", "maxIterations", 5);
    controller.createAdapter().setFlowState({
      flowId: "auto-common",
      executionState: {
        flowKind: "auto-flow",
        flowVersion: 1,
        terminated: true,
        terminationOutcome: "stopped",
        terminationReason: "Stopped by implement: user requested stop",
        phases: [
          { id: "source", status: "done", repeatVars: {}, steps: [] },
          { id: "implement", status: "running", repeatVars: {}, steps: [] },
        ],
      },
    });
    view = controller.getViewModel();
    assert.equal(view.progress.items.find((item) => item.kind === "block" && item.blockId === "implementation.default").status, "stopped");

    controller.setFlowFailed("auto-common");
    view = controller.getViewModel();
    assert.equal(view.progress.items.find((item) => item.kind === "block" && item.blockId === "implementation.default").status, "failed");

    assert.throws(
      () => controller.insertAutoFlowBlock("auto-common", "designReview", "review.loop"),
      /cannot be inserted into slot 'designReview'/,
    );
    assert.equal(controller.getViewModel().autoFlow.status.valid, false);
    controller.destroy();
  });

  it("resets auto-flow edits to the last saved editor baseline", () => {
    const controller = createAutoFlowController();
    controller.mount();
    controller.selectFlowId("auto-common");

    assert.equal(controller.getViewModel().autoFlow.status.canReset, false);
    controller.toggleAutoFlowBlock("auto-common", "review.design-loop", false);

    let view = controller.getViewModel();
    assert.equal(view.autoFlow.status.canReset, true);
    assert.equal(view.autoFlow.slots.find((slot) => slot.slotId === "designReview").blocks[0].enabled, false);

    controller.resetAutoFlowConfig("auto-common");
    view = controller.getViewModel();
    assert.equal(view.autoFlow.status.canReset, false);
    assert.equal(view.autoFlow.status.lastMessage, "Reset auto-flow changes.");
    assert.equal(view.autoFlow.slots.find((slot) => slot.slotId === "designReview").blocks[0].enabled, true);
    controller.destroy();
  });

  it("rejects legacy auto-flow preset switching without selecting another flow", () => {
    const controller = createAutoFlowController();
    controller.mount();
    controller.selectFlowId("auto-common");

    assert.throws(
      () => controller.selectAutoFlowPreset("simple"),
      /--preset is unsupported/,
    );
    const view = controller.getViewModel();

    assert.equal(view.flowItems[view.selectedFlowIndex].key, "flow:auto-common");
    assert.equal(view.autoFlow.status.canReset, false);
    assert.equal(view.autoFlow.status.canRun, true);
    assert.equal(view.autoFlow.slots.find((slot) => slot.slotId === "designReview").blocks[0].blockId, "review.design-loop");
    assert.equal(view.progress.flow.id, "auto-common");
    assert.equal(
      view.progress.items.some((item) => item.kind === "block" && item.blockId === "review.design-loop"),
      true,
    );
    controller.destroy();
  });

  it("requires unsaved auto-flow drafts to be saved before running", async () => {
    const controller = createAutoFlowController();
    controller.mount();
    controller.selectFlowId("auto-common");
    controller.toggleAutoFlowBlock("auto-common", "review.design-loop", false);

    await controller.openRunConfirm("auto-common");
    const view = controller.getViewModel();

    assert.equal(view.confirmation, null);
    assert.match(view.logText, /Save this auto-flow draft before running it/);
    assert.equal(view.autoFlow.status.lastMessage, "Save this auto-flow draft before running it.");
    controller.destroy();
  });

  it("saves edited presets as selectable auto-config flows and switches to them", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-interactive-save-auto-flow-"));
    const controller = createAutoFlowController({ cwd: tempDir });
    try {
      controller.mount();
      controller.selectFlowId("auto-common");
      controller.toggleAutoFlowBlock("auto-common", "checks.go.linter", true, "final");
      controller.toggleAutoFlowBlock("auto-common", "checks.go.tests", true, "final");

      let view = controller.getViewModel();
      assert.equal(view.autoFlow.slots.find((slot) => slot.slotId === "final").blocks.length, 2);
      assert.equal(
        view.progress.items.some((item) => item.kind === "block" && item.blockId === "checks.go.linter"),
        true,
      );

      controller.saveAutoFlowConfig("auto-common", "preset-standard");
      view = controller.getViewModel();

      assert.equal(view.flowItems[view.selectedFlowIndex].key, "flow:auto-config:preset-standard");
      assert.equal(view.autoFlow.source.type, "project-config");
      assert.equal(view.progress.flow.id, "auto-config:preset-standard");
      assert.equal(
        view.progress.items.find((item) => item.kind === "block" && item.slotId === "final" && item.blockId === "checks.go.linter").status,
        "pending",
      );
      assert.equal(
        view.progress.items.find((item) => item.kind === "block" && item.slotId === "final" && item.blockId === "checks.go.tests").status,
        "pending",
      );

      controller.selectFlowId("auto-common");
      view = controller.getViewModel();
      assert.equal(view.progress.flow.id, "auto-common");
      assert.equal(
        view.progress.items.some((item) => item.kind === "block" && item.blockId === "checks.go.linter"),
        false,
      );
    } finally {
      controller.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("renders shared form state independently from blessed widgets", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "demo-form",
      title: "Demo Form",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Name",
          required: true,
        },
      ],
    });

    let view = controller.getViewModel();
    assert.equal(view.form?.title, "User Input");
    assert.match(view.form?.content ?? "", /Demo Form/);
    assert.match(view.form?.content ?? "", /Text input:/);
    assert.match(view.form?.content ?? "", /┌/);
    assert.match(view.form?.content ?? "", /│ │/);
    assert.match(view.form?.content ?? "", /└/);

    await controller.handleKeypress("A", { name: "a" });
    await controller.handleKeypress("", { name: "enter" });

    const result = await request;
    assert.equal(result.values.name, "A");

    view = controller.getViewModel();
    assert.equal(view.form, null);
  });

  it("shows text input placeholders separately from the editable field", () => {
    const controller = createController();
    controller.requestUserInput({
      formId: "placeholder-form",
      title: "Placeholder Form",
      fields: [
        {
          id: "jira",
          type: "text",
          label: "Jira issue key",
          required: true,
          placeholder: "DEMO-1234",
        },
      ],
    });

    const view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Text input:/);
    assert.match(view.form?.content ?? "", /┌/);
    assert.match(view.form?.content ?? "", /│ │/);
    assert.match(view.form?.content ?? "", /Hint: DEMO-1234/);
  });

  it("updates the scope and branch label together", () => {
    const controller = createController();

    controller.setScope("ag-112@abcd1234", null, "AG-112");

    const view = controller.getViewModel();
    assert.match(view.header, /Scope ag-112@abcd1234/);
    assert.match(view.header, /AG-112$/);
  });

  it("renders text input box at the provided modal width before typing", () => {
    const controller = createController();
    controller.requestUserInput({
      formId: "wide-form",
      title: "Wide Form",
      fields: [
        {
          id: "summary",
          type: "text",
          label: "Summary",
          required: true,
        },
      ],
    });

    const view = controller.getViewModel({ formContentWidth: 30 });
    const boxTopLine = (view.form?.content ?? "").split("\n").find((line) => line.startsWith("┌"));

    assert.equal(boxTopLine, `┌${"─".repeat(32)}┐`);
  });

  it("maps Ink key events into the controller key format", () => {
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress("", {
        upArrow: false,
        downArrow: false,
        leftArrow: true,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: false,
        meta: false,
      }),
      { name: "left", ctrl: false, shift: false, meta: false },
    );
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress("q", {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: false,
        meta: false,
      }),
      { name: "q", ctrl: false, shift: false, meta: false },
    );
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress(" ", {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: false,
        meta: false,
      }),
      { name: "space", ctrl: false, shift: false, meta: false },
    );
    assert.deepEqual(
      inkSessionModule.normalizeInkKeypress("\x7f", {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: true,
        meta: false,
      }),
      { name: "backspace", ctrl: false, shift: false, meta: false },
    );
  });

  it("deletes text with backspace inside form inputs", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "backspace-form",
      title: "Backspace Form",
      fields: [
        {
          id: "name",
          type: "text",
          label: "Name",
          required: true,
        },
      ],
    });

    await controller.handleKeypress("A", { name: "a" });
    await controller.handleKeypress("B", { name: "b" });
    await controller.handleKeypress("", { name: "backspace" });
    await controller.handleKeypress("", { name: "enter" });

    const result = await request;
    assert.equal(result.values.name, "A");
  });

  it("asks for confirmation before exiting the application", async () => {
    let exitCalls = 0;
    const controller = new controllerModule.InteractiveSessionController({
      scopeKey: "ag-86",
      jiraIssueKey: "AG-86",
      summaryText: "Existing summary",
      cwd: process.cwd(),
      gitBranchName: "feature/ink-model",
      version: "0.1.15",
      getRunConfirmation: async () => readyToRunConfirmation(),
      onRun: async () => {},
      onInterrupt: async () => {},
      onExit: () => {
        exitCalls += 1;
      },
      flows: [
        {
          id: "auto-common",
          label: "Auto Common",
          description: "Run the common auto flow.",
          source: "built-in",
          treePath: ["recommended", "auto-common"],
          catalogRole: "recipe",
          phases: [],
        },
      ],
    });
    controller.mount();

    await controller.handleKeypress("q", { name: "q" });
    let view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /Exit AgentWeaver\?/);
    assert.equal(exitCalls, 0);

    await controller.handleKeypress("", { name: "escape" });
    assert.equal(controller.getViewModel().confirmText, null);
    assert.equal(exitCalls, 0);

    await controller.handleKeypress("", { name: "c", ctrl: true });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /Exit AgentWeaver\?/);

    await controller.handleKeypress("", { name: "enter" });
    assert.equal(exitCalls, 1);
  });

  it("toggles checkbox-style form fields on space", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "checkbox-form",
      title: "Checkbox Form",
      fields: [
        {
          id: "flags",
          type: "multi-select",
          label: "Flags",
          required: true,
          options: [
            { label: "Alpha", value: "alpha" },
            { label: "Beta", value: "beta" },
          ],
        },
      ],
    });

    await controller.handleKeypress(" ", { name: "space" });
    let view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /\[x\] Alpha/);

    await controller.handleKeypress("", { name: "down" });
    await controller.handleKeypress(" ", { name: "space" });
    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /\[x\] Beta/);

    await controller.handleKeypress("", { name: "enter" });
    const result = await request;
    assert.deepEqual(result.values.flags, ["alpha", "beta"]);
  });

  it("does not open a second flow confirmation while another flow is busy", async () => {
    let confirmationCalls = 0;
    let releaseRun;
    const runStarted = new Promise((resolve) => {
      releaseRun = resolve;
    });
    const controller = createBusyController({
      getRunConfirmation: async () => {
        confirmationCalls += 1;
        return readyToRunConfirmation();
      },
      onRun: async () => {
        await runStarted;
      },
    });
    controller.mount();

    controller.selectFlowIndex(1);

    await controller.handleKeypress("", { name: "enter" });
    assert.match(controller.getViewModel().confirmText ?? "", /Run flow "First Flow"\?/);

    const runningTask = controller.handleKeypress("", { name: "enter" });
    await Promise.resolve();

    controller.selectFlowIndex(1);
    await controller.handleKeypress("", { name: "enter" });

    assert.equal(confirmationCalls, 1);
    assert.equal(controller.getViewModel().confirmText, null);
    assert.match(controller.getViewModel().header, /\[running\]/);

    releaseRun();
    await runningTask;
    controller.destroy();
  });

  it("treats Shift+Tab as reverse navigation across panes, confirms, and forms", async () => {
    const controller = createController();
    controller.mount();

    await controller.handleKeypress("", { name: "tab" });
    let view = controller.getViewModel();
    assert.equal(view.progressTitle, "▶ Current Flow");

    await controller.handleKeypress("", { name: "tab", shift: true });
    view = controller.getViewModel();
    assert.equal(view.flowListTitle, "▶ Flows");

    controller.selectFlowIndex(1);
    await controller.handleKeypress("", { name: "enter" });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Restart \]/);

    await controller.handleKeypress("", { name: "tab" });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Cancel \]/);

    await controller.handleKeypress("", { name: "tab", shift: true });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Restart \]/);

    await controller.handleKeypress("", { name: "escape" });

    const request = controller.requestUserInput({
      formId: "reverse-nav-form",
      title: "Reverse Navigation Form",
      fields: [
        {
          id: "first",
          type: "text",
          label: "First field",
          required: true,
        },
        {
          id: "second",
          type: "text",
          label: "Second field",
          required: true,
        },
      ],
    });

    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Field 1\/2/);

    await controller.handleKeypress("", { name: "tab" });
    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Field 2\/2/);

    await controller.handleKeypress("", { name: "tab", shift: true });
    view = controller.getViewModel();
    assert.match(view.form?.content ?? "", /Field 1\/2/);

    controller.interruptActiveForm();
    await assert.rejects(request);
    controller.destroy();
  });

  it("buffers log appends and emits incremental log updates instead of render events per chunk", async () => {
    const controller = createController();
    const events = [];
    const unsubscribe = controller.subscribe((event) => {
      events.push(event);
    });

    controller.appendLog("first chunk");
    controller.appendLog("second chunk");

    assert.equal(controller.getViewModel().logText, "first chunk\nsecond chunk");
    assert.deepEqual(events, []);

    await sleep(160);

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "log");
    assert.deepEqual(events[0]?.appendedLines, ["first chunk", "second chunk"]);

    unsubscribe();
    controller.destroy();
  });

  it("renders the last full Ink page when log scroll follows the end of a long buffer", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const logText = lines.join("\n");

    assert.equal(
      inkSessionModule.sliceFromScroll(logText, lines.length - 1, 5),
      lines.slice(-5).join("\n"),
    );
    assert.equal(
      inkSessionModule.sliceFromScroll(logText, 8, 5),
      lines.slice(8, 13).join("\n"),
    );
  });

  it("shows continue as an explicit interactive action when continue and restart are both valid", async () => {
    const controller = createBusyController({
      getRunConfirmation: async () => ({
        hasExistingState: true,
        requiresExplicitChoice: true,
        resume: { available: false, reason: "The saved run already terminated and cannot be resumed." },
        continue: { available: true, reason: "Start the next iteration from the latest active artifacts." },
        restart: { available: true, reason: "Archive the active attempt and start a fresh run." },
        details: "Continuable loop boundary found.",
      }),
    });
    controller.mount();

    await controller.handleKeypress("", { name: "enter" });
    let view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Continue \]/);
    assert.match(view.confirmText ?? "", /Restart/);

    await controller.handleKeypress("", { name: "right" });
    view = controller.getViewModel();
    assert.match(view.confirmText ?? "", /\[ Restart \]/);

    controller.destroy();
  });

  it("exposes semantic run confirmation metadata and preserves invalid action state", async () => {
    const runs = [];
    const controller = createBusyController({
      getRunConfirmation: async () => ({
        hasExistingState: true,
        requiresExplicitChoice: true,
        resume: { available: true, reason: "Saved state is resumable." },
        continue: { available: true, reason: "Continue from current artifacts." },
        restart: { available: true, reason: "Start again." },
        details: "Choose launch mode.",
      }),
      onRun: async (flowId, mode) => {
        runs.push({ flowId, mode });
      },
    });
    controller.mount();

    await controller.openRunConfirm("first-flow");
    let view = controller.getViewModel();
    assert.equal(view.confirmation.kind, "run");
    assert.equal(view.confirmation.flowId, "first-flow");
    assert.deepEqual(view.confirmation.actions, ["resume", "continue", "restart", "cancel"]);
    assert.equal(view.confirmation.selectedAction, "resume");
    assert.match(view.confirmText, /Run flow "First Flow"\?/);

    controller.selectConfirmAction("restart");
    assert.equal(controller.getViewModel().confirmation.selectedAction, "restart");
    assert.throws(() => controller.selectConfirmAction("stop"), /Invalid confirmation action/);
    assert.equal(controller.getViewModel().confirmation.selectedAction, "restart");
    controller.cancelConfirm();
    assert.equal(controller.getViewModel().confirmation, null);

    await controller.openRunConfirm("first-flow");
    controller.selectConfirmAction("continue");
    await controller.acceptConfirm();
    assert.deepEqual(runs, [{ flowId: "first-flow", mode: "continue" }]);
    controller.destroy();
  });

  it("opens interrupt confirmation and invokes the interrupt callback through acceptConfirm", async () => {
    let releaseRun;
    const interrupted = [];
    const controller = createBusyController({
      onRun: async () => {
        await new Promise((resolve) => {
          releaseRun = resolve;
        });
      },
      onInterrupt: async (flowId) => {
        interrupted.push(flowId);
      },
    });
    controller.mount();
    controller.selectFlowIndex(1);
    await controller.openRunConfirm("first-flow");
    const runningTask = controller.acceptConfirm();
    await Promise.resolve();

    controller.openInterruptConfirm();
    let view = controller.getViewModel();
    assert.equal(view.confirmation.kind, "interrupt");
    assert.deepEqual(view.confirmation.actions, ["stop", "cancel"]);
    controller.selectConfirmAction("cancel");
    await controller.acceptConfirm();
    assert.deepEqual(interrupted, []);

    controller.openInterruptConfirm();
    controller.selectConfirmAction("stop");
    await controller.acceptConfirm();
    assert.deepEqual(interrupted, ["first-flow"]);

    releaseRun();
    await runningTask;
    controller.destroy();
  });

  it("updates all form field types directly and exposes validation errors without closing the form", async () => {
    const controller = createController();
    const request = controller.requestUserInput({
      formId: "direct-form",
      title: "Direct Form",
      fields: [
        { id: "name", type: "text", label: "Name", required: true },
        { id: "notes", type: "text", label: "Notes", multiline: true },
        { id: "enabled", type: "boolean", label: "Enabled" },
        {
          id: "mode",
          type: "single-select",
          label: "Mode",
          required: true,
          options: [
            { value: "fast", label: "Fast" },
            { value: "safe", label: "Safe" },
          ],
        },
        {
          id: "tags",
          type: "multi-select",
          label: "Tags",
          required: true,
          options: [
            { value: "api", label: "API" },
            { value: "ui", label: "UI" },
          ],
        },
      ],
    });

    let view = controller.getViewModel();
    assert.equal(view.form.formId, "direct-form");
    assert.equal(view.form.currentFieldId, "name");
    assert.equal(view.form.fields.length, 5);

    assert.throws(() => controller.submitForm(), /Form validation failed/);
    view = controller.getViewModel();
    assert.equal(view.form.formId, "direct-form");
    assert.match(view.form.error, /Field 'Name' is required/);
    assert.match(view.logText, /Field 'Name' is required/);

    assert.throws(() => controller.updateFormField("missing", "value"), /Unknown form field/);
    assert.equal(controller.getViewModel().form.currentFieldId, "name");

    controller.updateFormField("name", "Ada");
    controller.updateFormField("notes", "Line 1\nLine 2");
    controller.updateFormField("enabled", true);
    controller.updateFormField("mode", "safe");
    controller.updateFormField("tags", ["api", "ui"]);
    assert.equal(controller.getViewModel().form.error, null);
    controller.submitForm();

    const result = await request;
    assert.deepEqual(result.values, {
      name: "Ada",
      notes: "Line 1\nLine 2",
      enabled: true,
      mode: "safe",
      tags: ["api", "ui"],
    });
    assert.equal(controller.getViewModel().form, null);
  });

  it("handles help, scroll, folder toggle, invalid selection, and log clearing through direct methods", () => {
    const controller = createController();
    controller.mount();

    const initial = controller.getViewModel();
    assert.throws(() => controller.selectFlowIndex(999), /Invalid flow index/);
    assert.equal(controller.getViewModel().selectedFlowIndex, initial.selectedFlowIndex);
    controller.selectFlowKey("flow:auto-common");
    assert.equal(controller.getViewModel().flowItems[controller.getViewModel().selectedFlowIndex].key, "flow:auto-common");
    controller.selectFlowId("auto-common");
    assert.equal(controller.getViewModel().flowItems[controller.getViewModel().selectedFlowIndex].key, "flow:auto-common");

    controller.toggleFolder("folder:custom");
    assert.equal(controller.getViewModel().flowItems.find((item) => item.key === "folder:custom")?.label, "▸ Custom");
    assert.throws(() => controller.toggleFolder("folder:missing"), /Unknown visible folder key/);
    assert.equal(controller.getViewModel().flowItems.find((item) => item.key === "folder:custom")?.label, "▸ Custom");

    controller.showHelp(true);
    assert.equal(controller.getViewModel().helpVisible, true);
    controller.setScrollOffset("help", 999);
    assert.ok(controller.getViewModel().helpScrollOffset > 0);
    controller.scrollPane("help", { delta: -999 });
    assert.equal(controller.getViewModel().helpScrollOffset, 0);

    controller.appendLog("before clear");
    controller.clearLog();
    assert.equal(controller.getViewModel().logText, "Log cleared.");
    controller.destroy();
  });

  it("does not emit render events for unchanged scroll offsets", () => {
    const controller = createController();
    controller.mount();
    let renders = 0;
    const unsubscribe = controller.subscribe((event) => {
      if (event.type === "render") {
        renders += 1;
      }
    });

    controller.setScrollOffset("help", 999);
    assert.equal(renders, 1);
    const offset = controller.getViewModel().helpScrollOffset;

    controller.setScrollOffset("help", offset);
    controller.scrollPane("help", { delta: 0 });
    assert.equal(renders, 1);

    controller.scrollPane("help", { delta: -999 });
    assert.equal(renders, 2);

    unsubscribe();
    controller.destroy();
  });

  it("exposes Git workspace defaults, refreshes clean snapshots, and disables no-remote push", async () => {
    const gitService = {
      status: async () => gitSnapshot({ clean: true, changedFiles: [] }),
      createBranch: async () => ({ status: "success", message: "created" }),
      checkout: async () => ({ status: "success", message: "checked out" }),
      stage: async () => ({ status: "success", message: "staged" }),
      unstage: async () => ({ status: "success", message: "unstaged" }),
      commit: async () => ({ status: "success", message: "committed", commitHash: "abc1234" }),
      fetch: async () => ({ status: "success", message: "fetched" }),
      pullFfOnly: async () => ({ status: "success", message: "pulled" }),
      push: async () => ({ status: "success", message: "pushed" }),
      validateBranchName: async () => ({ ok: true }),
    };
    const controller = createGitController(gitService);

    assert.equal(controller.getViewModel().gitWorkspace.available, false);
    await controller.refreshGitWorkspace();

    const view = controller.getViewModel();
    assert.equal(view.gitWorkspace.available, true);
    assert.equal(view.gitWorkspace.clean, true);
    assert.equal(view.gitWorkspace.changedFiles.length, 0);
    assert.equal(view.gitWorkspace.canPush, false);
    assert.match(view.gitWorkspace.pushDisabledReason, /No Git remote/);
  });

  it("validates Git commit messages before invoking the service", async () => {
    let commitCalls = 0;
    const gitService = {
      status: async () => gitSnapshot(),
      createBranch: async () => ({ status: "success", message: "created" }),
      checkout: async () => ({ status: "success", message: "checked out" }),
      stage: async () => ({ status: "success", message: "staged" }),
      unstage: async () => ({ status: "success", message: "unstaged" }),
      commit: async () => {
        commitCalls += 1;
        return { status: "success", message: "committed", commitHash: "abc1234" };
      },
      fetch: async () => ({ status: "success", message: "fetched" }),
      pullFfOnly: async () => ({ status: "success", message: "pulled" }),
      push: async () => ({ status: "success", message: "pushed" }),
      validateBranchName: async () => ({ ok: true }),
    };
    const controller = createGitController(gitService);

    await controller.refreshGitWorkspace();
    await controller.commitGitChanges(["--option-like.ts"], "   ");

    const view = controller.getViewModel();
    assert.equal(commitCalls, 0);
    assert.equal(view.gitWorkspace.operation.status, "error");
    assert.match(view.gitWorkspace.operation.message, /must not be empty/);
  });

  it("logs Git operations and refreshes the workspace after mutation", async () => {
    const calls = [];
    const gitService = {
      status: async () => gitSnapshot({ clean: calls.includes("stage"), changedFiles: calls.includes("stage") ? [] : gitSnapshot().changedFiles }),
      createBranch: async () => ({ status: "success", message: "created" }),
      checkout: async () => ({ status: "success", message: "checked out" }),
      stage: async (paths) => {
        calls.push("stage");
        assert.deepEqual(paths, ["--option-like.ts"]);
        return { status: "success", message: "staged" };
      },
      unstage: async () => ({ status: "success", message: "unstaged" }),
      commit: async () => ({ status: "success", message: "committed", commitHash: "abc1234" }),
      fetch: async () => ({ status: "success", message: "fetched" }),
      pullFfOnly: async () => ({ status: "success", message: "pulled" }),
      push: async () => ({ status: "success", message: "pushed" }),
      validateBranchName: async () => ({ ok: true }),
    };
    const controller = createGitController(gitService);

    await controller.refreshGitWorkspace();
    await controller.stageGitPaths(["--option-like.ts"]);

    const view = controller.getViewModel();
    assert.equal(view.gitWorkspace.clean, true);
    assert.equal(view.gitWorkspace.operation.status, "success");
    assert.match(view.logText, /Git stage: staged/);
  });

  it("stages only selected files that need staging while preserving the full selection", async () => {
    const before = gitSnapshot({
      changedFiles: [
        { path: "src/unstaged.ts", file: "src/unstaged.ts", xy: " M", indexStatus: " ", workTreeStatus: "M", staged: false, type: "modified" },
        { path: "src/staged.ts", file: "src/staged.ts", xy: "M ", indexStatus: "M", workTreeStatus: " ", staged: true, type: "modified" },
      ],
    });
    const after = gitSnapshot({
      changedFiles: [
        { path: "src/unstaged.ts", file: "src/unstaged.ts", xy: "M ", indexStatus: "M", workTreeStatus: " ", staged: true, type: "modified" },
        { path: "src/staged.ts", file: "src/staged.ts", xy: "M ", indexStatus: "M", workTreeStatus: " ", staged: true, type: "modified" },
      ],
    });
    let statusCalls = 0;
    const gitService = {
      status: async () => {
        statusCalls += 1;
        return statusCalls === 1 ? before : after;
      },
      createBranch: async () => ({ status: "success", message: "created" }),
      checkout: async () => ({ status: "success", message: "checked out" }),
      stage: async (paths) => {
        assert.deepEqual(paths, ["src/unstaged.ts"]);
        return { status: "success", message: "staged" };
      },
      unstage: async () => ({ status: "success", message: "unstaged" }),
      commit: async () => ({ status: "success", message: "committed", commitHash: "abc1234" }),
      fetch: async () => ({ status: "success", message: "fetched" }),
      pullFfOnly: async () => ({ status: "success", message: "pulled" }),
      push: async () => ({ status: "success", message: "pushed" }),
      validateBranchName: async () => ({ ok: true }),
    };
    const controller = createGitController(gitService);

    await controller.refreshGitWorkspace();
    await controller.stageGitPaths(["src/unstaged.ts", "src/staged.ts"]);

    assert.deepEqual(controller.getViewModel().gitWorkspace.selectedPaths, ["src/unstaged.ts", "src/staged.ts"]);
  });
});
