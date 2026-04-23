import { app } from "electron";
import { autoUpdater } from "electron-updater";

import type { Logger } from "./logger";

export type UpdateLifecycleState = "unsupported" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";

export interface UpdateStatePayload {
  readonly state: UpdateLifecycleState;
  readonly message: string;
  readonly currentVersion: string;
  readonly availableVersion?: string;
  readonly downloadedVersion?: string;
  readonly downloadProgressPercent?: number;
}

export interface DesktopUpdater {
  checkForUpdates(): Promise<UpdateStatePayload>;
  getState(): UpdateStatePayload;
  installUpdate(): Promise<void>;
  start(): void;
}

interface CreateDesktopUpdaterOptions {
  readonly logger: Logger;
  readonly onStateChange: (payload: UpdateStatePayload) => void;
  readonly onBeforeInstall: () => Promise<void>;
}

const updateCheckIntervalMs = 4 * 60 * 60 * 1000;
const startupUpdateCheckDelayMs = 30 * 1000;

export function createDesktopUpdater(options: CreateDesktopUpdaterOptions): DesktopUpdater {
  const baseState = {
    currentVersion: app.getVersion()
  } as const;
  let state: UpdateStatePayload = {
    state: "unsupported",
    message: resolveUnsupportedMessage(),
    ...baseState
  };
  let startupTimer: NodeJS.Timeout | null = null;
  let intervalTimer: NodeJS.Timeout | null = null;

  const updaterEnabled = app.isPackaged && process.env.MONET_DISABLE_AUTO_UPDATE !== "1";

  const emitState = (payload: UpdateStatePayload) => {
    state = payload;
    options.onStateChange(payload);
  };

  if (updaterEnabled) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("checking-for-update", () => {
      emitState({
        state: "checking",
        message: "Checking for updates…",
        ...baseState
      });
    });

    autoUpdater.on("update-available", (info: { version: string }) => {
      emitState(
        buildUpdateState(baseState, {
          state: "available",
          message: `Update ${info.version} available. Downloading in the background…`,
          availableVersion: info.version
        })
      );
    });

    autoUpdater.on("download-progress", (progress: { percent: number }) => {
      emitState(
        buildUpdateState(baseState, {
          state: "downloading",
          message: `Downloading update${typeof progress.percent === "number" ? ` (${Math.round(progress.percent)}%)` : ""}…`,
          ...(state.availableVersion !== undefined ? { availableVersion: state.availableVersion } : {}),
          downloadProgressPercent: progress.percent
        })
      );
    });

    autoUpdater.on("update-downloaded", (info: { version: string }) => {
      emitState(
        buildUpdateState(baseState, {
          state: "downloaded",
          message: `Update ${info.version} downloaded. Restart Monet to install it.`,
          availableVersion: info.version,
          downloadedVersion: info.version,
          downloadProgressPercent: 100
        })
      );
    });

    autoUpdater.on("update-not-available", () => {
      emitState({
        state: "idle",
        message: "Monet is up to date.",
        ...baseState
      });
    });

    autoUpdater.on("error", (error: unknown) => {
      options.logger.error("desktop.updater_error", error);
      emitState(
        buildUpdateState(baseState, {
          state: "error",
          message: error instanceof Error ? error.message : "Auto-update failed.",
          ...(state.availableVersion !== undefined ? { availableVersion: state.availableVersion } : {}),
          ...(state.downloadedVersion !== undefined ? { downloadedVersion: state.downloadedVersion } : {}),
          ...(state.downloadProgressPercent !== undefined ? { downloadProgressPercent: state.downloadProgressPercent } : {})
        })
      );
    });

    emitState({
      state: "idle",
      message: "Auto-update ready.",
      ...baseState
    });
  }

  return {
    async checkForUpdates() {
      if (!updaterEnabled) {
        return state;
      }

      await autoUpdater.checkForUpdates();
      return state;
    },
    getState() {
      return state;
    },
    async installUpdate() {
      if (!updaterEnabled) {
        throw new Error(resolveUnsupportedMessage());
      }

      if (state.state !== "downloaded") {
        throw new Error("No downloaded update is ready to install.");
      }

      emitState(
        buildUpdateState(baseState, {
          state: "downloaded",
          message: `Installing update ${state.downloadedVersion ?? state.availableVersion ?? ""}…`.trim(),
          ...(state.availableVersion !== undefined ? { availableVersion: state.availableVersion } : {}),
          ...(state.downloadedVersion !== undefined ? { downloadedVersion: state.downloadedVersion } : {}),
          downloadProgressPercent: 100
        })
      );
      await options.onBeforeInstall();
      autoUpdater.quitAndInstall(false, true);
    },
    start() {
      if (!updaterEnabled) {
        return;
      }

      if (startupTimer || intervalTimer) {
        return;
      }

      startupTimer = setTimeout(() => {
        startupTimer = null;
        void autoUpdater.checkForUpdates().catch((error: unknown) => {
          options.logger.error("desktop.updater_startup_check_failed", error);
        });
      }, startupUpdateCheckDelayMs);

      intervalTimer = setInterval(() => {
        void autoUpdater.checkForUpdates().catch((error: unknown) => {
          options.logger.error("desktop.updater_periodic_check_failed", error);
        });
      }, updateCheckIntervalMs);
    }
  };
}

function resolveUnsupportedMessage() {
  if (process.env.MONET_DISABLE_AUTO_UPDATE === "1") {
    return "Auto-update is disabled by MONET_DISABLE_AUTO_UPDATE.";
  }

  if (!app.isPackaged) {
    return "Auto-update is only available in packaged builds."
  }

  return "Auto-update is unavailable in this environment.";
}

function buildUpdateState(
  baseState: { currentVersion: string },
  payload: Omit<UpdateStatePayload, "currentVersion"> & {
    availableVersion?: string;
    downloadedVersion?: string;
    downloadProgressPercent?: number;
  }
): UpdateStatePayload {
  return {
    state: payload.state,
    message: payload.message,
    currentVersion: baseState.currentVersion,
    ...(payload.availableVersion !== undefined ? { availableVersion: payload.availableVersion } : {}),
    ...(payload.downloadedVersion !== undefined ? { downloadedVersion: payload.downloadedVersion } : {}),
    ...(payload.downloadProgressPercent !== undefined ? { downloadProgressPercent: payload.downloadProgressPercent } : {})
  };
}
