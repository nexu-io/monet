import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { BrowserWindow, app, dialog, ipcMain, shell, utilityProcess } from "electron";

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

let mainWindow: BrowserWindow | null = null;
let controllerRuntime: ControllerRuntime | null = null;
let isAppQuitting = false;

if (!gotSingleInstanceLock) {
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (mainWindow || !controllerRuntime) {
    return;
  }

  mainWindow = await createMainWindow(controllerRuntime);
});

ipcMain.handle("monet:get-runtime-info", () => {
  return {
    apiBase: controllerRuntime?.apiBase,
    bearerToken: controllerRuntime?.bearerToken
  };
});

ipcMain.handle("monet:restart-controller", async () => {
  if (process.env.MONET_DESKTOP_CONTROLLER_URL?.trim()) {
    return {
      restarted: false,
      reason: "external-controller"
    };
  }

  controllerRuntime = await startManagedController();
  broadcastControllerState({ state: "ready", apiBase: controllerRuntime.apiBase });

  return {
    restarted: true,
    apiBase: controllerRuntime.apiBase
  };
});

async function bootstrap() {
  controllerRuntime = await resolveControllerRuntime();
  mainWindow = await createMainWindow(controllerRuntime);
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

  await loadRenderer(window);
  window.once("ready-to-show", () => {
    window.show();
    broadcastControllerState({ state: "ready", apiBase: runtime.apiBase });
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  return window;
}

async function loadRenderer(window: BrowserWindow) {
  const rendererUrl = process.env.MONET_DESKTOP_RENDERER_URL?.trim();

  if (rendererUrl) {
    await window.loadURL(rendererUrl);
    return;
  }

  const rendererEntry = path.resolve(__dirname, "../../web-ui/out/index.html");
  await assertFileExists(rendererEntry, "exported web-ui entrypoint");
  await window.loadFile(rendererEntry);
}

async function resolveControllerRuntime(): Promise<ControllerRuntime> {
  const externalApiBase = process.env.MONET_DESKTOP_CONTROLLER_URL?.trim();

  if (externalApiBase) {
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
    controllerRuntime.child.kill();
  }

  const controllerEntrypoint = path.resolve(__dirname, "../../controller/dist/electron-entry.js");
  await assertFileExists(controllerEntrypoint, "controller desktop entrypoint");

  const port = await reserveEphemeralPort();
  const bearerToken = randomBytes(24).toString("hex");
  const apiBase = `http://${controllerHost}:${port}`;

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
      return;
    }

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
  console.error("Failed to bootstrap the Monet desktop shell.", error);

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
