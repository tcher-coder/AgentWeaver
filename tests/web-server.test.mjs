import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { startWebServer } = await import(
  pathToFileURL(path.join(distRoot, "interactive/web/server.js")).href
);
const { ensureScopeWorkspaceDir, scopeWorkspaceDir } = await import(
  pathToFileURL(path.join(distRoot, "artifacts.js")).href
);
const { listArtifactCatalog } = await import(
  pathToFileURL(path.join(distRoot, "runtime/artifact-catalog.js")).href
);
const { createArtifactRegistry } = await import(
  pathToFileURL(path.join(distRoot, "runtime/artifact-registry.js")).href
);

async function startOrSkip(t, options) {
  try {
    return await startWebServer(options);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("local TCP listeners are not permitted in this sandbox");
      return null;
    }
    throw error;
  }
}

function portFromUrl(url) {
  return Number(new URL(url).port);
}

const AUTH = { username: "operator", password: "secret-pass" };

function basicAuthHeader(username = AUTH.username, password = AUTH.password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function encodedArtifactUrl(serverUrl, artifactId, action, scopeKey) {
  const url = new URL(`/__agentweaver/api/artifacts/${encodeURIComponent(artifactId)}/${action}`, serverUrl);
  if (scopeKey) {
    url.searchParams.set("scope", scopeKey);
  }
  return url;
}

function resetScope(scopeKey) {
  rmSync(scopeWorkspaceDir(scopeKey), { recursive: true, force: true });
  ensureScopeWorkspaceDir(scopeKey);
  return scopeWorkspaceDir(scopeKey);
}

function removeScope(scopeKey) {
  rmSync(scopeWorkspaceDir(scopeKey), { recursive: true, force: true });
}

function catalogItem(scopeKey, overrides) {
  return {
    id: overrides.id,
    scopeKey,
    runId: overrides.runId ?? null,
    logicalKey: overrides.logicalKey ?? null,
    title: overrides.title ?? "Artifact",
    relativePath: overrides.relativePath,
    kind: overrides.kind,
    role: overrides.role ?? "artifact",
    phaseId: overrides.phaseId ?? null,
    stepId: overrides.stepId ?? null,
    schemaId: overrides.schemaId ?? null,
    sizeBytes: overrides.sizeBytes ?? 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    isLatest: true,
    source: overrides.source ?? "scanner",
  };
}

function manualCatalog(scopeKey, items) {
  return { scopeKey, items, groups: [{ phaseId: "unclassified", title: "Unclassified", items }] };
}

async function connectWebSocket(url, headers = []) {
  const parsed = new URL(url);
  const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
  await new Promise((resolve) => socket.once("connect", resolve));
  socket.write([
    "GET /__agentweaver/ws HTTP/1.1",
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}`,
    "Sec-WebSocket-Version: 13",
    ...headers,
    "",
    "",
  ].join("\r\n"));
  const handshakeResponse = await new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.includes("\r\n\r\n")) {
        resolve(buffer.toString("utf8"));
      }
    });
  });
  socket.handshakeResponse = handshakeResponse;
  return socket;
}

function encodeClientFrame(raw) {
  const payload = Buffer.from(raw);
  const mask = crypto.randomBytes(4);
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function readServerMessage(socket) {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const length = buffer[1] & 0x7f;
      if (buffer.length < 2 + length) return;
      socket.off("data", onData);
      resolve(JSON.parse(buffer.subarray(2, 2 + length).toString("utf8")));
    });
  });
}

describe("web server", () => {
  it("starts on 127.0.0.1 with an assigned port and serves static console assets plus health", async (t) => {
    const server = await startOrSkip(t, {
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.equal(server.host, "127.0.0.1");
      assert.ok(portFromUrl(server.url) > 0);

      const root = await fetch(server.url);
      assert.equal(root.status, 200);
      assert.match(await root.text(), /AgentWeaver Operator Console/);

      const script = await fetch(new URL("/static/app.js", server.url));
      assert.equal(script.status, 200);
      assert.match(script.headers.get("content-type") ?? "", /text\/javascript/);
      assert.match(await script.text(), /WebSocket/);

      const styles = await fetch(new URL("/static/styles.css", server.url));
      assert.equal(styles.status, 200);
      assert.match(styles.headers.get("content-type") ?? "", /text\/css/);
      assert.match(await styles.text(), /workspace/);

      const health = await fetch(new URL("/__agentweaver/health", server.url));
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });
    } finally {
      await server.close();
    }
  });

  it("supports deterministic exit requests and concurrent assigned ports", async (t) => {
    let exitCount = 0;
    let first;
    let second;
    try {
      [first, second] = await Promise.all([
        startOrSkip(t, {
          noOpen: true,
          onClientAction: () => {},
          onClientConnected: () => {},
          onExitRequested: () => {
            exitCount += 1;
          },
        }),
        startOrSkip(t, {
          noOpen: true,
          onClientAction: () => {},
          onClientConnected: () => {},
          onExitRequested: () => {
            exitCount += 1;
          },
        }),
      ]);
    } catch (error) {
      if (first) await first.close();
      if (second) await second.close();
      throw error;
    }
    if (!first || !second) return;
    try {
      assert.notEqual(portFromUrl(first.url), portFromUrl(second.url));
      const response = await fetch(new URL("/__agentweaver/exit", first.url), { method: "POST" });
      assert.equal(response.status, 202);
      assert.equal(exitCount, 1);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  it("reports browser opener failures without failing startup", async (t) => {
    const warnings = [];
    const server = await startOrSkip(t, {
      noOpen: false,
      openBrowser: async () => {
        throw new Error("open failed");
      },
      printInfo: (message) => warnings.push(message),
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    try {
      if (!server) return;
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.match(warnings.join("\n"), /failed to open browser: open failed/);
    } finally {
      await server?.close();
    }
  });

  it("closes promptly with a connected WebSocket client", async (t) => {
    const server = await startOrSkip(t, {
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    const socket = await connectWebSocket(server.url);
    try {
      const closedPromise = readServerMessage(socket);
      await server.close();
      assert.deepEqual(await closedPromise, { type: "closed", reason: "Server shutting down." });
      assert.equal(socket.destroyed, true);
    } finally {
      socket.destroy();
    }
  });

  it("can bind to all interfaces when explicitly requested", async (t) => {
    const server = await startOrSkip(t, {
      host: "0.0.0.0",
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    try {
      assert.match(server.url, /^http:\/\/0\.0\.0\.0:\d+\/$/);
      assert.equal(server.host, "0.0.0.0");
      const health = await fetch(`http://127.0.0.1:${portFromUrl(server.url)}/__agentweaver/health`);
      assert.equal(health.status, 200);
    } finally {
      await server.close();
    }
  });

  it("requires valid Basic auth for protected HTTP resources when auth is active", async (t) => {
    let exitCount = 0;
    const server = await startOrSkip(t, {
      noOpen: true,
      auth: AUTH,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {
        exitCount += 1;
      },
    });
    if (!server) return;
    try {
      const root = await fetch(server.url);
      assert.equal(root.status, 401);
      assert.match(root.headers.get("www-authenticate") ?? "", /Basic realm="AgentWeaver Web UI"/);
      assert.doesNotMatch(await root.text(), /AgentWeaver Operator Console/);

      const wrongUser = await fetch(server.url, { headers: { authorization: basicAuthHeader("other", AUTH.password) } });
      assert.equal(wrongUser.status, 401);

      const wrongPassword = await fetch(new URL("/static/app.js", server.url), { headers: { authorization: basicAuthHeader(AUTH.username, "bad") } });
      assert.equal(wrongPassword.status, 401);
      assert.doesNotMatch(await wrongPassword.text(), /WebSocket/);

      const malformed = await fetch(server.url, { headers: { authorization: "Basic not-a-valid-pair" } });
      assert.equal(malformed.status, 401);

      const health = await fetch(new URL("/__agentweaver/health", server.url));
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });

      const exitDenied = await fetch(new URL("/__agentweaver/exit", server.url), { method: "POST" });
      assert.equal(exitDenied.status, 401);
      assert.equal(exitCount, 0);

      const catalogDenied = await fetch(new URL("/__agentweaver/artifacts", server.url));
      assert.equal(catalogDenied.status, 401);

      const authedRoot = await fetch(server.url, { headers: { authorization: basicAuthHeader() } });
      assert.equal(authedRoot.status, 200);
      assert.match(await authedRoot.text(), /AgentWeaver Operator Console/);

      const authedScript = await fetch(new URL("/static/app.js", server.url), { headers: { authorization: basicAuthHeader() } });
      assert.equal(authedScript.status, 200);
      assert.match(await authedScript.text(), /WebSocket/);

      const authedExit = await fetch(new URL("/__agentweaver/exit", server.url), { method: "POST", headers: { authorization: basicAuthHeader() } });
      assert.equal(authedExit.status, 202);
      assert.equal(exitCount, 1);
    } finally {
      await server.close();
    }
  });

  it("serves injected artifact catalog JSON and reports absent provider clearly", async (t) => {
    const catalog = {
      scopeKey: "ag-web-1",
      items: [
        {
          id: "artifact-1",
          scopeKey: "ag-web-1",
          runId: "run-1",
          logicalKey: "design-main",
          title: "Design",
          relativePath: "design-ag-web-1-1.md",
          kind: "markdown",
          role: "design",
          phaseId: "design",
          stepId: "write_design",
          schemaId: "markdown/v1",
          sizeBytes: 12,
          updatedAt: "2026-01-01T00:00:00.000Z",
          isLatest: true,
          source: "manifest",
        },
      ],
      groups: [
        {
          phaseId: "design",
          title: "Design",
          items: [],
        },
      ],
    };
    const server = await startOrSkip(t, {
      noOpen: true,
      getArtifactCatalog: () => catalog,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    try {
      const response = await fetch(new URL("/__agentweaver/artifacts", server.url));
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), catalog);
    } finally {
      await server.close();
    }

    const withoutProvider = await startOrSkip(t, {
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!withoutProvider) return;
    try {
      const response = await fetch(new URL("/__agentweaver/artifacts", withoutProvider.url));
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Artifact catalog provider is not configured." });
    } finally {
      await withoutProvider.close();
    }
  });

  it("requires valid Basic auth for the artifact catalog endpoint when auth is active", async (t) => {
    const server = await startOrSkip(t, {
      noOpen: true,
      auth: AUTH,
      getArtifactCatalog: () => ({ scopeKey: "ag-web-auth", items: [], groups: [] }),
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    try {
      const denied = await fetch(new URL("/__agentweaver/artifacts", server.url));
      assert.equal(denied.status, 401);

      const wrong = await fetch(new URL("/__agentweaver/artifacts", server.url), {
        headers: { authorization: basicAuthHeader(AUTH.username, "bad") },
      });
      assert.equal(wrong.status, 401);

      const allowed = await fetch(new URL("/__agentweaver/artifacts", server.url), {
        headers: { authorization: basicAuthHeader() },
      });
      assert.equal(allowed.status, 200);
      assert.deepEqual(await allowed.json(), { scopeKey: "ag-web-auth", items: [], groups: [] });
    } finally {
      await server.close();
    }
  });

  it("requires valid Basic auth for artifact API listing and content endpoints", async (t) => {
    const scopeKey = `web-api-auth-${process.pid}`;
    const root = resetScope(scopeKey);
    writeFileSync(path.join(root, "auth.md"), "# Auth\n", "utf8");
    const item = catalogItem(scopeKey, {
      id: `scanner:${scopeKey}:auth.md`,
      relativePath: "auth.md",
      kind: "markdown",
    });
    const server = await startOrSkip(t, {
      noOpen: true,
      auth: AUTH,
      getArtifactCatalog: () => manualCatalog(scopeKey, [item]),
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) {
      removeScope(scopeKey);
      return;
    }
    try {
      const listingUrl = new URL("/__agentweaver/api/artifacts", server.url);
      listingUrl.searchParams.set("scope", scopeKey);
      const endpointUrls = [
        listingUrl,
        encodedArtifactUrl(server.url, item.id, "preview", scopeKey),
        encodedArtifactUrl(server.url, item.id, "raw", scopeKey),
        encodedArtifactUrl(server.url, item.id, "download", scopeKey),
      ];
      for (const url of endpointUrls) {
        const denied = await fetch(url);
        assert.equal(denied.status, 401);
        assert.match(denied.headers.get("www-authenticate") ?? "", /Basic realm="AgentWeaver Web UI"/);
      }

      const malformed = await fetch(listingUrl, { headers: { authorization: "Basic malformed" } });
      assert.equal(malformed.status, 401);
      const wrong = await fetch(encodedArtifactUrl(server.url, item.id, "preview", scopeKey), {
        headers: { authorization: basicAuthHeader(AUTH.username, "bad") },
      });
      assert.equal(wrong.status, 401);

      const allowed = await fetch(listingUrl, { headers: { authorization: basicAuthHeader() } });
      assert.equal(allowed.status, 200);
    } finally {
      await server.close();
      removeScope(scopeKey);
    }
  });

  it("lists only active-scope artifacts and applies exact runId filtering", async (t) => {
    const scopeKey = "web-api-list-active";
    const items = [
      catalogItem(scopeKey, { id: "run-1-item", relativePath: "run-1.md", kind: "markdown", runId: "run-1" }),
      catalogItem(scopeKey, { id: "run-2-item", relativePath: "run-2.md", kind: "markdown", runId: "run-2" }),
      catalogItem(scopeKey, { id: "scope-item", relativePath: "scope.md", kind: "markdown", runId: null }),
      catalogItem("other-scope", { id: "other-item", relativePath: "other.md", kind: "markdown", runId: "run-1" }),
    ];
    const server = await startOrSkip(t, {
      noOpen: true,
      getArtifactCatalog: () => manualCatalog(scopeKey, items),
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) {
      removeScope(scopeKey);
      return;
    }
    try {
      const missingScope = await fetch(new URL("/__agentweaver/api/artifacts", server.url));
      assert.equal(missingScope.status, 400);
      assert.equal((await missingScope.json()).code, "missing_scope");

      const wrongScopeUrl = new URL("/__agentweaver/api/artifacts", server.url);
      wrongScopeUrl.searchParams.set("scope", "other-scope");
      const wrongScope = await fetch(wrongScopeUrl);
      assert.equal(wrongScope.status, 403);
      assert.equal((await wrongScope.json()).code, "scope_mismatch");

      const activeUrl = new URL("/__agentweaver/api/artifacts", server.url);
      activeUrl.searchParams.set("scope", scopeKey);
      const active = await fetch(activeUrl);
      assert.equal(active.status, 200);
      assert.deepEqual((await active.json()).items.map((item) => item.id), ["run-1-item", "run-2-item", "scope-item"]);

      activeUrl.searchParams.set("runId", "run-1");
      const filtered = await fetch(activeUrl);
      assert.equal(filtered.status, 200);
      assert.deepEqual((await filtered.json()).items.map((item) => item.id), ["run-1-item"]);
    } finally {
      await server.close();
    }
  });

  it("previews text-like artifacts with truncation and rejects unsupported binary previews", async (t) => {
    const scopeKey = `web-api-preview-${process.pid}`;
    const root = resetScope(scopeKey);
    mkdirSync(path.join(root, ".artifacts"), { recursive: true });
    writeFileSync(path.join(root, "doc.md"), "# Heading\n", "utf8");
    writeFileSync(path.join(root, ".artifacts", "data.json"), "{\"ok\":true}", "utf8");
    writeFileSync(path.join(root, ".artifacts", "invalid.json"), "{\"bad\":", "utf8");
    writeFileSync(path.join(root, ".artifacts", "large.json"), `{"value":"${"x".repeat(600 * 1024)}"}`, "utf8");
    writeFileSync(path.join(root, "note.txt"), "plain text\n", "utf8");
    writeFileSync(path.join(root, "patch.diff"), "diff --git a/a b/a\n", "utf8");
    writeFileSync(path.join(root, "large.txt"), `${"x".repeat(600 * 1024)}tail`, "utf8");
    writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 1, 2, 3]));
    const items = [
      catalogItem(scopeKey, { id: "markdown-item", relativePath: "doc.md", kind: "markdown" }),
      catalogItem(scopeKey, { id: "json-item", relativePath: ".artifacts/data.json", kind: "json" }),
      catalogItem(scopeKey, { id: "invalid-json-item", relativePath: ".artifacts/invalid.json", kind: "json" }),
      catalogItem(scopeKey, { id: "large-json-item", relativePath: ".artifacts/large.json", kind: "json" }),
      catalogItem(scopeKey, { id: "text-item", relativePath: "note.txt", kind: "text" }),
      catalogItem(scopeKey, { id: "diff-item", relativePath: "patch.diff", kind: "diff" }),
      catalogItem(scopeKey, { id: "large-item", relativePath: "large.txt", kind: "text" }),
      catalogItem(scopeKey, { id: "binary-item", relativePath: "blob.bin", kind: "binary" }),
    ];
    const server = await startOrSkip(t, {
      noOpen: true,
      getArtifactCatalog: () => manualCatalog(scopeKey, items),
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) {
      removeScope(scopeKey);
      return;
    }
    try {
      for (const [id, kind] of [["markdown-item", "markdown"], ["json-item", "json"], ["text-item", "text"], ["diff-item", "diff"]]) {
        const response = await fetch(encodedArtifactUrl(server.url, id, "preview", scopeKey));
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.renderKind, kind);
        assert.equal(body.encoding, "utf-8");
        assert.equal(body.truncated, false);
        assert.ok(body.sizeBytes > 0);
        assert.ok(body.loadedBytes > 0);
        assert.equal(typeof body.content, "string");
      }

      const json = await fetch(encodedArtifactUrl(server.url, "json-item", "preview", scopeKey));
      assert.equal(json.status, 200);
      const jsonBody = await json.json();
      assert.equal(jsonBody.content, "{\"ok\":true}");
      assert.equal(jsonBody.jsonParseSafe, true);

      const invalidJson = await fetch(encodedArtifactUrl(server.url, "invalid-json-item", "preview", scopeKey));
      assert.equal(invalidJson.status, 200);
      const invalidJsonBody = await invalidJson.json();
      assert.equal(invalidJsonBody.content, "{\"bad\":");
      assert.equal(invalidJsonBody.jsonParseSafe, true);

      const largeJson = await fetch(encodedArtifactUrl(server.url, "large-json-item", "preview", scopeKey));
      assert.equal(largeJson.status, 200);
      const largeJsonBody = await largeJson.json();
      assert.equal(largeJsonBody.truncated, true);
      assert.equal(largeJsonBody.jsonParseSafe, false);
      assert.ok(largeJsonBody.loadedBytes <= 512 * 1024);

      const large = await fetch(encodedArtifactUrl(server.url, "large-item", "preview", scopeKey));
      assert.equal(large.status, 200);
      const largeBody = await large.json();
      assert.equal(largeBody.truncated, true);
      assert.ok(largeBody.loadedBytes <= 512 * 1024);
      assert.equal(largeBody.content.length, 512 * 1024);

      const binary = await fetch(encodedArtifactUrl(server.url, "binary-item", "preview", scopeKey));
      assert.equal(binary.status, 415);
      const binaryBody = await binary.json();
      assert.equal(binaryBody.code, "unsupported_preview");
      assert.equal(binaryBody.artifact.id, "binary-item");
      assert.equal(Object.hasOwn(binaryBody, "content"), false);
    } finally {
      await server.close();
      removeScope(scopeKey);
    }
  });

  it("serves raw and downloadable artifact bytes with pinned safety headers and sanitized filenames", async (t) => {
    const scopeKey = `web-api-raw-${process.pid}`;
    const root = resetScope(scopeKey);
    writeFileSync(path.join(root, "doc.md"), "# Raw\n", "utf8");
    writeFileSync(path.join(root, "data.json"), "{\"ok\":true}\n", "utf8");
    writeFileSync(path.join(root, "note.txt"), "text\n", "utf8");
    writeFileSync(path.join(root, "patch.diff"), "diff\n", "utf8");
    writeFileSync(path.join(root, "blob.bin"), Buffer.from([0, 255, 7]));
    writeFileSync(path.join(root, "mystery.custom"), "mystery\n", "utf8");
    writeFileSync(path.join(root, "bad\"\r\nname.txt"), "download\n", "utf8");
    const items = [
      catalogItem(scopeKey, { id: "md", relativePath: "doc.md", kind: "markdown" }),
      catalogItem(scopeKey, { id: "json", relativePath: "data.json", kind: "json" }),
      catalogItem(scopeKey, { id: "txt", relativePath: "note.txt", kind: "text" }),
      catalogItem(scopeKey, { id: "diff", relativePath: "patch.diff", kind: "diff" }),
      catalogItem(scopeKey, { id: "bin", relativePath: "blob.bin", kind: "binary" }),
      catalogItem(scopeKey, { id: "unknown", relativePath: "mystery.custom", kind: "unknown" }),
      catalogItem(scopeKey, { id: "unsafe-name", relativePath: "bad\"\r\nname.txt", kind: "text" }),
    ];
    const server = await startOrSkip(t, {
      noOpen: true,
      getArtifactCatalog: () => manualCatalog(scopeKey, items),
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) {
      removeScope(scopeKey);
      return;
    }
    try {
      const expectedTypes = new Map([
        ["md", "text/markdown; charset=utf-8"],
        ["json", "application/json; charset=utf-8"],
        ["txt", "text/plain; charset=utf-8"],
        ["diff", "text/plain; charset=utf-8"],
        ["bin", "application/octet-stream"],
        ["unknown", "application/octet-stream"],
      ]);
      for (const [id, contentType] of expectedTypes) {
        const response = await fetch(encodedArtifactUrl(server.url, id, "raw", scopeKey));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), contentType);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      }
      const binary = await fetch(encodedArtifactUrl(server.url, "bin", "raw", scopeKey));
      assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from([0, 255, 7]));

      const download = await fetch(encodedArtifactUrl(server.url, "unsafe-name", "download", scopeKey));
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("cache-control"), "no-store");
      assert.equal(download.headers.get("x-content-type-options"), "nosniff");
      assert.equal(download.headers.get("content-disposition"), "attachment; filename=\"bad___name.txt\"");
      assert.equal(await download.text(), "download\n");
    } finally {
      await server.close();
      removeScope(scopeKey);
    }
  });

  it("rejects traversal ids, symlink escapes, and manifest realpath escapes", async (t) => {
    const scopeKey = `web-api-paths-${process.pid}`;
    const root = resetScope(scopeKey);
    const outsideDir = path.join(os.tmpdir(), `agentweaver-web-api-outside-${process.pid}`);
    rmSync(outsideDir, { recursive: true, force: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(path.join(outsideDir, "outside.txt"), "outside\n", "utf8");
    symlinkSync(path.join(outsideDir, "outside.txt"), path.join(root, "escape.txt"));

    const linkedDir = path.join(root, "linked-out");
    symlinkSync(outsideDir, linkedDir, "dir");
    const manifestEscapePath = path.join(linkedDir, "manifest-escape.md");
    writeFileSync(manifestEscapePath, "# Outside\n", "utf8");
    const registry = createArtifactRegistry();
    const record = registry.publish({
      scopeKey,
      runId: "run-escape",
      flowId: "flow",
      phaseId: "phase",
      stepId: "step",
      nodeKind: "test",
      kind: "artifact",
      payloadPath: manifestEscapePath,
      logicalKey: "escape/manifest",
      payloadFamily: "markdown",
      schemaId: "markdown/v1",
      schemaVersion: 1,
      inputs: [],
    });

    const symlinkItem = catalogItem(scopeKey, {
      id: "symlink-item",
      relativePath: "escape.txt",
      kind: "text",
    });
    const server = await startOrSkip(t, {
      noOpen: true,
      getArtifactCatalog: () => {
        const catalog = listArtifactCatalog({ scopeKey, artifactRegistry: createArtifactRegistry() });
        return {
          ...catalog,
          items: [...catalog.items, symlinkItem],
          groups: catalog.groups,
        };
      },
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) {
      removeScope(scopeKey);
      rmSync(outsideDir, { recursive: true, force: true });
      return;
    }
    try {
      const crafted = await fetch(encodedArtifactUrl(server.url, `scanner:${scopeKey}:../../package.json`, "raw", scopeKey));
      assert.equal(crafted.status, 400);
      assert.equal((await crafted.json()).code, "invalid_id");

      const symlink = await fetch(encodedArtifactUrl(server.url, "symlink-item", "preview", scopeKey));
      assert.equal(symlink.status, 403);
      assert.equal((await symlink.json()).code, "forbidden_path");

      const manifestById = await fetch(encodedArtifactUrl(server.url, record.artifact_id, "raw", scopeKey));
      assert.equal(manifestById.status, 403);
      assert.equal((await manifestById.json()).code, "forbidden_path");

      const manifestByLogicalRef = await fetch(encodedArtifactUrl(server.url, "escape/manifest@latest", "preview", scopeKey));
      assert.equal(manifestByLogicalRef.status, 403);
      assert.equal((await manifestByLogicalRef.json()).code, "forbidden_path");
    } finally {
      await server.close();
      removeScope(scopeKey);
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects unauthorized WebSocket upgrades before session callbacks when auth is active", async (t) => {
    let connectedCount = 0;
    let actionCount = 0;
    const server = await startOrSkip(t, {
      noOpen: true,
      auth: AUTH,
      onClientAction: () => {
        actionCount += 1;
      },
      onClientConnected: () => {
        connectedCount += 1;
      },
      onExitRequested: () => {},
    });
    if (!server) return;
    const sockets = [];
    try {
      for (const headers of [
        [],
        [`Authorization: ${basicAuthHeader("other", AUTH.password)}`],
        [`Authorization: ${basicAuthHeader(AUTH.username, "bad")}`],
        ["Authorization: Basic malformed"],
      ]) {
        const socket = await connectWebSocket(server.url, headers);
        sockets.push(socket);
        assert.match(socket.handshakeResponse, /^HTTP\/1\.1 401 Unauthorized/);
      }
      assert.equal(connectedCount, 0);
      assert.equal(actionCount, 0);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await server.close();
    }
  });

  it("allows authenticated WebSocket clients to receive snapshots and dispatch actions", async (t) => {
    let connectedCount = 0;
    let actionType = "";
    const server = await startOrSkip(t, {
      noOpen: true,
      auth: AUTH,
      onClientAction: (action) => {
        actionType = action.type;
      },
      onClientConnected: (client) => {
        connectedCount += 1;
        client.send({ type: "snapshot", viewModel: { title: "Authenticated" } });
      },
      onExitRequested: () => {},
    });
    if (!server) return;
    const socket = await connectWebSocket(server.url, [`Authorization: ${basicAuthHeader()}`]);
    try {
      assert.match(socket.handshakeResponse, /^HTTP\/1\.1 101 Switching Protocols/);
      assert.equal(connectedCount, 1);
      const messagePromise = readServerMessage(socket);
      assert.deepEqual(await messagePromise, { type: "snapshot", viewModel: { title: "Authenticated" } });
      socket.write(encodeClientFrame(JSON.stringify({ type: "help.toggle", visible: true })));
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(actionType, "help.toggle");
    } finally {
      socket.destroy();
      await server.close();
    }
  });

  it("returns protocol errors for malformed WebSocket messages", async (t) => {
    const server = await startOrSkip(t, {
      noOpen: true,
      onClientAction: () => {},
      onClientConnected: () => {},
      onExitRequested: () => {},
    });
    if (!server) return;
    const socket = await connectWebSocket(server.url);
    try {
      const messagePromise = readServerMessage(socket);
      socket.write(encodeClientFrame("{"));
      const message = await messagePromise;
      assert.equal(message.type, "error");
      assert.match(message.message, /valid JSON/);
    } finally {
      socket.destroy();
      await server.close();
    }
  });
});
