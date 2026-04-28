"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import githubIconUrl from "../../assets/connectors/github.svg";
import googleDriveIconUrl from "../../assets/connectors/google-drive.svg";
import notionIconUrl from "../../assets/connectors/notion.svg";
import { PageFrame } from "../../components/page-frame";
import { useControllerState } from "../../lib/controller-state";
import { disconnectConnector, getConnector, listConnectors, startConnectorConnection, type ConnectorCatalogCard, type ConnectorDetail, type ConnectorId } from "../../lib/connectors-api";

type ConnectorsLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "loaded"; readonly connectors: ConnectorCatalogCard[] };

type ConnectorDetailLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "loaded"; readonly connector: ConnectorDetail };

type ConnectorActionState =
  | { readonly status: "idle" }
  | { readonly status: "starting"; readonly connectorId: ConnectorId }
  | { readonly status: "success"; readonly connectorId?: ConnectorId; readonly message: string }
  | { readonly status: "error"; readonly connectorId?: ConnectorId; readonly message: string };

type ConnectorDisconnectState =
  | { readonly status: "idle" }
  | { readonly status: "confirming" }
  | { readonly status: "disconnecting" }
  | { readonly status: "success"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

type ConnectorDetailWithExecutionMetadata = ConnectorDetail & {
  readonly lastProviderExecutionId?: string;
  readonly providerExecutionId?: string;
};

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
const dangerButtonClassName =
  "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-error/30 bg-error-subtle px-3.5 text-sm font-semibold text-error transition-colors hover:border-error/50 hover:bg-error-subtle/80 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";
const connectorGridClassName = "grid gap-4 sm:grid-cols-2";
const connectorCardClassName =
  "flex min-h-[15rem] flex-col justify-between gap-5 rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2";
const connectorDetailQueryParam = "connector";
const connectorOAuthStatusQueryParam = "connector_oauth";
const connectorOAuthIdQueryParam = "connector_id";

type ConnectorIconMeta =
  | { readonly label: string; readonly src: string; readonly className: string; readonly imageClassName?: string; readonly renderMode?: "image" }
  | { readonly label: string; readonly src: string; readonly className: string; readonly imageClassName?: string; readonly renderMode: "mask" };

const connectorIconMeta: Record<ConnectorCatalogCard["icon"], ConnectorIconMeta> = {
  github: {
    label: "GitHub",
    src: githubIconUrl,
    className: "bg-white ring-1 ring-border-subtle dark:ring-white/20",
    imageClassName: "h-6 w-6"
  },
  notion: {
    label: "Notion",
    src: notionIconUrl,
    className: "bg-white ring-1 ring-border-subtle dark:ring-white/20",
    imageClassName: "h-6 w-6"
  },
  "google-drive": {
    label: "Google Drive",
    src: googleDriveIconUrl,
    className: "bg-white ring-1 ring-border-subtle dark:ring-white/20",
    imageClassName: "h-6 w-6"
  }
};

const connectorStatusMeta: Record<
  ConnectorCatalogCard["status"],
  { readonly label: string; readonly iconClassName: string; readonly primaryActionLabel: string; readonly primaryActionDisabled?: boolean }
> = {
  connected: {
    label: "Connected",
    iconClassName: "border-success/25 bg-success-subtle text-success shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-success)_12%,transparent)]",
    primaryActionLabel: "Manage"
  },
  expired: {
    label: "Needs reconnect",
    iconClassName: "border-warning/25 bg-warning-subtle text-warning shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-warning)_12%,transparent)]",
    primaryActionLabel: "Reconnect"
  },
  not_connected: {
    label: "Not connected",
    iconClassName: "border-border-strong bg-surface-2 text-text-tertiary",
    primaryActionLabel: "Connect"
  },
  unavailable: {
    label: "Unavailable",
    iconClassName: "border-error/25 bg-error-subtle text-error shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-error)_12%,transparent)]",
    primaryActionLabel: "Unavailable",
    primaryActionDisabled: true
  }
};

function isConnectorId(value: string | null): value is ConnectorId {
  return value === "github" || value === "notion" || value === "google_drive";
}

function isConnectorOAuthReturnStatus(value: string | null): value is "connected" | "pending" | "error" {
  return value === "connected" || value === "pending" || value === "error";
}

function formatPolicyLabel(policy: ConnectorDetail["allowedTools"][number]["policy"]) {
  const sideEffectLabel = policy.sideEffect.replaceAll("_", " ");
  const approvalLabel = policy.approval.replaceAll("_", " ");

  return `${sideEffectLabel} · ${approvalLabel}`;
}

function getConnectorAccountLabel(connector: ConnectorDetail) {
  return connector.connection.connectedAccountLabel ?? connector.connection.account?.accountLabel ?? connector.connectedAccountLabel;
}

function getProviderExecutionId(connector: ConnectorDetail) {
  const detail = connector as ConnectorDetailWithExecutionMetadata;

  return detail.lastProviderExecutionId ?? detail.providerExecutionId;
}

function isSafeExternalConnectorUrl(url: string) {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function openProviderAuthorizationUrl(url: string) {
  if (!isSafeExternalConnectorUrl(url)) {
    throw new Error("The provider returned an unsupported authorization URL.");
  }

  const desktopApi = typeof window === "undefined" ? undefined : window.monetDesktop;

  if (desktopApi?.openExternalUrl) {
    const result = await desktopApi.openExternalUrl({ url });

    if (!result.opened) {
      throw new Error(result.error ?? "Unable to open the provider authorization page.");
    }

    return;
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");

  if (!popup) {
    throw new Error("Unable to open the provider authorization page.");
  }
}

function ConnectorIcon({ connector }: { readonly connector: ConnectorCatalogCard }) {
  const meta = connectorIconMeta[connector.icon] ?? {
    label: connector.displayName,
    iconFallback: connector.displayName.slice(0, 2).toUpperCase(),
    className: "bg-surface-2 text-text-primary ring-1 ring-border-subtle"
  };

  return (
    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-xs ${meta.className}`} aria-hidden="true" title={meta.label}>
      {"src" in meta ? (
        meta.renderMode === "mask" ? (
          <span
            className={meta.imageClassName ?? "h-6 w-6 bg-current"}
            style={{
              WebkitMask: `url(${meta.src}) center / contain no-repeat`,
              mask: `url(${meta.src}) center / contain no-repeat`
            }}
          />
        ) : (
          <img className={meta.imageClassName ?? "h-6 w-6"} src={meta.src} alt="" loading="lazy" draggable={false} />
        )
      ) : (
        meta.iconFallback
      )}
    </div>
  );
}

function ConnectorStatusBadge({ status }: { readonly status: ConnectorCatalogCard["status"] }) {
  const meta = connectorStatusMeta[status];

  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${meta.iconClassName}`} aria-label={meta.label} title={meta.label}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {status === "connected" ? <path d="m3.5 8.2 2.7 2.7 6.3-6.8" /> : null}
        {status === "expired" ? <><path d="M8 4.5v4" /><path d="M8 12h.01" /></> : null}
        {status === "not_connected" ? <><circle cx="8" cy="8" r="4.5" /><path d="m5 11 6-6" /></> : null}
        {status === "unavailable" ? <><circle cx="8" cy="8" r="4.5" /><path d="M8 5.5v3" /><path d="M8 11h.01" /></> : null}
      </svg>
    </span>
  );
}

function ConnectorCard({
  connector,
  actionBusy,
  onPrimaryAction,
  onViewTools
}: {
  readonly connector: ConnectorCatalogCard;
  readonly actionBusy: boolean;
  readonly onPrimaryAction: (connector: ConnectorCatalogCard) => void;
  readonly onViewTools: (connectorId: ConnectorId) => void;
}) {
  const statusMeta = connectorStatusMeta[connector.status];
  const primaryActionLabel = actionBusy ? "Starting…" : statusMeta.primaryActionLabel;

  return (
    <article className={connectorCardClassName}>
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

      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:items-center">
        <button
          className={primaryButtonClassName}
          type="button"
          disabled={statusMeta.primaryActionDisabled || actionBusy}
          onClick={() => onPrimaryAction(connector)}
          aria-label={`${statusMeta.primaryActionLabel} ${connector.displayName}`}
        >
          {primaryActionLabel}
        </button>
        <button className={secondaryButtonClassName} type="button" disabled={connector.status === "unavailable" || actionBusy} onClick={() => onViewTools(connector.id)} aria-label={`View ${connector.displayName} tools`}>
          View tools
        </button>
      </div>
    </article>
  );
}

function ConnectorCardSkeleton() {
  return (
    <article className={`${connectorCardClassName} pointer-events-none`} aria-hidden="true">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 animate-pulse rounded-xl bg-surface-2" />
            <div className="flex min-w-0 flex-col gap-2">
              <div className="h-5 w-28 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-20 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
          <div className="h-8 w-8 animate-pulse rounded-full bg-surface-2" />
        </div>

        <div className="flex flex-col gap-2">
          <div className="h-4 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-surface-2" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-surface-2" />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:items-center">
        <div className="h-9 w-24 animate-pulse rounded-md bg-surface-2" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-surface-2" />
      </div>
    </article>
  );
}

function ConnectorCardGrid({
  connectors,
  loading = false,
  actionState,
  onPrimaryAction,
  onViewTools
}: {
  readonly connectors: readonly ConnectorCatalogCard[];
  readonly loading?: boolean;
  readonly actionState: ConnectorActionState;
  readonly onPrimaryAction: (connector: ConnectorCatalogCard) => void;
  readonly onViewTools: (connectorId: ConnectorId) => void;
}) {
  return (
    <section className="flex flex-col gap-4" aria-label={loading ? "Loading connectors" : "Available connectors"} aria-busy={loading} aria-live="polite">
      {actionState.status === "success" ? (
        <ConnectorInlineNotice tone="success" message={actionState.message} />
      ) : actionState.status === "error" ? (
        <ConnectorInlineNotice tone="error" message={actionState.message} />
      ) : null}
      <div className={connectorGridClassName}>
        {loading
          ? Array.from({ length: 4 }).map((_, index) => <ConnectorCardSkeleton key={index} />)
          : connectors.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                actionBusy={actionState.status === "starting" && actionState.connectorId === connector.id}
                onPrimaryAction={onPrimaryAction}
                onViewTools={onViewTools}
              />
            ))}
      </div>
      {loading ? <span className="sr-only">Loading connector catalog and connection status</span> : null}
    </section>
  );
}

function ConnectorInlineNotice({ tone, message }: { readonly tone: "success" | "error"; readonly message: string }) {
  const className =
    tone === "success"
      ? "rounded-xl border border-success/20 bg-success-subtle px-4 py-3 text-sm font-medium text-success"
      : "rounded-xl border border-error/20 bg-error-subtle px-4 py-3 text-sm font-medium text-error";

  return (
    <p className={className} role={tone === "error" ? "alert" : "status"} aria-live="polite">
      {message}
    </p>
  );
}

function ConnectorDetailDrawer({ connectorId, onClose, onDisconnected }: { readonly connectorId: ConnectorId; readonly onClose: () => void; readonly onDisconnected: () => Promise<void> }) {
  const [detailState, setDetailState] = useState<ConnectorDetailLoadState>({ status: "idle" });
  const [disconnectState, setDisconnectState] = useState<ConnectorDisconnectState>({ status: "idle" });

  const refreshConnectorDetail = useCallback(async () => {
    setDetailState({ status: "loading" });

    try {
      const response = await getConnector(connectorId);
      setDetailState({ status: "loaded", connector: response.connector });
    } catch (error) {
      setDetailState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load connector details."
      });
    }
  }, [connectorId]);

  useEffect(() => {
    void refreshConnectorDetail();
  }, [refreshConnectorDetail]);

  useEffect(() => {
    setDisconnectState({ status: "idle" });
  }, [connectorId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const loadedConnector = detailState.status === "loaded" ? detailState.connector : undefined;
  const drawerTitle = loadedConnector?.displayName ?? "Connector details";
  const accountLabel = loadedConnector ? getConnectorAccountLabel(loadedConnector) : undefined;
  const providerExecutionId = loadedConnector ? getProviderExecutionId(loadedConnector) : undefined;
  const disconnecting = disconnectState.status === "disconnecting";

  const handleDisconnect = useCallback(async () => {
    if (!loadedConnector?.connection.connected || disconnecting) {
      return;
    }

    setDisconnectState({ status: "disconnecting" });

    try {
      await disconnectConnector(loadedConnector.id);
      await Promise.all([refreshConnectorDetail(), onDisconnected()]);
      setDisconnectState({ status: "success", message: `${loadedConnector.displayName} has been disconnected.` });
    } catch (error) {
      setDisconnectState({
        status: "error",
        message: error instanceof Error ? error.message : `Unable to disconnect ${loadedConnector.displayName}.`
      });
    }
  }, [disconnecting, loadedConnector, onDisconnected, refreshConnectorDetail]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="connector-detail-title">
      <button className="absolute inset-0 cursor-default border-0 bg-black/30 p-0" type="button" aria-label="Close connector details" onClick={onClose} />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-border-subtle bg-surface-0 shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border-subtle p-5">
          <div className="flex flex-col gap-2">
            <p className={eyebrowClassName}>Connector details</p>
            <h2 id="connector-detail-title" className="m-0 font-heading text-2xl font-semibold tracking-[-0.02em] text-text-heading">
              {drawerTitle}
            </h2>
            {loadedConnector ? <p className="m-0 leading-[1.5] text-text-muted">{loadedConnector.description}</p> : null}
          </div>
          <button className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-subtle bg-surface-1 text-xl leading-none text-text-secondary hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus" type="button" onClick={onClose} aria-label="Close connector details">
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          {detailState.status === "idle" || detailState.status === "loading" ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface-1 p-4" aria-live="polite">
              <div className="h-4 w-28 animate-pulse rounded bg-surface-2" />
              <div className="h-8 w-40 animate-pulse rounded bg-surface-2" />
              <div className="h-20 w-full animate-pulse rounded bg-surface-2" />
              <span className="sr-only">Loading connector details</span>
            </div>
          ) : null}

          {detailState.status === "error" ? (
            <ConnectorStatePanel
              eyebrow="Error"
              title="Unable to load connector details."
              description={detailState.message}
              action={
                <button className={secondaryButtonClassName} type="button" onClick={() => void refreshConnectorDetail()}>
                  Try again
                </button>
              }
            />
          ) : null}

          {loadedConnector ? (
            <>
              {disconnectState.status === "success" ? <ConnectorInlineNotice tone="success" message={disconnectState.message} /> : null}
              {disconnectState.status === "error" ? <ConnectorInlineNotice tone="error" message={disconnectState.message} /> : null}

              <section className="rounded-2xl border border-border-subtle bg-surface-1 p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ConnectorIcon connector={loadedConnector} />
                      <div className="flex flex-col gap-1">
                        <p className="m-0 text-sm font-semibold text-text-heading">Connection status</p>
                        <p className="m-0 text-sm text-text-muted">{accountLabel ? `Connected account: ${accountLabel}` : "No connected account label is available."}</p>
                      </div>
                    </div>
                    <ConnectorStatusBadge status={loadedConnector.connection.status} />
                  </div>

                  {loadedConnector.connection.lastErrorCode ? (
                    <p className="m-0 rounded-lg border border-error/20 bg-error-subtle px-3 py-2 text-sm text-error">
                      Last connector error: {loadedConnector.connection.lastErrorMessage ?? loadedConnector.connection.lastErrorCode}
                    </p>
                  ) : null}

                  <dl className="m-0 grid gap-3 rounded-xl border border-border-subtle bg-surface-0 p-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-text-heading">Provider connector ID</dt>
                      <dd className="m-0 mt-1 break-all text-text-muted">{loadedConnector.providerConnectorId}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-text-heading">Provider execution ID</dt>
                      <dd className="m-0 mt-1 break-all text-text-muted">{providerExecutionId ?? "Shown after a connector tool execution completes."}</dd>
                    </div>
                  </dl>
                </div>
              </section>

              <section className="rounded-2xl border border-border-subtle bg-surface-1 p-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="m-0 font-heading text-lg font-semibold text-text-heading">Available allowlisted tools</h3>
                    <p className="m-0 text-sm leading-[1.5] text-text-muted">Only these curated provider tools can be mounted at chat runtime for this connector.</p>
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {loadedConnector.allowedTools.map((tool) => (
                      <li key={tool.providerToolId} className="rounded-xl border border-border-subtle bg-surface-0 p-3">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="m-0 font-semibold text-text-heading">{tool.displayName}</p>
                              <p className="m-0 break-all text-xs text-text-tertiary">{tool.providerToolId}</p>
                            </div>
                            <span className="rounded-full border border-border-subtle bg-surface-1 px-2.5 py-1 text-xs font-semibold capitalize text-text-secondary">
                              {formatPolicyLabel(tool.policy)}
                            </span>
                          </div>
                          <p className="m-0 text-sm leading-[1.5] text-text-muted">{tool.summary}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer className="flex flex-col gap-2 border-t border-border-subtle p-5 sm:flex-row sm:justify-between">
          <button className={secondaryButtonClassName} type="button" onClick={onClose}>
            Close
          </button>
          <button
            className={dangerButtonClassName}
            type="button"
            disabled={!loadedConnector || !loadedConnector.connection.connected || disconnecting}
            onClick={() => setDisconnectState({ status: "confirming" })}
            aria-label={`Disconnect ${drawerTitle}`}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </footer>

        {disconnectState.status === "confirming" || disconnectState.status === "disconnecting" ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-5" role="presentation">
            <section className="w-full max-w-md rounded-2xl border border-border-subtle bg-surface-0 p-5 shadow-xl" role="alertdialog" aria-modal="true" aria-labelledby="disconnect-confirm-title" aria-describedby="disconnect-confirm-description">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <p className={eyebrowClassName}>Confirm disconnect</p>
                  <h3 id="disconnect-confirm-title" className="m-0 font-heading text-xl font-semibold text-text-heading">
                    Disconnect {drawerTitle}?
                  </h3>
                  <p id="disconnect-confirm-description" className="m-0 leading-[1.6] text-text-muted">
                    Monet will revoke this connector when supported, remove its chat tools, and cancel any pending connector approvals{accountLabel ? ` for ${accountLabel}` : ""}.
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button className={secondaryButtonClassName} type="button" disabled={disconnecting} onClick={() => setDisconnectState({ status: "idle" })}>
                    Keep connected
                  </button>
                  <button className={dangerButtonClassName} type="button" disabled={!loadedConnector || disconnecting} onClick={() => void handleDisconnect()}>
                    {disconnecting ? "Disconnecting…" : "Disconnect connector"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>
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

export default function ConnectorsPage() {
  const { config, controllerState, isDesktop, restartController, restartPending } = useControllerState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loadState, setLoadState] = useState<ConnectorsLoadState>({ status: "idle" });
  const [actionState, setActionState] = useState<ConnectorActionState>({ status: "idle" });
  const [pendingExternalReturnConnectorId, setPendingExternalReturnConnectorId] = useState<ConnectorId | null>(null);
  const selectedConnectorId = useMemo(() => {
    const value = searchParams.get(connectorDetailQueryParam);

    return isConnectorId(value) ? value : undefined;
  }, [searchParams]);
  const controllerStatus = controllerState?.state;
  const controllerStarting = controllerStatus === "starting" || controllerStatus === "restarting";
  const controllerOffline = controllerStatus === "failed" || controllerStatus === "stopped";

  const refreshConnectors = useCallback(async () => {
    if (controllerStarting || controllerOffline) {
      return undefined;
    }

    setLoadState({ status: "loading" });

    try {
      const response = await listConnectors();
      setLoadState({ status: "loaded", connectors: response.connectors });
      return response.connectors;
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load connectors."
      });
      return undefined;
    }
  }, [controllerOffline, controllerStarting]);

  const refreshConnectorUntilConnected = useCallback(
    async (connectorId: ConnectorId) => {
      const deadline = Date.now() + 30_000;

      while (Date.now() <= deadline) {
        const connectors = await refreshConnectors();
        const connector = connectors?.find((candidate) => candidate.id === connectorId);

        if (connector?.status === "connected") {
          return true;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }

      return false;
    },
    [refreshConnectors]
  );

  useEffect(() => {
    if (!config) {
      return;
    }

    void refreshConnectors();
  }, [config, refreshConnectors]);

  useEffect(() => {
    const oauthReturnStatus = searchParams.get(connectorOAuthStatusQueryParam);

    if (!isConnectorOAuthReturnStatus(oauthReturnStatus) || controllerStarting || controllerOffline) {
      return;
    }

    const returnedConnectorId = searchParams.get(connectorOAuthIdQueryParam);
    const connectorId = isConnectorId(returnedConnectorId) ? returnedConnectorId : undefined;

    setPendingExternalReturnConnectorId(null);

    if (oauthReturnStatus === "error") {
      setActionState({
        status: "error",
        ...(connectorId ? { connectorId } : {}),
        message: "Connector authorization could not be completed. Try reconnecting the connector."
      });
    } else if (oauthReturnStatus === "pending") {
      setActionState({
        status: "success",
        ...(connectorId ? { connectorId } : {}),
        message: "Connector authorization is still pending. Monet refreshed connector status; try again shortly if it does not connect."
      });
    } else {
      setActionState({
        status: "success",
        ...(connectorId ? { connectorId } : {}),
        message: "Connector authorization completed. Monet refreshed connector status."
      });
    }

    void refreshConnectors().finally(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete(connectorOAuthStatusQueryParam);
        next.delete(connectorOAuthIdQueryParam);

        if (connectorId) {
          next.set(connectorDetailQueryParam, connectorId);
        }

        return next;
      });
    });
  }, [controllerOffline, controllerStarting, refreshConnectors, searchParams, setSearchParams]);

  const openConnectorDetail = useCallback(
    (connectorId: ConnectorId) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set(connectorDetailQueryParam, connectorId);
        return next;
      });
    },
    [setSearchParams]
  );

  const closeConnectorDetail = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete(connectorDetailQueryParam);
      return next;
    });
  }, [setSearchParams]);

  useEffect(() => {
    if (!pendingExternalReturnConnectorId) {
      return;
    }

    let refreshStarted = false;

    const refreshOnReturn = () => {
      if (refreshStarted || document.visibilityState === "hidden") {
        return;
      }

      refreshStarted = true;
      setPendingExternalReturnConnectorId(null);
      void refreshConnectorUntilConnected(pendingExternalReturnConnectorId).finally(() => {
        openConnectorDetail(pendingExternalReturnConnectorId);
      });
    };

    window.addEventListener("focus", refreshOnReturn, { once: true });
    document.addEventListener("visibilitychange", refreshOnReturn);

    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [openConnectorDetail, pendingExternalReturnConnectorId, refreshConnectorUntilConnected]);

  const handleConnectorPrimaryAction = useCallback(
    async (connector: ConnectorCatalogCard) => {
      if (connector.status === "unavailable") {
        return;
      }

      if (connector.status === "connected") {
        openConnectorDetail(connector.id);
        return;
      }

      setActionState({ status: "starting", connectorId: connector.id });

      try {
        const response = await startConnectorConnection(connector.id);

        if (response.status === "connected") {
          setActionState({ status: "success", connectorId: connector.id, message: `${connector.displayName} is connected.` });
          await refreshConnectors();
          openConnectorDetail(connector.id);
          return;
        }

        if (response.status === "pending") {
          if (response.redirectUrl) {
            await openProviderAuthorizationUrl(response.redirectUrl);
            setPendingExternalReturnConnectorId(connector.id);
          }

          setActionState({
            status: "success",
            connectorId: connector.id,
            message: response.redirectUrl
              ? `${connector.displayName} authorization opened in your browser. Return to Monet after completing provider authorization to refresh its status.`
              : `${connector.displayName} connection is pending. Return to Monet after completing provider authorization to refresh its status.`
          });
          await refreshConnectors();
          openConnectorDetail(connector.id);
          return;
        }

        if (response.redirectUrl) {
          await openProviderAuthorizationUrl(response.redirectUrl);
          setPendingExternalReturnConnectorId(connector.id);
        }

        setActionState({
          status: "success",
          connectorId: connector.id,
          message: response.redirectUrl
            ? `${connector.displayName} authorization opened in your browser. Return to Monet after completing the provider flow to refresh connector status.`
            : `${connector.displayName} authorization is ready. Complete the provider flow, then return to Monet to refresh connector status.`
        });
        await refreshConnectors();
        openConnectorDetail(connector.id);
      } catch (error) {
        setActionState({
          status: "error",
          connectorId: connector.id,
          message: error instanceof Error ? error.message : `Unable to start ${connector.displayName} connection.`
        });
      }
    },
    [openConnectorDetail, refreshConnectors]
  );

  let content: ReactNode;

  if (!config) {
    content = <ConnectorCardGrid connectors={[]} loading actionState={actionState} onPrimaryAction={handleConnectorPrimaryAction} onViewTools={openConnectorDetail} />;
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
    content = <ConnectorCardGrid connectors={[]} loading actionState={actionState} onPrimaryAction={handleConnectorPrimaryAction} onViewTools={openConnectorDetail} />;
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
        description="Add your Composio API key and connector auth config IDs in Settings to enable GitHub, Notion, and Google Drive."
        action={
          <div className="flex flex-wrap gap-2">
            <Link className={secondaryButtonClassName} to="/settings/connectors">Configure connectors</Link>
            <button className={secondaryButtonClassName} type="button" onClick={() => void refreshConnectors()}>
              Refresh status
            </button>
          </div>
        }
      />
    );
  } else {
    content = <ConnectorCardGrid connectors={loadState.connectors} actionState={actionState} onPrimaryAction={handleConnectorPrimaryAction} onViewTools={openConnectorDetail} />;
  }

  return (
    <PageFrame
      pathname="/connectors"
      title="Connectors"
      description="Connect tools and manage live artifacts with safe approvals."
      contentClassName="w-full"
    >
      {content}
      {selectedConnectorId ? <ConnectorDetailDrawer connectorId={selectedConnectorId} onClose={closeConnectorDetail} onDisconnected={async () => void (await refreshConnectors())} /> : null}
    </PageFrame>
  );
}
