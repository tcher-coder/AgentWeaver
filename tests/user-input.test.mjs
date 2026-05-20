import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const {
  validateUserInputValues,
} = await import(pathToFileURL(path.join(distRoot, "user-input.js")).href);

const validFile = {
  kind: "text-file",
  name: "task.md",
  mediaType: "text/markdown",
  extension: "md",
  sizeBytes: 12,
  sha256: "a".repeat(64),
  content: "# Task\n",
};

function form() {
  return {
    formId: "task-describe-source-input",
    title: "Task Describe Source",
    fields: [
      { id: "jira_ref", type: "text", label: "Jira issue key or browse URL" },
      { id: "task_file", type: "text-file", label: "Task source file", maxBytes: 128 },
      { id: "additional_instructions", type: "text", label: "Additional instructions" },
      { id: "task_description", type: "text", label: "Task description" },
    ],
  };
}

function jiraTaskInputForm() {
  return {
    formId: "jira-task-input",
    title: "Jira Task",
    fields: [
      { id: "jira_ref", type: "text", label: "Jira issue key or browse URL" },
      { id: "task_file", type: "text-file", label: "Task source file", maxBytes: 128 },
      { id: "task_description", type: "text", label: "Task description" },
    ],
  };
}

function manualJiraTaskInputForm() {
  return {
    formId: "manual-jira-task-input",
    title: "Manual Jira Task",
    fields: [
      { id: "task_file", type: "text-file", label: "Task source file", maxBytes: 128 },
      { id: "task_description", type: "text", label: "Task description" },
    ],
  };
}

describe("user input validation", () => {
  it("accepts exactly one task describe source and keeps additional instructions independent", () => {
    assert.doesNotThrow(() => validateUserInputValues(form(), {
      jira_ref: "DEMO-1",
      task_file: null,
      additional_instructions: "Keep concise",
      task_description: "",
    }));
    assert.doesNotThrow(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: validFile,
      additional_instructions: "Keep concise",
      task_description: "",
    }));
    assert.doesNotThrow(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: null,
      additional_instructions: "Keep concise",
      task_description: "Add a filter",
    }));
  });

  it("rejects no source and multiple task describe sources with distinct messages", () => {
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: null,
      additional_instructions: "",
      task_description: "",
    }), /Jira URL\/key, upload a task file, or enter/);
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "DEMO-1",
      task_file: validFile,
      additional_instructions: "",
      task_description: "",
    }), /only one task source/);
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: validFile,
      additional_instructions: "",
      task_description: "Add a filter",
    }), /only one task source/);
  });

  it("rejects invalid uploaded text-file metadata and content", () => {
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: { ...validFile, extension: "pdf" },
      additional_instructions: "",
      task_description: "",
    }), /extension is not supported/);
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: { ...validFile, mediaType: "application/pdf" },
      additional_instructions: "",
      task_description: "",
    }), /media type is not supported/);
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: { ...validFile, sizeBytes: 129 },
      additional_instructions: "",
      task_description: "",
    }), /maximum size/);
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: { ...validFile, content: "   \r\n" },
      additional_instructions: "",
      task_description: "",
    }), /must not be empty/);
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: { ...validFile, content: "abc\0def" },
      additional_instructions: "",
      task_description: "",
    }), /binary/);
    assert.throws(() => validateUserInputValues(form(), {
      jira_ref: "",
      task_file: { ...validFile, sha256: "not-a-digest" },
      additional_instructions: "",
      task_description: "",
    }), /sha256/);
  });

  it("accepts exactly one source for the common Jira task input form", () => {
    assert.doesNotThrow(() => validateUserInputValues(jiraTaskInputForm(), {
      jira_ref: "DEMO-1",
      task_file: null,
      task_description: "",
    }));
    assert.doesNotThrow(() => validateUserInputValues(jiraTaskInputForm(), {
      jira_ref: "",
      task_file: validFile,
      task_description: "",
    }));
    assert.doesNotThrow(() => validateUserInputValues(jiraTaskInputForm(), {
      jira_ref: "",
      task_file: null,
      task_description: "Add a filter",
    }));
    assert.throws(() => validateUserInputValues(jiraTaskInputForm(), {
      jira_ref: "",
      task_file: null,
      task_description: "",
    }), /upload a task file/);
    assert.throws(() => validateUserInputValues(jiraTaskInputForm(), {
      jira_ref: "DEMO-1",
      task_file: validFile,
      task_description: "",
    }), /only one task source/);
  });

  it("accepts exactly one source for manual Jira task fallback input", () => {
    assert.doesNotThrow(() => validateUserInputValues(manualJiraTaskInputForm(), {
      task_file: validFile,
      task_description: "",
    }));
    assert.doesNotThrow(() => validateUserInputValues(manualJiraTaskInputForm(), {
      task_file: null,
      task_description: "Add a filter",
    }));
    assert.throws(() => validateUserInputValues(manualJiraTaskInputForm(), {
      task_file: null,
      task_description: "",
    }), /Upload a task file/);
    assert.throws(() => validateUserInputValues(manualJiraTaskInputForm(), {
      task_file: validFile,
      task_description: "Add a filter",
    }), /only one task source/);
  });
});
