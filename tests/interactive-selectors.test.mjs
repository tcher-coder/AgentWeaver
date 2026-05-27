import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const treeModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/tree.js")).href
);
const selectorsModule = await import(
  pathToFileURL(path.join(distRoot, "interactive/selectors.js")).href
);

const flows = [
  {
    id: "project-review",
    label: "Project Review",
    description: "Review a project-local flow.",
    source: "project-local",
    treePath: ["custom", "project-flows", "review", "project-review"],
    phases: [
      {
        id: "collect",
        repeatVars: {},
        steps: [{ id: "inspect" }],
      },
    ],
  },
  {
    id: "auto",
    label: "Auto",
    description: "Run the base auto flow.",
    source: "built-in",
    treePath: ["recommended", "auto"],
    catalogRole: "recipe",
    phases: [
      {
        id: "plan_1",
        repeatVars: { target: "api" },
        steps: [{ id: "questions" }, { id: "answer" }],
      },
      {
        id: "plan_2",
        repeatVars: { target: "api" },
        steps: [{ id: "questions" }, { id: "answer" }],
      },
      {
        id: "implement",
        repeatVars: {},
        steps: [{ id: "code" }],
      },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    description: "Run the planning block.",
    source: "built-in",
    treePath: ["built-in-blocks", "core-pipeline", "plan"],
    catalogRole: "block",
    phases: [],
  },
];

describe("interactive tree selectors", () => {
  it("orders catalog roots and applies default expansion rules", () => {
    const flowTree = treeModule.buildFlowTree(flows);

    const collapsed = treeModule.computeVisibleFlowItems(flowTree, new Set());
    assert.deepEqual(
      collapsed.map((item) => item.key),
      ["folder:recommended", "folder:custom", "folder:built-in-blocks"],
    );

    const initiallyExpanded = new Set(treeModule.collectInitiallyExpandedFolderKeys(flowTree));
    const expanded = treeModule.computeVisibleFlowItems(
      flowTree,
      initiallyExpanded,
    );
    assert.deepEqual(
      expanded.map((item) => [item.key, item.label]),
      [
        ["folder:recommended", "Recommended"],
        ["flow:auto", "Auto"],
        ["folder:custom", "Custom"],
        ["folder:custom/project-flows", "Project flows"],
        ["folder:built-in-blocks", "Built-in blocks"],
      ],
    );

    const builtInExpanded = treeModule.computeVisibleFlowItems(
      flowTree,
      new Set([...initiallyExpanded, "folder:built-in-blocks"]),
    );
    assert.deepEqual(
      builtInExpanded.map((item) => item.key),
      [
        "folder:recommended",
        "flow:auto",
        "folder:custom",
        "folder:custom/project-flows",
        "folder:built-in-blocks",
        "folder:built-in-blocks/core-pipeline",
      ],
    );
  });

  it("derives a stable header label for folders and flows", () => {
    assert.equal(selectorsModule.selectHeaderLabel(undefined, "auto-common"), "auto-common");
    assert.equal(
      selectorsModule.selectHeaderLabel(
        {
          kind: "folder",
          key: "folder:custom/project-flows",
          name: "project-flows",
          label: "Project flows",
          depth: 1,
          pathSegments: ["custom", "project-flows"],
        },
        "auto-common",
      ),
      "Custom/Project flows",
    );
    assert.equal(
      selectorsModule.selectHeaderLabel(
        {
          kind: "flow",
          key: "flow:auto",
          name: "auto",
          label: "Auto",
          depth: 1,
          pathSegments: ["recommended", "auto"],
          flow: flows[1],
        },
        "fallback",
      ),
      "Auto",
    );
  });
});

describe("interactive progress selectors", () => {
  it("groups repeated phases and anchors the current running section", () => {
    const progress = selectorsModule.selectProgressViewModel(flows[1], {
      flowKind: "declarative",
      flowVersion: 1,
      terminated: false,
      terminationOutcome: "success",
      phases: [
        {
          id: "plan_1",
          status: "done",
          steps: [
            { id: "questions", status: "done" },
            { id: "answer", status: "done" },
          ],
        },
        {
          id: "plan_2",
          status: "running",
          steps: [
            { id: "questions", status: "done" },
            { id: "answer", status: "running" },
          ],
        },
      ],
    });

    assert.equal(progress.flow.id, "auto");
    assert.deepEqual(
      progress.items.map((item) => [item.kind, item.label, item.status]),
      [
        ["group", "target api", "running"],
        ["phase", "plan_1", "done"],
        ["step", "questions", "done"],
        ["step", "answer", "done"],
        ["phase", "plan_2", "running"],
        ["step", "questions", "done"],
        ["step", "answer", "running"],
        ["phase", "implement", "pending"],
        ["step", "code", "pending"],
      ],
    );
    assert.equal(progress.anchorIndex, 6);
  });

  it("hides post-termination skipped phases and appends a termination summary", () => {
    const progress = selectorsModule.selectProgressViewModel(flows[1], {
      flowKind: "declarative",
      flowVersion: 1,
      terminated: true,
      terminationOutcome: "stopped",
      terminationReason: "Stopped by plan_1: operator interrupt",
      phases: [
        {
          id: "plan_1",
          status: "done",
          steps: [
            { id: "questions", status: "done" },
            { id: "answer", status: "done" },
          ],
        },
        {
          id: "plan_2",
          status: "skipped",
          steps: [
            { id: "questions", status: "skipped" },
            { id: "answer", status: "skipped" },
          ],
        },
      ],
    });

    assert.deepEqual(
      progress.items.map((item) => item.label),
      ["target api", "plan_1", "questions", "answer", "implement", "code", "Flow stopped before completion"],
    );
    assert.equal(progress.items.at(-1)?.kind, "termination");
  });
});
