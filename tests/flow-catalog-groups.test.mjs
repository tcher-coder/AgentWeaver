import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");

let tempRoot;
let originalHome;
let flowCatalogModule;
let groupsModule;
let treeModule;

beforeEach(async () => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "agentweaver-flow-catalog-groups-"));
  originalHome = process.env.HOME;
  process.env.HOME = path.join(tempRoot, "home");
  flowCatalogModule = await import(
    `${pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href}?groups=${Date.now()}`
  );
  groupsModule = await import(
    `${pathToFileURL(path.join(distRoot, "pipeline/flow-catalog-groups.js")).href}?groups=${Date.now()}`
  );
  treeModule = await import(
    `${pathToFileURL(path.join(distRoot, "interactive/tree.js")).href}?groups=${Date.now()}`
  );
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

function idsForGroup(entries, group) {
  return entries
    .filter((entry) => entry.treePath[0] === "built-in-blocks" && entry.treePath[1] === group)
    .map((entry) => entry.id)
    .sort();
}

function toInteractiveFlow(entry) {
  return {
    id: entry.id,
    label: entry.label ?? entry.id,
    description: entry.flow.description ?? "",
    source: entry.source,
    treePath: entry.treePath,
    ...(entry.catalogRole ? { catalogRole: entry.catalogRole } : {}),
    phases: [],
  };
}

describe("flow catalog grouping metadata", () => {
  it("covers every public visible built-in command except the dedicated auto entry", () => {
    const metadata = groupsModule.BUILT_IN_FLOW_CATALOG_METADATA;
    const missing = flowCatalogModule.BUILT_IN_COMMAND_FLOW_IDS
      .filter((flowId) => flowId !== "auto")
      .filter((flowId) => !metadata[flowId]);

    assert.deepEqual(missing, []);
    for (const [flowId, item] of Object.entries(metadata)) {
      assert.ok(item.label.trim().length > 0, `${flowId} should have a label`);
      assert.ok(item.treePath.length >= 2, `${flowId} should have a tree path`);
      assert.equal(typeof item.order, "number", `${flowId} should have a numeric order`);
      assert.ok(["recipe", "block", "tool", "integration", "specialized"].includes(item.role), `${flowId} should have a valid role`);
    }
    assert.deepEqual(metadata["plan-revise"].treePath, ["built-in-blocks", "core-pipeline", "plan-revise"]);
  });

  it("places real catalog entries into Recommended and Built-in blocks groups", async () => {
    const entries = await flowCatalogModule.loadInteractiveFlowCatalog(path.join(tempRoot, "repo"));
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    assert.deepEqual(byId.get("auto")?.treePath, ["recommended", "auto"]);
    assert.equal(byId.get("auto")?.label, "Auto");
    assert.deepEqual(byId.get("instant-task")?.treePath, ["recommended", "instant-task"]);
    assert.equal(byId.get("instant-task")?.label, "Instant task");

    assert.deepEqual(idsForGroup(entries, "core-pipeline"), [
      "design-review",
      "implement",
      "plan",
      "plan-revise",
      "review",
      "review-fix",
      "review-loop",
    ]);
    assert.deepEqual(idsForGroup(entries, "quality-checks"), ["run-go-linter-loop", "run-go-tests-loop"]);
    assert.deepEqual(idsForGroup(entries, "task-utilities"), ["playbook-init", "task-describe"]);
    assert.deepEqual(idsForGroup(entries, "delivery"), ["git-commit", "mr-description"]);
    assert.deepEqual(idsForGroup(entries, "integrations"), ["gitlab-diff-review", "gitlab-review"]);
    assert.deepEqual(idsForGroup(entries, "specialized"), ["bug-analyze", "bug-fix"]);

    const visiblePublicBuiltIns = entries.filter(
      (entry) => entry.source === "built-in" && flowCatalogModule.isBuiltInCommandFlowId(entry.id) && entry.id !== "auto",
    );
    assert.equal(
      visiblePublicBuiltIns.some((entry) => entry.treePath[0] === "built-in-blocks" && entry.treePath[1] === "other"),
      false,
    );
  });

  it("keeps hidden helper flows out of the interactive catalog", async () => {
    const entries = await flowCatalogModule.loadInteractiveFlowCatalog(path.join(tempRoot, "repo"));
    const entryIds = new Set(entries.map((entry) => entry.id));

    for (const hiddenId of [
      "normalize-task-source",
      "task-source/manual-input",
      "task-source/manual-jira-input",
      "task-source/jira-fetch",
      "design-review/design-review-loop",
      "review/review-project",
      "review/review-project-loop",
      "auto-golang",
      "auto-common-guided",
    ]) {
      assert.equal(entryIds.has(hiddenId), false, hiddenId);
    }
  });

  it("renders human-readable labels and built-in collapse defaults from real entries", async () => {
    const entries = await flowCatalogModule.loadInteractiveFlowCatalog(path.join(tempRoot, "repo"));
    const flowTree = treeModule.buildFlowTree(entries.map(toInteractiveFlow));
    const initiallyExpanded = new Set(treeModule.collectInitiallyExpandedFolderKeys(flowTree));
    const visible = treeModule.computeVisibleFlowItems(flowTree, initiallyExpanded);

    assert.deepEqual(
      visible.slice(0, 3).map((item) => [item.key, item.label]),
      [
        ["folder:recommended", "Recommended"],
        ["flow:auto", "Auto"],
        ["flow:instant-task", "Instant task"],
      ],
    );
    assert.equal(visible.some((item) => item.key === "folder:built-in-blocks"), true);
    assert.equal(visible.some((item) => item.key === "folder:built-in-blocks/core-pipeline"), false);
    assert.equal(
      visible.some((item) => [item.name, item.label, item.key, ...item.pathSegments].some((value) => value === "default")),
      false,
    );

    const builtInExpanded = treeModule.computeVisibleFlowItems(
      flowTree,
      new Set([...initiallyExpanded, "folder:built-in-blocks"]),
    );
    assert.deepEqual(
      builtInExpanded
        .filter((item) => item.kind === "folder" && item.pathSegments[0] === "built-in-blocks" && item.depth === 1)
        .map((item) => item.label),
      ["Core pipeline", "Quality checks", "Task utilities", "Delivery", "Integrations", "Specialized"],
    );
    assert.equal(builtInExpanded.some((item) => item.key === "flow:plan"), false);
  });
});
