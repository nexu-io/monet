"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, StatusDot } from "@nexu-design/ui-web";

import { getMonetClientConfig, type ControllerHealthResponse, type MonetClientConfig } from "../lib/monet-client";

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
  const [config, setConfig] = useState<MonetClientConfig | null>(null);
  const [state, setState] = useState<HealthState>(initialState);

  async function loadHealth() {
    const nextConfig = getMonetClientConfig();
    setConfig(nextConfig);
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const requestOptions: RequestInit = {
        cache: "no-store"
      };

      if (nextConfig.bearerToken) {
        requestOptions.headers = {
          Authorization: `Bearer ${nextConfig.bearerToken}`
        };
      }

      const response = await fetch(`${nextConfig.apiBase}/api/health`, requestOptions);

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
    void loadHealth();
  }, []);

  const tone = state.loading ? "unknown" : state.data ? "healthy" : "offline";
  const label = state.loading ? "Checking controller" : state.data ? "Controller ready" : "Controller unavailable";
  const badgeVariant = state.loading ? "warning" : state.data ? "success" : "destructive";
  const dotStatus = state.loading ? "warning" : state.data ? "success" : "error";

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
            <div className="muted mono">{state.data ? JSON.stringify(state.data) : state.error ?? "Waiting for response..."}</div>
          </li>
        </ul>

        <Button type="button" variant="primary" onClick={() => void loadHealth()} disabled={state.loading}>
          {state.loading ? "Refreshing..." : "Retry health check"}
        </Button>
      </CardContent>
    </Card>
  );
}
