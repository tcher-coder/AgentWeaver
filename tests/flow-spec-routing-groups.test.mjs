import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { builtInCommandFlowFile, flowRoutingGroups, isBuiltInCommandFlowId, loadInteractiveFlowCatalog } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href
);
const { loadDeclarativeFlow } = await import(pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href);
const { listBuiltInFlowSpecFiles } = await import(pathToFileURL(path.join(distRoot, "pipeline/spec-loader.js")).href);

const allowedGroups = new Set([
  "planning",
  "design-review",
  "implementation",
  "review",
  "repair-loop",
  "local-fix-loop",
]);

const targetedSpecs = [
  "plan.json",
  "normalize-task-source.json",
  "implement.json",
  "auto-golang.json",
  "instant-task.json",
  "review/review.json",
  "review/review-fix.json",
  "review/review-project.json",
  "design-review.json",
  "plan-revise.json",
  "go/run-go-linter-loop.json",
  "go/run-go-tests-loop.json",
  "task-describe.json",
  "bugz/bug-analyze.json",
  "bugz/bug-fix.json",
  "gitlab/gitlab-review.json",
  "gitlab/gitlab-diff-review.json",
  "gitlab/mr-description.json",
];

function collectLlmPromptSteps(node, acc = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectLlmPromptSteps(item, acc));
    return acc;
  }
  if (!node || typeof node !== "object") {
    return acc;
  }
  if (node.node === "llm-prompt") {
    acc.push(node);
  }
  Object.values(node).forEach((value) => collectLlmPromptSteps(value, acc));
  return acc;
}

describe("flow spec routing groups", () => {
  it("hides helper flows marked with catalogVisibility=hidden from the interactive catalog", async () => {
    const entries = await loadInteractiveFlowCatalog(process.cwd());
    const entryIds = new Set(entries.map((entry) => entry.id));

    assert.equal(entryIds.has("normalize-task-source"), false);
    assert.equal(entryIds.has("task-source/manual-input"), false);
    assert.equal(entryIds.has("task-source/manual-jira-input"), false);
    assert.equal(entryIds.has("task-source/jira-fetch"), false);
    assert.equal(entryIds.has("design-review/design-review-loop"), false);
    assert.equal(entryIds.has("review/review-project"), false);
    assert.equal(entryIds.has("review/review-project-loop"), false);

    assert.equal(entryIds.has("instant-task"), true);
    assert.equal(entryIds.has("auto"), true);
    assert.equal(entryIds.has("auto-common"), false);
    assert.equal(entryIds.has("auto-simple"), false);
    assert.equal(entryIds.has("auto-golang"), false);
    assert.equal(entryIds.has("auto-common-guided"), false);
    assert.equal(entryIds.has("plan"), true);
  });

  it("annotates every targeted built-in llm-prompt step with an allowed routing group", async () => {
    for (const relativePath of targetedSpecs) {
      const spec = JSON.parse(readFileSync(path.join(distRoot, "pipeline/flow-specs", relativePath), "utf8"));
      const steps = collectLlmPromptSteps(spec);
      assert.ok(steps.length > 0, `${relativePath} should contain llm-prompt steps`);
      for (const step of steps) {
        assert.equal(typeof step.routingGroup, "string", `${relativePath}:${step.id} is missing routingGroup`);
        assert.equal(allowedGroups.has(step.routingGroup), true, `${relativePath}:${step.id} has invalid routingGroup`);
      }
    }
  });

  it("collects the same routing groups the runtime preview needs for auto", async () => {
    const flowEntry = (await loadInteractiveFlowCatalog(process.cwd())).find((candidate) => candidate.id === "auto");
    assert.ok(flowEntry, "auto flow should exist");

    const groups = (await flowRoutingGroups(flowEntry, process.cwd())).sort();

    assert.deepEqual(groups, [
      "design-review",
      "implementation",
      "planning",
      "repair-loop",
      "review",
    ]);
  });

  it("keeps every routed built-in command addressable by its built-in spec path", async () => {
    const entries = await loadInteractiveFlowCatalog(process.cwd());
    const routedEntries = [];
    for (const entry of entries) {
      if (entry.id === "auto" || entry.source !== "built-in" || !isBuiltInCommandFlowId(entry.id)) {
        continue;
      }
      if ((await flowRoutingGroups(entry, process.cwd())).length > 0) {
        routedEntries.push(entry);
      }
    }

    assert.ok(routedEntries.length > 0, "expected routed built-in flows");
    for (const entry of routedEntries) {
      assert.equal(
        builtInCommandFlowFile(entry.id),
        entry.fileName,
        `missing built-in flow file mapping for ${entry.id}`,
      );
    }
  });

  it("packages required physical specs without virtual auto-simple or auto-common specs", () => {
    const builtInFiles = listBuiltInFlowSpecFiles();

    assert.equal(builtInFiles.filter((fileName) => fileName === "auto-simple.json").length, 0);
    assert.equal(builtInFiles.filter((fileName) => fileName === "auto-common.json").length, 0);
    assert.equal(existsSync(path.join(distRoot, "pipeline/flow-specs/auto-simple.json")), false);
    assert.equal(existsSync(path.join(distRoot, "pipeline/flow-specs/auto-common.json")), false);
    assert.equal(existsSync(path.join(distRoot, "pipeline/flow-specs/review/review-loop.json")), true);
    assert.equal(existsSync(path.join(distRoot, "pipeline/flow-specs/design-review/design-review-loop.json")), true);
    assert.equal(existsSync(path.join(distRoot, "structured-artifact-schemas.json")), true);
    assert.equal(existsSync(path.join(distRoot, "interactive/web/static/index.html")), true);
  });

  it("declares task describe file upload source and raw task-source prompt variable", () => {
    const spec = JSON.parse(readFileSync(path.join(distRoot, "pipeline/flow-specs/task-describe.json"), "utf8"));
    const collectStep = spec.phases[0].steps.find((step) => step.id === "collect_task_source");
    const fields = collectStep.params.fields.list.map((entry) => entry.const);
    const taskFile = fields.find((field) => field.id === "task_file");
    const runFromInput = spec.phases[0].steps.find((step) => step.id === "run_task_describe_from_input");

    assert.ok(taskFile);
    assert.equal(taskFile.type, "text-file");
    assert.equal(taskFile.maxBytes, 524288);
    assert.deepEqual(taskFile.accept, [".md", ".markdown", ".txt", ".xml", "text/plain", "text/markdown", "text/xml", "application/xml"]);
    assert.equal(runFromInput.prompt.vars.task_source_file.artifact.kind, "task-source-file");
    assert.match(runFromInput.prompt.inlineTemplate, /values\.task_file is present/);
    assert.match(runFromInput.prompt.inlineTemplate, /raw uploaded task source artifact/);
  });
});
