import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BrowserWindow, app, dialog, ipcMain, net, protocol, safeStorage, screen, shell, utilityProcess } from "electron";

import { waitForControllerReady } from "./controller-readiness";
import {
  buildManagedControllerEnv,
  clearRuntimeChildOnExit,
  sendUtilityProcessSignal,
  waitForUtilityProcessExit
} from "./controller-process";
import { createLogger } from "./logger";
import { isAllowedMainWindowNavigation, shouldOpenNavigationExternally } from "./navigation";
import { createProviderSecretStore, type ProviderSecretStorageSnapshot, type ProviderType } from "./provider-secret-store";
import { waitForRendererReady } from "./renderer-readiness";
import { createDesktopUpdater, type UpdateStatePayload } from "./updater";

export const desktopAppName = "@monet/desktop";

interface ControllerRuntime {
  readonly apiBase: string;
  readonly bearerToken: string | null;
  readonly managed: boolean;
  readonly child?: Electron.UtilityProcess;
}

interface ControllerStatePayload {
  readonly state: "starting" | "ready" | "restarting" | "stopped" | "failed";
  readonly apiBase?: string;
  readonly bearerToken?: string | null;
  readonly message?: string;
  readonly restartAvailable?: boolean;
}

interface ControllerReadyMessage {
  readonly type: "controller-ready";
  readonly host: string;
  readonly port: number;
}

interface ProviderSecretMutationResult {
  readonly controllerSync: {
    readonly applied: boolean;
    readonly reason?: string;
  };
  readonly storage: ProviderSecretStorageSnapshot;
}

interface OpenPathResult {
  readonly opened: boolean;
  readonly path?: string;
  readonly error?: string;
  readonly errorDetails?: OpenPathErrorDetails;
}

interface OpenPathErrorDetails {
  readonly workspacePath?: string;
  readonly nativeOpenFailureReason?: string;
}

interface OpenWorkspaceDirectoryResponse {
  readonly ok: true;
  readonly workspacePath: string;
}

type DesktopShortcutAction = "new-session" | "open-settings";

interface WindowStateSnapshot {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
  readonly isMaximized: boolean;
}

const controllerHost = "127.0.0.1";
const desktopRendererScheme = "app";
const desktopRendererHost = "monet";
const desktopRendererOrigin = `${desktopRendererScheme}://${desktopRendererHost}`;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const logger = createLogger("desktop", {
  component: "main"
});
const defaultWindowState = {
  width: 1440,
  height: 960,
  minWidth: 1080,
  minHeight: 720
} as const;
const userDataPath = app.getPath("userData");
const sqliteDatabasePath = path.join(userDataPath, "sqlite", "monet.db");
const windowStateFilePath = path.join(userDataPath, "window-state.json");

let mainWindow: BrowserWindow | null = null;
let controllerRuntime: ControllerRuntime | null = null;
let isAppQuitting = false;
let shutdownPromise: Promise<void> | null = null;
let providerSecretStore:
  | ReturnType<typeof createProviderSecretStore>
  | null = null;
const intentionallyStoppedControllerPids = new Set<number>();
let pendingWindowStateSave: NodeJS.Timeout | null = null;
const desktopUpdater = createDesktopUpdater({
  logger: logger.child({
    component: "updater"
  }),
  onStateChange(payload) {
    broadcastUpdateState(payload);
  },
  onBeforeInstall() {
    return gracefulShutdown("update");
  }
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: desktopRendererScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

if (!gotSingleInstanceLock) {
  logger.warn("desktop.single_instance_denied");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch(handleBootstrapError);
}

app.on("before-quit", (event) => {
  if (isAppQuitting) {
    return;
  }

  event.preventDefault();
  void gracefulShutdown("user").finally(() => {
    app.exit(0);
  });
});

app.on("window-all-closed", () => {
  logger.info("desktop.window_all_closed", {
    platform: process.platform
  });

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  logger.info("desktop.activate", {
    hasWindow: mainWindow != null,
    hasControllerRuntime: controllerRuntime != null
  });

  if (mainWindow || !controllerRuntime) {
    return;
  }

  mainWindow = await createMainWindow(controllerRuntime);
});

ipcMain.handle("monet:get-runtime-info", () => {
  logger.debug("desktop.runtime_info_requested", {
    hasRuntime: controllerRuntime != null
  });

  return {
    apiBase: controllerRuntime?.apiBase,
    bearerToken: controllerRuntime?.bearerToken
  };
});

ipcMain.on("monet:get-runtime-info-sync", (event) => {
  event.returnValue = {
    apiBase: controllerRuntime?.apiBase,
    bearerToken: controllerRuntime?.bearerToken
  };
});

ipcMain.handle("monet:restart-controller", async () => {
  logger.info("desktop.controller_restart_requested", {
    usingExternalController: Boolean(process.env.MONET_DESKTOP_CONTROLLER_URL?.trim())
  });

  if (process.env.MONET_DESKTOP_CONTROLLER_URL?.trim()) {
    broadcastControllerState({
      state: "ready",
      message: "This desktop session is connected to an external controller. Restart it outside the app.",
      restartAvailable: false
    });

    return {
      restarted: false,
      reason: "external-controller"
    };
  }

  try {
    broadcastControllerState({
      state: "restarting",
      message: "Restarting the local Monet controller…",
      restartAvailable: true
    });
    controllerRuntime = await startManagedController("restart");
    broadcastControllerState({
      state: "ready",
      apiBase: controllerRuntime.apiBase,
      bearerToken: controllerRuntime.bearerToken,
      message: "Local controller ready.",
      restartAvailable: controllerRuntime.managed
    });

    logger.info("desktop.controller_restart_completed", {
      apiBase: controllerRuntime.apiBase
    });

    return {
      restarted: true,
      apiBase: controllerRuntime.apiBase
    };
  } catch (error) {
    logger.error("desktop.controller_restart_failed", error);
    broadcastControllerState({
      state: "failed",
      message: error instanceof Error ? error.message : "The local controller could not restart.",
      restartAvailable: true
    });
    throw error;
  }
});

ipcMain.handle("monet:get-provider-secret-storage", () => {
  return getProviderSecretStore().getSnapshot() satisfies ProviderSecretStorageSnapshot;
});

ipcMain.handle("monet:get-update-state", () => {
  return desktopUpdater.getState() satisfies UpdateStatePayload;
});

ipcMain.handle("monet:check-for-updates", async () => {
  return await desktopUpdater.checkForUpdates();
});

ipcMain.handle("monet:install-update", async () => {
  await desktopUpdater.installUpdate();

  return {
    started: true
  };
});

ipcMain.handle("monet:get-app-paths", () => {
  return {
    userDataPath
  };
});

ipcMain.handle("monet:pick-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("monet:open-path", async (_event, payload: { path: string }) => {
  const targetPath = payload.path.trim();

  if (!targetPath) {
    return {
      opened: false,
      error: "Path is required."
    };
  }

  const error = await shell.openPath(targetPath);

  return {
    opened: error.length === 0,
    ...(error.length > 0 ? { error } : {})
  };
});

ipcMain.handle("monet:open-workspace-directory", async (_event, payload: { sessionId?: string } | null) => {
  const sessionId = payload?.sessionId?.trim() ?? "";

  if (!sessionId) {
    return {
      opened: false,
      error: "Session ID is required."
    } satisfies OpenPathResult;
  }

  const workspaceResult = await ensureWorkspaceDirectoryForSession(sessionId);

  if (!workspaceResult.ok) {
    return {
      opened: false,
      ...(workspaceResult.workspacePath ? { path: workspaceResult.workspacePath } : {}),
      error: workspaceResult.error
    } satisfies OpenPathResult;
  }

  const workspacePath = workspaceResult.workspacePath;

  try {
    await mkdir(workspacePath, {
      recursive: true,
      mode: 0o700
    });
  } catch (error) {
    return {
      opened: false,
      path: workspacePath,
      error: error instanceof Error ? error.message : "Could not create the workspace directory."
    } satisfies OpenPathResult;
  }

  const error = await shell.openPath(workspacePath);

  if (error.length > 0) {
    return {
      opened: false,
      path: workspacePath,
      error: `Could not open the workspace folder: ${error}`,
      errorDetails: {
        workspacePath,
        nativeOpenFailureReason: error
      }
    } satisfies OpenPathResult;
  }

  return {
    opened: true,
    path: workspacePath
  } satisfies OpenPathResult;
});

ipcMain.handle(
  "monet:save-provider-secret",
  async (_event, payload: { providerType: ProviderType; secret: string }) => {
    getProviderSecretStore().saveSecret(payload.providerType, payload.secret);

    return {
      storage: getProviderSecretStore().getSnapshot(),
      controllerSync: await applyProviderCredentialToController(payload.providerType, payload.secret)
    } satisfies ProviderSecretMutationResult;
  }
);

ipcMain.handle("monet:clear-provider-secret", async (_event, payload: { providerType: ProviderType }) => {
  getProviderSecretStore().clearSecret(payload.providerType);

  return {
    storage: getProviderSecretStore().getSnapshot(),
    controllerSync: await applyProviderCredentialToController(payload.providerType, null)
  } satisfies ProviderSecretMutationResult;
});

async function bootstrap() {
  logger.info("desktop.bootstrap_started");
  await registerDesktopRendererProtocol();
  controllerRuntime = await resolveControllerRuntime();
  await syncSavedProviderSecretsToController(controllerRuntime);
  mainWindow = await createMainWindow(controllerRuntime);
  broadcastUpdateState(desktopUpdater.getState());
  desktopUpdater.start();
  logger.info("desktop.bootstrap_completed", {
    managedController: controllerRuntime.managed
  });
}

async function createMainWindow(runtime: ControllerRuntime) {
  const preloadPath = path.join(__dirname, "preload.js");
  await assertFileExists(preloadPath, "desktop preload bundle");
  const windowState = await loadWindowState();

  const window = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(windowState.x !== undefined ? { x: windowState.x } : {}),
    ...(windowState.y !== undefined ? { y: windowState.y } : {}),
    minWidth: defaultWindowState.minWidth,
    minHeight: defaultWindowState.minHeight,
    show: false,
    backgroundColor: "#0b1020",
    title: "Monet",
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: buildPreloadArguments(runtime)
    }
  });

  mainWindow = window;

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenNavigationExternally(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedMainWindowNavigation(url, process.env.MONET_DESKTOP_RENDERER_URL)) {
      return;
    }

    event.preventDefault();

    if (shouldOpenNavigationExternally(url)) {
      void shell.openExternal(url);
    }
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (!matchesShortcut(input, "n") && !matchesShortcut(input, ",")) {
      return;
    }

    event.preventDefault();

    if (matchesShortcut(input, "n")) {
      dispatchDesktopShortcut(window, "new-session");
      return;
    }

    if (matchesShortcut(input, ",")) {
      dispatchDesktopShortcut(window, "open-settings");
    }
  });

  window.once("ready-to-show", () => {
    if (windowState.isMaximized) {
      window.maximize();
    }

    window.show();
  });
  await loadLoadingScreen(window);
  logger.info("desktop.loading_screen_ready");

  if (!window.isDestroyed() && !window.isVisible()) {
    window.show();
  }

  await loadRenderer(window);
  logger.info("desktop.renderer_loaded", {
    managedController: runtime.managed
  });
  broadcastControllerState({
    state: "ready",
    apiBase: runtime.apiBase,
    bearerToken: runtime.bearerToken,
    message: runtime.managed ? "Local controller ready." : "Connected to the configured controller endpoint.",
    restartAvailable: runtime.managed
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.on("resize", () => {
    scheduleWindowStateSave(window);
  });

  window.on("move", () => {
    scheduleWindowStateSave(window);
  });

  window.on("close", () => {
    void saveWindowState(window);
  });

  return window;
}

async function loadLoadingScreen(window: BrowserWindow) {
  await window.loadURL(createLoadingScreenUrl());
}

async function loadRenderer(window: BrowserWindow) {
  const rendererUrl = process.env.MONET_DESKTOP_RENDERER_URL?.trim();

  if (rendererUrl) {
    logger.info("desktop.renderer_wait_started", {
      mode: "dev",
      rendererUrl
    });
    await waitForRendererReady(rendererUrl, {
      onReady(attempt, readyRendererUrl) {
        logger.info("desktop.renderer_ready", {
          attempt,
          rendererUrl: readyRendererUrl
        });
      }
    });
    await window.loadURL(rendererUrl);
    return;
  }

  const rendererEntry = path.join(getRendererOutputDirectory(), "index.html");
  await assertFileExists(rendererEntry, "exported web-ui entrypoint");
  logger.info("desktop.renderer_wait_started", {
    mode: "prod",
    rendererEntry,
    rendererUrl: createDesktopRendererUrl("/")
  });
  await window.loadURL(createDesktopRendererUrl("/"));
}

async function registerDesktopRendererProtocol() {
  if (process.env.MONET_DESKTOP_RENDERER_URL?.trim()) {
    return;
  }

  const rendererOutputDirectory = getRendererOutputDirectory();
  await access(rendererOutputDirectory, fsConstants.R_OK);

  if (protocol.isProtocolHandled(desktopRendererScheme)) {
    return;
  }

  protocol.handle(desktopRendererScheme, async (request) => {
    const filePath = await resolveDesktopRendererAssetPath(request.url, rendererOutputDirectory);
    return net.fetch(pathToFileURL(filePath).toString());
  });

  logger.info("desktop.renderer_protocol_registered", {
    origin: desktopRendererOrigin,
    rendererOutputDirectory
  });
}

function createDesktopRendererUrl(pathname: string) {
  return new URL(pathname, `${desktopRendererOrigin}/`).toString();
}

function getRendererOutputDirectory() {
  return app.isPackaged ? path.join(app.getAppPath(), "web-ui", "out") : path.resolve(__dirname, "../../web-ui/out");
}

function getControllerEntrypointPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), "controller", "dist", "electron-entry.js")
    : path.resolve(__dirname, "../../controller/dist/electron-entry.js");
}

function getMigrationsDirectory() {
  return app.isPackaged
    ? path.join(app.getAppPath(), "database", "migrations")
    : path.resolve(__dirname, "../../../packages/database/migrations");
}

async function resolveDesktopRendererAssetPath(requestUrl: string, rendererOutputDirectory: string) {
  const request = new URL(requestUrl);

  if (request.hostname !== desktopRendererHost) {
    throw new Error(`Unsupported renderer host: ${request.hostname}`);
  }

  const decodedPathname = decodeURIComponent(request.pathname);
  const relativePath = decodedPathname.replace(/^\/+/, "");
  const normalizedTarget = path.normalize(relativePath);

  if (normalizedTarget.startsWith("..") || path.isAbsolute(normalizedTarget)) {
    throw new Error(`Blocked renderer asset path outside export directory: ${decodedPathname}`);
  }

  const candidates = buildRendererAssetCandidates(normalizedTarget, rendererOutputDirectory);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Renderer asset not found for ${requestUrl}`);
}

function buildRendererAssetCandidates(normalizedTarget: string, rendererOutputDirectory: string) {
  if (!normalizedTarget || normalizedTarget === ".") {
    return [path.join(rendererOutputDirectory, "index.html")];
  }

  const directCandidate = path.join(rendererOutputDirectory, normalizedTarget);
  const nestedIndexCandidate = path.join(rendererOutputDirectory, normalizedTarget, "index.html");

  if (path.extname(normalizedTarget)) {
    return [directCandidate];
  }

  return [directCandidate, nestedIndexCandidate, path.join(rendererOutputDirectory, "index.html")];
}

async function fileExists(filePath: string) {
  try {
    const metadata = await stat(filePath);
    return metadata.isFile();
  } catch {
    return false;
  }
}

function createLoadingScreenUrl() {
  const html = String.raw`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Monet</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(59, 130, 246, 0.24), transparent 34%),
          radial-gradient(circle at bottom, rgba(34, 197, 94, 0.18), transparent 30%),
          linear-gradient(180deg, #0f172a 0%, #020617 100%);
        color: rgba(248, 250, 252, 0.96);
      }

      main {
        width: min(420px, calc(100vw - 48px));
        padding: 32px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 24px;
        background: rgba(15, 23, 42, 0.72);
        box-shadow: 0 24px 80px rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(18px);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(30, 41, 59, 0.72);
        color: rgba(191, 219, 254, 0.96);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .badge::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(135deg, #38bdf8, #22c55e);
        box-shadow: 0 0 18px rgba(56, 189, 248, 0.65);
      }

      h1 {
        margin: 20px 0 10px;
        font-size: 32px;
        line-height: 1.1;
      }

      p {
        margin: 0;
        color: rgba(203, 213, 225, 0.84);
        font-size: 15px;
        line-height: 1.6;
      }

      .footer {
        margin-top: 24px;
        display: flex;
        align-items: center;
        gap: 14px;
        color: rgba(148, 163, 184, 0.92);
        font-size: 13px;
      }

      .spinner {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 2px solid rgba(148, 163, 184, 0.28);
        border-top-color: #38bdf8;
        border-right-color: #22c55e;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="badge">Desktop shell</div>
      <h1>Launching Monet…</h1>
      <p>Waiting for the local services and renderer to finish starting.</p>
      <div class="footer">
        <div class="spinner" aria-hidden="true"></div>
        <span>This window will switch automatically when ready.</span>
      </div>
    </main>
  </body>
</html>`;

  return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

async function resolveControllerRuntime(): Promise<ControllerRuntime> {
  const externalApiBase = process.env.MONET_DESKTOP_CONTROLLER_URL?.trim();

  if (externalApiBase) {
    logger.info("desktop.controller_runtime_resolved", {
      mode: "external",
      apiBase: trimTrailingSlash(externalApiBase)
    });

    return {
      apiBase: trimTrailingSlash(externalApiBase),
      bearerToken: process.env.MONET_DESKTOP_CONTROLLER_BEARER_TOKEN?.trim() || null,
      managed: false
    };
  }

  return startManagedController();
}

async function startManagedController(mode: "startup" | "restart" = "startup"): Promise<ControllerRuntime> {
  if (controllerRuntime?.child) {
    logger.warn("desktop.controller_existing_child_replaced");
    await stopManagedController({
      reason: mode === "restart" ? "restart" : "replace"
    });
  }

  const controllerEntrypoint = getControllerEntrypointPath();
  await assertFileExists(controllerEntrypoint, "controller desktop entrypoint");

  const bearerToken = randomBytes(24).toString("hex");

  logger.info("desktop.controller_start_requested", {
    host: controllerHost
  });

  const child = utilityProcess.fork(controllerEntrypoint, [], {
    env: buildManagedControllerEnv({
      baseEnv: process.env,
      providerSecretEnv: buildProviderSecretEnv(process.env),
      host: controllerHost,
      port: "0",
      bearerToken,
      userDataPath,
      databasePath: sqliteDatabasePath,
      migrationsDirectory: getMigrationsDirectory()
    })
  });

  child.once("exit", () => {
    controllerRuntime = clearRuntimeChildOnExit(controllerRuntime, child);

    if (isAppQuitting) {
      logger.info("desktop.controller_exit_during_shutdown");
      return;
    }

    if (typeof child.pid === "number" && intentionallyStoppedControllerPids.delete(child.pid)) {
      logger.info("desktop.controller_exit_expected_for_restart");
      return;
    }

    logger.error("desktop.controller_exited_unexpectedly");
    broadcastControllerState({
      state: "stopped",
      message: "The local controller exited unexpectedly. Restart it to resume chat and settings requests.",
      restartAvailable: true
    });
    void dialog.showMessageBox({
      type: "error",
      title: "Local controller stopped",
      message: "The local Monet controller exited unexpectedly.",
      detail: "Restart the desktop app or use the preload restart hook once the renderer is wired to surface recovery actions."
    });
  });

  broadcastControllerState({
    state: mode === "restart" ? "restarting" : "starting",
    message: mode === "restart" ? "Restarting the local Monet controller…" : "Starting the local Monet controller…",
    restartAvailable: true
  });

  let port: number;
  let apiBase: string;

  try {
    const address = await waitForManagedControllerAddress(child);
    port = address.port;
    apiBase = `http://${controllerHost}:${port}`;

    await waitForControllerReady(apiBase, bearerToken, {
      onReady(attempt, healthUrl) {
        logger.info("desktop.controller_healthcheck_ready", {
          attempt,
          healthUrl
        });
      }
    });
  } catch (error) {
    await stopUtilityProcess(child, {
      markAsIntentional: true,
      reason: `${mode}-failed`
    });
    broadcastControllerState({
      state: "failed",
      message: error instanceof Error ? error.message : `The local controller failed to ${mode}.`,
      restartAvailable: true
    });
    throw error;
  }

  logger.info("desktop.controller_ready", {
    apiBase,
    port
  });

  return {
    apiBase,
    bearerToken,
    managed: true,
    child
  };
}

function waitForManagedControllerAddress(child: Electron.UtilityProcess) {
  return new Promise<ControllerReadyMessage>((resolve, reject) => {
    const handleMessage = (message: unknown) => {
      if (!isControllerReadyMessage(message)) {
        return;
      }

      cleanup();
      resolve(message);
    };
    const handleExit = () => {
      cleanup();
      reject(new Error("The local controller exited before reporting its bound port."));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for the local controller to report its bound port."));
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("message", handleMessage);
      child.removeListener("exit", handleExit);
    };

    child.on("message", handleMessage);
    child.once("exit", handleExit);
  });
}

function isControllerReadyMessage(message: unknown): message is ControllerReadyMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }

  const candidate = message as Partial<ControllerReadyMessage>;

  return (
    candidate.type === "controller-ready" &&
    (candidate.host === controllerHost || candidate.host === "localhost") &&
    Number.isInteger(candidate.port) &&
    typeof candidate.port === "number" &&
    candidate.port > 0 &&
    candidate.port <= 65535
  );
}

function buildPreloadArguments(runtime: ControllerRuntime) {
  return [`--monet-api-base=${runtime.apiBase}`, `--monet-controller-managed=${runtime.managed ? "true" : "false"}`];
}

function broadcastControllerState(payload: ControllerStatePayload) {
  mainWindow?.webContents.send("monet:controller-state", payload);
}

function broadcastUpdateState(payload: UpdateStatePayload) {
  mainWindow?.webContents.send("monet:update-state", payload);
}

function dispatchDesktopShortcut(window: BrowserWindow, action: DesktopShortcutAction) {
  window.webContents.send("monet:shortcut", {
    action
  });
}

async function loadWindowState(): Promise<WindowStateSnapshot> {
  try {
    const serialized = await readFile(windowStateFilePath, "utf8");
    const parsed = JSON.parse(serialized) as Partial<WindowStateSnapshot>;
    const width = clampWindowDimension(parsed.width, defaultWindowState.width, defaultWindowState.minWidth);
    const height = clampWindowDimension(parsed.height, defaultWindowState.height, defaultWindowState.minHeight);
    const normalized: WindowStateSnapshot = {
      width,
      height,
      isMaximized: parsed.isMaximized === true,
      ...(typeof parsed.x === "number" ? { x: parsed.x } : {}),
      ...(typeof parsed.y === "number" ? { y: parsed.y } : {})
    };

    return ensureWindowStateVisible(normalized);
  } catch {
    return {
      width: defaultWindowState.width,
      height: defaultWindowState.height,
      isMaximized: false
    };
  }
}

function scheduleWindowStateSave(window: BrowserWindow) {
  if (pendingWindowStateSave) {
    clearTimeout(pendingWindowStateSave);
  }

  pendingWindowStateSave = setTimeout(() => {
    pendingWindowStateSave = null;
    void saveWindowState(window);
  }, 200);
}

async function saveWindowState(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }

  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
  const payload: WindowStateSnapshot = {
    width: clampWindowDimension(bounds.width, defaultWindowState.width, defaultWindowState.minWidth),
    height: clampWindowDimension(bounds.height, defaultWindowState.height, defaultWindowState.minHeight),
    x: bounds.x,
    y: bounds.y,
    isMaximized: window.isMaximized()
  };

  await mkdir(path.dirname(windowStateFilePath), {
    recursive: true
  });
  await writeFile(windowStateFilePath, JSON.stringify(payload, null, 2), "utf8");
}

function ensureWindowStateVisible(state: WindowStateSnapshot): WindowStateSnapshot {
  if (state.x === undefined || state.y === undefined) {
    return {
      ...state,
      width: Math.min(state.width, screen.getPrimaryDisplay().workArea.width),
      height: Math.min(state.height, screen.getPrimaryDisplay().workArea.height)
    };
  }

  const display = screen.getDisplayMatching({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height
  });
  const { x, y, width, height } = display.workArea;
  const horizontallyVisible = state.x < x + width - 80 && state.x + state.width > x + 80;
  const verticallyVisible = state.y < y + height - 80 && state.y + state.height > y + 80;

  if (horizontallyVisible && verticallyVisible) {
    return {
      ...state,
      width: Math.min(state.width, width),
      height: Math.min(state.height, height)
    };
  }

  return {
    width: Math.min(state.width, width),
    height: Math.min(state.height, height),
    isMaximized: state.isMaximized
  };
}

function clampWindowDimension(value: number | undefined, fallback: number, minimum: number) {
  return Math.max(minimum, Math.round(typeof value === "number" ? value : fallback));
}

function matchesShortcut(input: Electron.Input, key: string) {
  if (input.type !== "keyDown") {
    return false;
  }

  if (!(input.meta || input.control) || input.shift || input.alt) {
    return false;
  }

  return input.key.toLowerCase() === key;
}

async function assertFileExists(filePath: string, label: string) {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    throw new Error(`Unable to locate ${label} at ${filePath}. Build the workspace packages before launching Electron.`);
  }
}

function handleBootstrapError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error("desktop.bootstrap_failed", error);

  void dialog
    .showMessageBox({
      type: "error",
      title: "Monet failed to start",
      message,
      detail: "The desktop shell could not finish wiring the renderer and local controller."
    })
    .finally(() => {
      app.exit(1);
    });
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

async function gracefulShutdown(reason: "user" | "update") {
  shutdownPromise ??= (async () => {
    isAppQuitting = true;

    logger.info("desktop.shutdown_requested", {
      reason
    });

    await stopManagedController({
      reason
    });
  })();

  return shutdownPromise;
}

async function stopManagedController(options: { reason: string }) {
  if (!controllerRuntime?.child) {
    return;
  }

  await stopUtilityProcess(controllerRuntime.child, {
    markAsIntentional: true,
    reason: options.reason
  });
}

async function stopUtilityProcess(
  child: Electron.UtilityProcess,
  options: {
    markAsIntentional: boolean;
    reason: string;
  }
) {
  if (typeof child.pid === "number" && options.markAsIntentional) {
    intentionallyStoppedControllerPids.add(child.pid);
  }

  logger.info("desktop.controller_stop_requested", {
    pid: child.pid,
    reason: options.reason
  });

  const exitWait = waitForUtilityProcessExit(child, 5_000);

  if (typeof child.pid === "number") {
    sendUtilityProcessSignal(child.pid, "SIGTERM");
  } else {
    child.kill();
  }

  const exited = await exitWait;

  if (exited) {
    return;
  }

  logger.warn("desktop.controller_stop_force_kill", {
    pid: child.pid,
    reason: options.reason
  });
  if (typeof child.pid === "number") {
    sendUtilityProcessSignal(child.pid, "SIGKILL");
  } else {
    child.kill();
  }
  await waitForUtilityProcessExit(child, 1_000);
}

function getProviderSecretStore() {
  providerSecretStore ??= createProviderSecretStore({
    platform: process.platform,
    safeStorage,
    secretsFilePath: path.join(userDataPath, "provider-secrets.json")
  });

  return providerSecretStore;
}

function buildProviderSecretEnv(env: NodeJS.ProcessEnv) {
  try {
    const secrets = getProviderSecretStore().loadSecretsForControllerEnv();
    const nextEnv: NodeJS.ProcessEnv = {};

    if (!env.MONET_OPENAI_API_KEY?.trim() && !env.OPENAI_API_KEY?.trim() && secrets.openai) {
      nextEnv.MONET_OPENAI_API_KEY = secrets.openai;
    }

    if (!env.MONET_OPENROUTER_API_KEY?.trim() && !env.OPENROUTER_API_KEY?.trim() && secrets.openrouter) {
      nextEnv.MONET_OPENROUTER_API_KEY = secrets.openrouter;
    }

    return nextEnv;
  } catch (error) {
    logger.warn("desktop.provider_secret_load_failed", {
      reason: error instanceof Error ? error.message : "unknown_error"
    });

    return {};
  }
}

async function syncSavedProviderSecretsToController(runtime: ControllerRuntime) {
  let secrets: Partial<Record<ProviderType, string>>;

  try {
    secrets = getProviderSecretStore().loadSecretsForControllerEnv();
  } catch (error) {
    logger.warn("desktop.provider_secret_sync_load_failed", {
      reason: error instanceof Error ? error.message : "unknown_error"
    });
    return;
  }

  await Promise.all(
    (["openai", "openrouter"] as const)
      .filter((providerType) => Boolean(secrets[providerType]))
      .map(async (providerType) => {
        const result = await applyProviderCredentialToController(providerType, secrets[providerType] ?? null, runtime);

        if (!result.applied) {
          logger.warn("desktop.provider_secret_sync_failed", {
            providerType,
            reason: result.reason
          });
        }
      })
  );
}

async function applyProviderCredentialToController(
  providerType: ProviderType,
  secret: string | null,
  runtime = controllerRuntime
): Promise<ProviderSecretMutationResult["controllerSync"]> {
  if (!runtime) {
    return {
      applied: false,
      reason: "controller-unavailable"
    };
  }

  if (!isSafeControllerCredentialSyncTarget(runtime.apiBase)) {
    return {
      applied: false,
      reason: "controller-url-not-loopback"
    };
  }

  const normalizedSecret = secret?.trim() ?? null;
  const headers: Record<string, string> = {};

  if (runtime.bearerToken) {
    headers.Authorization = `Bearer ${runtime.bearerToken}`;
  }

  if (normalizedSecret) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const requestInit: RequestInit = {
      method: normalizedSecret ? "PUT" : "DELETE",
      headers,
      ...(normalizedSecret ? { body: JSON.stringify({ apiKey: normalizedSecret }) } : {})
    };

    const response = await fetch(new URL(`/api/provider-credentials/${providerType}`, runtime.apiBase).toString(), requestInit);

    if (!response.ok) {
      return {
        applied: false,
        reason: `controller returned ${response.status}`
      };
    }

    return {
      applied: true
    };
  } catch (error) {
    return {
      applied: false,
      reason: error instanceof Error ? error.message : "controller request failed"
    };
  }
}

async function ensureWorkspaceDirectoryForSession(
  sessionId: string,
  runtime = controllerRuntime
): Promise<
  | {
      readonly ok: true;
      readonly workspacePath: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly workspacePath?: string;
    }
> {
  if (!runtime) {
    return {
      ok: false,
      error: "The Monet controller is not available."
    };
  }

  const headers: Record<string, string> = {};

  if (runtime.bearerToken) {
    headers.Authorization = `Bearer ${runtime.bearerToken}`;
  }

  try {
    const response = await fetch(
      new URL(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/open`, runtime.apiBase).toString(),
      {
        method: "POST",
        headers
      }
    );
    const responseBody = await response.text();
    const parsedBody = parseJsonResponse(responseBody);
    const workspacePath = getWorkspacePathFromResponse(parsedBody);

    if (!response.ok) {
      return {
        ok: false,
        ...(workspacePath ? { workspacePath } : {}),
        error: getControllerErrorMessage(parsedBody, response.status)
      };
    }

    if (!workspacePath) {
      return {
        ok: false,
        error: "The controller did not return a workspace path."
      };
    }

    return {
      ok: true,
      workspacePath
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not contact the Monet controller."
    };
  }
}

function parseJsonResponse(responseBody: string): unknown {
  if (!responseBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseBody) as unknown;
  } catch {
    return null;
  }
}

function getWorkspacePathFromResponse(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== "object" || !("workspacePath" in responseBody)) {
    return null;
  }

  const workspacePath = (responseBody as Partial<OpenWorkspaceDirectoryResponse>).workspacePath;

  return typeof workspacePath === "string" && workspacePath.trim().length > 0 ? workspacePath : null;
}

function getControllerErrorMessage(responseBody: unknown, status: number) {
  if (responseBody && typeof responseBody === "object") {
    const candidate = responseBody as { error?: unknown; message?: unknown };

    if (typeof candidate.error === "string" && candidate.error.trim().length > 0) {
      return candidate.error;
    }

    if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
      return candidate.message;
    }
  }

  return `The controller returned ${status}.`;
}

function isSafeControllerCredentialSyncTarget(apiBase: string) {
  try {
    const url = new URL(apiBase);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    return isLoopbackControllerHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackControllerHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();

  if (normalizedHostname === "localhost" || normalizedHostname === "::1" || normalizedHostname === "[::1]") {
    return true;
  }

  return /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
}
