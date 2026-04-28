import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ArtifactTileRenderContent } from "../../components/artifact-tile-renderer";
import { PageFrame } from "../../components/page-frame";
import { useSessions } from "../../components/session-provider";
import {
  getLiveArtifact,
  pinLiveArtifact,
  refreshLiveArtifact,
  type LiveArtifact,
  type LiveArtifactSourceState,
  type LiveArtifactTile
} from "../../lib/live-artifacts-api";

type ArtifactLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "loaded"; readonly artifact: LiveArtifact };

const statePanelClassName = "rounded-2xl border border-border-subtle bg-surface-1 p-6 shadow-xs";
const eyebrowClassName = "m-0 text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary";
const titleClassName = "m-0 font-heading text-xl font-semibold tracking-[-0.01em] text-text-heading";
const descriptionClassName = "m-0 max-w-[68ch] leading-[1.6] text-text-muted";
const primaryButtonClassName = "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-2 disabled:text-text-tertiary disabled:shadow-none";
const secondaryButtonClassName = "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-border-subtle bg-surface-0 px-3.5 text-sm font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not refreshed yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function ArtifactStatusBadge({ artifact }: { readonly artifact: LiveArtifact }) {
  if (artifact.refreshStatus === "refreshing") {
    return <span className="inline-flex items-center rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">Refreshing</span>;
  }

  if (artifact.refreshStatus === "failed") {
    return <span className="inline-flex items-center rounded-full border border-warning/25 bg-warning-subtle px-2.5 py-1 text-xs font-semibold text-warning">Refresh issue</span>;
  }

  if (artifact.status === "draft") {
    return <span className="inline-flex items-center rounded-full border border-border-strong bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-tertiary">Draft</span>;
  }

  return <span className="inline-flex items-center rounded-full border border-success/25 bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success">Active</span>;
}

function getSourceStateLabel(state: LiveArtifactSourceState["state"]) {
  switch (state) {
    case "disconnected":
      return "Disconnected";
    case "expired":
      return "Expired";
    case "missing_connector":
      return "Missing connector";
    case "stale_provider_tool":
      return "Stale provider tool";
    case "ok":
      return "Connected";
  }
}

function getActionableSourceStates(sourceStates: readonly LiveArtifactSourceState[] | undefined) {
  return (sourceStates ?? []).filter((sourceState) => sourceState.state !== "ok");
}

function SourceStateBadge({ sourceState }: { readonly sourceState: LiveArtifactSourceState }) {
  const isOk = sourceState.state === "ok";

  return (
    <span
      className={isOk
        ? "inline-flex items-center gap-1.5 rounded-md border border-success/20 bg-success-subtle px-2 py-1 text-xs font-medium text-success"
        : "inline-flex items-center gap-1.5 rounded-md border border-warning/20 bg-warning-subtle px-2 py-1 text-xs font-medium text-warning"}
      title={sourceState.message}
    >
      {getSourceStateLabel(sourceState.state)}
    </span>
  );
}

function SourceStateNotice({ sourceStates }: { readonly sourceStates: readonly LiveArtifactSourceState[] | undefined }) {
  const actionableStates = getActionableSourceStates(sourceStates);

  if (actionableStates.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">
      <p className="m-0 font-semibold">{actionableStates.length} connector source{actionableStates.length === 1 ? "" : "s"} need attention.</p>
      <ul className="m-0 mt-2 list-disc space-y-1 pl-5">
        {actionableStates.map((sourceState) => (
          <li key={`${sourceState.tileId}-${sourceState.state}`}>
            <span className="font-medium">{sourceState.tileTitle}:</span> {getSourceStateLabel(sourceState.state)} — {sourceState.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TileSourceBadge({ tile }: { readonly tile: LiveArtifactTile }) {
  const source = tile.sourceJson;

  if (!source) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2 py-1 text-xs font-medium text-text-secondary">
        Static (No source)
      </span>
    );
  }

  const isConnector = source.type === "connector_tool" && source.connector;
  const name = isConnector ? source.connector?.connectorName : source.toolName;
  const account = isConnector ? source.connector?.accountLabel : null;
  
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2 py-1 text-xs font-medium text-text-secondary">
        Source: {name} {account ? `(${account})` : ""}
      </span>
      {source.refreshPermission === "manual_refresh_granted_for_read_only" ? (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-success/20 bg-success-subtle px-2 py-1 text-xs font-medium text-success">
          Refresh permitted
        </span>
      ) : source.refreshPermission === "requires_confirmation" ? (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/20 bg-warning-subtle px-2 py-1 text-xs font-medium text-warning">
          Requires confirmation
        </span>
      ) : null}
      {tile.sourceState ? <SourceStateBadge sourceState={tile.sourceState} /> : null}
    </div>
  );
}

function TileRenderer({ tile }: { readonly tile: LiveArtifactTile }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface-1 p-5 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="m-0 font-heading text-lg font-semibold text-text-heading">{tile.title}</h3>
        <TileSourceBadge tile={tile} />
      </div>
      
      <div className="rounded-lg bg-surface-0 p-4 border border-border-subtle/50">
        <ArtifactTileRenderContent renderJson={tile.renderJson} />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3 text-xs text-text-tertiary">
        <span>Last refreshed: {formatDateTime(tile.lastRefreshedAt)}</span>
        {tile.refreshStatus === "refreshing" && <span className="text-accent">Refreshing...</span>}
        {tile.refreshStatus === "failed" && <span className="text-warning">Refresh failed</span>}
      </div>
      {tile.lastError && (
        <div className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning border border-warning/20">
          {tile.lastError}
        </div>
      )}
    </div>
  );
}

export default function ArtifactDetailPage() {
  const { artifactId } = useParams<{ artifactId: string }>();
  const [loadState, setLoadState] = useState<ArtifactLoadState>({ status: "idle" });
  const [isPinning, setIsPinning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const { sessions, buildSessionHref, isSessionsLoading } = useSessions();

  const loadArtifact = useCallback(async () => {
    if (!artifactId) return;
    setLoadState({ status: "loading" });

    try {
      const response = await getLiveArtifact(artifactId);
      setLoadState({ status: "loaded", artifact: response.artifact });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load live artifact."
      });
    }
  }, [artifactId]);

  useEffect(() => {
    void loadArtifact();
  }, [loadArtifact]);

  const handlePinToggle = async () => {
    if (loadState.status !== "loaded" || !artifactId) return;
    
    const currentPinned = loadState.artifact.pinned;
    setIsPinning(true);
    
    try {
      const response = await pinLiveArtifact(artifactId, !currentPinned);
      setLoadState({ status: "loaded", artifact: response.artifact });
    } catch (error) {
      // Ignore error for now, maybe show toast in a real app
    } finally {
      setIsPinning(false);
    }
  };

  const handleRefresh = async () => {
    if (loadState.status !== "loaded" || !artifactId) return;
    
    setIsRefreshing(true);
    setRefreshError(null);
    
    try {
      const response = await refreshLiveArtifact(artifactId);
      setLoadState({ status: "loaded", artifact: response.artifact });
      
      if (response.failures && response.failures.length > 0) {
        setRefreshError(`Failed to refresh ${response.failures.length} tile(s).`);
      }
    } catch (error) {
      const maybeRefreshError = error as { readonly disabled?: boolean; readonly status?: number; readonly message?: string };

      if (maybeRefreshError.disabled || maybeRefreshError.status === 501) {
        setRefreshError("Automatic refresh is not supported or currently disabled for this artifact.");
      } else {
        setRefreshError(maybeRefreshError.message || "Failed to refresh artifact.");
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  if (loadState.status === "idle" || loadState.status === "loading") {
    return (
      <PageFrame pathname="/artifacts" title="Loading Artifact..." description="Loading live artifact details..." contentClassName="w-full !max-w-[calc(var(--spacing)*340)]">
        <div className="flex flex-col gap-6" aria-live="polite" aria-label="Loading artifact details">
          <div className="h-10 w-1/3 animate-pulse rounded bg-surface-2" />
          <div className="h-20 w-full animate-pulse rounded bg-surface-2" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-64 w-full animate-pulse rounded-xl bg-surface-2" />
            <div className="h-64 w-full animate-pulse rounded-xl bg-surface-2" />
          </div>
        </div>
      </PageFrame>
    );
  }

  if (loadState.status === "error") {
    return (
      <PageFrame pathname="/artifacts" title="Error" description="Failed to load the requested artifact." contentClassName="w-full !max-w-[calc(var(--spacing)*340)]">
        <div className={statePanelClassName}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <p className={eyebrowClassName}>Error</p>
              <h2 className={titleClassName}>Unable to load live artifact.</h2>
              <p className={descriptionClassName}>{loadState.message}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={secondaryButtonClassName} type="button" onClick={() => void loadArtifact()}>
                Try again
              </button>
              <Link className={secondaryButtonClassName} to="/artifacts">
                Back to Artifacts
              </Link>
            </div>
          </div>
        </div>
      </PageFrame>
    );
  }

  const artifact = loadState.artifact;
  
  // Check if session is available
  const matchingSession = artifact.sessionId ? sessions.find(s => s.id === artifact.sessionId) : null;
  const isSessionAvailable = matchingSession && matchingSession.archivedAt === null;
  const creatingChatUnavailableReason = !artifact.sessionId
    ? "This artifact was not created from a chat session."
    : isSessionsLoading
      ? "Checking the creating chat session…"
      : "The chat session that created this artifact has been deleted or archived.";
  
  const header = (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-sm font-medium text-text-tertiary">
        <Link to="/artifacts" className="hover:text-text-primary transition-colors">Artifacts</Link>
        <span>/</span>
        <span className="text-text-primary truncate max-w-[200px]">{artifact.title}</span>
      </div>
      
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {artifact.pinned ? <span className="inline-flex items-center rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">Pinned</span> : null}
            <ArtifactStatusBadge artifact={artifact} />
            <span className="inline-flex items-center rounded-full border border-border-subtle bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-secondary">
              Refreshed {formatDateTime(artifact.lastRefreshedAt)}
            </span>
          </div>
          <h1 className="m-0 font-heading text-3xl font-bold tracking-[-0.01em] text-text-heading">{artifact.title}</h1>
          {artifact.description && <p className="m-0 max-w-[68ch] text-text-secondary">{artifact.description}</p>}
        </div>
        
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button 
            className={secondaryButtonClassName} 
            type="button" 
            onClick={handlePinToggle}
            disabled={isPinning}
          >
            {artifact.pinned ? "Unpin" : "Pin"}
          </button>
          
          <button 
            className={secondaryButtonClassName} 
            type="button" 
            onClick={handleRefresh}
            disabled={isRefreshing || artifact.refreshStatus === "refreshing"}
          >
            {isRefreshing || artifact.refreshStatus === "refreshing" ? "Refreshing..." : "Refresh"}
          </button>
          
          <button 
            className={secondaryButtonClassName} 
            type="button" 
            disabled 
            title="Download as PDF will be available in a future update."
          >
            Download PDF
          </button>
          
          {isSessionAvailable ? (
            <Link 
              className={primaryButtonClassName} 
              to={buildSessionHref("/", artifact.sessionId)}
            >
              Open creating chat
            </Link>
          ) : (
            <button 
              className={primaryButtonClassName} 
              type="button" 
              disabled 
              title={creatingChatUnavailableReason}
            >
              {artifact.sessionId && isSessionsLoading ? "Checking chat…" : "Open creating chat"}
            </button>
          )}
        </div>
      </div>
      
      {refreshError && (
        <div className="rounded-lg border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">
          {refreshError}
        </div>
      )}
      <SourceStateNotice sourceStates={artifact.sourceStates} />
      {artifact.lastRefreshError && !refreshError && (
        <div className="rounded-lg border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">
          Last refresh error: {artifact.lastRefreshError}
        </div>
      )}
    </div>
  );

  return (
    <PageFrame
      pathname={`/artifacts/${artifact.id}`}
      title={artifact.title}
      description={artifact.description || `Live artifact with ${artifact.tiles.length} tile(s)`}
      header={header}
      contentClassName="w-full !max-w-[calc(var(--spacing)*340)]"
    >
      <div className="flex flex-col gap-6">
        {artifact.tiles.length === 0 ? (
          <div className={statePanelClassName}>
            <p className="m-0 text-center text-text-muted">This artifact has no content tiles yet.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {artifact.tiles.map((tile) => (
              <TileRenderer key={tile.id} tile={tile} />
            ))}
          </div>
        )}
      </div>
    </PageFrame>
  );
}
