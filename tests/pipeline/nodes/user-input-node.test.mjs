import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { userInputNode } = await import(
  pathToFileURL(path.join(distRoot, "pipeline/nodes/user-input-node.js")).href
);
const { buildInitialUserInputValues } = await import(
  pathToFileURL(path.join(distRoot, "user-input.js")).href
);

let tempDir;
let originalCwd;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(os.tmpdir(), "agentweaver-user-input-node-"));
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("userInputNode", () => {
  it("prefills form defaults from initialValues", async () => {
    const outputFile = path.join(tempDir, "instant-task-input-demo.json");
    let capturedForm = null;

    const result = await userInputNode.run(
      {
        issueKey: "demo",
        requestUserInput: async (form) => {
          capturedForm = form;
          return {
            formId: form.formId,
            submittedAt: "2026-04-19T16:00:00.000Z",
            values: buildInitialUserInputValues(form.fields),
          };
        },
      },
      {
        formId: "instant-task-input",
        title: "Instant Task Input",
        fields: [
          {
            id: "task_description",
            type: "text",
            label: "Task description",
            required: true,
            multiline: true,
          },
          {
            id: "additional_instructions",
            type: "text",
            label: "Additional instructions",
            multiline: true,
          },
        ],
        initialValues: {
          task_description: "Saved task",
          additional_instructions: "Saved notes",
        },
        outputFile,
      },
    );

    assert.ok(capturedForm, "requestUserInput should receive a form");
    assert.equal(capturedForm.fields[0].default, "Saved task");
    assert.equal(capturedForm.fields[1].default, "Saved notes");
    assert.equal(result.value.values.task_description, "Saved task");
    assert.equal(result.value.values.additional_instructions, "Saved notes");

    const persisted = JSON.parse(readFileSync(outputFile, "utf8"));
    assert.equal(persisted.values.task_description, "Saved task");
    assert.equal(persisted.values.additional_instructions, "Saved notes");
  });

  it("persists task source uploads as raw artifacts and strips content from structured JSON", async () => {
    const outputFile = path.join(tempDir, ".agentweaver/scopes/ag-file/.artifacts/task-describe-input-ag-file.json");
    const stalePath = path.join(tempDir, ".agentweaver/scopes/ag-file/.artifacts/task-source-ag-file.txt");
    mkdirSync(path.dirname(stalePath), { recursive: true });
    writeFileSync(stalePath, "stale\n", "utf8");
    const result = await userInputNode.run(
      {
        issueKey: "ag-file",
        requestUserInput: async (form) => ({
          formId: form.formId,
          submittedAt: "2026-04-19T16:00:00.000Z",
          values: {
            jira_ref: "",
            task_file: {
              kind: "text-file",
              name: "../task.md",
              mediaType: "text/markdown",
              extension: "md",
              sizeBytes: 15,
              sha256: "0".repeat(64),
              content: "# Task\r\nDetails\r\n",
            },
            additional_instructions: "Keep acceptance criteria concise.",
            task_description: "",
          },
        }),
      },
      {
        formId: "task-describe-source-input",
        title: "Task Describe Source",
        fields: [
          { id: "jira_ref", type: "text", label: "Jira issue key or browse URL" },
          { id: "task_file", type: "text-file", label: "Task source file", maxBytes: 524288 },
          { id: "additional_instructions", type: "text", label: "Additional instructions" },
          { id: "task_description", type: "text", label: "Task description" },
        ],
        outputFile,
      },
    );

    const rawPath = path.join(tempDir, ".agentweaver/scopes/ag-file/.artifacts/task-source-ag-file.md");
    const normalized = "# Task\nDetails\n";
    const digest = createHash("sha256").update(normalized, "utf8").digest("hex");
    assert.equal(readFileSync(rawPath, "utf8"), normalized);

    const persisted = JSON.parse(readFileSync(outputFile, "utf8"));
    assert.equal(persisted.values.task_file.kind, "text-file");
    assert.equal(persisted.values.task_file.name, "../task.md");
    assert.equal(persisted.values.task_file.storedPath, rawPath);
    assert.equal(persisted.values.task_file.sha256, digest);
    assert.equal(persisted.values.task_file.sizeBytes, Buffer.byteLength(normalized, "utf8"));
    assert.equal(Object.hasOwn(persisted.values.task_file, "content"), false);
    assert.equal(result.value.values.task_file.storedPath, rawPath);
    assert.match(result.value.promptSuffix, /uploaded task source artifact/);
    assert.match(result.value.promptSuffix, /task-source-ag-file\.md/);
    assert.equal(result.outputs.length, 2);
    assert.equal(result.outputs[0].path, outputFile);
    assert.equal(result.outputs[1].path, rawPath);
    assert.equal(result.outputs[1].manifest.payloadFamily, "markdown");
    assert.equal(result.outputs[1].manifest.schemaId, "markdown/v1");
    assert.equal(existsSync(rawPath), true);
    assert.equal(existsSync(stalePath), false);
  });
});
