"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getMonetClientConfig, type ControllerStatePayload, type MonetClientConfig } from "./monet-client";

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
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);

  useEffect(() => {
    const desktopApi = getDesktopApi();

    setConfig(getMonetClientConfig());
    setControllerState(desktopApi?.getControllerState?.() ?? null);

    if (!desktopApi?.onControllerStateChange) {
      return;
    }

    return desktopApi.onControllerStateChange((payload) => {
      setConfig(getMonetClientConfig());
      setControllerState(payload);

      if (payload.state === "ready") {
        setRestartError(null);
      }

      if (payload.state === "failed" || payload.state === "stopped") {
        setRestartPending(false);
      }
    });
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
      setRestartError(error instanceof Error ? error.message : "Unable to restart the local controller.");
      throw error;
    } finally {
      setRestartPending(false);
    }
  }, []);

  return useMemo(
    () => ({
      config,
      controllerState,
      isDesktop: Boolean(getDesktopApi()),
      restartController,
      restartError,
      restartPending
    }),
    [config, controllerState, restartController, restartError, restartPending]
  );
}
