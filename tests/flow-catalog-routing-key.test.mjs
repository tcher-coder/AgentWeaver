import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");

let tempRoot;
let flowCatalogModule;
let originalHome;

function writeProjectFlow(repoDir, relativeFilePath) {
  const filePath = path.join(repoDir, ".agentweaver", ".flows", relativeFilePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    kind: "custom-flow",
    version: 1,
    phases: [],
  }, null, 2)}\n`, "utf8");
}

function writeGlobalFlow(homeDir, relativeFilePath) {
  const filePath = path.join(homeDir, ".agentweaver", ".flows", relativeFilePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({
    kind: "custom-flow",
    version: 1,
    phases: [],
  }, null, 2)}\n`, "utf8");
}

function writeAutoConfig(repoDir, name) {
  const filePath = path.join(repoDir, ".agentweaver", "flow-configs", `${name}.yaml`);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `kind: auto-flow-config\nversion: 2\nname: ${name}\n`, "utf8");
}

beforeEach(async () => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "agentweaver-flow-catalog-"));
  originalHome = process.env.HOME;
  process.env.HOME = path.join(tempRoot, "home");
  flowCatalogModule = await import(
    `${pathToFileURL(path.join(distRoot, "pipeline/flow-catalog.js")).href}?catalog=${Date.now()}`
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

describe("flow routing keys", () => {
  it("keeps project-local flow defaults distinct across repositories with the same repo-local id", async () => {
    const firstRepo = path.join(tempRoot, "repo-a");
    const secondRepo = path.join(tempRoot, "repo-b");
    writeProjectFlow(firstRepo, "review/fix.json");
    writeProjectFlow(secondRepo, "review/fix.json");

    const firstEntry = (await flowCatalogModule.loadInteractiveFlowCatalog(firstRepo)).find((entry) => entry.source === "project-local");
    const secondEntry = (await flowCatalogModule.loadInteractiveFlowCatalog(secondRepo)).find((entry) => entry.source === "project-local");

    assert.ok(firstEntry, "first project-local flow should exist");
    assert.ok(secondEntry, "second project-local flow should exist");
    assert.equal(firstEntry.id, secondEntry.id);
    assert.notEqual(
      flowCatalogModule.flowRoutingKey(firstEntry),
      flowCatalogModule.flowRoutingKey(secondEntry),
    );
  });

  it("exposes auto and saved configs while hiding legacy public auto flows", async () => {
    const repo = path.join(tempRoot, "repo");
    writeAutoConfig(repo, "backend-standard");

    const entries = await flowCatalogModule.loadInteractiveFlowCatalog(repo);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    assert.deepEqual(byId.get("auto")?.treePath, ["recommended", "auto"]);
    assert.deepEqual(byId.get("auto-config:backend-standard")?.treePath, ["custom", "saved-auto-flows", "backend-standard"]);
    for (const legacyId of ["auto-common", "auto-simple", "auto-golang", "auto-common-guided"]) {
      assert.equal(byId.has(legacyId), false, legacyId);
    }
  });

  it("groups project-local flows under Custom while preserving routing identity", async () => {
    const repo = path.join(tempRoot, "repo");
    writeProjectFlow(repo, "review/fix.json");

    const entry = (await flowCatalogModule.loadInteractiveFlowCatalog(repo)).find((candidate) => candidate.source === "project-local");

    assert.ok(entry, "project-local flow should exist");
    assert.equal(entry.id, "review/fix");
    assert.deepEqual(entry.treePath, ["custom", "project-flows", "review", "fix"]);
    assert.equal(flowCatalogModule.flowRoutingKey(entry), `project-local:${entry.absolutePath}`);
  });

  it("groups global flows under Custom while preserving routing identity", async () => {
    const repo = path.join(tempRoot, "repo");
    const home = process.env.HOME;
    writeGlobalFlow(home, "team/audit.json");
    const entry = (await flowCatalogModule.loadInteractiveFlowCatalog(repo)).find((candidate) => candidate.source === "global");

    assert.ok(entry, "global flow should exist");
    assert.equal(entry.id, "team/audit");
    assert.deepEqual(entry.treePath, ["custom", "global-flows", "team", "audit"]);
    assert.equal(flowCatalogModule.flowRoutingKey(entry), `global:${entry.absolutePath}`);
  });

  it("keeps duplicate id validation active after custom regrouping", async () => {
    const repo = path.join(tempRoot, "repo");
    writeProjectFlow(repo, "git-commit.json");

    await assert.rejects(
      flowCatalogModule.loadInteractiveFlowCatalog(repo),
      /Flow id 'git-commit' conflicts/,
    );
  });
});
