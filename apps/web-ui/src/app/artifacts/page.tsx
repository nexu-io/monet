"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { PageFrame } from "../../components/page-frame";
import { useSessions } from "../../components/session-provider";
import { LIVE_ARTIFACT_DISCOVERY_PROMPT, stashPendingChatPrompt } from "../../lib/chat-prompt-seed";
import { listLiveArtifacts, type LiveArtifactSourceState, type LiveArtifactSummary } from "../../lib/live-artifacts-api";

type ArtifactsLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "loaded"; readonly artifacts: LiveArtifactSummary[] };

const statePanelClassName = "rounded-2xl border border-border-subtle bg-surface-1 p-6 shadow-xs";
const eyebrowClassName = "m-0 text-xs font-semibold uppercase tracking-[0.1em] text-text-tertiary";
const titleClassName = "m-0 font-heading text-xl font-semibold tracking-[-0.01em] text-text-heading";
const descriptionClassName = "m-0 max-w-[68ch] leading-[1.6] text-text-muted";
const primaryButtonClassName = "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-accent bg-accent px-3.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-2 disabled:text-text-tertiary disabled:shadow-none";
const secondaryButtonClassName = "inline-flex min-h-9 cursor-pointer items-center justify-center rounded-md border border-border-subtle bg-surface-0 px-3.5 text-sm font-medium text-text-primary transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";
const artifactGridClassName = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

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

function getArtifactRecency(artifact: LiveArtifactSummary) {
  return artifact.lastRefreshedAt ?? artifact.updatedAt ?? artifact.createdAt;
}

function sortArtifactsPinnedFirst(artifacts: readonly LiveArtifactSummary[]) {
  return [...artifacts].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    return new Date(getArtifactRecency(right)).getTime() - new Date(getArtifactRecency(left)).getTime();
  });
}

function ArtifactStatusBadge({ artifact }: { readonly artifact: LiveArtifactSummary }) {
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

function getActionableSourceStates(sourceStates: readonly LiveArtifactSourceState[] | undefined) {
  return (sourceStates ?? []).filter((sourceState) => sourceState.state !== "ok");
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
      return "Stale tool";
    case "ok":
      return "Connected";
  }
}

function SourceStateSummary({ sourceStates }: { readonly sourceStates: readonly LiveArtifactSourceState[] | undefined }) {
  const actionableStates = getActionableSourceStates(sourceStates);

  if (actionableStates.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-sm text-warning">
      <div className="flex flex-wrap gap-1.5">
        {actionableStates.slice(0, 3).map((sourceState) => (
          <span key={`${sourceState.tileId}-${sourceState.state}`} className="inline-flex items-center rounded-full border border-warning/25 bg-surface-0/60 px-2 py-0.5 text-xs font-semibold text-warning">
            {getSourceStateLabel(sourceState.state)}
          </span>
        ))}
        {actionableStates.length > 3 ? <span className="text-xs font-semibold text-warning">+{actionableStates.length - 3} more</span> : null}
      </div>
      <p className="m-0 line-clamp-2">
        {actionableStates[0]?.message} {actionableStates.length > 1 ? `(${actionableStates.length} source issues)` : ""}
      </p>
    </div>
  );
}

function ArtifactCard({ artifact }: { readonly artifact: LiveArtifactSummary }) {
  const description = artifact.description?.trim() || "No description yet.";
  const refreshedLabel = formatDateTime(artifact.lastRefreshedAt);
  const updatedLabel = formatDateTime(artifact.updatedAt);

  return (
    <article className="flex min-h-[14rem] flex-col justify-between gap-5 rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {artifact.pinned ? <span className="inline-flex items-center rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">Pinned</span> : null}
              <ArtifactStatusBadge artifact={artifact} />
            </div>
            <h2 className="m-0 line-clamp-2 font-heading text-lg font-semibold tracking-[-0.01em] text-text-heading">{artifact.title}</h2>
          </div>
        </div>

        <p className="m-0 line-clamp-3 leading-[1.6] text-text-secondary">{description}</p>

        <dl className="m-0 grid gap-2 rounded-lg border border-border-subtle bg-surface-0 px-3 py-2 text-sm text-text-muted">
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-text-tertiary">Last refreshed</dt>
            <dd className="m-0 text-right text-text-primary">{refreshedLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-text-tertiary">Updated</dt>
            <dd className="m-0 text-right text-text-primary">{updatedLabel}</dd>
          </div>
        </dl>

        <SourceStateSummary sourceStates={artifact.sourceStates} />

        {artifact.lastRefreshError ? <p className="m-0 rounded-lg border border-warning/20 bg-warning-subtle px-3 py-2 text-sm text-warning">{artifact.lastRefreshError}</p> : null}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:items-center">
        <Link className={primaryButtonClassName} to={`/artifacts/${artifact.id}`}>
          Open artifact
        </Link>
        <Link className={secondaryButtonClassName} to="/connectors">
          Browse connectors
        </Link>
      </div>
    </article>
  );
}

function ArtifactCardGrid({ artifacts }: { readonly artifacts: readonly LiveArtifactSummary[] }) {
  return (
    <section className="flex flex-col gap-4" aria-label="Live artifacts">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm text-text-muted">Pinned artifacts appear first. Archived artifacts are hidden from this view.</p>
        <span className="text-sm font-medium text-text-tertiary">{artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}</span>
      </div>
      <div className={artifactGridClassName}>
        {artifacts.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} />
        ))}
      </div>
    </section>
  );
}

function ArtifactStatePanel({ eyebrow, title, description, action }: { readonly eyebrow: string; readonly title: string; readonly description: string; readonly action?: ReactNode }) {
  return (
    <section className={statePanelClassName}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className={eyebrowClassName}>{eyebrow}</p>
          <h2 className={titleClassName}>{title}</h2>
          <p className={descriptionClassName}>{description}</p>
        </div>
        {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </section>
  );
}

function LoadingArtifactsState() {
  return (
    <section className={artifactGridClassName} aria-live="polite" aria-label="Loading live artifacts">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex min-h-[14rem] flex-col gap-4 rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-xs">
          <div className="h-5 w-24 animate-pulse rounded bg-surface-2" />
          <div className="h-7 w-3/4 animate-pulse rounded bg-surface-2" />
          <div className="h-16 w-full animate-pulse rounded bg-surface-2" />
          <div className="mt-auto h-9 w-32 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
      <span className="sr-only">Loading live artifacts</span>
    </section>
  );
}

function NewArtifactButton({ children }: { readonly children: ReactNode }) {
  const { createSession } = useSessions();
  const [isStarting, setIsStarting] = useState(false);

  async function handleStartNewArtifactChat() {
    if (isStarting) {
      return;
    }

    setIsStarting(true);

    try {
      stashPendingChatPrompt(LIVE_ARTIFACT_DISCOVERY_PROMPT);
      await createSession({ pathname: "/" });
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <button
      className={primaryButtonClassName}
      type="button"
      aria-label="Start a chat to create a new live artifact"
      disabled={isStarting}
      onClick={() => void handleStartNewArtifactChat()}
    >
      {isStarting ? "Starting…" : children}
    </button>
  );
}

function ArtifactsHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 font-heading text-3xl font-bold tracking-[-0.01em] text-text-heading">Live Artifacts</h1>
        <p className="m-0 max-w-[68ch] text-text-secondary">Reusable dashboards and briefs created from chats, connector tools, and safe refreshable sources.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link className={secondaryButtonClassName} to="/connectors">
          Browse connectors
        </Link>
        <NewArtifactButton>
          New artifact
        </NewArtifactButton>
      </div>
    </div>
  );
}

export default function ArtifactsPage() {
  const [loadState, setLoadState] = useState<ArtifactsLoadState>({ status: "idle" });

  const refreshArtifacts = useCallback(async () => {
    setLoadState({ status: "loading" });

    try {
      const response = await listLiveArtifacts({ includeArchived: false });
      setLoadState({ status: "loaded", artifacts: response.artifacts });
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load live artifacts."
      });
    }
  }, []);

  useEffect(() => {
    void refreshArtifacts();
  }, [refreshArtifacts]);

  const sortedArtifacts = useMemo(() => (loadState.status === "loaded" ? sortArtifactsPinnedFirst(loadState.artifacts) : []), [loadState]);

  let content: ReactNode;

  if (loadState.status === "idle" || loadState.status === "loading") {
    content = <LoadingArtifactsState />;
  } else if (loadState.status === "error") {
    content = (
      <ArtifactStatePanel
        eyebrow="Error"
        title="Unable to load live artifacts."
        description={loadState.message}
        action={
          <button className={secondaryButtonClassName} type="button" onClick={() => void refreshArtifacts()}>
            Try again
          </button>
        }
      />
    );
  } else if (sortedArtifacts.length === 0) {
    content = (
      <ArtifactStatePanel
        eyebrow="Empty"
        title="No live artifacts yet."
        description="Start a chat to create a saved artifact, or connect read-only-capable tools first so Monet can gather repeatable source data. Connector setup lives on the Connectors page."
        action={
          <>
            <NewArtifactButton>
              New artifact
            </NewArtifactButton>
            <Link className={secondaryButtonClassName} to="/connectors">
              Browse connectors
            </Link>
          </>
        }
      />
    );
  } else {
    content = <ArtifactCardGrid artifacts={sortedArtifacts} />;
  }

  return (
    <PageFrame
      pathname="/artifacts"
      title="Live Artifacts"
      description="Reusable dashboards and briefs created from chats, connector tools, and safe refreshable sources."
      header={<ArtifactsHeader />}
      contentClassName="w-full !max-w-[calc(var(--spacing)*340)]"
    >
      {content}
    </PageFrame>
  );
}
