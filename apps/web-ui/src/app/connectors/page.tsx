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
const primaryButtonClassName =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-2 disabled:text-text-tertiary disabled:shadow-none";
const connectorGridClassName = "grid gap-4 lg:grid-cols-3";

const connectorIconMeta: Record<ConnectorCatalogCard["icon"], { readonly label: string; readonly glyph: string; readonly className: string }> = {
  github: {
    label: "GitHub",
    glyph: "GH",
    className: "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"
  },
  notion: {
    label: "Notion",
    glyph: "N",
    className: "bg-white text-neutral-950 ring-1 ring-border-subtle"
  },
  "google-drive": {
    label: "Google Drive",
    glyph: "△",
    className: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
  }
};

const connectorStatusMeta: Record<
  ConnectorCatalogCard["status"],
  { readonly label: string; readonly badgeClassName: string; readonly primaryActionLabel: string; readonly primaryActionDisabled?: boolean }
> = {
  connected: {
    label: "Connected",
    badgeClassName: "border-success/20 bg-success-subtle text-success",
    primaryActionLabel: "Manage"
  },
  expired: {
    label: "Needs reconnect",
    badgeClassName: "border-warning/20 bg-warning-subtle text-warning",
    primaryActionLabel: "Reconnect"
  },
  not_connected: {
    label: "Not connected",
    badgeClassName: "border-border-strong bg-surface-2 text-text-secondary",
    primaryActionLabel: "Connect"
  },
  unavailable: {
    label: "Unavailable",
    badgeClassName: "border-error/20 bg-error-subtle text-error",
    primaryActionLabel: "Unavailable",
    primaryActionDisabled: true
  }
};

function formatToolId(toolId: string) {
  return toolId
    .split("_")
    .filter(Boolean)
    .slice(1)
    .map((part) => part.toLowerCase())
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ConnectorIcon({ connector }: { readonly connector: ConnectorCatalogCard }) {
  const meta = connectorIconMeta[connector.icon] ?? {
    label: connector.displayName,
    glyph: connector.displayName.slice(0, 2).toUpperCase(),
    className: "bg-surface-2 text-text-primary ring-1 ring-border-subtle"
  };

  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-xs ${meta.className}`} aria-hidden="true" title={meta.label}>
      {meta.glyph}
    </div>
  );
}

function ConnectorStatusBadge({ status }: { readonly status: ConnectorCatalogCard["status"] }) {
  const meta = connectorStatusMeta[status];

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.badgeClassName}`}>
      {meta.label}
    </span>
  );
}

function ConnectorCard({ connector }: { readonly connector: ConnectorCatalogCard }) {
  const statusMeta = connectorStatusMeta[connector.status];
  const featuredTools = connector.featuredTools.slice(0, 3).map(formatToolId);
  const accountLabel = connector.connectedAccountLabel?.trim();

  return (
    <article className="flex min-h-[24rem] flex-col justify-between gap-5 rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <ConnectorIcon connector={connector} />
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="m-0 font-heading text-lg font-semibold text-text-heading">{connector.displayName}</h2>
              <p className="m-0 text-xs font-medium uppercase tracking-[0.08em] text-text-tertiary">{connector.category}</p>
            </div>
          </div>
          <ConnectorStatusBadge status={connector.status} />
        </div>

        <p className="m-0 leading-[1.6] text-text-secondary">{connector.description}</p>

        {accountLabel ? (
          <p className="m-0 rounded-lg border border-border-subtle bg-surface-0 px-3 py-2 text-sm text-text-muted">
            Connected as <span className="font-medium text-text-primary">{accountLabel}</span>
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Capabilities</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-[1.5] text-text-muted">
            {connector.capabilitySummaries.slice(0, 2).map((summary) => (
              <li key={summary} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span>{summary}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2" aria-label={`${connector.displayName} featured tools`}>
          {featuredTools.map((tool) => (
            <span key={tool} className="rounded-full border border-border-subtle bg-surface-0 px-2.5 py-1 text-xs font-medium text-text-secondary">
              {tool}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:items-center">
        <button className={primaryButtonClassName} type="button" disabled={statusMeta.primaryActionDisabled} aria-label={`${statusMeta.primaryActionLabel} ${connector.displayName}`}>
          {statusMeta.primaryActionLabel}
        </button>
        <button className={secondaryButtonClassName} type="button" disabled={connector.status === "unavailable"} aria-label={`View ${connector.displayName} tools`}>
          View tools
        </button>
      </div>
    </article>
  );
}

function ConnectorCardGrid({ connectors }: { readonly connectors: readonly ConnectorCatalogCard[] }) {
  return (
    <section className="flex flex-col gap-4" aria-label="Available connectors">
      <div className="flex flex-col gap-2">
        <p className={eyebrowClassName}>Setup</p>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className={titleClassName}>Connect external tools to Monet.</h2>
            <p className={descriptionClassName}>Choose a connector, review its curated read-only tools, and connect an account when you are ready.</p>
          </div>
        </div>
      </div>
      <div className={connectorGridClassName}>
        {connectors.map((connector) => (
          <ConnectorCard key={connector.id} connector={connector} />
        ))}
      </div>
    </section>
  );
}

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
    content = <ConnectorCardGrid connectors={loadState.connectors} />;
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
