import type { ExecutionRoutingGroup } from "./execution-routing-config.js";
import type {
  AutoFlowBlockDefinition,
  AutoFlowPhaseFactoryContext,
  AutoFlowSlotId,
} from "./auto-flow-types.js";
import type { DeclarativePhaseSpec, DeclarativeStepSpec, PromptBindingSpec, ValueSpec } from "./spec-types.js";

const SOURCE_SLOT = ["source"] as const satisfies readonly AutoFlowSlotId[];
const NORMALIZE_SLOT = ["normalize"] as const satisfies readonly AutoFlowSlotId[];
const PLANNING_SLOT = ["planning"] as const satisfies readonly AutoFlowSlotId[];
const DESIGN_REVIEW_SLOT = ["designReview"] as const satisfies readonly AutoFlowSlotId[];
const IMPLEMENTATION_SLOT = ["implementation"] as const satisfies readonly AutoFlowSlotId[];
const REVIEW_SLOT = ["review"] as const satisfies readonly AutoFlowSlotId[];

const ref = (value: string): ValueSpec => ({ ref: value });
const constant = (value: string | number | boolean | null): ValueSpec => ({ const: value });

function sourcePhase(): DeclarativePhaseSpec {
  return {
    id: "source",
    steps: [
      {
        id: "fetch_jira_source",
        when: { ref: "params.jiraApiUrl" },
        node: "flow-run",
        params: {
          fileName: constant("jira-fetch.json"),
          labelText: constant("Fetching Jira task source"),
          jiraApiUrl: ref("params.jiraApiUrl"),
          taskKey: ref("params.taskKey"),
        },
      },
      {
        id: "collect_manual_source",
        when: { not: { ref: "params.jiraApiUrl" } },
        node: "flow-run",
        params: {
          fileName: constant("manual-jira-input.json"),
          labelText: constant("Collecting manual Jira task source"),
          taskKey: ref("params.taskKey"),
          manualTaskDescription: ref("params.manualTaskDescription"),
        },
      },
    ],
  };
}

function normalizePhase(): DeclarativePhaseSpec {
  return {
    id: "normalize",
    steps: [
      {
        id: "run_normalize_source",
        node: "flow-run",
        params: {
          fileName: constant("normalize-task-source.json"),
          labelText: constant("Normalizing task source"),
          taskKey: ref("params.taskKey"),
          iteration: ref("params.taskContextIteration"),
          llmExecutor: ref("params.llmExecutor"),
          llmModel: ref("params.llmModel"),
          extraPrompt: ref("params.extraPrompt"),
        },
      },
    ],
  };
}

function planningPhase(): DeclarativePhaseSpec {
  return {
    id: "plan",
    steps: [
      {
        id: "run_plan_flow",
        node: "flow-run",
        params: {
          fileName: constant("plan.json"),
          labelText: constant("Running planning flow"),
          taskKey: ref("params.taskKey"),
          taskContextIteration: ref("params.taskContextIteration"),
          designIteration: ref("params.designIteration"),
          planIteration: ref("params.planIteration"),
          qaIteration: ref("params.qaIteration"),
          llmExecutor: ref("params.llmExecutor"),
          llmModel: ref("params.llmModel"),
          extraPrompt: ref("params.extraPrompt"),
          mdLang: ref("params.mdLang"),
        },
      },
    ],
  };
}

function designReviewLoopPhase(): DeclarativePhaseSpec {
  return {
    id: "design_review_loop",
    steps: [
      {
        id: "run_design_review_loop",
        node: "flow-run",
        params: {
          fileName: constant("design-review-loop.json"),
          labelText: constant("Running design-review loop"),
          taskKey: ref("params.taskKey"),
          baseIteration: ref("params.designReviewBaseIteration"),
          workspaceDir: ref("params.workspaceDir"),
          extraPrompt: ref("params.extraPrompt"),
          llmExecutor: ref("params.llmExecutor"),
          llmModel: ref("params.llmModel"),
        },
        stopFlowIf: {
          equals: [
            ref("steps.design_review_loop.run_design_review_loop.value.executionState.terminationOutcome"),
            constant("stopped"),
          ],
        },
        stopFlowOutcome: "stopped",
      },
    ],
  };
}

function implementationPromptVars(context: AutoFlowPhaseFactoryContext): NonNullable<PromptBindingSpec["vars"]> {
  const vars: NonNullable<PromptBindingSpec["vars"]> = {
    design_file: ref("steps.implement.resolve_planning_bundle.value.designFile"),
    design_json_file: ref("steps.implement.resolve_planning_bundle.value.designJsonFile"),
    plan_file: ref("steps.implement.resolve_planning_bundle.value.planFile"),
    plan_json_file: ref("steps.implement.resolve_planning_bundle.value.planJsonFile"),
    qa_file: ref("steps.implement.resolve_planning_bundle.value.qaFile"),
    qa_json_file: ref("steps.implement.resolve_planning_bundle.value.qaJsonFile"),
  };
  if (context.presetId === "standard") {
    vars.project_guidance_file = constant("not provided");
    vars.project_guidance_json_file = constant("not provided");
  }
  return vars;
}

function implementationPhase(context: AutoFlowPhaseFactoryContext): DeclarativePhaseSpec {
  const routingGroup: ExecutionRoutingGroup | undefined = context.presetId === "standard" ? "implementation" : undefined;
  const runImplementStep: DeclarativeStepSpec = {
    id: "run_implement",
    node: "llm-prompt",
    ...(routingGroup ? { routingGroup } : {}),
    prompt: {
      templateRef: "implement",
      vars: implementationPromptVars(context),
      extraPrompt: ref("params.extraPrompt"),
      format: "task-prompt",
    },
    params: {
      labelText: constant("Running implementation mode locally"),
      model: ref("params.llmModel"),
      executor: ref("params.llmExecutor"),
    },
  };

  return {
    id: "implement",
    steps: [
      {
        id: "resolve_planning_bundle",
        node: "planning-bundle",
        params: {
          taskKey: ref("params.taskKey"),
        },
      },
      runImplementStep,
      {
        id: "notify_implement_complete",
        node: "telegram-notify",
        params: {
          message: {
            template: "Implementation phase for {taskKey} complete.",
            vars: {
              taskKey: ref("params.taskKey"),
            },
          },
        },
      },
    ],
  };
}

function reviewLoopPhase(context: AutoFlowPhaseFactoryContext): DeclarativePhaseSpec {
  const runReviewLoopStep: DeclarativeStepSpec = {
    id: "run_review_loop",
    node: "flow-run",
    ...(context.presetId === "standard"
      ? {
          stopFlowIf: {
            not: {
              equals: [
                ref("steps.review-loop.run_review_loop.value.executionState.terminationOutcome"),
                constant("success"),
              ],
            },
          },
          stopFlowOutcome: "stopped" as const,
        }
      : {}),
    params: {
      fileName: constant("review-loop.json"),
      labelText: constant("Running review-loop"),
      taskKey: ref("params.taskKey"),
      baseIteration: ref("params.baseIteration"),
      workspaceDir: ref("params.workspaceDir"),
      extraPrompt: ref("params.extraPrompt"),
      reviewFixPoints: ref("params.reviewFixPoints"),
      reviewBlockingSeverities: ref("params.reviewBlockingSeverities"),
      llmExecutor: ref("params.llmExecutor"),
      llmModel: ref("params.llmModel"),
    },
  };

  return {
    id: "review-loop",
    steps: [
      runReviewLoopStep,
      {
        id: "notify_task_complete",
        node: "telegram-notify",
        params: {
          message: {
            template: "Task {taskKey} complete.",
            vars: {
              taskKey: ref("params.taskKey"),
            },
          },
        },
      },
    ],
  };
}

export const BUILT_IN_AUTO_FLOW_BLOCKS = [
  {
    id: "source.jira",
    title: "Task source",
    category: "source",
    allowedSlots: SOURCE_SLOT,
    requires: [],
    provides: ["task.source"],
    locked: true,
    defaultEnabled: true,
    createPhase: sourcePhase,
  },
  {
    id: "normalize.task-source",
    title: "Task source normalization",
    category: "normalize",
    allowedSlots: NORMALIZE_SLOT,
    requires: ["task.source"],
    provides: ["task.context"],
    locked: true,
    defaultEnabled: true,
    createPhase: normalizePhase,
  },
  {
    id: "planning.plan",
    title: "Planning",
    category: "planning",
    allowedSlots: PLANNING_SLOT,
    requires: ["task.context"],
    provides: ["planning.result", "planning.bundle"],
    locked: true,
    defaultEnabled: true,
    createPhase: planningPhase,
  },
  {
    id: "review.design-loop",
    title: "Design review loop",
    category: "review",
    allowedSlots: DESIGN_REVIEW_SLOT,
    requires: ["planning.result"],
    provides: ["design-review.result"],
    defaultEnabled: true,
    params: {
      maxIterations: {
        type: "integer",
        min: 1,
        max: 5,
        default: 3,
        supportedExecutableValues: [3],
      },
    },
    createPhase: designReviewLoopPhase,
  },
  {
    id: "implementation.default",
    title: "Default implementation",
    category: "implementation",
    allowedSlots: IMPLEMENTATION_SLOT,
    requires: ["planning.bundle"],
    provides: ["implementation.result"],
    locked: true,
    defaultEnabled: true,
    createPhase: implementationPhase,
  },
  {
    id: "review.loop",
    title: "Review loop",
    category: "review",
    allowedSlots: REVIEW_SLOT,
    requires: ["implementation.result"],
    provides: ["review.result"],
    defaultEnabled: true,
    params: {
      maxIterations: {
        type: "integer",
        min: 1,
        max: 5,
        default: 5,
        supportedExecutableValues: [5],
      },
    },
    createPhase: reviewLoopPhase,
  },
] as const satisfies readonly AutoFlowBlockDefinition[];

const builtInBlockById = new Map<string, AutoFlowBlockDefinition>(
  BUILT_IN_AUTO_FLOW_BLOCKS.map((block) => [block.id, block]),
);

export function listBuiltInAutoFlowBlockDefinitions(): AutoFlowBlockDefinition[] {
  return [...BUILT_IN_AUTO_FLOW_BLOCKS];
}

export function getBuiltInAutoFlowBlockDefinition(blockId: string): AutoFlowBlockDefinition | null {
  return builtInBlockById.get(blockId) ?? null;
}
