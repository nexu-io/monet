import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, MessageSquare, RefreshCw, RotateCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { ArtifactHtmlFrame } from "../../components/live-artifacts/artifact-html-frame";
import { PageFrame } from "../../components/page-frame";
import { useSessions } from "../../components/session-provider";
import {
  getLiveArtifact,
  refreshLiveArtifact,
  type LiveArtifact
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
const primaryButtonClassName = "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-2 disabled:text-text-tertiary disabled:shadow-none";
const secondaryButtonClassName = "inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-subtle bg-surface-0 px-3.5 text-sm font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";

export default function ArtifactDetailPage() {
  const { artifactId } = useParams<{ artifactId: string }>();
  const [loadState, setLoadState] = useState<ArtifactLoadState>({ status: "idle" });
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
                <RotateCw className="size-3.5" aria-hidden="true" />
                Try again
              </button>
              <Link className={secondaryButtonClassName} to="/artifacts">
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to Artifacts
              </Link>
            </div>
          </div>
        </div>
      </PageFrame>
    );
  }

  const artifact = loadState.artifact;
  const isStaticHtmlArtifact = artifact.contentType === "html_page_v1" && artifact.document?.sourceJson?.refreshPermission !== "manual_refresh_granted_for_read_only";
  
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2 min-w-0">
          <h1 className="m-0 font-heading text-xl font-bold tracking-[-0.01em] text-text-heading">{artifact.title}</h1>
          {artifact.description && <p className="m-0 max-w-[68ch] text-sm text-text-secondary">{artifact.description}</p>}
        </div>
        
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button 
            className={secondaryButtonClassName} 
            type="button" 
            onClick={handleRefresh}
            disabled={isRefreshing || artifact.refreshStatus === "refreshing" || isStaticHtmlArtifact}
            title={isStaticHtmlArtifact ? "This HTML artifact has no refreshable data source yet." : undefined}
          >
            <RefreshCw className={isRefreshing || artifact.refreshStatus === "refreshing" ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden="true" />
            {isRefreshing || artifact.refreshStatus === "refreshing" ? "Refreshing..." : "Refresh"}
          </button>
          
          <button 
            className={secondaryButtonClassName} 
            type="button" 
            disabled 
            title="Download as PDF will be available in a future update."
          >
            <Download className="size-3.5" aria-hidden="true" />
            Download PDF
          </button>
          
          {isSessionAvailable ? (
            <Link 
              className={primaryButtonClassName} 
              to={buildSessionHref("/", artifact.sessionId)}
            >
              <MessageSquare className="size-3.5" aria-hidden="true" />
              Open chat
            </Link>
          ) : (
            <button 
              className={primaryButtonClassName} 
              type="button" 
              disabled 
              title={creatingChatUnavailableReason}
            >
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {artifact.sessionId && isSessionsLoading ? "Checking chat…" : "Open chat"}
            </button>
          )}
        </div>
      </div>
      
      {refreshError && (
        <div className="rounded-lg border border-warning/20 bg-warning-subtle px-4 py-3 text-sm text-warning">
          {refreshError}
        </div>
      )}
      {isStaticHtmlArtifact && (
        <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3 text-sm text-text-muted">
          This HTML artifact is static. Refresh becomes available when the artifact document includes a granted read-only data source.
        </div>
      )}
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
      description={artifact.description || "Live artifact"}
      header={header}
      contentClassName="w-full"
      contentWrapper="none"
    >
      {artifact.document ? (
        <ArtifactHtmlFrame document={artifact.document} title={artifact.title} />
      ) : (
        <div className={statePanelClassName}>
          <p className="m-0 text-center text-text-muted">This artifact has no renderable content yet.</p>
        </div>
      )}
    </PageFrame>
  );
}
