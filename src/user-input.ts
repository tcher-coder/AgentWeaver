import process from "node:process";
import { createInterface } from "node:readline/promises";

import { TaskRunnerError } from "./errors.js";

export type UserInputOption = {
  value: string;
  label: string;
  description?: string;
};

export type UserInputOptionsResolver = (values: UserInputFormValues) => UserInputOption[];

export const TEXT_FILE_FIELD_DEFAULT_MAX_BYTES = 512 * 1024;
export const TEXT_FILE_ALLOWED_EXTENSIONS = ["md", "markdown", "txt", "xml"] as const;
export const TEXT_FILE_ALLOWED_MEDIA_TYPES = ["text/plain", "text/markdown", "text/xml", "application/xml"] as const;

export type UploadedTextFileExtension = (typeof TEXT_FILE_ALLOWED_EXTENSIONS)[number];
export type UploadedTextFileValue = {
  kind: "text-file";
  name: string;
  mediaType: string;
  extension: UploadedTextFileExtension;
  sizeBytes: number;
  sha256: string;
  content?: string;
  storedPath?: string;
};

export type UserInputFieldDefinition =
  | {
      id: string;
      type: "boolean";
      label: string;
      help?: string;
      required?: boolean;
      default?: boolean;
    }
    | {
      id: string;
      type: "text";
      label: string;
      help?: string;
      required?: boolean;
      default?: string;
      multiline?: boolean;
      rows?: number;
      placeholder?: string;
    }
  | {
      id: string;
      type: "text-file";
      label: string;
      help?: string;
      required?: boolean;
      accept?: string[];
      maxBytes?: number;
      buttonLabel?: string;
    }
  | {
      id: string;
      type: "single-select";
      label: string;
      help?: string;
      required?: boolean;
      options: UserInputOption[];
      optionsFromValues?: UserInputOptionsResolver;
      default?: string;
    }
  | {
      id: string;
      type: "multi-select";
      label: string;
      help?: string;
      required?: boolean;
      options: UserInputOption[];
      optionsFromValues?: UserInputOptionsResolver;
      default?: string[];
    };

export type UserInputFormDefinition = {
  formId: string;
  title: string;
  description?: string;
  preview?: string;
  submitLabel?: string;
  fields: UserInputFieldDefinition[];
};

export type UserInputFieldValue = string | boolean | string[] | UploadedTextFileValue | null;
export type UserInputFormValues = Record<string, UserInputFieldValue>;

export type UserInputResult = {
  formId: string;
  submittedAt: string;
  values: UserInputFormValues;
};

export type UserInputRequester = (form: UserInputFormDefinition) => Promise<UserInputResult>;

function normalizeText(value: string): string {
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTextFileContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizeTextFileExtension(extension: string): UploadedTextFileExtension | null {
  const normalized = extension.trim().replace(/^\./, "").toLowerCase();
  return (TEXT_FILE_ALLOWED_EXTENSIONS as readonly string[]).includes(normalized)
    ? (normalized as UploadedTextFileExtension)
    : null;
}

export function inferredTextFileMediaType(extension: UploadedTextFileExtension): string {
  if (extension === "md" || extension === "markdown") {
    return "text/markdown";
  }
  if (extension === "xml") {
    return "text/xml";
  }
  return "text/plain";
}

export function textFileMaxBytes(field?: Extract<UserInputFieldDefinition, { type: "text-file" }>): number {
  return Number.isFinite(field?.maxBytes) && Number(field?.maxBytes) > 0
    ? Number(field?.maxBytes)
    : TEXT_FILE_FIELD_DEFAULT_MAX_BYTES;
}

export function isUploadedTextFileValue(value: unknown): value is UploadedTextFileValue {
  return isRecord(value) && value.kind === "text-file";
}

export function validateUploadedTextFileValue(
  value: unknown,
  label: string,
  field?: Extract<UserInputFieldDefinition, { type: "text-file" }>,
): asserts value is UploadedTextFileValue {
  if (!isUploadedTextFileValue(value)) {
    throw new TaskRunnerError(`Field '${label}' must be a text-file upload value.`);
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new TaskRunnerError(`Field '${label}' upload name must be a non-empty string.`);
  }
  if (typeof value.mediaType !== "string" || !TEXT_FILE_ALLOWED_MEDIA_TYPES.includes(value.mediaType as typeof TEXT_FILE_ALLOWED_MEDIA_TYPES[number])) {
    throw new TaskRunnerError(`Field '${label}' upload media type is not supported.`);
  }
  if (typeof value.extension !== "string" || !normalizeTextFileExtension(value.extension)) {
    throw new TaskRunnerError(`Field '${label}' upload extension is not supported.`);
  }
  if (typeof value.sizeBytes !== "number" || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 0) {
    throw new TaskRunnerError(`Field '${label}' upload size must be a non-negative integer.`);
  }
  if (value.sizeBytes > textFileMaxBytes(field)) {
    throw new TaskRunnerError(`Field '${label}' upload exceeds the maximum size of ${textFileMaxBytes(field)} bytes.`);
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new TaskRunnerError(`Field '${label}' upload sha256 must be a lowercase hex digest.`);
  }
  if (value.content !== undefined) {
    if (typeof value.content !== "string") {
      throw new TaskRunnerError(`Field '${label}' upload content must be a string.`);
    }
    const normalized = normalizeTextFileContent(value.content);
    if (Buffer.byteLength(normalized, "utf8") > textFileMaxBytes(field)) {
      throw new TaskRunnerError(`Field '${label}' upload exceeds the maximum size of ${textFileMaxBytes(field)} bytes.`);
    }
    if (normalized.trim().length === 0) {
      throw new TaskRunnerError(`Field '${label}' upload content must not be empty.`);
    }
    if (normalized.includes("\0")) {
      throw new TaskRunnerError(`Field '${label}' upload content appears to be binary.`);
    }
  }
  if (value.storedPath !== undefined && (typeof value.storedPath !== "string" || value.storedPath.trim().length === 0)) {
    throw new TaskRunnerError(`Field '${label}' upload storedPath must be a non-empty string when provided.`);
  }
}

export function defaultValueForField(field: UserInputFieldDefinition): UserInputFieldValue {
  if (field.type === "boolean") {
    return field.default ?? false;
  }
  if (field.type === "text") {
    return field.default ?? "";
  }
  if (field.type === "text-file") {
    return null;
  }
  if (field.type === "single-select") {
    return field.default ?? field.options[0]?.value ?? "";
  }
  return [...(field.default ?? [])];
}

export function buildInitialUserInputValues(fields: UserInputFieldDefinition[]): UserInputFormValues {
  return Object.fromEntries(fields.map((field) => [field.id, defaultValueForField(field)]));
}

export function applyInitialUserInputValues(
  fields: UserInputFieldDefinition[],
  initialValues: UserInputFormValues | undefined,
): UserInputFieldDefinition[] {
  if (!initialValues) {
    return fields;
  }

  return fields.map((field) => {
    const initialValue = initialValues[field.id];
    if (initialValue === undefined) {
      return field;
    }
    if (field.type === "boolean" && typeof initialValue === "boolean") {
      return { ...field, default: initialValue };
    }
    if (field.type === "text" && typeof initialValue === "string") {
      return { ...field, default: initialValue };
    }
    if (field.type === "text-file") {
      return field;
    }
    if (field.type === "single-select" && typeof initialValue === "string") {
      return { ...field, default: initialValue };
    }
    if (
      field.type === "multi-select"
      && Array.isArray(initialValue)
      && initialValue.every((item) => typeof item === "string")
    ) {
      return { ...field, default: [...initialValue] };
    }
    return field;
  });
}

function defaultSelectValue(
  field: Extract<UserInputFieldDefinition, { type: "single-select" | "multi-select" }>,
): string | string[] {
  if (field.type === "single-select") {
    return field.default ?? field.options[0]?.value ?? "";
  }
  return [...(field.default ?? [])];
}

export function resolveFieldOptions(
  field: Extract<UserInputFieldDefinition, { type: "single-select" | "multi-select" }>,
  values: UserInputFormValues,
): UserInputOption[] {
  return field.optionsFromValues?.(values) ?? field.options;
}

export function resolveFieldDefinition(
  field: UserInputFieldDefinition,
  values: UserInputFormValues,
): UserInputFieldDefinition {
  if (field.type !== "single-select" && field.type !== "multi-select") {
    return field;
  }
  return {
    ...field,
    options: resolveFieldOptions(field, values),
  };
}

export function normalizeUserInputFieldValue(
  field: UserInputFieldDefinition,
  values: UserInputFormValues,
): void {
  if (field.type === "text-file") {
    if (values[field.id] === undefined) {
      values[field.id] = null;
    }
    return;
  }
  if (field.type !== "single-select" && field.type !== "multi-select") {
    return;
  }

  const allowedValues = new Set(resolveFieldOptions(field, values).map((option) => option.value));
  if (field.type === "single-select") {
    const currentValue = typeof values[field.id] === "string" ? String(values[field.id]) : "";
    if (!allowedValues.has(currentValue)) {
      const fallback = defaultSelectValue(resolveFieldDefinition(field, values) as typeof field);
      values[field.id] = typeof fallback === "string" ? fallback : "";
    }
    return;
  }

  const currentValue = values[field.id];
  const currentValues: string[] = Array.isArray(currentValue)
    ? currentValue.filter((item): item is string => typeof item === "string")
    : [];
  values[field.id] = currentValues.filter((item): item is string => typeof item === "string" && allowedValues.has(item));
}

export function validateUserInputValues(form: UserInputFormDefinition, values: UserInputFormValues): void {
  for (const field of form.fields) {
    const value = values[field.id];
    if (field.type === "boolean") {
      if (typeof value !== "boolean") {
        throw new TaskRunnerError(`Field '${field.label}' must be a boolean.`);
      }
      continue;
    }

    if (field.type === "text") {
      if (typeof value !== "string") {
        throw new TaskRunnerError(`Field '${field.label}' must be a string.`);
      }
      if (field.required && normalizeText(value).length === 0) {
        throw new TaskRunnerError(`Field '${field.label}' is required.`);
      }
      continue;
    }

    if (field.type === "text-file") {
      if (value === null || value === undefined) {
        if (field.required) {
          throw new TaskRunnerError(`Field '${field.label}' is required.`);
        }
        continue;
      }
      validateUploadedTextFileValue(value, field.label, field);
      continue;
    }

    if (field.type === "single-select") {
      const options = resolveFieldOptions(field, values);
      if (typeof value !== "string") {
        throw new TaskRunnerError(`Field '${field.label}' must be a string.`);
      }
      if (field.required && normalizeText(value).length === 0) {
        throw new TaskRunnerError(`Field '${field.label}' is required.`);
      }
      if (value && !options.some((option) => option.value === value)) {
        throw new TaskRunnerError(`Field '${field.label}' contains an unknown option '${value}'.`);
      }
      continue;
    }

    const options = resolveFieldOptions(field, values);
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new TaskRunnerError(`Field '${field.label}' must be a string array.`);
    }
    if (field.required && value.length === 0) {
      throw new TaskRunnerError(`Field '${field.label}' requires at least one selected option.`);
    }
    const allowed = new Set(options.map((option) => option.value));
    for (const item of value) {
      if (!allowed.has(item)) {
        throw new TaskRunnerError(`Field '${field.label}' contains an unknown option '${item}'.`);
      }
    }
  }

  if (form.formId === "review-fix-selection") {
    const applyAll = values.apply_all === true;
    const selectedFindings = Array.isArray(values.selected_findings)
      ? values.selected_findings.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (!applyAll && selectedFindings.length === 0) {
      throw new TaskRunnerError("Select at least one finding or enable 'apply all'.");
    }
  }

  if (form.formId === "task-describe-source-input") {
    const jiraRef = typeof values.jira_ref === "string" ? normalizeText(values.jira_ref) : "";
    const taskFile = isUploadedTextFileValue(values.task_file) ? values.task_file : null;
    const taskDescription = typeof values.task_description === "string" ? normalizeText(values.task_description) : "";
    const selectedSourceCount = [Boolean(jiraRef), Boolean(taskFile), Boolean(taskDescription)].filter(Boolean).length;
    if (selectedSourceCount === 0) {
      throw new TaskRunnerError("Provide a Jira URL/key, upload a task file, or enter a short task description.");
    }
    if (selectedSourceCount > 1) {
      throw new TaskRunnerError("Provide only one task source: Jira URL/key, uploaded file, or task description.");
    }
  }

  if (form.formId === "jira-task-input" && form.fields.some((field) => field.id === "task_description")) {
    const jiraRef = typeof values.jira_ref === "string" ? normalizeText(values.jira_ref) : "";
    const taskFile = isUploadedTextFileValue(values.task_file) ? values.task_file : null;
    const taskDescription = typeof values.task_description === "string" ? normalizeText(values.task_description) : "";
    const selectedSourceCount = [Boolean(jiraRef), Boolean(taskFile), Boolean(taskDescription)].filter(Boolean).length;
    if (selectedSourceCount === 0) {
      throw new TaskRunnerError("Provide a Jira URL/key, upload a task file, or enter a task description.");
    }
    if (selectedSourceCount > 1) {
      throw new TaskRunnerError("Provide only one task source: Jira URL/key, uploaded file, or task description.");
    }
  }

  if (form.formId === "manual-jira-task-input") {
    const taskFile = isUploadedTextFileValue(values.task_file) ? values.task_file : null;
    const taskDescription = typeof values.task_description === "string" ? normalizeText(values.task_description) : "";
    const selectedSourceCount = [Boolean(taskFile), Boolean(taskDescription)].filter(Boolean).length;
    if (selectedSourceCount === 0) {
      throw new TaskRunnerError("Upload a task file or enter a task description.");
    }
    if (selectedSourceCount > 1) {
      throw new TaskRunnerError("Provide only one task source: uploaded file or task description.");
    }
  }
}

function parseBoolean(value: string): boolean | null {
  const normalized = normalizeText(value).toLowerCase();
  if (["y", "yes", "true", "1", "да", "д"].includes(normalized)) {
    return true;
  }
  if (["n", "no", "false", "0", "нет", "н"].includes(normalized)) {
    return false;
  }
  return null;
}

export async function requestUserInputInTerminal(form: UserInputFormDefinition): Promise<UserInputResult> {
  if (form.fields.length === 0) {
    return {
      formId: form.formId,
      submittedAt: new Date().toISOString(),
      values: {},
    };
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new TaskRunnerError(
      `Flow requires interactive user input for form '${form.formId}', but no TTY is available.`,
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    process.stdout.write(`\n${form.title}\n`);
    if (form.description?.trim()) {
      process.stdout.write(`${form.description.trim()}\n`);
    }
    const values = buildInitialUserInputValues(form.fields);

    for (const rawField of form.fields) {
      normalizeUserInputFieldValue(rawField, values);
      const field = resolveFieldDefinition(rawField, values);
      if (field.type === "boolean") {
        while (true) {
          const current = values[field.id];
          const answer = await rl.question(`${field.label} [y/n] (${current ? "y" : "n"}): `);
          const parsed = answer.trim() ? parseBoolean(answer) : Boolean(current);
          if (parsed === null) {
            process.stdout.write("Please answer y/n.\n");
            continue;
          }
          values[field.id] = parsed;
          break;
        }
        continue;
      }

      if (field.type === "text") {
        const current = String(values[field.id] ?? "");
        if (field.multiline) {
          process.stdout.write(`${field.label}${current ? " (leave empty to keep current value)" : ""}:\n`);
          if (field.help?.trim()) {
            process.stdout.write(`${field.help.trim()}\n`);
          }
          process.stdout.write("Finish input with an empty line.\n");
          const lines: string[] = [];
          while (true) {
            const line = await rl.question(lines.length === 0 ? "> " : "... ");
            if (!line.trim()) {
              break;
            }
            lines.push(line);
          }
          values[field.id] = lines.length > 0 ? lines.join("\n") : current;
        } else {
          const answer = await rl.question(`${field.label}${current ? ` (${current})` : ""}: `);
          values[field.id] = answer.trim() ? answer : current;
        }
        continue;
      }

      if (field.type === "text-file") {
        values[field.id] = null;
        process.stdout.write(`${field.label}: file upload is available in the web UI only.\n`);
        continue;
      }

      const options = field.options
        .map((option, index) => {
          const description = option.description
            ? `\n   ${option.description.split("\n").join("\n   ")}`
            : "";
          return `${index + 1}. ${option.label}${description}`;
        })
        .join("\n");
      process.stdout.write(`${field.label}\n${options}\n`);
      if (field.type === "single-select") {
        while (true) {
          const current = String(values[field.id] ?? "");
          const answer = await rl.question(`Choose one option${current ? ` (${current})` : ""}: `);
          const raw = answer.trim();
          if (!raw && current) {
            break;
          }
          const index = Number.parseInt(raw, 10) - 1;
          const option = field.options[index];
          if (!option) {
            process.stdout.write("Unknown option number.\n");
            continue;
          }
          values[field.id] = option.value;
          break;
        }
        continue;
      }

      while (true) {
        const current = Array.isArray(values[field.id]) ? (values[field.id] as string[]) : [];
        const answer = await rl.question(
          `Choose one or more options separated by comma${current.length > 0 ? ` (${current.join(", ")})` : ""}: `,
        );
        const raw = answer.trim();
        if (!raw && current.length > 0) {
          break;
        }
        const selected = raw
          .split(",")
          .map((item) => Number.parseInt(item.trim(), 10) - 1)
          .map((index) => field.options[index]?.value)
          .filter((item): item is string => Boolean(item));
        if (selected.length === 0 && field.required) {
          process.stdout.write("Select at least one option.\n");
          continue;
        }
        values[field.id] = selected;
        break;
      }
    }

    validateUserInputValues(form, values);
    return {
      formId: form.formId,
      submittedAt: new Date().toISOString(),
      values,
    };
  } finally {
    rl.close();
  }
}
