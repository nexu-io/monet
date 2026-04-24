"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getMonetClientConfig, type ControllerStatePayload, type MonetClientConfig, type UpdateStatePayload } from "./monet-client";

interface RestartResult {
  readonly restarted: boolean;
  readonly apiBase?: string;
  readonly reason?: string;
}

function getDesktopApi() {
  return typeof window === "undefined" ? undefined : window.monetDesktop;
}

export function useControllerState() {
  const [config, setConfig] = useState<MonetClientConfig | null>(() => (typeof window === "undefined" ? null : getMonetClientConfig()));
  const [controllerState, setControllerState] = useState<ControllerStatePayload | null>(() => getDesktopApi()?.getControllerState?.() ?? null);
  const [updateState, setUpdateState] = useState<UpdateStatePayload | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateCheckPending, setUpdateCheckPending] = useState(false);
  const [updateInstallPending, setUpdateInstallPending] = useState(false);

  useEffect(() => {
    const desktopApi = getDesktopApi();
    let cancelled = false;

    setConfig(getMonetClientConfig());
    setControllerState(desktopApi?.getControllerState?.() ?? null);
    void desktopApi?.getUpdateState?.().then((payload) => {
      if (!cancelled) {
        setUpdateState(payload);
      }
    });

    const cleanupController = desktopApi?.onControllerStateChange?.((payload) => {
      setConfig(getMonetClientConfig());
      setControllerState(payload);

      if (payload.state === "ready") {
        setRestartError(null);
      }

      if (payload.state === "failed" || payload.state === "stopped") {
        setRestartPending(false);
      }
    });
    const cleanupUpdater = desktopApi?.onUpdateStateChange?.((payload) => {
      setUpdateState(payload);

      if (payload.state !== "error") {
        setUpdateError(null);
      }

      if (payload.state === "downloaded" || payload.state === "unsupported" || payload.state === "idle") {
        setUpdateCheckPending(false);
      }

      if (payload.state === "downloaded" || payload.state === "unsupported") {
        setUpdateInstallPending(false);
      }
    });

    return () => {
      cancelled = true;
      cleanupController?.();
      cleanupUpdater?.();
    };
  }, []);

  const restartController = useCallback(async (): Promise<RestartResult | null> => {
    const desktopApi = getDesktopApi();

    if (!desktopApi?.restartController) {
      return null;
    }

    setRestartPending(true);
    setRestartError(null);

    try {
      const result = await desktopApi.restartController();
      setConfig(getMonetClientConfig());
      return result;
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : "Unable to restart the local workspace.");
      throw error;
    } finally {
      setRestartPending(false);
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    const desktopApi = getDesktopApi();

    if (!desktopApi?.checkForUpdates) {
      return null;
    }

    setUpdateCheckPending(true);
    setUpdateError(null);

    try {
      const result = await desktopApi.checkForUpdates();
      setUpdateState(result);
      return result;
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : "Unable to check for updates.");
      throw error;
    } finally {
      setUpdateCheckPending(false);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const desktopApi = getDesktopApi();

    if (!desktopApi?.installUpdate) {
      return null;
    }

    setUpdateInstallPending(true);
    setUpdateError(null);

    try {
      return await desktopApi.installUpdate();
    } catch (error) {
      setUpdateInstallPending(false);
      setUpdateError(error instanceof Error ? error.message : "Unable to install the downloaded update.");
      throw error;
    }
  }, []);

  return useMemo(
    () => ({
      checkForUpdates,
      config,
      controllerState,
      installUpdate,
      isDesktop: Boolean(getDesktopApi()),
      restartController,
      restartError,
      restartPending,
      updateCheckPending,
      updateError,
      updateInstallPending,
      updateState
    }),
    [checkForUpdates, config, controllerState, installUpdate, restartController, restartError, restartPending, updateCheckPending, updateError, updateInstallPending, updateState]
  );
}
