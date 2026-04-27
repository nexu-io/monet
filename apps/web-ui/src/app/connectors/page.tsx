"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { PageFrame } from "../../components/page-frame";
import { useControllerState } from "../../lib/controller-state";
import { listConnectors, type ConnectorCatalogCard } from "../../lib/connectors-api";

type ConnectorsLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "loaded"; readonly connectors: ConnectorCatalogCard[] };

const statePanelClassName =
  "rounded-2xl border border-border-subtle bg-surface-1 p-6 shadow-xs";
const eyebrowClassName =
  "m-0 text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary";
const titleClassName =
  "m-0 font-heading text-xl font-semibold tracking-[-0.01em] text-text-heading";
const descriptionClassName =
  "m-0 max-w-[68ch] leading-[1.6] text-text-muted";
const secondaryButtonClassName =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-border-subtle bg-surface-0 px-3.5 text-sm font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";

function ConnectorStatePanel({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className={statePanelClassName} aria-live="polite">
      <div className="flex flex-col gap-3">
        <p className={eyebrowClassName}>{eyebrow}</p>
        <div className="flex flex-col gap-2">
          <h2 className={titleClassName}>{title}</h2>
          <p className={descriptionClassName}>{description}</p>
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </section>
  );
}

function LoadingConnectorsState() {
  return (
    <section className={statePanelClassName} aria-label="Loading connectors" aria-live="polite">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className={eyebrowClassName}>Loading</p>
          <h2 className={titleClassName}>Checking connector availability…</h2>
          <p className={descriptionClassName}>Monet is loading the connector catalog and current connection status.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3" aria-hidden="true">
          {["GitHub", "Notion", "Google Drive"].map((label) => (
            <div key={label} className="flex min-h-28 flex-col gap-3 rounded-xl border border-border-subtle bg-surface-0 p-4">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-2" />
              <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
              <span className="sr-only">Loading {label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ConnectorsPage() {
  const { config, controllerState, isDesktop, restartController, restartPending } = useControllerState();
  const [loadState, setLoadState] = useState<ConnectorsLoadState>({ status: "idle" });
  const connectorsEnabled = config?.features.connectors ?? false;
  const controllerStatus = controllerState?.state;
  const controllerStarting = controllerStatus === "starting" || controllerStatus === "restarting";
  const controllerOffline = controllerStatus === "failed" || controllerStatus === "stopped";

  const refreshConnectors = useCallback(async () => {
    if (!connectorsEnabled || controllerStarting || controllerOffline) {
      return;
    }

    setLoadState({ status: "loading" });

    try {
      const response = await listConnectors();
      setLoadState({ status: "loaded", connectors: response.connectors });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load connectors."
      });
    }
  }, [connectorsEnabled, controllerOffline, controllerStarting]);

  useEffect(() => {
    if (!config) {
      return;
    }

    void refreshConnectors();
  }, [config, refreshConnectors]);

  let content: ReactNode;

  if (!config) {
    content = <LoadingConnectorsState />;
  } else if (!connectorsEnabled) {
    content = (
      <ConnectorStatePanel
        eyebrow="Unavailable"
        title="Connectors are not enabled for this workspace."
        description="Turn on the connectors feature flag and restart Monet to access external tools from GitHub, Notion, and Google Drive."
      />
    );
  } else if (controllerStarting) {
    content = (
      <ConnectorStatePanel
        eyebrow="Setup"
        title="Waiting for your local workspace…"
        description="Connector setup will be available after the local controller finishes starting."
      />
    );
  } else if (controllerOffline) {
    content = (
      <ConnectorStatePanel
        eyebrow="Setup"
        title="Start your local workspace to manage connectors."
        description={controllerState?.message ?? "The connector catalog depends on the local Monet controller."}
        action={
          isDesktop ? (
            <button className={secondaryButtonClassName} type="button" onClick={() => void restartController()} disabled={restartPending}>
              {restartPending ? "Restarting workspace…" : "Restart workspace"}
            </button>
          ) : undefined
        }
      />
    );
  } else if (loadState.status === "idle" || loadState.status === "loading") {
    content = <LoadingConnectorsState />;
  } else if (loadState.status === "error") {
    content = (
      <ConnectorStatePanel
        eyebrow="Error"
        title="Unable to load connectors."
        description={loadState.message}
        action={
          <button className={secondaryButtonClassName} type="button" onClick={() => void refreshConnectors()}>
            Try again
          </button>
        }
      />
    );
  } else if (loadState.connectors.length === 0) {
    content = (
      <ConnectorStatePanel
        eyebrow="Empty"
        title="No connectors are configured yet."
        description="When connector providers are available, they will appear here with their connection status and available tools."
        action={
          <button className={secondaryButtonClassName} type="button" onClick={() => void refreshConnectors()}>
            Refresh catalog
          </button>
        }
      />
    );
  } else if (loadState.connectors.every((connector) => connector.status === "unavailable")) {
    content = (
      <ConnectorStatePanel
        eyebrow="Unavailable"
        title="Connector providers are currently unavailable."
        description="The catalog loaded, but none of the configured connector providers are available from this workspace. Check provider configuration and try again."
        action={
          <button className={secondaryButtonClassName} type="button" onClick={() => void refreshConnectors()}>
            Refresh status
          </button>
        }
      />
    );
  } else {
    content = (
      <ConnectorStatePanel
        eyebrow="Setup"
        title="Connect external tools to Monet."
        description={`The connector catalog is ready with ${loadState.connectors.length} provider${loadState.connectors.length === 1 ? "" : "s"}. Connector cards and tool details will appear in the next setup step.`}
      />
    );
  }

  return (
    <PageFrame
      pathname="/connectors"
      title="Connectors"
      description="Connect approved external services so Monet can use curated tools with safe approval policies."
    >
      {content}
    </PageFrame>
  );
}
