import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { BrowserWindow, app, dialog, ipcMain, shell, utilityProcess } from "electron";

import { createLogger } from "./logger";

export const desktopAppName = "@monet/desktop";

interface ControllerRuntime {
  readonly apiBase: string;
  readonly bearerToken: string | null;
  readonly managed: boolean;
  readonly child?: Electron.UtilityProcess;
}

interface ControllerStatePayload {
  readonly state: "starting" | "ready" | "stopped";
  readonly apiBase?: string;
}

const controllerHost = "127.0.0.1";
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const logger = createLogger("desktop", {
  component: "main"
});

let mainWindow: BrowserWindow | null = null;
let controllerRuntime: ControllerRuntime | null = null;
let isAppQuitting = false;

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
    return {
      restarted: false,
      reason: "external-controller"
    };
  }

  try {
    controllerRuntime = await startManagedController();
    broadcastControllerState({ state: "ready", apiBase: controllerRuntime.apiBase });

    logger.info("desktop.controller_restart_completed", {
      apiBase: controllerRuntime.apiBase
    });

    return {
      restarted: true,
      apiBase: controllerRuntime.apiBase
    };
  } catch (error) {
    logger.error("desktop.controller_restart_failed", error);
    throw error;
  }
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

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: "#0b1020",
    title: "Monet",
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

  window.once("ready-to-show", () => {
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
  broadcastControllerState({ state: "ready", apiBase: runtime.apiBase });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
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

async function startManagedController(): Promise<ControllerRuntime> {
  if (controllerRuntime?.child) {
    logger.warn("desktop.controller_existing_child_replaced");
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

    logger.error("desktop.controller_exited_unexpectedly");
    broadcastControllerState({ state: "stopped" });
    void dialog.showMessageBox({
      type: "error",
      title: "Local controller stopped",
      message: "The local Monet controller exited unexpectedly.",
      detail: "Restart the desktop app or use the preload restart hook once the renderer is wired to surface recovery actions."
    });
  });

  broadcastControllerState({ state: "starting" });
  await waitForControllerReady(apiBase, bearerToken);

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
  const args = [`--monet-api-base=${runtime.apiBase}`];

  if (runtime.bearerToken) {
    args.push(`--monet-bearer-token=${runtime.bearerToken}`);
  }

  return args;
}

function broadcastControllerState(payload: ControllerStatePayload) {
  mainWindow?.webContents.send("monet:controller-state", payload);
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
