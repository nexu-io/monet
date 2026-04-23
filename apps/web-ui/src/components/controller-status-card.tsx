"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, StatusDot } from "@nexu-design/ui-web";

import { useControllerState } from "../lib/controller-state";
import { type ControllerHealthResponse } from "../lib/monet-client";

type HealthState = {
  readonly loading: boolean;
  readonly data: ControllerHealthResponse | null;
  readonly error: string | null;
};

const initialState: HealthState = {
  loading: true,
  data: null,
  error: null
};

export function ControllerStatusCard() {
  const {
    checkForUpdates,
    config,
    controllerState,
    installUpdate,
    isDesktop,
    restartController,
    restartError,
    restartPending,
    updateCheckPending,
    updateError,
    updateInstallPending,
    updateState
  } = useControllerState();
  const [state, setState] = useState<HealthState>(initialState);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  async function loadHealth() {
    if (!config) {
      return;
    }

    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const requestOptions: RequestInit = {
        cache: "no-store",
        credentials: "omit"
      };

      if (config.bearerToken) {
        requestOptions.headers = {
          Authorization: `Bearer ${config.bearerToken}`
        };
      }

      const response = await fetch(`${config.apiBase}/api/health`, requestOptions);

      if (!response.ok) {
        throw new Error(`Controller returned ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as ControllerHealthResponse;
      setState({ loading: false, data, error: null });
    } catch (error) {
      setState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to reach the local controller."
      });
    }
  }

  useEffect(() => {
    if (!config) {
      return;
    }

    if (controllerState?.state === "starting" || controllerState?.state === "restarting") {
      setState({ loading: true, data: null, error: null });
      return;
    }

    if (controllerState?.state === "failed" || controllerState?.state === "stopped") {
      setState({
        loading: false,
        data: null,
        error: controllerState.message ?? "Unable to reach the local controller."
      });
      return;
    }

    void loadHealth();
  }, [config, controllerState?.message, controllerState?.state]);

  async function handleRestart() {
    try {
      const result = await restartController();

      if (result?.restarted === false) {
        setActionMessage("This session uses an external controller. Restart it outside the app.");
        return;
      }

      setActionMessage("Controller restart requested. Waiting for readiness signal…");
    } catch {
      setActionMessage(null);
    }
  }

  async function handleCheckForUpdates() {
    try {
      const result = await checkForUpdates();
      setActionMessage(result?.message ?? "Checking for updates…");
    } catch {
      setActionMessage(null);
    }
  }

  async function handleInstallUpdate() {
    try {
      await installUpdate();
      setActionMessage("Restarting Monet to install the downloaded update…");
    } catch {
      setActionMessage(null);
    }
  }

  const lifecycleState = controllerState?.state;
  const tone = lifecycleState === "starting" || lifecycleState === "restarting" || state.loading
    ? "unknown"
    : lifecycleState === "failed" || lifecycleState === "stopped" || !state.data
      ? "offline"
      : "healthy";
  const label = lifecycleState === "starting"
    ? "Starting local controller"
    : lifecycleState === "restarting"
      ? "Restarting controller"
      : lifecycleState === "failed"
        ? "Controller start failed"
        : lifecycleState === "stopped"
          ? "Controller stopped"
          : state.loading
            ? "Checking controller"
            : state.data
              ? "Controller ready"
              : "Controller unavailable";
  const badgeVariant = tone === "healthy" ? "success" : state.loading || lifecycleState === "starting" || lifecycleState === "restarting" ? "warning" : "destructive";
  const dotStatus = tone === "healthy" ? "success" : state.loading || lifecycleState === "starting" || lifecycleState === "restarting" ? "warning" : "error";

  return (
    <Card className="card stack">
      <CardHeader>
        <div className="stack-tight">
          <span className="eyebrow">Controller connectivity</span>
          <CardTitle>Renderer-to-controller handshake</CardTitle>
          <CardDescription className="muted">
            The web UI resolves its API base from preload first, then falls back to public Next.js env vars for local
            development.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="stack">
        <Badge variant={badgeVariant} size="sm" radius="full" className="status-badge" data-tone={tone}>
          <StatusDot status={dotStatus} size="xs" pulse={state.loading} />
          <span>{label}</span>
        </Badge>

        <ul className="status-list">
          <li>
            <strong>Desktop lifecycle</strong>
            <div className="muted">{controllerState ? label : isDesktop ? "Waiting for desktop status..." : "Browser-only mode"}</div>
          </li>
          <li>
            <strong>API base</strong>
            <div className="muted mono">{config?.apiBase ?? "Resolving..."}</div>
          </li>
          <li>
            <strong>Auth source</strong>
            <div className="muted">{config?.source ?? "Resolving..."}</div>
          </li>
          <li>
            <strong>Bearer token</strong>
            <div className="muted">{config?.bearerToken ? "Configured" : "Not configured"}</div>
          </li>
          <li>
            <strong>Health response</strong>
            <div className="muted mono">{state.data ? JSON.stringify(state.data) : controllerState?.message ?? state.error ?? "Waiting for response..."}</div>
          </li>
          <li>
            <strong>Update status</strong>
            <div className="muted">
              {updateState
                ? `${updateState.message}${updateState.downloadedVersion ? ` (${updateState.downloadedVersion})` : updateState.availableVersion ? ` (${updateState.availableVersion})` : ""}`
                : isDesktop
                  ? "Resolving desktop updater status..."
                  : "Browser-only mode"}
            </div>
          </li>
        </ul>

        {actionMessage || restartError || updateError ? <p className="muted">{actionMessage ?? restartError ?? updateError}</p> : null}

        <div className="session-browser-actions">
          <Button type="button" variant="primary" onClick={() => void loadHealth()} disabled={state.loading || !config}>
            {state.loading ? "Refreshing..." : "Retry health check"}
          </Button>
          {isDesktop ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleRestart()}
              disabled={restartPending || controllerState?.restartAvailable === false}
            >
              {restartPending || lifecycleState === "restarting" ? "Restarting..." : "Restart controller"}
            </Button>
          ) : null}
          {isDesktop ? (
            <Button type="button" variant="secondary" onClick={() => void handleCheckForUpdates()} disabled={updateCheckPending || updateInstallPending}>
              {updateCheckPending || updateState?.state === "checking" ? "Checking updates..." : "Check for updates"}
            </Button>
          ) : null}
          {isDesktop && updateState?.state === "downloaded" ? (
            <Button type="button" variant="primary" onClick={() => void handleInstallUpdate()} disabled={updateInstallPending}>
              {updateInstallPending ? "Installing update..." : "Restart to update"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
