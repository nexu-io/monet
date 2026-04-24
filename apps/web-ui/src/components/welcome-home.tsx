"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Badge, Button, StatusDot } from "@nexu-design/ui-web";

// Inline icon primitives keep the welcome surface dependency-free and style via
// currentColor / size tokens. We intentionally keep them tiny and glyph-like.
function Icon({ path, size = 14 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ArrowRightIcon = () => <Icon path="M3 8h10M9 4l4 4-4 4" />;
const SparkleIcon = () => <Icon size={18} path="M8 2v3M8 11v3M2 8h3M11 8h3M4.5 4.5l2 2M9.5 9.5l2 2M4.5 11.5l2-2M9.5 6.5l2-2" />;
const GearIcon = () => <Icon path="M8 10a2 2 0 100-4 2 2 0 000 4zm4.2-2a4.7 4.7 0 00-.1-1l1.2-.9-1.2-2-1.4.4a4.5 4.5 0 00-1.7-1L8.8 2H7.2l-.2 1.5a4.5 4.5 0 00-1.7 1l-1.4-.4-1.2 2 1.2.9a4.7 4.7 0 000 2l-1.2.9 1.2 2 1.4-.4a4.5 4.5 0 001.7 1l.2 1.5h1.6l.2-1.5a4.5 4.5 0 001.7-1l1.4.4 1.2-2-1.2-.9c.1-.3.1-.7.1-1z" />;
const ChatIcon = () => <Icon path="M3 4h10v7H6l-3 3V4z" />;
const WrenchIcon = () => <Icon path="M10 2a3 3 0 013 4.5l3 3-1.5 1.5-3-3A3 3 0 0110 2zM3 14l5-5" />;

import { useControllerState } from "../lib/controller-state";
import type { ProviderReadinessTarget } from "../lib/provider-readiness";
import type { SessionRecord } from "../lib/session-api";

export interface WelcomeHomeProps {
  readonly recentSessions: readonly SessionRecord[];
  readonly readyProviders: readonly ProviderReadinessTarget[];
  readonly activeProviderTarget: ProviderReadinessTarget | null;
  readonly providerSetupRequired: boolean;
  readonly isStartupLoading: boolean;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onSend: (prompt: string) => Promise<void> | void;
  readonly isComposerDisabled: boolean;
  readonly composerDisabledReason?: string;
  readonly modelSettingsHref: string;
}

function greetingForNow(): string {
  const hour = new Date().getHours();

  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatRelativeTime(updatedAt: string): string {
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);

  if (diffDays < 7) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(updatedAt));
}

export function WelcomeHome({
  recentSessions,
  readyProviders,
  activeProviderTarget,
  providerSetupRequired,
  isStartupLoading,
  onOpenSession,
  onSend,
  isComposerDisabled,
  composerDisabledReason,
  modelSettingsHref
}: WelcomeHomeProps) {
  const [value, setValue] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { controllerState, isDesktop } = useControllerState();
  const greeting = useMemo(greetingForNow, []);
  const providerLabel = activeProviderTarget
    ? `${activeProviderTarget.providerDisplayName}${activeProviderTarget.modelName ? ` · ${activeProviderTarget.modelName}` : ""}`
    : providerSetupRequired
      ? "No model configured yet"
      : "Resolving model…";
  const readyProviderCount = readyProviders.length;
  const recentCount = recentSessions.length;
  const activeRecentSessions = recentSessions.slice(0, 4);

  useEffect(() => {
    if (!isComposerDisabled) {
      textareaRef.current?.focus();
    }
  }, [isComposerDisabled]);

  async function handleSubmit() {
    const trimmed = value.trim();

    if (!trimmed || isComposerDisabled || isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      await onSend(trimmed);
      setValue("");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  const badgeTone: "success" | "warning" | "info" | "error" | "neutral" = providerSetupRequired
    ? "warning"
    : controllerState?.state === "ready" || !isDesktop
      ? "success"
      : controllerState?.state === "failed" || controllerState?.state === "stopped"
        ? "error"
        : "warning";
  const badgeText = providerSetupRequired
    ? "Finish model setup to start chatting"
    : controllerState?.state === "ready"
      ? `Ready · ${providerLabel}`
      : controllerState?.state === "starting"
        ? "Starting local controller…"
        : controllerState?.state === "restarting"
          ? "Restarting local controller…"
          : controllerState?.state === "failed" || controllerState?.state === "stopped"
            ? controllerState?.message ?? "Local controller unavailable"
            : !isDesktop
              ? `Browser mode · ${providerLabel}`
              : "Waiting for controller";

  return (
    <div className="welcome">
      <section className="welcome-hero" aria-labelledby="welcome-heading">
        <Badge variant="outline" radius="full" className="welcome-badge" aria-live="polite">
          <StatusDot status={badgeTone} size="xs" pulse={controllerState?.state === "starting" || controllerState?.state === "restarting"} />
          <span>{badgeText}</span>
        </Badge>

        <h1 id="welcome-heading" className="welcome-greeting">
          {greeting},{" "}
          <span className="welcome-greeting-accent">ready when you are.</span>
        </h1>

        <p className="welcome-subtitle">
          Ask Monet to inspect the local app, wire providers, or drive your next build loop.
          Everything runs against your local controller.
        </p>
      </section>

      <section className="welcome-composer" aria-label="Start a new conversation">
        <label className="sr-only" htmlFor="welcome-composer-input">
          Message
        </label>
        <textarea
          id="welcome-composer-input"
          ref={textareaRef}
          className="welcome-composer-textarea"
          rows={3}
          placeholder={
            isComposerDisabled
              ? composerDisabledReason ?? "Finish setup to start chatting"
              : "What should we build, debug, or explore today?"
          }
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isComposerDisabled || isSubmitting}
        />

        <div className="welcome-composer-footer">
          <div className="welcome-composer-hints">
            <kbd>⏎</kbd>
            <span>to send</span>
            <span aria-hidden="true">·</span>
            <kbd>⇧</kbd>
            <kbd>⏎</kbd>
            <span>for newline</span>
          </div>

          <div className="welcome-composer-actions">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void handleSubmit()}
              disabled={isComposerDisabled || isSubmitting || value.trim().length === 0}
              trailingIcon={<ArrowRightIcon />}
            >
              {isSubmitting ? "Sending…" : "Start chat"}
            </Button>
          </div>
        </div>
      </section>

      <section className="welcome-section" aria-labelledby="welcome-overview-heading">
        <div className="welcome-section-header">
          <h2 id="welcome-overview-heading" className="welcome-section-heading">
            Workspace at a glance
          </h2>
        </div>

        <div className="welcome-grid">
          <Link href={modelSettingsHref} className="welcome-info-card">
            <span className="welcome-info-card-eyebrow">Models</span>
            <span className="welcome-info-card-value">
              {isStartupLoading ? "—" : readyProviderCount}
            </span>
            <p className="welcome-info-card-description">
              {providerSetupRequired
                ? "No provider validated yet. Configure your first model to start chatting."
                : readyProviderCount === 1
                  ? "One provider is ready to serve requests from this shell."
                  : `${readyProviderCount} provider routes are ready across your validated models.`}
            </p>
            <span className="welcome-info-card-footer">
              <GearIcon />
              <span>Manage providers</span>
            </span>
          </Link>

          <Link href="/sessions" className="welcome-info-card">
            <span className="welcome-info-card-eyebrow">Recent chats</span>
            <span className="welcome-info-card-value">
              {isStartupLoading ? "—" : recentCount}
            </span>
            <p className="welcome-info-card-description">
              {recentCount === 0
                ? "You haven't started any sessions yet. Send your first prompt above."
                : "Open your active sessions, rename them, or archive ones you're done with."}
            </p>
            <span className="welcome-info-card-footer">
              <ChatIcon />
              <span>Browse sessions</span>
            </span>
          </Link>

          <div className="welcome-info-card" role="group" aria-label="Controller status">
            <span className="welcome-info-card-eyebrow">Controller</span>
            <span className="welcome-info-card-value" style={{ textTransform: "capitalize" }}>
              {controllerState?.state ?? (isDesktop ? "waiting" : "external")}
            </span>
            <p className="welcome-info-card-description">
              {controllerState?.message ??
                (isDesktop
                  ? "Health and restart actions live in the sidebar status footer."
                  : "Running outside the desktop shell — the controller is managed externally.")}
            </p>
            <span className="welcome-info-card-footer">
              <WrenchIcon />
              <span>{isDesktop ? "Desktop runtime" : "External runtime"}</span>
            </span>
          </div>
        </div>
      </section>

      <section className="welcome-section" aria-labelledby="welcome-recent-heading">
        <div className="welcome-section-header">
          <h2 id="welcome-recent-heading" className="welcome-section-heading">
            Pick up where you left off
          </h2>
          {recentCount > 0 ? (
            <Link href="/sessions" className="welcome-section-link">
              View all →
            </Link>
          ) : null}
        </div>

        {activeRecentSessions.length === 0 ? (
          <div
            className="welcome-info-card"
            style={{ cursor: "default", alignItems: "flex-start" }}
            role="note"
          >
            <span style={{ color: "hsl(var(--accent))", display: "inline-flex" }}>
              <SparkleIcon />
            </span>
            <span className="welcome-info-card-title">No chats yet</span>
            <p className="welcome-info-card-description">
              Every message you send will be stored by the local controller. Start above and
              this list will fill up automatically.
            </p>
          </div>
        ) : (
          <div className="welcome-grid">
            {activeRecentSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className="welcome-recent-card"
                onClick={() => onOpenSession(session.id)}
              >
                <h3 className="welcome-recent-card-title">{session.title}</h3>
                <div className="welcome-recent-card-meta">
                  <span>{formatRelativeTime(session.updatedAt)}</span>
                  <span className="welcome-recent-card-meta-dot" aria-hidden="true" />
                  <span>Open chat</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
