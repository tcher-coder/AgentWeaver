import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { createArtifactRegistry } = await import(
  pathToFileURL(path.join(distRoot, "runtime/artifact-registry.js")).href
);
const {
  inferArtifactRenderKind,
  inferArtifactRole,
  inferArtifactTitle,
  listArtifactCatalog,
} = await import(
  pathToFileURL(path.join(distRoot, "runtime/artifact-catalog.js")).href
);
const {
  artifactIndexFile,
  artifactManifestSidecarPath,
  scopeArtifactsDir,
  scopeWorkspaceDir,
} = await import(
  pathToFileURL(path.join(distRoot, "artifacts.js")).href
);

let originalCwd;
let tempDir;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-artifact-catalog-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

function writeScopeFile(scopeKey, relativePath, content, encoding = "utf8") {
  const filePath = path.join(scopeWorkspaceDir(scopeKey), relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, encoding);
  return filePath;
}

function publishMarkdown(registry, scopeKey, payloadPath, overrides = {}) {
  return registry.publish({
    scopeKey,
    runId: "run-1",
    flowId: "implement",
    phaseId: "design",
    stepId: "write_design",
    nodeKind: "codex-prompt",
    nodeVersion: 1,
    kind: "artifact",
    payloadPath,
    inputs: [],
    ...overrides,
  });
}

describe("artifact catalog", () => {
  it("projects manifest-backed artifacts with registry metadata and no payload body", () => {
    const scopeKey = "ag-cat-1";
    const registry = createArtifactRegistry();
    const payloadPath = writeScopeFile(scopeKey, "design-ag-cat-1-1.md", "# Design\n");

    publishMarkdown(registry, scopeKey, payloadPath, {
      runId: "run-manifest",
      phaseId: "plan",
      stepId: "write_plan",
      logicalKey: "design-main",
    });

    const catalog = listArtifactCatalog({ scopeKey, artifactRegistry: registry });
    const item = catalog.items.find((candidate) => candidate.relativePath === "design-ag-cat-1-1.md");

    assert.ok(item);
    assert.equal(item.source, "manifest");
    assert.equal(item.scopeKey, scopeKey);
    assert.equal(item.runId, "run-manifest");
    assert.equal(item.logicalKey, "design-main");
    assert.equal(item.phaseId, "plan");
    assert.equal(item.stepId, "write_plan");
    assert.equal(item.schemaId, "markdown/v1");
    assert.equal(item.isLatest, true);
    assert.equal(item.kind, "markdown");
    assert.equal(item.role, "design");
    assert.equal(item.title, "Design");
    assert.equal(typeof item.sizeBytes, "number");
    assert.ok(item.sizeBytes > 0);
    assert.match(item.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Object.hasOwn(item, "body"), false);
  });

  it("scans legacy workspace and .artifacts files when no manifest exists", () => {
    const scopeKey = "ag-cat-2";
    const registry = createArtifactRegistry();
    writeScopeFile(scopeKey, "legacy-note.md", "# Legacy\n");
    writeScopeFile(scopeKey, ".artifacts/legacy-data.json", "{\n  \"ok\": true\n}\n");

    const catalog = listArtifactCatalog({ scopeKey, artifactRegistry: registry });
    const workspaceItem = catalog.items.find((item) => item.relativePath === "legacy-note.md");
    const artifactsItem = catalog.items.find((item) => item.relativePath === ".artifacts/legacy-data.json");

    assert.ok(workspaceItem);
    assert.equal(workspaceItem.source, "scanner");
    assert.equal(workspaceItem.kind, "markdown");
    assert.equal(workspaceItem.isLatest, true);
    assert.equal(workspaceItem.phaseId, null);
    assert.match(workspaceItem.id, /^scanner:ag-cat-2:legacy-note\.md$/);

    assert.ok(artifactsItem);
    assert.equal(artifactsItem.source, "scanner");
    assert.equal(artifactsItem.kind, "json");
    assert.equal(artifactsItem.title, "Legacy Data");
    assert.equal(artifactsItem.phaseId, null);
  });

  it("suppresses duplicate payloads and excludes internal registry files", () => {
    const scopeKey = "ag-cat-3";
    const registry = createArtifactRegistry();
    const payloadPath = writeScopeFile(scopeKey, "plan-ag-cat-3-1.md", "# Plan\n");
    publishMarkdown(registry, scopeKey, payloadPath, {
      phaseId: "plan",
      logicalKey: "plan-main",
    });

    writeScopeFile(scopeKey, "loose.manifest.json", "{}\n");
    writeScopeFile(scopeKey, ".artifacts/manifest-history/old.json", "{}\n");
    writeScopeFile(scopeKey, ".artifacts/restart-archives/archive.json", "{}\n");
    writeScopeFile(scopeKey, ".artifacts/internal-index.json", "{}\n");
    writeScopeFile(scopeKey, ".artifacts/artifact-index.json.tmp-123", "{}\n");
    writeScopeFile(scopeKey, ".artifacts/scratch.tmp", "temporary\n");
    writeFileSync(artifactManifestSidecarPath(payloadPath), "{}\n", "utf8");
    writeFileSync(artifactIndexFile(scopeKey), "{}\n", "utf8");

    const catalog = listArtifactCatalog({ scopeKey, artifactRegistry: registry });
    const matchingPayloads = catalog.items.filter((item) => item.relativePath === "plan-ag-cat-3-1.md");
    const relativePaths = catalog.items.map((item) => item.relativePath);

    assert.equal(matchingPayloads.length, 1);
    assert.equal(matchingPayloads[0].source, "manifest");
    assert.deepEqual(
      relativePaths.filter((relativePath) => relativePath.includes("manifest") || relativePath.includes("index") || relativePath.includes("restart") || relativePath.includes("tmp")),
      [],
    );
  });

  it("infers only MVP render kinds from payload family, schema id, and extension", () => {
    assert.equal(inferArtifactRenderKind({ payloadFamily: "markdown", schemaId: "helper-json/v1", filePath: "artifact.json" }), "markdown");
    assert.equal(inferArtifactRenderKind({ schemaId: "gitlab-mr-diff/v1", filePath: "artifact.json" }), "diff");
    assert.equal(inferArtifactRenderKind({ schemaId: "markdown/v1", filePath: "artifact.txt" }), "markdown");
    assert.equal(inferArtifactRenderKind({ filePath: "artifact.json" }), "json");
    assert.equal(inferArtifactRenderKind({ filePath: "artifact.log" }), "text");
    assert.equal(inferArtifactRenderKind({ filePath: "artifact.patch" }), "diff");
    assert.equal(inferArtifactRenderKind({ filePath: "artifact.png" }), "binary");
    assert.equal(inferArtifactRenderKind({ filePath: "artifact.custom" }), "unknown");
  });

  it("infers readable roles and titles for known AgentWeaver prefixes", () => {
    assert.equal(inferArtifactRole("design-main", "design-ag-1.md"), "design");
    assert.equal(inferArtifactTitle("ag-1", "design-main", "design-ag-1.md"), "Design");
    assert.equal(inferArtifactRole("plan-main", "plan-ag-1.md"), "plan");
    assert.equal(inferArtifactTitle("ag-1", "qa-main", "qa-ag-1.md"), "QA Plan");
    assert.equal(inferArtifactRole("task-context-main", "task-context-ag-1.md"), "context");
    assert.equal(inferArtifactTitle("ag-1", "gitlab-diff-main", ".artifacts/gitlab-diff-ag-1.json"), "GitLab Diff");
    assert.equal(inferArtifactRole("artifacts/task-source.md", ".artifacts/task-source-ag-1.md"), "context");
    assert.equal(inferArtifactTitle("ag-1", "artifacts/task-source.md", ".artifacts/task-source-ag-1.md"), "Task Source");
  });

  it("lists manifest-backed raw task source artifacts as openable text or markdown", () => {
    const scopeKey = "ag-cat-source";
    const registry = createArtifactRegistry();
    const payloadPath = writeScopeFile(scopeKey, ".artifacts/task-source-ag-cat-source.md", "# Uploaded task\n");

    publishMarkdown(registry, scopeKey, payloadPath, {
      phaseId: "task_describe",
      stepId: "collect_task_source",
      logicalKey: "artifacts/task-source.md",
      payloadFamily: "markdown",
      schemaId: "markdown/v1",
      schemaVersion: 1,
    });

    const catalog = listArtifactCatalog({ scopeKey, artifactRegistry: registry });
    const item = catalog.items.find((candidate) => candidate.relativePath === ".artifacts/task-source-ag-cat-source.md");

    assert.ok(item);
    assert.equal(item.source, "manifest");
    assert.equal(item.kind, "markdown");
    assert.equal(item.role, "context");
    assert.equal(item.title, "Task Source");
    assert.equal(item.schemaId, "markdown/v1");
  });

  it("groups phase-less items as unclassified and returns deterministic order", () => {
    const scopeKey = "ag-cat-4";
    const registry = createArtifactRegistry();
    const designPath = writeScopeFile(scopeKey, "design-ag-cat-4-1.md", "# Design\n");
    const qaPath = writeScopeFile(scopeKey, "qa-ag-cat-4-1.md", "# QA\n");
    writeScopeFile(scopeKey, ".artifacts/legacy.json", "{}\n");

    publishMarkdown(registry, scopeKey, designPath, {
      phaseId: "design",
      stepId: "write_design",
      logicalKey: "design-main",
    });
    publishMarkdown(registry, scopeKey, qaPath, {
      runId: "run-2",
      phaseId: "qa",
      stepId: "write_qa",
      logicalKey: "qa-main",
    });

    const first = listArtifactCatalog({ scopeKey, artifactRegistry: registry });
    const second = listArtifactCatalog({ scopeKey, artifactRegistry: registry });

    assert.deepEqual(first.items.map((item) => item.relativePath), second.items.map((item) => item.relativePath));
    assert.deepEqual(first.groups.map((group) => group.phaseId), ["design", "qa", "unclassified"]);

    const unclassified = first.groups.find((group) => group.phaseId === "unclassified");
    assert.ok(unclassified);
    assert.equal(unclassified.title, "Unclassified");
    assert.deepEqual(unclassified.items.map((item) => item.relativePath), [".artifacts/legacy.json"]);
  });

  it("adds nested type groups when a phase contains repeated artifact types", () => {
    const scopeKey = "ag-cat-4b";
    const registry = createArtifactRegistry();
    const firstReviewPath = writeScopeFile(scopeKey, "review-ag-cat-4b-1.md", "# Review 1\n");
    const secondReviewPath = writeScopeFile(scopeKey, "review-ag-cat-4b-2.md", "# Review 2\n");

    publishMarkdown(registry, scopeKey, firstReviewPath, {
      runId: "review-run-1",
      phaseId: "review",
      stepId: "write_review",
      logicalKey: "review-main",
    });
    publishMarkdown(registry, scopeKey, secondReviewPath, {
      runId: "review-run-2",
      phaseId: "review",
      stepId: "write_review",
      logicalKey: "review-main",
    });

    const catalog = listArtifactCatalog({ scopeKey, artifactRegistry: registry });
    const reviewGroup = catalog.groups.find((group) => group.phaseId === "review");

    assert.ok(reviewGroup);
    assert.equal(reviewGroup.items.length, 2);
    assert.deepEqual(reviewGroup.groups?.map((group) => group.title), ["Review"]);
    assert.deepEqual(reviewGroup.groups?.[0]?.items.map((item) => item.relativePath).sort(), [
      "review-ag-cat-4b-1.md",
      "review-ag-cat-4b-2.md",
    ]);
  });

  it("keeps scanner traversal inside the scope workspace", () => {
    const scopeKey = "ag-cat-5";
    const registry = createArtifactRegistry();
    mkdirSync(scopeArtifactsDir(scopeKey), { recursive: true });
    writeScopeFile(scopeKey, "visible.txt", "visible\n");

    const catalog = listArtifactCatalog({ scopeKey, artifactRegistry: registry });

    assert.deepEqual(catalog.items.map((item) => item.relativePath), ["visible.txt"]);
  });
});
