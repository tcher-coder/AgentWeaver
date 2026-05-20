import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TaskRunnerError } from "../../errors.js";
import { buildLogicalKeyForPayload } from "../../artifact-manifest.js";
import { TASK_SOURCE_FILE_EXTENSIONS, taskSourceFile, taskSourceFileByExtension } from "../../artifacts.js";
import { printSummary } from "../../tui.js";
import {
  applyInitialUserInputValues,
  isUploadedTextFileValue,
  normalizeTextFileContent,
  requestUserInputInTerminal,
  textFileMaxBytes,
  validateUserInputValues,
  validateUploadedTextFileValue,
  type UploadedTextFileValue,
  type UserInputFieldDefinition,
  type UserInputFormDefinition,
  type UserInputFormValues,
} from "../../user-input.js";
import type { NodeOutputSpec, PipelineNodeDefinition } from "../types.js";

export type UserInputNodeParams = {
  formId: string;
  title: string;
  description?: string;
  submitLabel?: string;
  fields: UserInputFieldDefinition[];
  initialValues?: UserInputFormValues;
  outputFile: string;
};

export type UserInputNodeResult = {
  formId: string;
  submittedAt: string;
  values: UserInputFormValues;
  outputFile: string;
  promptSuffix: string;
  summaryText: string;
};

type PersistedTaskSource = {
  rawPath: string;
  value: UploadedTextFileValue;
};

function labelForSingleValue(field: UserInputFieldDefinition, value: string): string {
  if (field.type !== "single-select" && field.type !== "multi-select") {
    return value;
  }
  return field.options.find((option) => option.value === value)?.label ?? value;
}

function buildReviewFixPromptSuffix(
  params: UserInputNodeParams,
  values: UserInputFormValues,
): { promptSuffix: string; summaryText: string } {
  const applyAll = values.apply_all === true;
  const selectedFindings = Array.isArray(values.selected_findings)
    ? values.selected_findings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const extraNotes = typeof values.extra_notes === "string" ? values.extra_notes.trim() : "";

  if (!applyAll && selectedFindings.length === 0) {
    throw new TaskRunnerError("Review-fix requires selecting at least one finding or enabling 'apply all'.");
  }

  const selectionSummary = applyAll
    ? "All findings selected."
    : `Selected findings:\n- ${selectedFindings.join("\n- ")}`;
  const promptSuffix = [
    "Use the user selection below as source of truth for the current review-fix scope.",
    `Selection file: ${params.outputFile}`,
    `apply_all: ${applyAll ? "true" : "false"}`,
    applyAll ? "Fix all findings in the current iteration." : `Fix only selected findings:\n- ${selectedFindings.join("\n- ")}`,
    extraNotes ? `User additional instructions:\n${extraNotes}` : "",
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n\n");
  const summaryText = extraNotes ? `${selectionSummary}\n\nNote:\n${extraNotes}` : selectionSummary;
  return { promptSuffix, summaryText };
}

function buildTaskDescribePromptSuffix(
  params: UserInputNodeParams,
  values: UserInputFormValues,
): { promptSuffix: string; summaryText: string } {
  const jiraRef = typeof values.jira_ref === "string" ? values.jira_ref.trim() : "";
  const taskFile = isUploadedTextFileValue(values.task_file) ? values.task_file : null;
  const taskDescription = typeof values.task_description === "string" ? values.task_description.trim() : "";
  const additionalInstructions =
    typeof values.additional_instructions === "string" ? values.additional_instructions.trim() : "";

  if (jiraRef) {
    return {
      promptSuffix: additionalInstructions
        ? [
            "Use the user-provided additional instructions together with the Jira task.",
            `User input file: ${params.outputFile}`,
            `Additional instructions:\n${additionalInstructions}`,
          ].join("\n\n")
        : "",
      summaryText: additionalInstructions
        ? `Task source: Jira\nJira: ${jiraRef}\n\nAdditional instructions:\n${additionalInstructions}`
        : `Task source: Jira\nJira: ${jiraRef}`,
    };
  }

  if (taskFile) {
    const sourceLine = `Uploaded task source: ${taskFile.name} (${taskFile.extension})`;
    const storedPathLine = taskFile.storedPath ? `Raw task source file: ${taskFile.storedPath}` : "";
    return {
      promptSuffix: [
        "Use the uploaded task source artifact as source of truth.",
        `User input file: ${params.outputFile}`,
        storedPathLine,
        sourceLine,
        additionalInstructions ? `Additional instructions:\n${additionalInstructions}` : "",
      ]
        .filter((item) => item.trim().length > 0)
        .join("\n\n"),
      summaryText: additionalInstructions
        ? `Task source: uploaded-file\n${sourceLine}\n${storedPathLine}\n\nAdditional instructions:\n${additionalInstructions}`
        : `Task source: uploaded-file\n${sourceLine}\n${storedPathLine}`,
    };
  }

  return {
    promptSuffix: [
      "Use the user task description as source of truth.",
      `User input file: ${params.outputFile}`,
      `Task description:\n${taskDescription}`,
      additionalInstructions ? `Additional instructions:\n${additionalInstructions}` : "",
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n\n"),
    summaryText: additionalInstructions
      ? `Task source: user-input\n\n${taskDescription}\n\nAdditional instructions:\n${additionalInstructions}`
      : `Task source: user-input\n\n${taskDescription}`,
  };
}

function buildInstantTaskPromptSuffix(
  params: UserInputNodeParams,
  values: UserInputFormValues,
): { promptSuffix: string; summaryText: string } {
  const taskDescription = typeof values.task_description === "string" ? values.task_description.trim() : "";
  const additionalInstructions =
    typeof values.additional_instructions === "string" ? values.additional_instructions.trim() : "";

  return {
    promptSuffix: [
      "Use the manual instant-task request below as the source of truth for task intent.",
      `User input file: ${params.outputFile}`,
      `Task description:\n${taskDescription}`,
      additionalInstructions ? `Additional instructions:\n${additionalInstructions}` : "",
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n\n"),
    summaryText: additionalInstructions
      ? `Task source: instant-task\n\n${taskDescription}\n\nAdditional instructions:\n${additionalInstructions}`
      : `Task source: instant-task\n\n${taskDescription}`,
  };
}

function buildPromptSuffix(params: UserInputNodeParams, values: UserInputFormValues): { promptSuffix: string; summaryText: string } {
  if (params.formId === "review-fix-selection") {
    return buildReviewFixPromptSuffix(params, values);
  }

  if (params.formId === "task-describe-source-input") {
    return buildTaskDescribePromptSuffix(params, values);
  }

  if (params.formId === "instant-task-input") {
    return buildInstantTaskPromptSuffix(params, values);
  }

  if (params.fields.length === 0) {
    return {
      promptSuffix: "",
      summaryText: "",
    };
  }

  const lines = params.fields.map((field) => {
    const raw = values[field.id];
    if (typeof raw === "boolean") {
      return `${field.label}: ${raw ? "yes" : "no"}`;
    }
    if (typeof raw === "string") {
      return `${field.label}: ${raw || "-"}`;
    }
    if (Array.isArray(raw)) {
      const labels = raw.map((item) => labelForSingleValue(field, item));
      return `${field.label}: ${labels.length > 0 ? labels.join(", ") : "-"}`;
    }
    return `${field.label}: -`;
  });
  const summaryText = lines.join("\n");
  return {
    promptSuffix: `Use user input from file ${params.outputFile}.\n\n${summaryText}`,
    summaryText,
  };
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function cloneFormValues(values: UserInputFormValues): UserInputFormValues {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isUploadedTextFileValue(value) ? { ...value } : Array.isArray(value) ? [...value] : value,
    ]),
  );
}

function findTextFileField(
  params: UserInputNodeParams,
  fieldId: string,
): Extract<UserInputFieldDefinition, { type: "text-file" }> | undefined {
  return params.fields.find((field): field is Extract<UserInputFieldDefinition, { type: "text-file" }> => (
    field.id === fieldId && field.type === "text-file"
  ));
}

function persistTaskDescribeSourceFile(
  contextIssueKey: string,
  params: UserInputNodeParams,
  values: UserInputFormValues,
): PersistedTaskSource | null {
  if (params.formId !== "task-describe-source-input" || !isUploadedTextFileValue(values.task_file)) {
    return null;
  }

  const field = findTextFileField(params, "task_file");
  validateUploadedTextFileValue(values.task_file, field?.label ?? "Task file", field);
  if (typeof values.task_file.content !== "string") {
    throw new TaskRunnerError("Uploaded task file content is required before persistence.");
  }

  const normalizedContent = normalizeTextFileContent(values.task_file.content);
  const maxBytes = textFileMaxBytes(field);
  if (Buffer.byteLength(normalizedContent, "utf8") > maxBytes) {
    throw new TaskRunnerError(`Uploaded task file exceeds the maximum size of ${maxBytes} bytes.`);
  }
  if (normalizedContent.trim().length === 0) {
    throw new TaskRunnerError("Uploaded task file content must not be empty.");
  }
  if (normalizedContent.includes("\0")) {
    throw new TaskRunnerError("Uploaded task file content appears to be binary.");
  }

  const rawPath = taskSourceFileByExtension(contextIssueKey, values.task_file.extension);
  const persistedValue: UploadedTextFileValue = {
    kind: "text-file",
    name: values.task_file.name,
    mediaType: values.task_file.mediaType,
    extension: values.task_file.extension,
    sizeBytes: Buffer.byteLength(normalizedContent, "utf8"),
    sha256: sha256Hex(normalizedContent),
    storedPath: rawPath,
  };
  mkdirSync(path.dirname(rawPath), { recursive: true });
  for (const extension of TASK_SOURCE_FILE_EXTENSIONS) {
    const stalePath = taskSourceFile(contextIssueKey, extension);
    if (stalePath !== rawPath && existsSync(stalePath)) {
      rmSync(stalePath, { force: true });
    }
  }
  writeFileSync(rawPath, normalizedContent, "utf8");
  values.task_file = persistedValue;
  return {
    rawPath,
    value: persistedValue,
  };
}

function payloadContractForTaskSource(value: UploadedTextFileValue): {
  payloadFamily: "markdown" | "plain-text";
  schemaId: "markdown/v1" | "plain-text/v1";
} {
  if (value.extension === "md" || value.extension === "markdown") {
    return { payloadFamily: "markdown", schemaId: "markdown/v1" };
  }
  return { payloadFamily: "plain-text", schemaId: "plain-text/v1" };
}

export const userInputNode: PipelineNodeDefinition<UserInputNodeParams, UserInputNodeResult> = {
  kind: "user-input",
  version: 1,
  async run(context, params) {
    const fields = applyInitialUserInputValues(params.fields, params.initialValues);
    const form: UserInputFormDefinition = {
      formId: params.formId,
      title: params.title,
      ...(params.description ? { description: params.description } : {}),
      ...(params.submitLabel ? { submitLabel: params.submitLabel } : {}),
      fields,
    };

    const requester = context.requestUserInput ?? requestUserInputInTerminal;
    const result = await requester(form);
    validateUserInputValues(form, result.values);
    const values = cloneFormValues(result.values);
    const persistedTaskSource = persistTaskDescribeSourceFile(context.issueKey, params, values);
    validateUserInputValues(form, values);
    const rendered = buildPromptSuffix(params, values);
    const artifact = {
      form_id: result.formId,
      submitted_at: result.submittedAt,
      values,
    };
    writeFileSync(params.outputFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    if (rendered.summaryText.trim().length > 0) {
      printSummary(params.title, rendered.summaryText);
    }
    const outputs: NodeOutputSpec[] = [
      {
        kind: "artifact",
        path: params.outputFile,
        required: true,
        manifest: {
          publish: true,
          logicalKey: buildLogicalKeyForPayload(context.issueKey, params.outputFile),
          payloadFamily: "structured-json",
          schemaId: "user-input/v1",
          schemaVersion: 1,
        },
      },
    ];
    if (persistedTaskSource) {
      const contract = payloadContractForTaskSource(persistedTaskSource.value);
      outputs.push({
        kind: "artifact",
        path: persistedTaskSource.rawPath,
        required: true,
        manifest: {
          publish: true,
          logicalKey: buildLogicalKeyForPayload(context.issueKey, persistedTaskSource.rawPath),
          payloadFamily: contract.payloadFamily,
          schemaId: contract.schemaId,
          schemaVersion: 1,
        },
      });
    }
    return {
      value: {
        formId: result.formId,
        submittedAt: result.submittedAt,
        values,
        outputFile: params.outputFile,
        promptSuffix: rendered.promptSuffix,
        summaryText: rendered.summaryText,
      },
      outputs,
    };
  },
};
