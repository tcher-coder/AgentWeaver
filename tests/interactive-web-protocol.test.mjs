import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { parseClientAction } = await import(
  pathToFileURL(path.join(distRoot, "interactive/web/protocol.js")).href
);

const textFileValue = {
  kind: "text-file",
  name: "task.md",
  mediaType: "text/markdown",
  extension: "md",
  sizeBytes: 24,
  sha256: "b".repeat(64),
  content: "# Task\n",
};

describe("interactive web protocol", () => {
  it("accepts every semantic client action", () => {
    const actions = [
      { type: "flow.select", index: 0 },
      { type: "flow.select", key: "flow:plan" },
      { type: "folder.toggle", key: "folder:default" },
      { type: "run.openConfirm", flowId: "plan" },
      { type: "confirm.select", action: "restart" },
      { type: "confirm.accept" },
      { type: "confirm.accept", action: "restart" },
      { type: "confirm.cancel" },
      { type: "form.update", values: { name: "Ada" } },
      { type: "form.fieldUpdate", fieldId: "name", value: "Ada" },
      { type: "form.fieldUpdate", fieldId: "task_file", value: textFileValue },
      { type: "form.submit", values: { name: "Ada" } },
      { type: "form.submit", values: { task_file: textFileValue } },
      { type: "form.cancel" },
      { type: "interrupt.openConfirm" },
      { type: "flow.interrupt", flowId: "plan" },
      { type: "log.clear" },
      { type: "artifactExplorer.open" },
      { type: "artifactExplorer.close", actionId: "artifact-close-1" },
      { type: "autoFlow.selectPreset", preset: "standard" },
      { type: "autoFlow.loadConfig", name: "backend-standard", flowId: "auto-common" },
      { type: "autoFlow.save", flowId: "auto-common", name: "backend-standard", location: "project" },
      { type: "autoFlow.reset", flowId: "auto-common" },
      { type: "autoFlow.toggleBlock", flowId: "auto-common", blockId: "review.design-loop", enabled: false },
      { type: "autoFlow.toggleBlock", flowId: "auto-common", slotId: "final", blockId: "checks.go.linter", enabled: false },
      { type: "autoFlow.updateParam", flowId: "auto-common", blockId: "review.loop", paramName: "maxIterations", value: 5 },
      { type: "autoFlow.updateParam", flowId: "auto-common", slotId: "final", blockId: "checks.go.tests", paramName: "maxIterations", value: 5 },
      { type: "autoFlow.insertBlock", flowId: "auto-common", slotId: "designReview", blockId: "review.design-loop" },
      { type: "autoFlow.removeBlock", flowId: "auto-common", slotId: "final", blockId: "checks.go.linter" },
      { type: "git.refresh" },
      { type: "git.createBranch", branchName: "feature/ag-121" },
      { type: "git.checkout", branchName: "main" },
      { type: "git.fetch" },
      { type: "git.pullFfOnly" },
      { type: "git.stage", paths: ["--option-like.ts"] },
      { type: "git.unstage", paths: ["--option-like.ts"] },
      { type: "git.updateCommitMessage", message: "" },
      { type: "git.commit", paths: ["--option-like.ts"], message: "Commit message" },
      { type: "git.push" },
      { type: "settings.update", settings: { theme: "dark", autoFlowHeight: null, workspaceSplit: 42, logAutoscroll: false } },
      { type: "help.toggle", visible: true },
      { type: "scroll", pane: "log", delta: 1 },
      { type: "scroll", pane: "summary", offset: 0, actionId: "a-1" },
    ];

    for (const action of actions) {
      assert.deepEqual(parseClientAction(JSON.stringify(action)), action);
    }
  });

  it("rejects malformed messages and invalid payloads", () => {
    assert.throws(() => parseClientAction("{"), /valid JSON/);
    assert.throws(() => parseClientAction(JSON.stringify({})), /string type/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "submitInput" })), /Unknown protocol action/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "artifactExplorer.toggle" })), /Unknown protocol action/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "artifactExplorer.open", actionId: "" })), /actionId must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "artifactExplorer.close", actionId: 123 })), /actionId must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.selectPreset", preset: "advanced" })), /preset must be simple or standard/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.loadConfig", name: "" })), /name must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.save", location: "remote" })), /location must be project or user/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.reset", flowId: "" })), /flowId must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.toggleBlock", blockId: "review.loop", enabled: "yes" })), /enabled must be a boolean/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.updateParam", blockId: "review.loop", paramName: "maxIterations", value: 1.5 })), /value must be an integer/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.insertBlock", slotId: "", blockId: "review.loop" })), /slotId must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "autoFlow.removeBlock", slotId: "", blockId: "review.loop" })), /slotId must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "git.createBranch", branchName: "feature/new", selectedBase: "main" })), /selected base/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "git.checkout", branchName: "" })), /branchName must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "git.stage", paths: "file.txt" })), /paths must be an array/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "git.stage", paths: [""] })), /paths must be an array/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "git.updateCommitMessage", message: 123 })), /message must be a string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "git.commit", message: "   " })), /message must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "settings.update", settings: {} })), /requires at least one setting/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "settings.update", settings: { theme: "sepia" } })), /theme must be light or dark/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "settings.update", settings: { workspaceSplit: "42" } })), /workspaceSplit must be a finite number/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "settings.update", settings: { logAutoscroll: "yes" } })), /logAutoscroll must be a boolean/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "settings.update", settings: { unknown: true } })), /Unsupported settings key/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "flow.select" })), /requires index or key/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "folder.toggle", key: "" })), /key must be a non-empty string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.update", values: [] })), /values must be an object/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.fieldUpdate", fieldId: "name" })), /value is required/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.fieldUpdate", fieldId: "task_file", value: { name: "task.md" } })), /value must be/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.fieldUpdate", fieldId: "task_file", value: { ...textFileValue, extension: "pdf" } })), /extension is not supported/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.fieldUpdate", fieldId: "task_file", value: { ...textFileValue, sizeBytes: "24" } })), /size must be/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "form.submit", values: { task_file: { ...textFileValue, content: 42 } } })), /content must be a string/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "scroll", pane: "bad", delta: 1 })), /scroll pane/);
    assert.throws(() => parseClientAction(JSON.stringify({ type: "scroll", pane: "log" })), /requires delta or offset/);
  });
});
