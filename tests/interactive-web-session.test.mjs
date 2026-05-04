import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const distRoot = path.resolve(process.cwd(), "dist");
const { createWebInteractiveSession } = await import(
  pathToFileURL(path.join(distRoot, "interactive/web/index.js")).href
);
const { setFlowExecutionState } = await import(
  pathToFileURL(path.join(distRoot, "tui.js")).href
);

function createOptions(overrides = {}) {
  return {
    scopeKey: "ag-107",
    jiraIssueKey: "AG-107",
    summaryText: "Initial summary",
    cwd: process.cwd(),
    gitBranchName: "feature/web",
    version: "0.1.17",
    flows: [
      {
        id: "plan",
        label: "Plan",
        description: "Plan work.",
        source: "built-in",
        treePath: ["default", "plan"],
        phases: [],
      },
    ],
    getRunConfirmation: async () => ({
      hasExistingState: false,
      resume: { available: false, reason: "No state." },
      continue: { available: false, reason: "No state." },
      restart: { available: true, reason: "Run." },
    }),
    onRun: async () => {},
    onInterrupt: async () => {},
    onExit: () => {},
    ...overrides,
  };
}

function encodeClientFrame(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] = masked[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function decodeServerFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    }
    if (buffer.length - offset < headerLength + length) break;
    const opcode = buffer[offset] & 0x0f;
    if (opcode === 1) {
      messages.push(JSON.parse(buffer.subarray(offset + headerLength, offset + headerLength + length).toString("utf8")));
    }
    offset += headerLength + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}

async function connectWebSocket(url) {
  const parsed = new URL(url);
  const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
  await new Promise((resolve) => socket.once("connect", resolve));
  const key = crypto.randomBytes(16).toString("base64");
  socket.write([
    "GET /__agentweaver/ws HTTP/1.1",
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n"));

  let buffer = Buffer.alloc(0);
  const queue = [];
  let resolveNext;
  await new Promise((resolve) => {
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        buffer = buffer.subarray(headerEnd + 4);
        resolve();
      }
    });
  });
  socket.removeAllListeners("data");
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const decoded = decodeServerFrames(buffer);
    buffer = decoded.rest;
    queue.push(...decoded.messages);
    if (resolveNext && queue.length > 0) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve(queue.shift());
    }
  });

  return {
    send: (message) => socket.write(encodeClientFrame(message)),
    nextMessage: async () => {
      if (queue.length > 0) return queue.shift();
      return await new Promise((resolve) => {
        resolveNext = resolve;
      });
    },
    close: () => socket.destroy(),
  };
}

async function nextMatching(client, predicate, limit = 20) {
  for (let index = 0; index < limit; index += 1) {
    const message = await client.nextMessage();
    if (predicate(message)) {
      return message;
    }
  }
  throw new Error("Expected WebSocket message was not received.");
}

function catalogItem(scopeKey, overrides = {}) {
  return {
    id: overrides.id ?? "artifact-1",
    scopeKey,
    runId: overrides.runId ?? null,
    logicalKey: overrides.logicalKey ?? "artifacts/result.json",
    title: overrides.title ?? "Result",
    relativePath: overrides.relativePath ?? ".artifacts/result.json",
    kind: overrides.kind ?? "json",
    role: overrides.role ?? "artifact",
    phaseId: overrides.phaseId ?? null,
    stepId: overrides.stepId ?? null,
    schemaId: overrides.schemaId ?? null,
    sizeBytes: overrides.sizeBytes ?? 2,
    updatedAt: "2026-01-01T00:00:00.000Z",
    isLatest: true,
    source: overrides.source ?? "manifest",
  };
}

function manualCatalog(scopeKey, items) {
  return {
    scopeKey,
    items,
    groups: [{ phaseId: "unclassified", title: "Unclassified", items }],
  };
}

function publishedArtifact(id, runId) {
  return {
    artifact_id: id,
    payload_path: `/tmp/${id}.md`,
    manifest: {
      run_id: runId,
    },
  };
}

describe("web interactive session", () => {
  it("streams controller snapshots, logs, and semantic actions", async (t) => {
    let ready;
    let runResolve;
    const runPromise = new Promise((resolve) => {
      runResolve = resolve;
    });
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const session = createWebInteractiveSession(createOptions({
      onRun: async (flowId, mode) => runResolve({ flowId, mode }),
    }), {
      noOpen: true,
      onServerReady: ready,
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      const snapshot = await client.nextMessage();
      assert.equal(snapshot.type, "snapshot");
      assert.match(snapshot.viewModel.header, /Scope ag-107/);
      assert.equal(snapshot.viewModel.artifactExplorer.available, false);
      assert.match(snapshot.viewModel.summaryText, /Initial summary/);
      assert.equal(snapshot.viewModel.flowItems.some((item) => item.key === "flow:plan"), true);

      session.setScope("ag-108", "AG-108");
      assert.match((await client.nextMessage()).viewModel.header, /Scope ag-108/);
      session.setSummary("Next summary");
      assert.match((await client.nextMessage()).viewModel.summaryText, /Next summary/);
      session.appendLog("hello");
      assert.deepEqual(await client.nextMessage(), { type: "log.append", appendedLines: ["hello"] });
      const reconnect = await connectWebSocket(server.url);
      try {
        const recovered = await reconnect.nextMessage();
        assert.equal(recovered.type, "snapshot");
        assert.match(recovered.viewModel.logText, /hello/);
        session.setSummary("Fanout summary");
        const firstFanout = await client.nextMessage();
        const secondFanout = await reconnect.nextMessage();
        assert.match(firstFanout.viewModel.summaryText, /Fanout summary/);
        assert.match(secondFanout.viewModel.summaryText, /Fanout summary/);
      } finally {
        reconnect.close();
      }
      session.setFlowFailed("plan");
      assert.equal((await client.nextMessage()).type, "snapshot");

      client.send({ type: "run.openConfirm", flowId: "plan" });
      const confirmation = await client.nextMessage();
      assert.equal(confirmation.type, "snapshot");
      assert.match(confirmation.viewModel.confirmText, /Run flow/);
      assert.equal(confirmation.viewModel.confirmation.kind, "run");
      assert.deepEqual(confirmation.viewModel.confirmation.actions, ["restart", "cancel"]);
      assert.equal(confirmation.viewModel.artifactExplorer.open, false);
      client.send({ type: "confirm.accept", action: "restart" });
      assert.deepEqual(await runPromise, { flowId: "plan", mode: "restart" });

      const inputPromise = session.requestUserInput({
        formId: "demo",
        title: "Demo",
        fields: [{ id: "name", type: "text", label: "Name", required: true }],
      });
      const requested = await nextMatching(client, (message) => message.type === "snapshot" && message.viewModel.form?.formId === "demo");
      assert.equal(requested.type, "snapshot");
      assert.equal(requested.viewModel.form.formId, "demo");
      assert.equal(requested.viewModel.form.currentFieldId, "name");
      assert.equal(requested.viewModel.form.fields[0].id, "name");
      client.send({ type: "form.fieldUpdate", fieldId: "name", value: "Ada" });
      assert.equal((await client.nextMessage()).type, "snapshot");
      client.send({ type: "form.submit" });
      const result = await inputPromise;
      assert.equal(result.formId, "demo");
      assert.equal(result.values.name, "Ada");
    } finally {
      client.close();
      session.destroy();
      setFlowExecutionState(null, null);
    }
  });

  it("persists Artifact Explorer state after completed runs and supports close, reopen, and reconnect", async (t) => {
    setFlowExecutionState(null, null);
    let ready;
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const scopeKey = "ag-116-web";
    const items = [
      catalogItem(scopeKey, { id: "old-item", kind: "markdown", relativePath: "old.md", runId: "old-run" }),
      catalogItem(scopeKey, { id: "pub-item", kind: "markdown", relativePath: "result.md", runId: "pub-1" }),
    ];
    const session = createWebInteractiveSession(createOptions({
      scopeKey,
      jiraIssueKey: "AG-116",
      onRun: async () => {
        setFlowExecutionState("plan", {
          runId: "run-1",
          publicationRunId: "pub-1",
          flowKind: "test",
          flowVersion: 1,
          terminated: true,
          terminationOutcome: "success",
          phases: [],
        });
      },
    }), {
      noOpen: true,
      onServerReady: ready,
      getArtifactCatalog: (input) => manualCatalog(input?.scopeKey ?? scopeKey, items),
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      await client.nextMessage();
      client.send({ type: "run.openConfirm", flowId: "plan" });
      await nextMatching(client, (message) => message.type === "snapshot" && message.viewModel.confirmation?.kind === "run");
      client.send({ type: "confirm.accept", action: "restart" });
      const completed = await nextMatching(
        client,
        (message) => message.type === "snapshot" && message.viewModel.artifactExplorer?.available === true,
      );
      assert.deepEqual(completed.viewModel.artifactExplorer, {
        available: true,
        open: true,
        scopeKey,
        runId: "pub-1",
        status: "completed",
        label: "Artifacts ready",
        artifactCount: 2,
        message: "The workflow completed and scope artifacts are available for review.",
      });

      client.send({ type: "artifactExplorer.close" });
      const closed = await nextMatching(
        client,
        (message) => message.type === "snapshot" && message.viewModel.artifactExplorer?.open === false,
      );
      assert.equal(closed.viewModel.artifactExplorer.available, true);
      assert.equal(closed.viewModel.artifactExplorer.scopeKey, scopeKey);
      assert.equal(closed.viewModel.artifactExplorer.runId, "pub-1");
      assert.equal(closed.viewModel.artifactExplorer.artifactCount, 2);

      const inputPromise = session.requestUserInput({
        formId: "artifact-block",
        title: "Artifact Block",
        fields: [{ id: "name", type: "text", label: "Name", required: true }],
      });
      const formSnapshot = await nextMatching(client, (message) => message.type === "snapshot" && message.viewModel.form?.formId === "artifact-block");
      assert.equal(formSnapshot.viewModel.artifactExplorer.open, false);
      client.send({ type: "form.fieldUpdate", fieldId: "name", value: "Ada" });
      await nextMatching(client, (message) => message.type === "snapshot" && message.viewModel.form?.values?.name === "Ada");
      client.send({ type: "form.submit" });
      await inputPromise;

      client.send({ type: "artifactExplorer.open" });
      const reopened = await nextMatching(
        client,
        (message) => message.type === "snapshot" && message.viewModel.artifactExplorer?.open === true,
      );
      assert.equal(reopened.viewModel.artifactExplorer.scopeKey, scopeKey);
      assert.equal(reopened.viewModel.artifactExplorer.runId, "pub-1");

      const reconnect = await connectWebSocket(server.url);
      try {
        const recovered = await reconnect.nextMessage();
        assert.equal(recovered.type, "snapshot");
        assert.equal(recovered.viewModel.artifactExplorer.available, true);
        assert.equal(recovered.viewModel.artifactExplorer.open, true);
        assert.equal(recovered.viewModel.artifactExplorer.scopeKey, scopeKey);
        assert.equal(recovered.viewModel.artifactExplorer.runId, "pub-1");
      } finally {
        reconnect.close();
      }
    } finally {
      client.close();
      session.destroy();
      setFlowExecutionState(null, null);
    }
  });

  it("restores Artifact Explorer availability from existing scope artifacts on startup", async (t) => {
    setFlowExecutionState(null, null);
    let ready;
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const scopeKey = "ag-116-existing-artifacts";
    const items = [
      catalogItem(scopeKey, { id: "design", kind: "markdown", relativePath: "design.md", runId: "old-run" }),
      catalogItem(scopeKey, { id: "design-json", kind: "json", relativePath: ".artifacts/design.json", runId: "old-run" }),
    ];
    const session = createWebInteractiveSession(createOptions({
      scopeKey,
      jiraIssueKey: "AG-116",
    }), {
      noOpen: true,
      onServerReady: ready,
      getArtifactCatalog: (input) => manualCatalog(input?.scopeKey ?? scopeKey, items),
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      const restored = await nextMatching(
        client,
        (message) => message.type === "snapshot" && message.viewModel.artifactExplorer?.available === true,
      );
      assert.equal(restored.viewModel.artifactExplorer.scopeKey, scopeKey);
      assert.equal(restored.viewModel.artifactExplorer.runId, null);
      assert.equal(restored.viewModel.artifactExplorer.open, false);
      assert.equal(restored.viewModel.artifactExplorer.artifactCount, 1);
      assert.equal(restored.viewModel.artifactExplorer.label, "Artifacts available");
    } finally {
      client.close();
      session.destroy();
      setFlowExecutionState(null, null);
    }
  });

  it("keeps nested flow artifacts visible in the completed-run Artifact Explorer", async (t) => {
    setFlowExecutionState(null, null);
    let ready;
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const scopeKey = "ag-116-nested-artifacts";
    const items = [
      catalogItem(scopeKey, { id: "project-guidance", kind: "markdown", relativePath: "project-guidance-plan.md", runId: "top-run" }),
      catalogItem(scopeKey, { id: "design", kind: "markdown", relativePath: "design.md", runId: "nested-plan-run" }),
      catalogItem(scopeKey, { id: "design-json", kind: "json", relativePath: ".artifacts/design.json", runId: "nested-plan-run" }),
      catalogItem(scopeKey, { id: "old-design", kind: "markdown", relativePath: "old-design.md", runId: "old-run" }),
    ];
    const session = createWebInteractiveSession(createOptions({
      scopeKey,
      jiraIssueKey: "AG-116",
      onRun: async () => {
        setFlowExecutionState("plan", {
          runId: "top-run",
          publicationRunId: "publication-run",
          flowKind: "auto-common-guided-flow",
          flowVersion: 1,
          terminated: true,
          terminationOutcome: "success",
          phases: [
            {
              id: "plan",
              status: "done",
              repeatVars: {},
              steps: [
                {
                  id: "run_plan_flow",
                  status: "done",
                  publishedArtifacts: [publishedArtifact("design", "nested-plan-run")],
                },
              ],
            },
          ],
        });
      },
    }), {
      noOpen: true,
      onServerReady: ready,
      getArtifactCatalog: (input) => manualCatalog(input?.scopeKey ?? scopeKey, items),
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      await client.nextMessage();
      client.send({ type: "run.openConfirm", flowId: "plan" });
      await nextMatching(client, (message) => message.type === "snapshot" && message.viewModel.confirmation?.kind === "run");
      client.send({ type: "confirm.accept", action: "restart" });
      const completed = await nextMatching(
        client,
        (message) => message.type === "snapshot" && message.viewModel.artifactExplorer?.available === true,
      );
      assert.equal(completed.viewModel.artifactExplorer.runId, "top-run");
      assert.deepEqual(completed.viewModel.artifactExplorer.runIds, ["top-run", "nested-plan-run"]);
      assert.equal(completed.viewModel.artifactExplorer.artifactCount, 2);
    } finally {
      client.close();
      session.destroy();
      setFlowExecutionState(null, null);
    }
  });

  it("offers Artifact Explorer after failed runs when artifacts are available", async (t) => {
    setFlowExecutionState(null, null);
    let ready;
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const scopeKey = "ag-116-failed";
    const items = [catalogItem(scopeKey, { id: "failed-item", kind: "markdown", relativePath: "failed.md", runId: "run-failed" })];
    const session = createWebInteractiveSession(createOptions({
      scopeKey,
      jiraIssueKey: "AG-116",
      onRun: async () => {
        setFlowExecutionState("plan", {
          runId: "run-failed",
          flowKind: "test",
          flowVersion: 1,
          terminated: true,
          terminationReason: "executor_error",
          phases: [],
        });
        throw new Error("run failed");
      },
    }), {
      noOpen: true,
      onServerReady: ready,
      getArtifactCatalog: (input) => manualCatalog(input?.scopeKey ?? scopeKey, items),
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      await client.nextMessage();
      client.send({ type: "run.openConfirm", flowId: "plan" });
      await nextMatching(client, (message) => message.type === "snapshot" && message.viewModel.confirmation?.kind === "run");
      client.send({ type: "confirm.accept", action: "restart" });
      const failed = await nextMatching(
        client,
        (message) => message.type === "snapshot" && message.viewModel.artifactExplorer?.status === "failed",
      );
      assert.equal(failed.viewModel.artifactExplorer.available, true);
      assert.equal(failed.viewModel.artifactExplorer.open, true);
      assert.equal(failed.viewModel.artifactExplorer.scopeKey, scopeKey);
      assert.equal(failed.viewModel.artifactExplorer.runId, "run-failed");
      assert.equal(failed.viewModel.artifactExplorer.artifactCount, 1);
      assert.match(failed.viewModel.artifactExplorer.label, /failed/i);
    } finally {
      client.close();
      session.destroy();
      setFlowExecutionState(null, null);
    }
  });

  it("cancels pending input deterministically", async (t) => {
    let ready;
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    const session = createWebInteractiveSession(createOptions(), {
      noOpen: true,
      onServerReady: (server) => ready(server),
    });
    session.mount();
    const server = await Promise.race([
      readyPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!server) {
      t.skip("local TCP listeners are not permitted in this sandbox");
      session.destroy();
      return;
    }
    const client = await connectWebSocket(server.url);
    try {
      await client.nextMessage();
      const inputPromise = session.requestUserInput({
        formId: "demo",
        title: "Demo",
        fields: [{ id: "name", type: "text", label: "Name", required: true }],
      });
      const requested = await client.nextMessage();
      client.send({ type: "form.cancel" });
      await assert.rejects(inputPromise, /User cancelled form 'demo'/);
      const interrupted = await client.nextMessage();
      assert.equal(interrupted.type, "snapshot");
      assert.equal(interrupted.viewModel.form, null);
      client.send({ type: "form.cancel" });
      const stale = await client.nextMessage();
      assert.equal(stale.type, "error");
      assert.match(stale.message, /No form is active/);
      client.send({ type: "run.openConfirm", flowId: "missing", actionId: "bad-run" });
      const invalid = await client.nextMessage();
      assert.equal(invalid.type, "error");
      assert.equal(invalid.actionId, "bad-run");
      assert.match(invalid.message, /Unknown visible flow/);
    } finally {
      client.close();
      session.destroy();
    }
  });

  it("closes startup server if the session is destroyed before opener resolves", async (t) => {
    let resolveOpen;
    let serverReady = false;
    const openPromise = new Promise((resolve) => {
      resolveOpen = resolve;
    });
    const session = createWebInteractiveSession(createOptions(), {
      noOpen: false,
      openBrowser: async () => {
        await openPromise;
      },
      onServerReady: () => {
        serverReady = true;
      },
    });
    session.mount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    session.destroy();
    resolveOpen();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(serverReady, false);
  });
});
