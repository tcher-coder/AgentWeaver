import { writeFileSync } from "node:fs";

import { printSummary } from "../../tui.js";
import {
  requestUserInputInTerminal,
  validateUserInputValues,
  type UserInputFormDefinition,
} from "../../user-input.js";
import type { NodeCheckSpec, NodeOutputSpec, PipelineNodeDefinition } from "../types.js";

export type ManualJiraTaskInputNodeParams = {
  taskKey: string;
  outputFile: string;
  attachmentsManifestFile?: string;
  attachmentsContextFile?: string;
};

export type ManualJiraTaskInputNodeResult = {
  outputFile: string;
  attachmentsManifestFile?: string;
  attachmentsContextFile?: string;
  descriptionLength: number;
};

function summarizeDescription(description: string): string {
  return description
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.slice(0, 140) || "Manual Jira task description";
}

function buildManualJiraPayload(taskKey: string, description: string): Record<string, unknown> {
  const summary = summarizeDescription(description);
  return {
    id: `manual-${taskKey}`,
    key: taskKey,
    self: null,
    source: "manual-jira-fallback",
    fields: {
      summary,
      description,
      issuetype: {
        name: "Manual task",
      },
      labels: ["manual-jira-fallback"],
      attachment: [],
      comment: {
        comments: [],
      },
    },
    manual_input: {
      description,
      captured_at: new Date().toISOString(),
    },
  };
}

export const manualJiraTaskInputNode: PipelineNodeDefinition<
  ManualJiraTaskInputNodeParams,
  ManualJiraTaskInputNodeResult
> = {
  kind: "manual-jira-task-input",
  version: 1,
  async run(context, params) {
    const form: UserInputFormDefinition = {
      formId: "manual-jira-task-input",
      title: "Manual Jira Task",
      description: "Paste the Jira task description when Jira access is unavailable.",
      submitLabel: "Continue",
      fields: [
        {
          id: "task_description",
          type: "text",
          label: "Task description",
          help: "Paste the Jira task text here. This will be stored as the raw Jira task artifact for this flow.",
          required: true,
          multiline: true,
          rows: 10,
          placeholder: "Paste Jira task title, description, acceptance criteria, comments, and links here.",
        },
      ],
    };

    const requester = context.requestUserInput ?? requestUserInputInTerminal;
    const result = await requester(form);
    validateUserInputValues(form, result.values);
    const description = String(result.values.task_description ?? "").trim();

    writeFileSync(params.outputFile, `${JSON.stringify(buildManualJiraPayload(params.taskKey, description), null, 2)}\n`, "utf8");
    if (params.attachmentsManifestFile) {
      writeFileSync(
        params.attachmentsManifestFile,
        `${JSON.stringify({ source: "manual-jira-fallback", issueKey: params.taskKey, attachments: [] }, null, 2)}\n`,
        "utf8",
      );
    }
    if (params.attachmentsContextFile) {
      writeFileSync(params.attachmentsContextFile, "No Jira attachments were provided for the manual Jira fallback.\n", "utf8");
    }

    printSummary("Manual Jira Task", description);

    const outputs: NodeOutputSpec[] = [
      {
        kind: "file",
        path: params.outputFile,
        required: true,
        manifest: {
          publish: true,
          logicalKey: "artifacts/jira-task.json",
          payloadFamily: "helper-json",
          schemaId: "helper-json/v1",
          schemaVersion: 1,
        },
      },
    ];
    if (params.attachmentsManifestFile) {
      outputs.push({
        kind: "artifact",
        path: params.attachmentsManifestFile,
        required: true,
        manifest: {
          publish: true,
          logicalKey: "artifacts/jira-attachments.json",
          payloadFamily: "helper-json",
          schemaId: "helper-json/v1",
          schemaVersion: 1,
        },
      });
    }
    if (params.attachmentsContextFile) {
      outputs.push({
        kind: "artifact",
        path: params.attachmentsContextFile,
        required: true,
        manifest: {
          publish: true,
          logicalKey: "jira-attachments-context.txt",
          payloadFamily: "plain-text",
          schemaId: "plain-text/v1",
          schemaVersion: 1,
        },
      });
    }

    return {
      value: {
        outputFile: params.outputFile,
        ...(params.attachmentsManifestFile ? { attachmentsManifestFile: params.attachmentsManifestFile } : {}),
        ...(params.attachmentsContextFile ? { attachmentsContextFile: params.attachmentsContextFile } : {}),
        descriptionLength: description.length,
      },
      outputs,
    };
  },
  checks(_context, params) {
    const checks: NodeCheckSpec[] = [
      {
        kind: "require-file",
        path: params.outputFile,
        message: `Manual Jira task input did not produce ${params.outputFile}.`,
      },
    ];
    if (params.attachmentsManifestFile) {
      checks.push({
        kind: "require-file",
        path: params.attachmentsManifestFile,
        message: `Manual Jira task input did not produce ${params.attachmentsManifestFile}.`,
      });
    }
    if (params.attachmentsContextFile) {
      checks.push({
        kind: "require-file",
        path: params.attachmentsContextFile,
        message: `Manual Jira task input did not produce ${params.attachmentsContextFile}.`,
      });
    }
    return checks;
  },
};
