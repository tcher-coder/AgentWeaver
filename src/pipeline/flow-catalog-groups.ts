export type BuiltInFlowCatalogRole = "recipe" | "block" | "tool" | "integration" | "specialized";

export type BuiltInFlowCatalogMetadata = {
  role: BuiltInFlowCatalogRole;
  treePath: readonly string[];
  label: string;
  order: number;
  standalone: boolean;
  embeddable: boolean;
  requires?: readonly string[];
  provides?: readonly string[];
};

export const RECOMMENDED_ROOT = "recommended";
export const CUSTOM_ROOT = "custom";
export const BUILT_IN_BLOCKS_ROOT = "built-in-blocks";

export const SAVED_AUTO_FLOWS_GROUP = "saved-auto-flows";
export const PROJECT_FLOWS_GROUP = "project-flows";
export const GLOBAL_FLOWS_GROUP = "global-flows";
export const OTHER_BUILT_IN_GROUP = "other";

export const TREE_SEGMENT_LABELS: Readonly<Record<string, string>> = {
  [RECOMMENDED_ROOT]: "Recommended",
  [CUSTOM_ROOT]: "Custom",
  [BUILT_IN_BLOCKS_ROOT]: "Built-in blocks",
  [SAVED_AUTO_FLOWS_GROUP]: "Saved auto flows",
  [PROJECT_FLOWS_GROUP]: "Project flows",
  [GLOBAL_FLOWS_GROUP]: "Global flows",
  "core-pipeline": "Core pipeline",
  "quality-checks": "Quality checks",
  "task-utilities": "Task utilities",
  delivery: "Delivery",
  integrations: "Integrations",
  specialized: "Specialized",
  [OTHER_BUILT_IN_GROUP]: "Other",
};

const ROOT_ORDER: Readonly<Record<string, number>> = {
  [RECOMMENDED_ROOT]: 10,
  [CUSTOM_ROOT]: 20,
  [BUILT_IN_BLOCKS_ROOT]: 30,
};

const CUSTOM_GROUP_ORDER: Readonly<Record<string, number>> = {
  [SAVED_AUTO_FLOWS_GROUP]: 10,
  [PROJECT_FLOWS_GROUP]: 20,
  [GLOBAL_FLOWS_GROUP]: 30,
};

const BUILT_IN_GROUP_ORDER: Readonly<Record<string, number>> = {
  "core-pipeline": 10,
  "quality-checks": 20,
  "task-utilities": 30,
  delivery: 40,
  integrations: 50,
  specialized: 60,
  [OTHER_BUILT_IN_GROUP]: 900,
};

const RECOMMENDED_ENTRY_ORDER: Readonly<Record<string, number>> = {
  auto: 10,
  "instant-task": 20,
};

export const BUILT_IN_FLOW_CATALOG_METADATA = {
  "instant-task": {
    role: "recipe",
    treePath: [RECOMMENDED_ROOT, "instant-task"],
    label: "Instant task",
    order: 20,
    standalone: true,
    embeddable: false,
  },
  plan: {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "core-pipeline", "plan"],
    label: "Plan",
    order: 10,
    standalone: true,
    embeddable: true,
    provides: ["design", "implementation plan", "QA plan"],
  },
  "plan-revise": {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "core-pipeline", "plan-revise"],
    label: "Plan revise",
    order: 20,
    standalone: true,
    embeddable: true,
    requires: ["design review verdict", "planning artifacts"],
    provides: ["revised planning artifacts"],
  },
  "design-review": {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "core-pipeline", "design-review"],
    label: "Design review",
    order: 30,
    standalone: true,
    embeddable: true,
    requires: ["planning artifacts"],
    provides: ["design review verdict"],
  },
  implement: {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "core-pipeline", "implement"],
    label: "Implement",
    order: 40,
    standalone: true,
    embeddable: true,
    requires: ["approved planning artifacts"],
    provides: ["code changes"],
  },
  review: {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "core-pipeline", "review"],
    label: "Review",
    order: 50,
    standalone: true,
    embeddable: true,
    requires: ["code changes"],
    provides: ["review findings"],
  },
  "review-fix": {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "core-pipeline", "review-fix"],
    label: "Review fix",
    order: 60,
    standalone: true,
    embeddable: true,
    requires: ["review findings"],
    provides: ["code changes"],
  },
  "review-loop": {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "core-pipeline", "review-loop"],
    label: "Review loop",
    order: 70,
    standalone: true,
    embeddable: true,
    requires: ["code changes"],
    provides: ["ready-to-merge verdict"],
  },
  "run-go-tests-loop": {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "quality-checks", "run-go-tests-loop"],
    label: "Go tests loop",
    order: 10,
    standalone: true,
    embeddable: true,
    requires: ["Go test command"],
    provides: ["test result"],
  },
  "run-go-linter-loop": {
    role: "block",
    treePath: [BUILT_IN_BLOCKS_ROOT, "quality-checks", "run-go-linter-loop"],
    label: "Go linter loop",
    order: 20,
    standalone: true,
    embeddable: true,
    requires: ["Go linter command"],
    provides: ["linter result"],
  },
  "task-describe": {
    role: "tool",
    treePath: [BUILT_IN_BLOCKS_ROOT, "task-utilities", "task-describe"],
    label: "Task describe",
    order: 10,
    standalone: true,
    embeddable: false,
    provides: ["task description"],
  },
  "playbook-init": {
    role: "tool",
    treePath: [BUILT_IN_BLOCKS_ROOT, "task-utilities", "playbook-init"],
    label: "Playbook init",
    order: 20,
    standalone: true,
    embeddable: false,
    provides: ["project playbook draft"],
  },
  "git-commit": {
    role: "tool",
    treePath: [BUILT_IN_BLOCKS_ROOT, "delivery", "git-commit"],
    label: "Git commit",
    order: 10,
    standalone: true,
    embeddable: false,
    requires: ["git changes"],
    provides: ["git commit"],
  },
  "mr-description": {
    role: "tool",
    treePath: [BUILT_IN_BLOCKS_ROOT, "delivery", "mr-description"],
    label: "MR description",
    order: 20,
    standalone: true,
    embeddable: false,
    requires: ["task context", "git changes"],
    provides: ["merge request description"],
  },
  "gitlab-review": {
    role: "integration",
    treePath: [BUILT_IN_BLOCKS_ROOT, "integrations", "gitlab-review"],
    label: "GitLab review",
    order: 10,
    standalone: true,
    embeddable: false,
    requires: ["GitLab merge request"],
    provides: ["accepted review findings"],
  },
  "gitlab-diff-review": {
    role: "integration",
    treePath: [BUILT_IN_BLOCKS_ROOT, "integrations", "gitlab-diff-review"],
    label: "GitLab diff review",
    order: 20,
    standalone: true,
    embeddable: false,
    requires: ["GitLab merge request diff"],
    provides: ["review findings"],
  },
  "bug-analyze": {
    role: "specialized",
    treePath: [BUILT_IN_BLOCKS_ROOT, "specialized", "bug-analyze"],
    label: "Bug analyze",
    order: 10,
    standalone: true,
    embeddable: false,
    requires: ["bug task"],
    provides: ["bug analysis"],
  },
  "bug-fix": {
    role: "specialized",
    treePath: [BUILT_IN_BLOCKS_ROOT, "specialized", "bug-fix"],
    label: "Bug fix",
    order: 20,
    standalone: true,
    embeddable: false,
    requires: ["bug analysis"],
    provides: ["code changes"],
  },
} as const satisfies Readonly<Record<string, BuiltInFlowCatalogMetadata>>;

export type BuiltInFlowCatalogId = keyof typeof BUILT_IN_FLOW_CATALOG_METADATA;

export function builtInFlowCatalogMetadata(flowId: string): BuiltInFlowCatalogMetadata | null {
  return BUILT_IN_FLOW_CATALOG_METADATA[flowId as BuiltInFlowCatalogId] ?? null;
}

export function treeSegmentLabel(segment: string): string {
  return TREE_SEGMENT_LABELS[segment] ?? segment;
}

export function treePathLabels(pathSegments: readonly string[]): string[] {
  return pathSegments.map((segment) => treeSegmentLabel(segment));
}

export function catalogPathOrder(pathSegments: readonly string[], flowId?: string): number | null {
  const [root, second] = pathSegments;
  if (!root) {
    return null;
  }

  if (pathSegments.length === 1) {
    return ROOT_ORDER[root] ?? null;
  }

  if (root === CUSTOM_ROOT && second && pathSegments.length === 2) {
    return CUSTOM_GROUP_ORDER[second] ?? null;
  }

  if (root === BUILT_IN_BLOCKS_ROOT && second && pathSegments.length === 2) {
    return BUILT_IN_GROUP_ORDER[second] ?? null;
  }

  if (root === RECOMMENDED_ROOT && flowId) {
    return RECOMMENDED_ENTRY_ORDER[flowId] ?? null;
  }

  if (root === BUILT_IN_BLOCKS_ROOT && flowId) {
    return builtInFlowCatalogMetadata(flowId)?.order ?? null;
  }

  return null;
}
