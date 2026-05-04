import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import type { Stats } from "node:fs";
import http, { type IncomingMessage } from "node:http";
import path from "node:path";
import process from "node:process";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

import { parseArtifactReference, type ArtifactManifest } from "../../artifact-manifest.js";
import { scopeArtifactsDir, scopeWorkspaceDir } from "../../artifacts.js";
import {
  groupArtifactCatalog,
  inferArtifactRenderKind,
  inferArtifactRole,
  inferArtifactTitle,
  type ArtifactCatalog,
  type ArtifactCatalogItem,
  type ArtifactRenderKind,
} from "../../runtime/artifact-catalog.js";
import { createArtifactRegistry } from "../../runtime/artifact-registry.js";
import type { ClientAction, ServerEvent } from "./protocol.js";
import { parseClientAction } from "./protocol.js";

export type WebSocketClient = {
  socket: Duplex;
  send: (message: ServerEvent) => void;
  close: () => void;
};

export type WebServerOptions = {
  noOpen?: boolean;
  host?: string;
  auth?: WebServerAuthConfig;
  onClientAction: (action: ClientAction, client: WebSocketClient) => void;
  onClientConnected: (client: WebSocketClient) => void;
  onExitRequested: () => void;
  getArtifactCatalog?: (input?: ArtifactCatalogRequest) => ArtifactCatalog | Promise<ArtifactCatalog>;
  printInfo?: (message: string) => void;
  openBrowser?: (url: string) => Promise<void>;
};

export type ArtifactCatalogRequest = {
  scopeKey?: string;
  runId?: string;
  runIds?: string[];
};

export type WebServerAuthConfig = {
  username: string;
  password: string;
};

export type StartedWebServer = {
  url: string;
  host: string;
  broadcast(message: ServerEvent): void;
  close(): Promise<void>;
};

const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "static");
const MAX_PREVIEW_SIZE = 512 * 1024;
const MAX_JSON_PARSE_SIZE = 2 * 1024 * 1024;

const CONTENT_TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

const BASIC_AUTH_REALM = "AgentWeaver Web UI";
const ARTIFACT_API_PREFIX = "/__agentweaver/api/artifacts";

type ArtifactApiErrorCode =
  | "invalid_id"
  | "missing_scope"
  | "scope_mismatch"
  | "forbidden_path"
  | "not_found"
  | "unsupported_preview"
  | "read_failed";

const ARTIFACT_ERROR_STATUSES: Record<ArtifactApiErrorCode, number> = {
  invalid_id: 400,
  missing_scope: 400,
  scope_mismatch: 403,
  forbidden_path: 403,
  not_found: 404,
  unsupported_preview: 415,
  read_failed: 500,
};

type ArtifactAction = "preview" | "raw" | "download";

type ArtifactApiRoute =
  | { kind: "list"; scopeKey: string | null; runIds: string[] }
  | { kind: "content"; artifactId: string; action: ArtifactAction; scopeKey: string | null; runIds: string[] };

type SafeArtifactMetadata = Pick<
  ArtifactCatalogItem,
  | "id"
  | "scopeKey"
  | "runId"
  | "logicalKey"
  | "title"
  | "relativePath"
  | "kind"
  | "role"
  | "phaseId"
  | "stepId"
  | "schemaId"
  | "sizeBytes"
  | "updatedAt"
  | "isLatest"
  | "source"
>;

type ResolvedArtifact = {
  item: ArtifactCatalogItem;
  filePath: string;
  realPath: string;
  stats: Stats;
};

function hashCredential(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function timingSafeStringEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(hashCredential(actual), hashCredential(expected));
}

function parseBasicAuthorization(header: string | undefined): { username: string; password: string } | null {
  if (!header) {
    return null;
  }
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match?.[1]) {
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }
  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  };
}

function isAuthorized(request: IncomingMessage, auth: WebServerAuthConfig | undefined): boolean {
  if (!auth) {
    return true;
  }
  const credentials = parseBasicAuthorization(request.headers.authorization);
  if (!credentials) {
    return false;
  }
  return timingSafeStringEqual(credentials.username, auth.username) && timingSafeStringEqual(credentials.password, auth.password);
}

function writeAuthRequired(response: http.ServerResponse): void {
  response.writeHead(401, {
    "content-type": "text/plain; charset=utf-8",
    "www-authenticate": `Basic realm="${BASIC_AUTH_REALM}"`,
    "cache-control": "no-store",
  });
  response.end("Authentication required");
}

function rejectUnauthorizedUpgrade(socket: Duplex): void {
  socket.write([
    "HTTP/1.1 401 Unauthorized",
    `WWW-Authenticate: Basic realm="${BASIC_AUTH_REALM}"`,
    "Content-Type: text/plain; charset=utf-8",
    "Connection: close",
    "",
    "Authentication required",
  ].join("\r\n"));
  socket.destroy();
}

function staticAssetPath(requestUrl: string | undefined): string | null {
  const parsed = new URL(requestUrl ?? "/", "http://agentweaver.local");
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  if (pathname !== "/index.html" && !pathname.startsWith("/static/")) {
    return null;
  }
  const relativePath = pathname === "/index.html" ? "index.html" : pathname.slice("/static/".length);
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }
  const assetPath = path.join(STATIC_DIR, normalized);
  if (!assetPath.startsWith(STATIC_DIR) || !existsSync(assetPath) || !statSync(assetPath).isFile()) {
    return null;
  }
  return assetPath;
}

function serveStaticAsset(request: IncomingMessage, response: http.ServerResponse): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const assetPath = staticAssetPath(request.url);
  if (!assetPath) {
    return false;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES.get(path.extname(assetPath)) ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  response.end(readFileSync(assetPath));
  return true;
}

function writeJson(response: http.ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function writeArtifactApiError(
  response: http.ServerResponse,
  code: ArtifactApiErrorCode,
  message: string,
  artifact?: SafeArtifactMetadata,
): void {
  writeJson(response, ARTIFACT_ERROR_STATUSES[code], {
    code,
    message,
    ...(artifact ? { artifact } : {}),
  });
}

function safeArtifactMetadata(item: ArtifactCatalogItem): SafeArtifactMetadata {
  return {
    id: item.id,
    scopeKey: item.scopeKey,
    runId: item.runId,
    logicalKey: item.logicalKey,
    title: item.title,
    relativePath: item.relativePath,
    kind: item.kind,
    role: item.role,
    phaseId: item.phaseId,
    stepId: item.stepId,
    schemaId: item.schemaId,
    sizeBytes: item.sizeBytes,
    updatedAt: item.updatedAt,
    isLatest: item.isLatest,
    source: item.source,
  };
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function isInsideDirectory(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseArtifactApiRoute(requestUrl: string | undefined): ArtifactApiRoute | null {
  const parsed = new URL(requestUrl ?? "/", "http://agentweaver.local");
  const scopeKey = parsed.searchParams.get("scope");
  const runIds = parsed.searchParams.getAll("runId").filter((value, index, values) => (
    value.length > 0 && values.indexOf(value) === index
  ));
  if (parsed.pathname === ARTIFACT_API_PREFIX) {
    return { kind: "list", scopeKey, runIds };
  }
  if (!parsed.pathname.startsWith(`${ARTIFACT_API_PREFIX}/`)) {
    return null;
  }

  const suffix = parsed.pathname.slice(`${ARTIFACT_API_PREFIX}/`.length);
  for (const action of ["preview", "raw", "download"] as const) {
    const actionSuffix = `/${action}`;
    if (!suffix.endsWith(actionSuffix)) {
      continue;
    }
    const encodedId = suffix.slice(0, -actionSuffix.length);
    const artifactId = safeDecodeURIComponent(encodedId);
    if (!artifactId || artifactId.includes("\0")) {
      return { kind: "content", artifactId: "", action, scopeKey, runIds };
    }
    return { kind: "content", artifactId, action, scopeKey, runIds };
  }
  return { kind: "content", artifactId: "", action: "preview", scopeKey, runIds };
}

function filterCatalog(catalog: ArtifactCatalog, scopeKey: string, runIds: string[]): ArtifactCatalog {
  const runIdSet = new Set(runIds);
  const markdownItems = catalog.items.filter((item) => item.scopeKey === scopeKey && item.kind === "markdown");
  let items = markdownItems;
  if (runIdSet.size > 0) {
    const runItems = markdownItems.filter((item) => item.runId !== null && runIdSet.has(item.runId));
    items = runItems.length > 0 ? runItems : markdownItems;
  }
  const sortedItems = items.slice();
  return {
    scopeKey,
    items: sortedItems,
    groups: groupArtifactCatalog(sortedItems),
  };
}

async function loadArtifactCatalog(
  options: WebServerOptions,
  input?: ArtifactCatalogRequest,
): Promise<ArtifactCatalog | null> {
  if (!options.getArtifactCatalog) {
    return null;
  }
  return options.getArtifactCatalog(input);
}

function scopeRelativePath(scopeKey: string, payloadPath: string): string {
  const workspaceDir = path.resolve(scopeWorkspaceDir(scopeKey));
  const normalizedPayloadPath = path.resolve(payloadPath);
  if (isInsideDirectory(workspaceDir, normalizedPayloadPath)) {
    return normalizePathSeparators(path.relative(workspaceDir, normalizedPayloadPath));
  }
  return normalizePathSeparators(path.basename(normalizedPayloadPath));
}

function itemFromManifest(scopeKey: string, manifest: ArtifactManifest): ArtifactCatalogItem {
  const relativePath = scopeRelativePath(scopeKey, manifest.payload_path);
  const kind = inferArtifactRenderKind({
    payloadFamily: manifest.payload_family,
    schemaId: manifest.schema_id,
    filePath: manifest.payload_path,
  });
  return {
    id: manifest.artifact_id,
    scopeKey,
    runId: manifest.run_id,
    logicalKey: manifest.logical_key,
    title: inferArtifactTitle(scopeKey, manifest.logical_key, relativePath),
    relativePath,
    kind,
    role: inferArtifactRole(manifest.logical_key, relativePath),
    phaseId: manifest.phase_id || null,
    stepId: manifest.step_id || null,
    schemaId: manifest.schema_id || null,
    sizeBytes: 0,
    updatedAt: manifest.created_at,
    isLatest: manifest.status === "ready",
    source: "manifest",
  };
}

function realExistingRoots(scopeKey: string): string[] {
  const roots = [scopeWorkspaceDir(scopeKey), scopeArtifactsDir(scopeKey)];
  const realRoots: string[] = [];
  for (const root of roots) {
    try {
      realRoots.push(realpathSync(root));
    } catch {
      // A missing .artifacts directory should not block regular scope files.
    }
  }
  return [...new Set(realRoots)];
}

function assertContainedRegularFile(scopeKey: string, filePath: string): { filePath: string; realPath: string; stats: Stats } {
  let realPath: string;
  try {
    realPath = realpathSync(filePath);
  } catch {
    throw new ArtifactApiResolutionError("not_found");
  }

  const allowedRoots = realExistingRoots(scopeKey);
  if (allowedRoots.length === 0 || !allowedRoots.some((root) => isInsideDirectory(root, realPath))) {
    throw new ArtifactApiResolutionError("forbidden_path");
  }

  let stats: Stats;
  try {
    stats = statSync(realPath);
  } catch {
    throw new ArtifactApiResolutionError("not_found");
  }
  if (!stats.isFile()) {
    throw new ArtifactApiResolutionError("forbidden_path");
  }
  return { filePath, realPath, stats };
}

class ArtifactApiResolutionError extends Error {
  constructor(readonly code: ArtifactApiErrorCode) {
    super(code);
  }
}

function catalogFilePath(scopeKey: string, item: ArtifactCatalogItem): string {
  if (path.isAbsolute(item.relativePath) || item.relativePath.includes("\0")) {
    throw new ArtifactApiResolutionError("forbidden_path");
  }
  return path.join(scopeWorkspaceDir(scopeKey), item.relativePath);
}

function findCatalogItemForReference(catalog: ArtifactCatalog, reference: string): ArtifactCatalogItem | null {
  return catalog.items.find((item) => item.id === reference) ?? null;
}

function resolveArtifactRequest(catalog: ArtifactCatalog, artifactId: string): ResolvedArtifact {
  if (!artifactId.trim() || artifactId.includes("\0")) {
    throw new ArtifactApiResolutionError("invalid_id");
  }

  const parsedReference = parseArtifactReference(artifactId);
  if (parsedReference) {
    if (parsedReference.kind === "artifact-id" && parsedReference.parsedId.scopeKey !== catalog.scopeKey) {
      throw new ArtifactApiResolutionError("scope_mismatch");
    }
    let manifest: ArtifactManifest;
    try {
      manifest = createArtifactRegistry().resolveArtifact(catalog.scopeKey, artifactId);
    } catch {
      throw new ArtifactApiResolutionError("not_found");
    }
    const item = findCatalogItemForReference(catalog, manifest.artifact_id) ?? itemFromManifest(catalog.scopeKey, manifest);
    const contained = assertContainedRegularFile(catalog.scopeKey, manifest.payload_path);
    return { item: { ...item, sizeBytes: contained.stats.size }, ...contained };
  }

  const item = findCatalogItemForReference(catalog, artifactId);
  if (!item) {
    throw new ArtifactApiResolutionError("invalid_id");
  }
  if (item.scopeKey !== catalog.scopeKey) {
    throw new ArtifactApiResolutionError("scope_mismatch");
  }
  const contained = assertContainedRegularFile(catalog.scopeKey, catalogFilePath(catalog.scopeKey, item));
  return { item: { ...item, sizeBytes: contained.stats.size }, ...contained };
}

function readLeadingBytes(filePath: string, byteLimit: number): { buffer: Buffer; loadedBytes: number } {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(byteLimit);
    const loadedBytes = readSync(fd, buffer, 0, byteLimit, 0);
    return { buffer: buffer.subarray(0, loadedBytes), loadedBytes };
  } finally {
    closeSync(fd);
  }
}

function contentTypeForArtifactKind(kind: ArtifactRenderKind): string {
  switch (kind) {
    case "markdown":
      return "text/markdown; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "text":
    case "diff":
      return "text/plain; charset=utf-8";
    case "binary":
    case "unknown":
      return "application/octet-stream";
  }
}

function sanitizeDownloadFilename(value: string): string {
  const normalizedSeparators = normalizePathSeparators(value);
  const basename = path.posix.basename(normalizedSeparators);
  const sanitized = basename
    .replace(/["\r\n\\/]/g, "_")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return sanitized && sanitized !== "." && sanitized !== ".." ? sanitized : "artifact";
}

function writeArtifactBytes(
  response: http.ServerResponse,
  resolved: ResolvedArtifact,
  attachment: boolean,
): void {
  const headers: Record<string, string> = {
    "content-type": contentTypeForArtifactKind(resolved.item.kind),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (attachment) {
    headers["content-disposition"] = `attachment; filename="${sanitizeDownloadFilename(resolved.item.relativePath || path.basename(resolved.realPath))}"`;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolved.realPath);
  } catch {
    writeArtifactApiError(response, "read_failed", "Artifact content could not be read.", safeArtifactMetadata(resolved.item));
    return;
  }
  response.writeHead(200, headers);
  response.end(bytes);
}

function previewJsonArtifact(resolved: ResolvedArtifact): {
  content: string;
  loadedBytes: number;
  truncated: boolean;
  jsonParseSafe: boolean;
} {
  if (resolved.stats.size <= MAX_JSON_PARSE_SIZE) {
    const loadedBytes = Number(resolved.stats.size);
    const content = readFileSync(resolved.realPath).toString("utf8");
    const contentBytes = Buffer.from(content, "utf8");
    if (contentBytes.length > MAX_PREVIEW_SIZE) {
      return {
        content: contentBytes.subarray(0, MAX_PREVIEW_SIZE).toString("utf8"),
        loadedBytes,
        truncated: true,
        jsonParseSafe: false,
      };
    }
    return { content, loadedBytes, truncated: false, jsonParseSafe: true };
  }

  const { buffer, loadedBytes } = readLeadingBytes(resolved.realPath, MAX_PREVIEW_SIZE);
  return {
    content: buffer.toString("utf8"),
    loadedBytes,
    truncated: true,
    jsonParseSafe: false,
  };
}

function writeArtifactPreview(response: http.ServerResponse, resolved: ResolvedArtifact): void {
  if (resolved.item.kind === "binary" || resolved.item.kind === "unknown") {
    writeArtifactApiError(
      response,
      "unsupported_preview",
      "Artifact preview is not supported for this content type.",
      safeArtifactMetadata(resolved.item),
    );
    return;
  }

  try {
    const preview: {
      content: string;
      loadedBytes: number;
      truncated: boolean;
      jsonParseSafe?: boolean;
    } = resolved.item.kind === "json"
      ? previewJsonArtifact(resolved)
      : (() => {
        const byteLimit = Math.min(Number(resolved.stats.size), MAX_PREVIEW_SIZE);
        const { buffer, loadedBytes } = readLeadingBytes(resolved.realPath, byteLimit);
        return {
          content: buffer.toString("utf8"),
          loadedBytes,
          truncated: resolved.stats.size > loadedBytes,
        };
      })();

    writeJson(response, 200, {
      artifact: safeArtifactMetadata(resolved.item),
      renderKind: resolved.item.kind,
      kind: resolved.item.kind,
      encoding: "utf-8",
      content: preview.content,
      truncated: preview.truncated,
      sizeBytes: resolved.stats.size,
      loadedBytes: preview.loadedBytes,
      ...(resolved.item.kind === "json" ? { jsonParseSafe: preview.jsonParseSafe } : {}),
    });
  } catch {
    writeArtifactApiError(response, "read_failed", "Artifact preview could not be read.", safeArtifactMetadata(resolved.item));
  }
}

function handleArtifactApiRequest(
  request: IncomingMessage,
  response: http.ServerResponse,
  options: WebServerOptions,
  auth: WebServerAuthConfig | undefined,
): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const route = parseArtifactApiRoute(request.url);
  if (!route) {
    return false;
  }
  if (!isAuthorized(request, auth)) {
    writeAuthRequired(response);
    return true;
  }

  if (route.kind === "list") {
    if (!route.scopeKey) {
      writeArtifactApiError(response, "missing_scope", "A scope query parameter is required.");
      return true;
    }
    const primaryRunId = route.runIds[0];
    void loadArtifactCatalog(options, {
      scopeKey: route.scopeKey,
      ...(route.runIds.length === 1 && primaryRunId ? { runId: primaryRunId, runIds: route.runIds } : {}),
      ...(route.runIds.length > 1 ? { runIds: route.runIds } : {}),
    })
      .then((catalog) => {
        if (!catalog) {
          writeArtifactApiError(response, "not_found", "Artifact catalog provider is not configured.");
          return;
        }
        if (catalog.scopeKey !== route.scopeKey) {
          writeArtifactApiError(response, "scope_mismatch", "Requested scope does not match the active Web UI scope.");
          return;
        }
        writeJson(response, 200, filterCatalog(catalog, route.scopeKey, route.runIds));
      })
      .catch(() => {
        writeArtifactApiError(response, "read_failed", "Artifact catalog could not be loaded.");
      });
    return true;
  }

  if (!route.artifactId) {
    writeArtifactApiError(response, "invalid_id", "Artifact identifier is invalid.");
    return true;
  }

  const primaryRunId = route.runIds[0];
  void loadArtifactCatalog(options, {
    ...(route.scopeKey ? { scopeKey: route.scopeKey } : {}),
    ...(route.runIds.length === 1 && primaryRunId ? { runId: primaryRunId, runIds: route.runIds } : {}),
    ...(route.runIds.length > 1 ? { runIds: route.runIds } : {}),
  })
    .then((catalog) => {
      if (!catalog) {
        writeArtifactApiError(response, "not_found", "Artifact catalog provider is not configured.");
        return;
      }
      if (route.scopeKey && catalog.scopeKey !== route.scopeKey) {
        writeArtifactApiError(response, "scope_mismatch", "Requested scope does not match the active Web UI scope.");
        return;
      }
      let resolved: ResolvedArtifact;
      try {
        resolved = resolveArtifactRequest(catalog, route.artifactId);
      } catch (error) {
        const code = error instanceof ArtifactApiResolutionError ? error.code : "read_failed";
        writeArtifactApiError(response, code, code === "invalid_id" ? "Artifact identifier is invalid." : "Artifact could not be resolved.");
        return;
      }
      if (route.action === "preview") {
        writeArtifactPreview(response, resolved);
        return;
      }
      writeArtifactBytes(response, resolved, route.action === "download");
    })
    .catch(() => {
      writeArtifactApiError(response, "read_failed", "Artifact could not be loaded.");
    });
  return true;
}

function htmlShell(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentWeaver Web UI</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #172026; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: center; border-bottom: 1px solid #d8dee6; padding-bottom: 12px; }
    h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: 0; }
    button { border: 1px solid #b8c2cc; background: #ffffff; color: #172026; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
    section { display: grid; gap: 8px; }
    pre, textarea { border: 1px solid #d8dee6; border-radius: 6px; background: #ffffff; padding: 12px; white-space: pre-wrap; overflow: auto; }
    pre { min-height: 96px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.45fr); gap: 16px; align-items: start; }
    .muted { color: #5d6875; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    label { display: grid; gap: 4px; font-size: 14px; }
    input, textarea, select { font: inherit; border: 1px solid #b8c2cc; border-radius: 6px; padding: 8px; background: #ffffff; color: #172026; }
    @media (prefers-color-scheme: dark) {
      body { background: #101418; color: #eef2f6; }
      header, pre, textarea, input, select, button { border-color: #34404c; }
      pre, textarea, input, select, button { background: #171d23; color: #eef2f6; }
      .muted { color: #9aa6b2; }
    }
    @media (max-width: 760px) { main { padding: 16px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>AgentWeaver Web UI</h1>
        <div id="scope" class="muted">Connecting...</div>
      </div>
      <div class="row">
        <button id="help">Help</button>
        <button id="clear-log">Clear Log</button>
      </div>
    </header>
    <div class="grid">
      <section>
        <h2>Summary</h2>
        <pre id="summary">Task summary is not available yet.</pre>
        <h2>Activity</h2>
        <pre id="logs"></pre>
      </section>
      <section>
        <h2>Action</h2>
        <div id="flows" class="row"></div>
        <div id="action" class="muted">No action is pending.</div>
      </section>
    </div>
  </main>
  <script>
    const scope = document.getElementById("scope");
    const summary = document.getElementById("summary");
    const logs = document.getElementById("logs");
    const action = document.getElementById("action");
    const flows = document.getElementById("flows");
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/__agentweaver/ws");
    let viewModel = null;
    function send(message) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); }
    function appendLogLine(line) {
      logs.textContent += (logs.textContent ? "\\n" : "") + line;
    }
    function renderState(next) {
      viewModel = next;
      scope.textContent = next.header || next.title || "AgentWeaver";
      summary.textContent = next.summaryText || "Task summary is not available yet.";
      logs.textContent = next.logText || "";
      flows.innerHTML = "";
      for (const [index, flow] of (next.flowItems || []).entries()) {
        const button = document.createElement("button");
        button.textContent = flow.label;
        button.title = flow.key;
        button.onclick = () => send({ type: "flow.select", index });
        button.ondblclick = () => {
          if (flow.key.startsWith("folder:")) send({ type: "folder.toggle", key: flow.key });
          else send({ type: "run.openConfirm", key: flow.key });
        };
        flows.append(button);
      }
      renderAction();
    }
    function renderAction() {
      action.innerHTML = "";
      if (!viewModel) {
        action.textContent = "No action is pending.";
        action.className = "muted";
        return;
      }
      if (viewModel.confirmation || viewModel.confirmText) {
        const confirmation = viewModel.confirmation;
        const label = document.createElement("div");
        label.textContent = confirmation ? confirmation.text : viewModel.confirmText;
        const row = document.createElement("div");
        row.className = "row";
        const actions = confirmation ? confirmation.actions : ["resume", "continue", "restart", "stop", "ok", "cancel"].filter((name) => viewModel.confirmText.toLowerCase().includes(name === "ok" ? "ok" : name));
        for (const name of actions) {
          const button = document.createElement("button");
          button.textContent = name === "ok" ? "OK" : name[0].toUpperCase() + name.slice(1);
          button.onclick = () => {
            send({ type: "confirm.select", action: name });
            send({ type: "confirm.accept" });
          };
          row.append(button);
        }
        if (!actions.includes("cancel")) {
          const cancel = document.createElement("button");
          cancel.textContent = "Cancel";
          cancel.onclick = () => send({ type: "confirm.cancel" });
          row.append(cancel);
        }
        action.append(label, row);
        return;
      }
      if (viewModel.form) {
        const formModel = viewModel.form;
        const form = document.createElement("form");
        const title = document.createElement("strong");
        title.textContent = formModel.definition.title;
        form.append(title);
        for (const field of formModel.fields || formModel.definition.fields) {
          const label = document.createElement("label");
          label.textContent = field.label;
          let input;
          if (field.type === "boolean") {
            input = document.createElement("input");
            input.type = "checkbox";
            input.checked = Boolean(formModel.values[field.id]);
          } else if (field.type === "text") {
            input = document.createElement(field.multiline ? "textarea" : "input");
            input.value = String(formModel.values[field.id] || "");
          } else {
            input = document.createElement("select");
            input.multiple = field.type === "multi-select";
            for (const option of field.options || []) {
              const opt = document.createElement("option");
              opt.value = option.value;
              opt.textContent = option.label;
              const current = formModel.values[field.id];
              opt.selected = Array.isArray(current) ? current.includes(option.value) : current === option.value;
              input.append(opt);
            }
          }
          input.dataset.fieldId = field.id;
          input.dataset.fieldType = field.type;
          label.append(input);
          form.append(label);
        }
        const row = document.createElement("div");
        row.className = "row";
        const submit = document.createElement("button");
        submit.textContent = formModel.definition.submitLabel || "Submit";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.onclick = () => send({ type: "form.cancel" });
        row.append(submit, cancel);
        form.append(row);
        function collectValues() {
          const values = {};
          for (const el of form.querySelectorAll("[data-field-id]")) {
            if (el.dataset.fieldType === "boolean") values[el.dataset.fieldId] = el.checked;
            else if (el.dataset.fieldType === "multi-select") values[el.dataset.fieldId] = Array.from(el.selectedOptions).map((option) => option.value);
            else values[el.dataset.fieldId] = el.value;
          }
          return values;
        }
        form.oninput = (event) => {
          const target = event.target;
          if (target && target.dataset && target.dataset.fieldId) {
            const fieldId = target.dataset.fieldId;
            const values = collectValues();
            send({ type: "form.fieldUpdate", fieldId, value: values[fieldId] });
            return;
          }
          send({ type: "form.update", values: collectValues() });
        };
        form.onsubmit = (event) => {
          event.preventDefault();
          send({ type: "form.submit", values: collectValues() });
        };
        action.append(form);
        return;
      }
      const row = document.createElement("div");
      row.className = "row";
      const run = document.createElement("button");
      run.textContent = "Run Selected";
      run.onclick = () => send({ type: "run.openConfirm" });
      const interrupt = document.createElement("button");
      interrupt.textContent = "Interrupt";
      interrupt.onclick = () => send({ type: "interrupt.openConfirm" });
      row.append(run, interrupt);
      action.append(row);
      action.className = "muted";
    }
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "snapshot") renderState(message.viewModel);
      if (message.type === "log.append") for (const line of message.appendedLines) appendLogLine(line);
      if (message.type === "error") appendLogLine("[protocol] " + message.message);
      if (message.type === "closed") appendLogLine("[closed] " + (message.reason || "Session closed."));
    };
    document.getElementById("help").onclick = () => send({ type: "help.toggle" });
    document.getElementById("clear-log").onclick = () => send({ type: "log.clear" });
  </script>
</body>
</html>`;
}

function acceptKey(key: string): string {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function encodeFrame(payload: string): Buffer {
  const data = Buffer.from(payload);
  if (data.length < 126) {
    return Buffer.concat([Buffer.from([0x81, data.length]), data]);
  }
  if (data.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
    return Buffer.concat([header, data]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(data.length), 2);
  return Buffer.concat([header, data]);
}

function decodeFrames(buffer: Buffer<ArrayBufferLike>): { messages: string[]; rest: Buffer<ArrayBufferLike>; close: boolean } {
  const messages: string[] = [];
  let offset = 0;
  let close = false;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset] ?? 0;
    const second = buffer[offset + 1] ?? 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) {
        break;
      }
      const longLength = buffer.readBigUInt64BE(offset + 2);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        close = true;
        break;
      }
      length = Number(longLength);
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) {
      break;
    }
    if (opcode === 0x8) {
      close = true;
      offset += frameLength;
      continue;
    }
    if (opcode === 0x1) {
      const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
      const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, offset + frameLength));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
      }
      messages.push(payload.toString("utf8"));
    }
    offset += frameLength;
  }
  return { messages, rest: buffer.subarray(offset), close };
}

function defaultOpenBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
}

export async function startWebServer(options: WebServerOptions): Promise<StartedWebServer> {
  const clients = new Set<WebSocketClient>();
  const sockets = new Set<Duplex>();
  const host = options.host?.trim() || "127.0.0.1";
  const auth = options.auth;
  let closed = false;
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/__agentweaver/health") {
      writeJson(response, 200, { ok: true });
      return;
    }
    if (handleArtifactApiRequest(request, response, options, auth)) {
      return;
    }
    if (request.method === "GET" && request.url === "/__agentweaver/artifacts") {
      if (!isAuthorized(request, auth)) {
        writeAuthRequired(response);
        return;
      }
      if (!options.getArtifactCatalog) {
        writeJson(response, 404, { error: "Artifact catalog provider is not configured." });
        return;
      }
      void Promise.resolve()
        .then(() => options.getArtifactCatalog?.())
        .then((catalog) => {
          writeJson(response, 200, catalog);
        })
        .catch((error) => {
          writeJson(response, 500, { error: (error as Error).message });
        });
      return;
    }
    if (request.method === "GET" && staticAssetPath(request.url)) {
      if (!isAuthorized(request, auth)) {
        writeAuthRequired(response);
        return;
      }
      if (serveStaticAsset(request, response)) {
        return;
      }
    }
    if (request.method === "POST" && request.url === "/__agentweaver/exit") {
      if (!isAuthorized(request, auth)) {
        writeAuthRequired(response);
        return;
      }
      response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      options.onExitRequested();
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  server.on("connection", (socket: Duplex) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    if (request.url !== "/__agentweaver/ws") {
      socket.destroy();
      return;
    }
    if (!isAuthorized(request, auth)) {
      rejectUnauthorizedUpgrade(socket);
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      "",
      "",
    ].join("\r\n"));

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const client: WebSocketClient = {
      socket,
      send: (message) => {
        if (!socket.destroyed) {
          socket.write(encodeFrame(JSON.stringify(message)));
        }
      },
      close: () => {
        if (!socket.destroyed) {
          socket.end(Buffer.from([0x88, 0x00]));
          socket.destroy();
        }
      },
    };
    clients.add(client);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const decoded = decodeFrames(buffered);
      buffered = decoded.rest;
      if (decoded.close) {
        client.close();
        return;
      }
      for (const message of decoded.messages) {
        try {
          options.onClientAction(parseClientAction(message), client);
        } catch (error) {
          client.send({ type: "error", message: (error as Error).message });
        }
      }
    });
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));
    options.onClientConnected(client);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string" || typeof address.port !== "number" || address.port <= 0) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Unable to determine assigned Web UI port.");
  }

  const url = `http://${formatHostForUrl(host)}:${address.port}/`;
  process.stdout.write(`AgentWeaver Web UI: ${url}\n`);
  if (!options.noOpen) {
    try {
      await (options.openBrowser ?? defaultOpenBrowser)(url);
    } catch (error) {
      options.printInfo?.(`Warning: failed to open browser: ${(error as Error).message}`);
    }
  }

  return {
    url,
    host,
    broadcast(message) {
      for (const client of clients) {
        client.send(message);
      }
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      for (const client of clients) {
        client.send({ type: "closed", reason: "Server shutting down." });
        client.close();
      }
      clients.clear();
      for (const socket of sockets) {
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
