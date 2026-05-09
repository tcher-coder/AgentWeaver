import process from "node:process";
import { writeSync } from "node:fs";

import { FlowInterruptedError } from "../../errors.js";
import type { FlowExecutionState } from "../../pipeline/spec-types.js";
import { listArtifactCatalog, type ArtifactCatalog } from "../../runtime/artifact-catalog.js";
import { createArtifactRegistry } from "../../runtime/artifact-registry.js";
import { loadAgentWeaverSettings, updateWebUiSettings } from "../../runtime/settings.js";
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
  let artifactRestoreGeneration = 0;
  let webUiSettings = loadAgentWeaverSettings().webUi;

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
    return { type: "snapshot", viewModel: controller.getViewModel(), settings: webUiSettings };
  }

  function sendError(client: WebSocketClient | null, message: string, id?: string): void {
    const event: ServerEvent = { type: "error", message, ...(id ? { actionId: id } : {}) };
    if (client) {
      client.send(event);
    } else {
      server?.broadcast(event);
    }
  }

  function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return values.filter((value, index, allValues): value is string => (
      typeof value === "string" && value.length > 0 && allValues.indexOf(value) === index
    ));
  }

  function collectPublishedArtifactRunIds(executionState: FlowExecutionState | null): string[] {
    const runIds: string[] = [];
    for (const phase of executionState?.phases ?? []) {
      for (const step of phase.steps) {
        for (const artifact of step.publishedArtifacts ?? []) {
          const runId = artifact.manifest?.run_id;
          if (runId) {
            runIds.push(runId);
          }
        }
      }
    }
    return uniqueStrings(runIds);
  }

  function candidateRunIds(): string[] {
    const executionState = controller.getCurrentFlowExecutionState();
    return uniqueStrings([
      executionState?.runId ?? null,
      executionState?.publicationRunId ?? null,
      ...collectPublishedArtifactRunIds(executionState),
    ]);
  }

  async function resolveArtifactExplorerRunMetadata(scopeKey: string): Promise<{ runId: string | null; runIds?: string[]; artifactCount?: number }> {
    const candidates = candidateRunIds();
    const preferredRunId = candidates[0] ?? null;
    try {
      const catalog = await artifactCatalogProvider({
        scopeKey,
      });
      if (!catalog || catalog.scopeKey !== scopeKey) {
        return { runId: preferredRunId };
      }
      const markdownArtifactCount = catalog.items.filter((item) => item.scopeKey === scopeKey && item.kind === "markdown").length;
      if (candidates.length === 0) {
        return {
          runId: null,
          artifactCount: markdownArtifactCount,
        };
      }
      const matchingRunIds = candidates.filter((candidate) => (
        catalog.items.some((item) => item.scopeKey === scopeKey && item.runId === candidate && item.kind === "markdown")
      ));
      if (matchingRunIds.length > 0) {
        return {
          runId: matchingRunIds[0] ?? preferredRunId,
          ...(matchingRunIds.length > 1 ? { runIds: matchingRunIds } : {}),
          artifactCount: markdownArtifactCount,
        };
      }
      if (markdownArtifactCount > 0) {
        return {
          runId: null,
          artifactCount: markdownArtifactCount,
        };
      }
      return {
        runId: preferredRunId,
        artifactCount: markdownArtifactCount,
      };
    } catch {
      return { runId: preferredRunId };
    }
  }

  async function markArtifactExplorerForCompletedRun(status: "completed" | "failed"): Promise<void> {
    artifactRestoreGeneration += 1;
    const scopeKey = activeScopeKey;
    const { runId, runIds, artifactCount } = await resolveArtifactExplorerRunMetadata(scopeKey);
    controller.setArtifactExplorerAvailability({
      scopeKey,
      runId,
      ...(runIds ? { runIds } : {}),
      status,
      ...(artifactCount !== undefined ? { artifactCount } : {}),
      open: !controller.hasActiveInput(),
    });
    await controller.refreshGitWorkspace();
  }

  async function restoreArtifactExplorerFromScope(scopeKey: string): Promise<void> {
    const generation = ++artifactRestoreGeneration;
    try {
      const catalog = await artifactCatalogProvider({ scopeKey });
      if (generation !== artifactRestoreGeneration || shuttingDown || activeScopeKey !== scopeKey) {
        return;
      }
      if (!catalog || catalog.scopeKey !== scopeKey) {
        controller.setArtifactExplorerUnavailable();
        return;
      }
      const artifactCount = catalog.items.filter((item) => item.scopeKey === scopeKey && item.kind === "markdown").length;
      if (artifactCount === 0) {
        controller.setArtifactExplorerUnavailable("No markdown artifacts were found for the current scope.");
        return;
      }
      controller.setArtifactExplorerAvailability({
        scopeKey,
        runId: null,
        status: "completed",
        artifactCount,
        open: false,
        label: "Artifacts available",
        message: "Markdown artifacts from this scope are available for review.",
      });
    } catch {
      if (generation === artifactRestoreGeneration && !shuttingDown && activeScopeKey === scopeKey) {
        controller.setArtifactExplorerUnavailable("Artifact Explorer could not inspect the current scope.");
      }
    }
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
      if (action.type === "autoFlow.selectPreset") {
        controller.selectAutoFlowPreset(action.preset);
        return;
      }
      if (action.type === "autoFlow.loadConfig") {
        controller.loadAutoFlowConfig(action.name, action.flowId);
        return;
      }
      if (action.type === "autoFlow.save") {
        controller.saveAutoFlowConfig(action.flowId, action.name, action.location);
        return;
      }
      if (action.type === "autoFlow.reset") {
        controller.resetAutoFlowConfig(action.flowId);
        return;
      }
      if (action.type === "autoFlow.toggleBlock") {
        controller.toggleAutoFlowBlock(action.flowId, action.blockId, action.enabled, action.slotId);
        return;
      }
      if (action.type === "autoFlow.updateParam") {
        controller.updateAutoFlowParameter(action.flowId, action.blockId, action.paramName, action.value, action.slotId);
        return;
      }
      if (action.type === "autoFlow.insertBlock") {
        controller.insertAutoFlowBlock(action.flowId, action.slotId, action.blockId);
        return;
      }
      if (action.type === "autoFlow.removeBlock") {
        controller.removeAutoFlowBlock(action.flowId, action.slotId, action.blockId);
        return;
      }
      if (action.type === "git.refresh") {
        await controller.refreshGitWorkspace();
        return;
      }
      if (action.type === "git.createBranch") {
        await controller.createGitBranch(action.branchName);
        return;
      }
      if (action.type === "git.checkout") {
        await controller.checkoutGitBranch(action.branchName);
        return;
      }
      if (action.type === "git.fetch") {
        await controller.fetchGitWorkspace();
        return;
      }
      if (action.type === "git.pullFfOnly") {
        await controller.pullGitWorkspaceFfOnly();
        return;
      }
      if (action.type === "git.stage") {
        await controller.stageGitPaths(action.paths);
        return;
      }
      if (action.type === "git.unstage") {
        await controller.unstageGitPaths(action.paths);
        return;
      }
      if (action.type === "git.updateCommitMessage") {
        controller.updateGitCommitMessage(action.message);
        return;
      }
      if (action.type === "git.commit") {
        await controller.commitGitChanges(action.paths, action.message);
        return;
      }
      if (action.type === "git.push") {
        await controller.pushGitWorkspace();
        return;
      }
      if (action.type === "settings.update") {
        webUiSettings = updateWebUiSettings(action.settings);
        server?.broadcast(snapshot());
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
      void restoreArtifactExplorerFromScope(activeScopeKey);
      unsubscribe = controller.subscribe((event) => {
        if (event.type === "log") {
          server?.broadcast({ type: "log.append", appendedLines: event.appendedLines });
          return;
        }
        server?.broadcast(snapshot());
      });
      void controller.refreshGitWorkspace().catch((error) => {
        controller.appendLog(`Git workspace refresh failed: ${(error as Error).message}`);
      }).then(() => startWebServer({
        ...(webOptions.noOpen !== undefined ? { noOpen: webOptions.noOpen } : {}),
        ...(webOptions.host !== undefined ? { host: webOptions.host } : {}),
        ...(webOptions.auth !== undefined ? { auth: webOptions.auth } : {}),
        printInfo: (message) => {
          webOptions.printInfo?.(message);
          controller.appendLog(message);
        },
        ...(webOptions.openBrowser ? { openBrowser: webOptions.openBrowser } : {}),
        getArtifactCatalog: (input) => artifactCatalogProvider(input) as ArtifactCatalog | Promise<ArtifactCatalog>,
        gitService: controller.getGitService(),
        getGitWorkspaceSnapshot: () => controller.getGitWorkspaceSnapshot(),
        onClientAction: (action, client) => {
          void dispatch(action, client);
        },
        onClientConnected: (client) => {
          client.send(snapshot());
        },
        onExitRequested: () => {
          options.onExit();
        },
      })).then((started) => {
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
      controller.setArtifactExplorerUnavailable();
      void restoreArtifactExplorerFromScope(scopeKey);
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
