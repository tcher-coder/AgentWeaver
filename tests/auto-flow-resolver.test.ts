import { describe, expect, it } from "vitest";

import { resolveAutoFlowPreset } from "../src/pipeline/auto-flow-resolver.js";
import { listBuiltInAutoFlowBlockDefinitions } from "../src/pipeline/auto-flow-blocks.js";
import { listBuiltInAutoFlowPresets } from "../src/pipeline/auto-flow-presets.js";
import { loadDeclarativeFlow, resolveNamedDeclarativeFlowRef } from "../src/pipeline/declarative-flows.js";
import { loadInteractiveFlowCatalog } from "../src/pipeline/flow-catalog.js";
import { createPipelineRegistryContext } from "../src/pipeline/plugin-loader.js";
import { compileFlowSpec } from "../src/pipeline/spec-compiler.js";
import { listBuiltInFlowSpecFiles } from "../src/pipeline/spec-loader.js";
import { validateExpandedPhases, validateFlowSpec } from "../src/pipeline/spec-validator.js";
import type { AutoFlowOverrideBlockPlacement, AutoFlowSavedConfigOverride } from "../src/pipeline/auto-flow-types.js";
import type { DeclarativePhaseSpec, ExpandedPhaseSpec, ExpandedStepSpec } from "../src/pipeline/spec-types.js";

function expectResolvedSpec(presetId: "simple" | "standard") {
  const result = resolveAutoFlowPreset(presetId);
  expect(result.diagnostics).toEqual([]);
  expect(result.spec).toBeDefined();
  return result;
}

function phaseIds(phases: readonly DeclarativePhaseSpec[] | readonly ExpandedPhaseSpec[]): string[] {
  return phases.map((phase) => phase.id);
}

function stepById(phase: DeclarativePhaseSpec | ExpandedPhaseSpec, stepId: string) {
  return phase.steps.find((step) => step.id === stepId);
}

function resolvedPlacementOverride(
  presetId: "simple" | "standard",
  mutate: (placements: AutoFlowOverrideBlockPlacement[]) => AutoFlowOverrideBlockPlacement[],
): AutoFlowSavedConfigOverride {
  const base = resolveAutoFlowPreset(presetId).preset.blocks.map((placement) => ({
    blockId: placement.blockId,
    slot: placement.slot,
  }));
  return { placements: mutate(base) };
}

describe("auto-flow built-in metadata", () => {
  it("lists the initial block catalog, presets, locked core blocks, and executable maxIterations defaults", () => {
    const blocks = Object.fromEntries(listBuiltInAutoFlowBlockDefinitions().map((block) => [block.id, block]));
    expect(Object.keys(blocks)).toEqual([
      "source.jira",
      "normalize.task-source",
      "planning.plan",
      "review.design-loop",
      "implementation.default",
      "review.loop",
    ]);
    for (const blockId of ["source.jira", "normalize.task-source", "planning.plan", "implementation.default"]) {
      expect(blocks[blockId]?.locked).toBe(true);
    }
    expect(blocks["review.loop"]?.params?.maxIterations).toMatchObject({
      type: "integer",
      min: 1,
      max: 5,
      default: 5,
      supportedExecutableValues: [5],
    });
    expect(blocks["review.design-loop"]?.params?.maxIterations).toMatchObject({
      type: "integer",
      min: 1,
      max: 5,
      default: 3,
      supportedExecutableValues: [3],
    });

    expect(listBuiltInAutoFlowPresets().map((preset) => [preset.id, preset.fileName])).toEqual([
      ["simple", "auto-simple.json"],
      ["standard", "auto-common.json"],
    ]);
  });
});

describe("auto-flow preset resolution", () => {
  it("resolves the simple preset in the required order with reserved summary lists present", () => {
    const result = expectResolvedSpec("simple");

    expect(result.summary.enabled.map((entry) => entry.blockId)).toEqual([
      "source.jira",
      "normalize.task-source",
      "planning.plan",
      "implementation.default",
      "review.loop",
    ]);
    expect(result.summary.disabled).toEqual([]);
    expect(result.summary.skipped).toEqual([]);
    expect(result.summary.autoDisabled).toEqual([]);
    expect(phaseIds(result.spec!.phases as DeclarativePhaseSpec[])).toEqual([
      "source",
      "normalize",
      "plan",
      "implement",
      "review-loop",
    ]);
  });

  it("resolves the standard preset in the required order with reserved summary lists present", () => {
    const result = expectResolvedSpec("standard");

    expect(result.summary.enabled.map((entry) => entry.blockId)).toEqual([
      "source.jira",
      "normalize.task-source",
      "planning.plan",
      "review.design-loop",
      "implementation.default",
      "review.loop",
    ]);
    expect(result.summary.disabled).toEqual([]);
    expect(result.summary.skipped).toEqual([]);
    expect(result.summary.autoDisabled).toEqual([]);
    expect(phaseIds(result.spec!.phases as DeclarativePhaseSpec[])).toEqual([
      "source",
      "normalize",
      "plan",
      "design_review_loop",
      "implement",
      "review-loop",
    ]);
  });

  it("emits specs that pass the existing declarative validation and compilation path", async () => {
    const cwd = process.cwd();
    const registryContext = await createPipelineRegistryContext(cwd);
    for (const presetId of ["simple", "standard"] as const) {
      const result = expectResolvedSpec(presetId);
      validateFlowSpec(result.spec!, registryContext.nodes, registryContext.executors, {
        resolveFlowByName: (fileName) => resolveNamedDeclarativeFlowRef(fileName, cwd),
      });
      const expanded = compileFlowSpec(result.spec!);
      validateExpandedPhases(expanded);
    }
  });

  it("rejects invalid slot placement with block id, requested slot, and allowed slots", () => {
    const result = resolveAutoFlowPreset("simple", resolvedPlacementOverride("simple", (placements) =>
      placements.map((placement) =>
        placement.blockId === "review.loop" ? { ...placement, slot: "planning" as never } : placement,
      ),
    ));

    expect(result.spec).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid-slot",
      blockId: "review.loop",
      slotId: "planning",
      allowedSlots: ["review"],
    }));
    expect(result.summary.invalid).toContainEqual(expect.objectContaining({
      blockId: "review.loop",
      diagnosticCode: "invalid-slot",
    }));
  });

  it("rejects disabling and removing locked core blocks before phase generation", () => {
    const disabled = resolveAutoFlowPreset("simple", { disabledBlocks: ["source.jira"] });
    expect(disabled.spec).toBeUndefined();
    expect(disabled.diagnostics).toContainEqual(expect.objectContaining({
      code: "locked-block-disabled",
      blockId: "source.jira",
    }));

    const removed = resolveAutoFlowPreset("simple", resolvedPlacementOverride("simple", (placements) =>
      placements.filter((placement) => placement.blockId !== "planning.plan"),
    ));
    expect(removed.spec).toBeUndefined();
    expect(removed.diagnostics).toContainEqual(expect.objectContaining({
      code: "locked-block-removed",
      blockId: "planning.plan",
    }));
  });

  it("rejects missing dependency contracts in slot order", () => {
    const result = resolveAutoFlowPreset("standard", resolvedPlacementOverride("standard", (placements) =>
      placements.filter((placement) => placement.blockId !== "planning.plan"),
    ));

    expect(result.spec).toBeUndefined();
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "missing-dependency",
        blockId: "review.design-loop",
        missingContract: "planning.result",
      }),
      expect.objectContaining({
        code: "missing-dependency",
        blockId: "implementation.default",
        missingContract: "planning.bundle",
      }),
    ]));
  });

  it("accepts only the executable review.loop maxIterations default", () => {
    expect(resolveAutoFlowPreset("simple", {
      blockParams: { "review.loop": { maxIterations: 5 } },
    }).diagnostics).toEqual([]);

    for (const value of [0, 6]) {
      expect(resolveAutoFlowPreset("simple", {
        blockParams: { "review.loop": { maxIterations: value } },
      }).diagnostics).toContainEqual(expect.objectContaining({
        code: "parameter-out-of-range",
        blockId: "review.loop",
        paramName: "maxIterations",
        value,
      }));
    }

    for (const value of [1, 2, 3, 4]) {
      expect(resolveAutoFlowPreset("simple", {
        blockParams: { "review.loop": { maxIterations: value } },
      }).diagnostics).toContainEqual(expect.objectContaining({
        code: "unsupported-override",
        blockId: "review.loop",
        paramName: "maxIterations",
        value,
      }));
    }
  });

  it("accepts only the executable review.design-loop maxIterations default", () => {
    expect(resolveAutoFlowPreset("standard", {
      blockParams: { "review.design-loop": { maxIterations: 3 } },
    }).diagnostics).toEqual([]);

    for (const value of [0, 6]) {
      expect(resolveAutoFlowPreset("standard", {
        blockParams: { "review.design-loop": { maxIterations: value } },
      }).diagnostics).toContainEqual(expect.objectContaining({
        code: "parameter-out-of-range",
        blockId: "review.design-loop",
        paramName: "maxIterations",
        value,
      }));
    }

    for (const value of [1, 2, 4, 5]) {
      expect(resolveAutoFlowPreset("standard", {
        blockParams: { "review.design-loop": { maxIterations: value } },
      }).diagnostics).toContainEqual(expect.objectContaining({
        code: "unsupported-override",
        blockId: "review.design-loop",
        paramName: "maxIterations",
        value,
      }));
    }
  });

  it("rejects non-integer maxIterations values and unknown parameters", () => {
    for (const value of ["5", 2.5, null]) {
      expect(resolveAutoFlowPreset("simple", {
        blockParams: { "review.loop": { maxIterations: value } },
      }).diagnostics).toContainEqual(expect.objectContaining({
        code: "invalid-parameter-type",
        blockId: "review.loop",
        paramName: "maxIterations",
        value,
      }));
    }

    expect(resolveAutoFlowPreset("simple", {
      blockParams: { "review.loop": { unknownLimit: 3 } },
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "unknown-parameter",
      blockId: "review.loop",
      paramName: "unknownLimit",
    }));
  });

  it("omits disabled optional blocks and records the disabled summary decision", () => {
    const result = resolveAutoFlowPreset("standard", { disabledBlocks: ["review.design-loop"] });

    expect(result.diagnostics).toEqual([]);
    expect(result.summary.disabled).toContainEqual(expect.objectContaining({
      status: "disabled",
      blockId: "review.design-loop",
      slotId: "designReview",
    }));
    expect(phaseIds(result.spec!.phases as DeclarativePhaseSpec[])).toEqual([
      "source",
      "normalize",
      "plan",
      "implement",
      "review-loop",
    ]);
  });
});

describe("auto-flow parity matrix", () => {
  it("preserves the auto-simple phase structure, prompt bindings, notifications, and no parent review stop", () => {
    const result = expectResolvedSpec("simple");
    const phases = result.spec!.phases as DeclarativePhaseSpec[];
    expect(phaseIds(phases)).toEqual(["source", "normalize", "plan", "implement", "review-loop"]);

    expect(stepById(phases[0]!, "fetch_jira_source")?.when).toEqual({ ref: "params.jiraApiUrl" });
    expect(stepById(phases[0]!, "fetch_jira_source")?.params?.fileName).toEqual({ const: "jira-fetch.json" });
    expect(stepById(phases[0]!, "collect_manual_source")?.when).toEqual({ not: { ref: "params.jiraApiUrl" } });
    expect(stepById(phases[0]!, "collect_manual_source")?.params?.fileName).toEqual({ const: "manual-jira-input.json" });
    expect(stepById(phases[1]!, "run_normalize_source")?.params?.fileName).toEqual({ const: "normalize-task-source.json" });
    expect(stepById(phases[2]!, "run_plan_flow")?.params?.fileName).toEqual({ const: "plan.json" });

    const implementStep = stepById(phases[3]!, "run_implement");
    expect(implementStep?.routingGroup).toBeUndefined();
    expect(Object.keys(implementStep?.prompt?.vars ?? {})).toEqual([
      "design_file",
      "design_json_file",
      "plan_file",
      "plan_json_file",
      "qa_file",
      "qa_json_file",
    ]);
    expect(stepById(phases[3]!, "notify_implement_complete")).toBeDefined();

    const reviewStep = stepById(phases[4]!, "run_review_loop");
    expect(reviewStep?.params?.fileName).toEqual({ const: "review-loop.json" });
    expect(reviewStep?.stopFlowIf).toBeUndefined();
    expect(stepById(phases[4]!, "notify_task_complete")).toBeDefined();
  });

  it("preserves the auto-common phase structure, routing, stop behavior, prompt bindings, and notifications", () => {
    const result = expectResolvedSpec("standard");
    const phases = result.spec!.phases as DeclarativePhaseSpec[];
    expect(phaseIds(phases)).toEqual(["source", "normalize", "plan", "design_review_loop", "implement", "review-loop"]);

    expect(stepById(phases[0]!, "fetch_jira_source")?.when).toEqual({ ref: "params.jiraApiUrl" });
    expect(stepById(phases[0]!, "fetch_jira_source")?.params?.fileName).toEqual({ const: "jira-fetch.json" });
    expect(stepById(phases[0]!, "collect_manual_source")?.when).toEqual({ not: { ref: "params.jiraApiUrl" } });
    expect(stepById(phases[0]!, "collect_manual_source")?.params?.fileName).toEqual({ const: "manual-jira-input.json" });
    expect(stepById(phases[1]!, "run_normalize_source")?.params?.fileName).toEqual({ const: "normalize-task-source.json" });
    expect(stepById(phases[2]!, "run_plan_flow")?.params?.fileName).toEqual({ const: "plan.json" });

    const designReviewStep = stepById(phases[3]!, "run_design_review_loop");
    expect(designReviewStep?.params?.fileName).toEqual({ const: "design-review-loop.json" });
    expect(designReviewStep?.stopFlowIf).toEqual({
      equals: [
        { ref: "steps.design_review_loop.run_design_review_loop.value.executionState.terminationOutcome" },
        { const: "stopped" },
      ],
    });
    expect(designReviewStep?.stopFlowOutcome).toBe("stopped");

    const implementStep = stepById(phases[4]!, "run_implement");
    expect(implementStep?.routingGroup).toBe("implementation");
    expect(implementStep?.prompt?.vars?.project_guidance_file).toEqual({ const: "not provided" });
    expect(implementStep?.prompt?.vars?.project_guidance_json_file).toEqual({ const: "not provided" });
    expect(stepById(phases[4]!, "notify_implement_complete")).toBeDefined();

    const reviewStep = stepById(phases[5]!, "run_review_loop");
    expect(reviewStep?.params?.fileName).toEqual({ const: "review-loop.json" });
    expect(reviewStep?.stopFlowIf).toEqual({
      not: {
        equals: [
          { ref: "steps.review-loop.run_review_loop.value.executionState.terminationOutcome" },
          { const: "success" },
        ],
      },
    });
    expect(reviewStep?.stopFlowOutcome).toBe("stopped");
    expect(stepById(phases[5]!, "notify_task_complete")?.stopFlowIf).toBeUndefined();
  });
});

describe("virtual built-in auto-flow loading", () => {
  it("loads auto-simple.json and auto-common.json through virtual preset-backed file names", async () => {
    const simple = await loadDeclarativeFlow({ source: "built-in", fileName: "auto-simple.json" });
    const standard = await loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });

    expect(phaseIds(simple.phases)).toEqual(["source", "normalize", "plan", "implement", "review-loop"]);
    expect(phaseIds(standard.phases)).toEqual(["source", "normalize", "plan", "design_review_loop", "implement", "review-loop"]);
  });

  it("lists virtual built-ins exactly once and keeps the interactive catalog addressable", async () => {
    const builtInFiles = listBuiltInFlowSpecFiles();
    expect(builtInFiles.filter((fileName) => fileName === "auto-simple.json")).toHaveLength(1);
    expect(builtInFiles.filter((fileName) => fileName === "auto-common.json")).toHaveLength(1);

    const entries = await loadInteractiveFlowCatalog(process.cwd());
    expect(entries.filter((entry) => entry.id === "auto-simple")).toHaveLength(1);
    expect(entries.filter((entry) => entry.id === "auto-common")).toHaveLength(1);
  });

  it("keeps auto-common implementation routing discoverable after virtual loading", async () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "auto-common.json" });
    const implement = flow.phases.find((phase) => phase.id === "implement");
    const runImplement = implement?.steps.find((step: ExpandedStepSpec) => step.id === "run_implement");
    expect(runImplement?.routingGroup).toBe("implementation");
  });
});
