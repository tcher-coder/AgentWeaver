import process from "node:process";
import { writeSync } from "node:fs";

import { FlowInterruptedError } from "../../errors.js";
import { listArtifactCatalog, type ArtifactCatalog } from "../../runtime/artifact-catalog.js";
import { createArtifactRegistry } from "../../runtime/artifact-registry.js";
import { InteractiveSessionController } from "../controller.js";
import type { InteractiveSession, InteractiveSessionOptions } from "../session.js";
import type { ClientAction, ServerEvent } from "./protocol.js";
import {
  startWebServer,
  type ArtifactCatalogRequest,
  type StartedWebServer,
  type WebServerAuthConfig,
  type WebServerOptions,
  type WebSocketClient,
} from "./server.js";

export type CreateWebInteractiveSessionOptions = {
  noOpen?: boolean;
  host?: string;
  auth?: WebServerAuthConfig;
  onServerReady?: (server: StartedWebServer) => void;
  printInfo?: (message: string) => void;
  openBrowser?: WebServerOptions["openBrowser"];
  getArtifactCatalog?: WebServerOptions["getArtifactCatalog"];
};

function actionId(action: ClientAction): string | undefined {
  return "actionId" in action ? action.actionId : undefined;
}

export function createWebInteractiveSession(
  options: InteractiveSessionOptions,
  webOptions: CreateWebInteractiveSessionOptions = {},
): InteractiveSession {
  const controller = new InteractiveSessionController(options);
  let server: StartedWebServer | null = null;
  let unsubscribe: (() => void) | null = null;
  let mounted = false;
  let shuttingDown = false;
  let activeScopeKey = options.scopeKey;

  const artifactCatalogProvider = webOptions.getArtifactCatalog ?? ((input?: ArtifactCatalogRequest) => {
    const explorerScopeKey = controller.getViewModel().artifactExplorer.scopeKey;
    const requestedScopeKey = input?.scopeKey;
    const scopeKey = requestedScopeKey && requestedScopeKey === explorerScopeKey ? requestedScopeKey : activeScopeKey;
    return listArtifactCatalog({
      scopeKey,
      artifactRegistry: createArtifactRegistry(),
    });
  });

  function snapshot(): ServerEvent {
    return { type: "snapshot", viewModel: controller.getViewModel() };
  }

  function sendError(client: WebSocketClient | null, message: string, id?: string): void {
    const event: ServerEvent = { type: "error", message, ...(id ? { actionId: id } : {}) };
    if (client) {
      client.send(event);
    } else {
      server?.broadcast(event);
    }
  }

  function candidateRunIds(): string[] {
    const executionState = controller.getCurrentFlowExecutionState();
    return [
      executionState?.publicationRunId ?? null,
      executionState?.runId ?? null,
    ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  }

  async function resolveArtifactExplorerRunMetadata(scopeKey: string): Promise<{ runId: string | null; artifactCount?: number }> {
    const candidates = candidateRunIds();
    const preferredRunId = candidates[0] ?? null;
    try {
      const catalog = await artifactCatalogProvider({ scopeKey, ...(preferredRunId ? { runId: preferredRunId } : {}) });
      if (!catalog || catalog.scopeKey !== scopeKey) {
        return { runId: preferredRunId };
      }
      if (candidates.length === 0) {
        return {
          runId: null,
          artifactCount: catalog.items.filter((item) => item.scopeKey === scopeKey).length,
        };
      }
      for (const candidate of candidates) {
        const artifactCount = catalog.items.filter((item) => item.scopeKey === scopeKey && item.runId === candidate).length;
        if (artifactCount > 0) {
          return { runId: candidate, artifactCount };
        }
      }
      return {
        runId: preferredRunId,
        artifactCount: catalog.items.filter((item) => item.scopeKey === scopeKey && item.runId === preferredRunId).length,
      };
    } catch {
      return { runId: preferredRunId };
    }
  }

  async function markArtifactExplorerForCompletedRun(status: "completed" | "failed"): Promise<void> {
    const scopeKey = activeScopeKey;
    const { runId, artifactCount } = await resolveArtifactExplorerRunMetadata(scopeKey);
    controller.setArtifactExplorerAvailability({
      scopeKey,
      runId,
      status,
      ...(artifactCount !== undefined ? { artifactCount } : {}),
      open: !controller.hasActiveInput(),
    });
  }

  async function dispatch(action: ClientAction, client: WebSocketClient): Promise<void> {
    let acceptedRunConfirmation = false;
    try {
      if (action.type === "flow.select") {
        if (action.key) {
          controller.selectFlowKey(action.key);
        } else {
          controller.selectFlowIndex(action.index ?? 0);
        }
        return;
      }
      if (action.type === "folder.toggle") {
        controller.toggleFolderKey(action.key);
        return;
      }
      if (action.type === "run.openConfirm") {
        await controller.openRunConfirm(action.flowId, action.key);
        return;
      }
      if (action.type === "confirm.select") {
        controller.selectConfirmAction(action.action);
        return;
      }
      if (action.type === "confirm.accept") {
        const confirmation = controller.getViewModel().confirmation;
        const acceptedAction = action.action ?? confirmation?.selectedAction;
        acceptedRunConfirmation = confirmation?.kind === "run" && acceptedAction !== "cancel";
        if (action.action) {
          controller.selectConfirmAction(action.action);
        }
        await controller.acceptConfirmation();
        if (acceptedRunConfirmation) {
          await markArtifactExplorerForCompletedRun("completed");
        }
        return;
      }
      if (action.type === "confirm.cancel") {
        controller.cancelConfirmation();
        return;
      }
      if (action.type === "form.update") {
        controller.updateActiveFormValues(action.values);
        return;
      }
      if (action.type === "form.fieldUpdate") {
        controller.updateFormField(action.fieldId, action.value);
        return;
      }
      if (action.type === "form.submit") {
        controller.submitForm(action.values);
        return;
      }
      if (action.type === "form.cancel") {
        controller.cancelForm();
        return;
      }
      if (action.type === "flow.interrupt") {
        await controller.interruptCurrentFlow(action.flowId);
        return;
      }
      if (action.type === "interrupt.openConfirm") {
        controller.openInterruptConfirm();
        return;
      }
      if (action.type === "log.clear") {
        controller.clearLog();
        return;
      }
      if (action.type === "artifactExplorer.open") {
        controller.openArtifactExplorer();
        return;
      }
      if (action.type === "artifactExplorer.close") {
        controller.closeArtifactExplorer();
        return;
      }
      if (action.type === "help.toggle") {
        controller.showHelp(action.visible ?? !controller.getViewModel().helpVisible);
        return;
      }
      controller.scrollPane(action.pane, { ...(action.delta !== undefined ? { delta: action.delta } : {}), ...(action.offset !== undefined ? { offset: action.offset } : {}) });
    } catch (error) {
      if (acceptedRunConfirmation) {
        await markArtifactExplorerForCompletedRun("failed");
      }
      const message = (error as Error).message;
      controller.appendLog(`Web action failed: ${message}`);
      sendError(client, message, actionId(action));
    }
  }

  return {
    mount(): void {
      if (mounted) {
        return;
      }
      mounted = true;
      controller.mount();
      unsubscribe = controller.subscribe((event) => {
        if (event.type === "log") {
          server?.broadcast({ type: "log.append", appendedLines: event.appendedLines });
          return;
        }
        server?.broadcast(snapshot());
      });
      void startWebServer({
        ...(webOptions.noOpen !== undefined ? { noOpen: webOptions.noOpen } : {}),
        ...(webOptions.host !== undefined ? { host: webOptions.host } : {}),
        ...(webOptions.auth !== undefined ? { auth: webOptions.auth } : {}),
        printInfo: (message) => {
          webOptions.printInfo?.(message);
          controller.appendLog(message);
        },
        ...(webOptions.openBrowser ? { openBrowser: webOptions.openBrowser } : {}),
        getArtifactCatalog: (input) => artifactCatalogProvider(input) as ArtifactCatalog | Promise<ArtifactCatalog>,
        onClientAction: (action, client) => {
          void dispatch(action, client);
        },
        onClientConnected: (client) => {
          client.send(snapshot());
        },
        onExitRequested: () => {
          options.onExit();
        },
      }).then((started) => {
        if (shuttingDown) {
          void started.close().catch((error) => {
            process.stderr.write(`Failed to close Web UI server: ${(error as Error).message}\n`);
          });
          return;
        }
        server = started;
        webOptions.onServerReady?.(started);
      }).catch((error) => {
        const message = `Web UI startup failed: ${(error as Error).message}`;
        controller.appendLog(message);
        writeSync(process.stderr.fd, `${message}\n`);
        options.onExit();
      });
    },

    destroy(): void {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      controller.interruptActiveForm("Web UI session closed.");
      unsubscribe?.();
      unsubscribe = null;
      const closePromise = server?.close();
      server = null;
      if (closePromise) {
        void closePromise.catch((error) => {
          process.stderr.write(`Failed to close Web UI server: ${(error as Error).message}\n`);
        });
      }
      controller.destroy();
    },

    requestUserInput: (form) => controller.requestUserInput(form),
    setSummary: (markdown) => controller.setSummary(markdown),
    clearSummary: () => controller.clearSummary(),
    setScope: (scopeKey, jiraIssueKey, gitBranchName) => {
      activeScopeKey = scopeKey;
      controller.setScope(scopeKey, jiraIssueKey, gitBranchName);
    },
    appendLog: (text) => controller.appendLog(text),
    setFlowFailed: (flowId) => controller.setFlowFailed(flowId),
    interruptActiveForm: (message = "Flow interrupted by user.") => {
      controller.interruptActiveForm(message);
      if (message) {
        controller.appendLog(new FlowInterruptedError(message).message);
      }
    },
  };
}
