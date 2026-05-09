import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { resolveAutoFlow } = await import(pathToFileURL(path.join(distRoot, "pipeline/auto-flow-resolver.js")).href);
const { collectFlowRoutingGroups } = await import(pathToFileURL(path.join(distRoot, "pipeline/declarative-flows.js")).href);

let tempDir;
let originalHome;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-auto-flow-resolver-"));
  originalHome = process.env.HOME;
  process.env.HOME = path.join(tempDir, "home");
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

function writeProjectConfig(name, body) {
  const filePath = path.join(tempDir, ".agentweaver", "flow-configs", `${name}.yaml`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
  return filePath;
}

describe("auto flow resolver", () => {
  it("resolves the simple preset to source, normalize, planning, implementation, and review", async () => {
    const resolved = await resolveAutoFlow({ kind: "preset", preset: "simple" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.equal(resolved.execution.kind, "built-in");
    assert.equal(resolved.execution.specFile, "auto-simple.json");
    assert.deepEqual(resolved.document.phases.map((phase) => phase.id), [
      "source",
      "normalize",
      "plan",
      "implement",
      "review-loop",
    ]);
    assert.deepEqual(resolved.summary.phaseOrder, ["source", "normalize", "planning", "implementation", "review"]);
  });

  it("resolves the standard preset with design review before implementation", async () => {
    const resolved = await resolveAutoFlow({ kind: "preset", preset: "standard" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    const phaseIds = resolved.document.phases.map((phase) => phase.id);
    assert.equal(resolved.execution.kind, "built-in");
    assert.equal(resolved.execution.specFile, "auto-common.json");
    assert.ok(phaseIds.indexOf("design_review_loop") < phaseIds.indexOf("implement"));
  });

  it("generates a flow when a saved config changes slots and iteration counts", async () => {
    writeProjectConfig("backend-standard", [
      "kind: auto-flow-config",
      "version: 1",
      "name: backend-standard",
      "basePreset: standard",
      "slots:",
      "  designReview:",
      "    blocks:",
      "      - id: review.design-loop",
      "        enabled: true",
      "        maxIterations: 2",
      "  postImplementationChecks:",
      "    blocks:",
      "      - id: checks.go.linter",
      "        enabled: true",
      "        maxIterations: 3",
      "  review:",
      "    blocks:",
      "      - id: review.loop",
      "        enabled: true",
      "  final:",
      "    blocks: []",
      "",
    ].join("\n"));

    const resolved = await resolveAutoFlow({ kind: "config", name: "backend-standard" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.equal(resolved.execution.kind, "generated");
    assert.equal(resolved.document.source.type, "project-config");
    assert.deepEqual(resolved.document.executionTarget.nestedFlowFiles, [
      "generated-checks-go-linter-3.json",
      "generated-review-design-loop-2.json",
    ]);
    assert.ok(resolved.document.phases.some((phase) => phase.id === "post_go_linter_loop"));
    assert.ok(resolved.summary.includedBlocks.some((block) => block.blockId === "checks.go.linter" && block.maxIterations === 3));
  });

  it("collects routing groups from generated in-memory nested flow-run nodes", async () => {
    writeProjectConfig("backend-standard", [
      "kind: auto-flow-config",
      "version: 1",
      "name: backend-standard",
      "basePreset: standard",
      "slots:",
      "  designReview:",
      "    blocks:",
      "      - id: review.design-loop",
      "        enabled: true",
      "        maxIterations: 2",
      "  postImplementationChecks:",
      "    blocks:",
      "      - id: checks.go.linter",
      "        enabled: true",
      "        maxIterations: 3",
      "  review:",
      "    blocks:",
      "      - id: review.loop",
      "        enabled: true",
      "  final:",
      "    blocks: []",
      "",
    ].join("\n"));

    const resolved = await resolveAutoFlow({ kind: "config", name: "backend-standard" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.equal(resolved.execution.kind, "generated");

    const groups = (await collectFlowRoutingGroups(
      resolved.execution.flow,
      tempDir,
      new Set(),
      { inMemoryFlows: resolved.execution.inMemoryFlows },
    )).sort();

    assert.ok(groups.includes("design-review"));
    assert.ok(groups.includes("local-fix-loop"));
    assert.ok(groups.includes("repair-loop"));
  });

  it("omits design review when a standard config disables the design review slot", async () => {
    writeProjectConfig("no-design-review", [
      "kind: auto-flow-config",
      "version: 1",
      "name: no-design-review",
      "basePreset: standard",
      "slots:",
      "  designReview:",
      "    blocks: []",
      "",
    ].join("\n"));

    const resolved = await resolveAutoFlow({ kind: "config", name: "no-design-review" }, { cwd: tempDir, scopeKey: "ag-123@test" });
    assert.equal(resolved.execution.kind, "generated");
    assert.equal(resolved.document.phases.some((phase) => phase.id === "design_review_loop"), false);
    assert.ok(resolved.summary.skippedBlocks.some((block) => block.blockId === "review.design-loop"));
  });

  it("rejects saved configs with review.loop.maxIterations above five", async () => {
    writeProjectConfig("invalid-review-loop", [
      "kind: auto-flow-config",
      "version: 1",
      "name: invalid-review-loop",
      "basePreset: standard",
      "slots:",
      "  review:",
      "    blocks:",
      "      - id: review.loop",
      "        enabled: true",
      "        maxIterations: 6",
      "",
    ].join("\n"));

    await assert.rejects(
      () => resolveAutoFlow({ kind: "config", name: "invalid-review-loop" }, { cwd: tempDir, scopeKey: "ag-123@test" }),
      /maxIterations for block 'review\.loop' must be between 1 and 5; received 6/,
    );
  });
});
