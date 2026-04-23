import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { BrowserWindow, app, dialog, ipcMain, safeStorage, screen, shell, utilityProcess } from "electron";

import { createLogger } from "./logger";
import { createProviderSecretStore, type ProviderSecretStorageSnapshot, type ProviderType } from "./provider-secret-store";

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

type DesktopShortcutAction = "new-session" | "open-settings";

interface WindowStateSnapshot {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
  readonly isMaximized: boolean;
}

const controllerHost = "127.0.0.1";
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
const windowStateFilePath = path.join(app.getPath("userData"), "window-state.json");

let mainWindow: BrowserWindow | null = null;
let controllerRuntime: ControllerRuntime | null = null;
let isAppQuitting = false;
let providerSecretStore:
  | ReturnType<typeof createProviderSecretStore>
  | null = null;
const intentionallyStoppedControllerPids = new Set<number>();
let pendingWindowStateSave: NodeJS.Timeout | null = null;

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

app.on("before-quit", () => {
  isAppQuitting = true;

  if (controllerRuntime?.child) {
    controllerRuntime.child.kill();
  }
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

ipcMain.handle("monet:get-app-paths", () => {
  return {
    userDataPath: app.getPath("userData")
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

ipcMain.handle(
  "monet:save-provider-secret",
  (_event, payload: { providerType: ProviderType; secret: string }) => {
    getProviderSecretStore().saveSecret(payload.providerType, payload.secret);

    return getProviderSecretStore().getSnapshot() satisfies ProviderSecretStorageSnapshot;
  }
);

ipcMain.handle("monet:clear-provider-secret", (_event, payload: { providerType: ProviderType }) => {
  getProviderSecretStore().clearSecret(payload.providerType);

  return getProviderSecretStore().getSnapshot() satisfies ProviderSecretStorageSnapshot;
});

async function bootstrap() {
  logger.info("desktop.bootstrap_started");
  controllerRuntime = await resolveControllerRuntime();
  mainWindow = await createMainWindow(controllerRuntime);
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

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);

    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const rendererUrl = process.env.MONET_DESKTOP_RENDERER_URL?.trim();

    if (rendererUrl?.startsWith("http") && url.startsWith(rendererUrl)) {
      return;
    }

    if (url.startsWith("file://")) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
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
    await waitForRendererReady(rendererUrl);
    await window.loadURL(rendererUrl);
    return;
  }

  const rendererEntry = path.resolve(__dirname, "../../web-ui/out/index.html");
  await assertFileExists(rendererEntry, "exported web-ui entrypoint");
  logger.info("desktop.renderer_wait_started", {
    mode: "prod",
    rendererEntry
  });
  await window.loadFile(rendererEntry);
}

async function waitForRendererReady(rendererUrl: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(rendererUrl);

      if (response.ok) {
        logger.info("desktop.renderer_ready", {
          attempt: attempt + 1,
          rendererUrl
        });
        return;
      }
    } catch {
      // Ignore early boot failures while the renderer dev server starts.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for renderer readiness at ${rendererUrl}.`);
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

    if (typeof controllerRuntime.child.pid === "number") {
      intentionallyStoppedControllerPids.add(controllerRuntime.child.pid);
    }

    controllerRuntime.child.kill();
  }

  const controllerEntrypoint = path.resolve(__dirname, "../../controller/dist/electron-entry.js");
  await assertFileExists(controllerEntrypoint, "controller desktop entrypoint");

  const port = await reserveEphemeralPort();
  const bearerToken = randomBytes(24).toString("hex");
  const apiBase = `http://${controllerHost}:${port}`;

  logger.info("desktop.controller_start_requested", {
    apiBase,
    port
  });

  const child = utilityProcess.fork(controllerEntrypoint, [], {
    env: {
      ...process.env,
      ...buildProviderSecretEnv(process.env),
      MONET_CONTROLLER_HOST: controllerHost,
      MONET_CONTROLLER_PORT: String(port),
      MONET_CONTROLLER_BEARER_TOKEN: bearerToken,
      MONET_USER_DATA_DIR: app.getPath("userData")
    }
  });

  child.once("exit", () => {
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

  try {
    await waitForControllerReady(apiBase, bearerToken);
  } catch (error) {
    if (typeof child.pid === "number") {
      intentionallyStoppedControllerPids.add(child.pid);
    }

    child.kill();
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

function buildPreloadArguments(runtime: ControllerRuntime) {
  const args = [`--monet-api-base=${runtime.apiBase}`, `--monet-controller-managed=${runtime.managed ? "true" : "false"}`];

  if (runtime.bearerToken) {
    args.push(`--monet-bearer-token=${runtime.bearerToken}`);
  }

  return args;
}

function broadcastControllerState(payload: ControllerStatePayload) {
  mainWindow?.webContents.send("monet:controller-state", payload);
}

function dispatchDesktopShortcut(window: BrowserWindow, action: DesktopShortcutAction) {
  window.webContents.send("monet:shortcut", {
    action
  });
}

async function waitForControllerReady(apiBase: string, bearerToken: string) {
  const healthUrl = `${apiBase}/api/health`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(healthUrl, {
        headers: {
          Authorization: `Bearer ${bearerToken}`
        }
      });

      if (response.ok) {
        logger.info("desktop.controller_healthcheck_ready", {
          attempt: attempt + 1,
          healthUrl
        });
        return;
      }
    } catch {
      // Ignore early boot failures while the controller binds its port.
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for controller readiness at ${healthUrl}.`);
}

function reserveEphemeralPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, controllerHost, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to reserve an ephemeral controller port."));
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
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

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function getProviderSecretStore() {
  providerSecretStore ??= createProviderSecretStore({
    platform: process.platform,
    safeStorage,
    secretsFilePath: path.join(app.getPath("userData"), "provider-secrets.json")
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
