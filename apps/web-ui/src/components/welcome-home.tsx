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
import { sanitizeInternalRuntimeMessage } from "./workspace-copy";

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

const infoCardClassName = "flex cursor-pointer flex-col gap-1.5 rounded-xl border border-border-subtle bg-surface-1 p-4 text-left text-inherit transition-[transform,border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-px hover:border-border-strong hover:shadow-sm";
const infoCardEyebrowClassName = "text-xs font-semibold uppercase tracking-[0.06em] text-text-tertiary";
const infoCardValueClassName = "m-0 font-heading text-3xl font-bold tracking-[-0.01em] text-text-heading";
const infoCardDescriptionClassName = "m-0 text-lg leading-normal text-text-secondary";
const infoCardFooterClassName = "flex items-center gap-1.5 text-sm text-text-tertiary";
const sectionHeadingClassName = "m-0 font-heading text-2xl font-semibold tracking-[-0.01em] text-text-heading";

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
  const workspaceMessage = sanitizeInternalRuntimeMessage(controllerState?.message);
  const badgeText = providerSetupRequired
    ? "Finish model setup to start chatting"
    : controllerState?.state === "ready"
      ? `Ready · ${providerLabel}`
      : controllerState?.state === "starting"
        ? "Starting workspace…"
        : controllerState?.state === "restarting"
          ? "Restarting workspace…"
          : controllerState?.state === "failed" || controllerState?.state === "stopped"
            ? workspaceMessage ?? "Workspace unavailable"
            : !isDesktop
              ? `Browser mode · ${providerLabel}`
              : "Preparing workspace…";

  return (
    <div className="mx-auto flex max-w-[var(--app-welcome-max-width)] flex-col items-stretch gap-7 pt-4 app:gap-10 app:pt-8">
      <section className="flex flex-col items-center gap-4 text-center" aria-labelledby="welcome-heading">
        <Badge
          variant="outline"
          radius="full"
          className="border border-border-subtle bg-surface-1 px-3 py-1.25 text-sm font-medium normal-case tracking-normal text-text-secondary shadow-xs"
          aria-live="polite"
        >
          <StatusDot status={badgeTone} size="xs" className="size-2" pulse={controllerState?.state === "starting" || controllerState?.state === "restarting"} />
          <span>{badgeText}</span>
        </Badge>

        <h1 id="welcome-heading" className="m-0 font-heading text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.1] tracking-[-0.02em] text-text-heading">
          {greeting},{" "}
          <span className="font-semibold italic text-accent">ready when you are.</span>
        </h1>

        <p className="m-0 max-w-[56ch] text-2xl text-text-secondary">
          Ask Monet to inspect the local app, wire providers, or drive your next build loop.
          Everything stays on your machine.
        </p>
      </section>

      <section className="flex flex-col gap-2.5 rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-sm transition-[box-shadow,border-color] duration-[var(--duration-normal)] ease-[var(--ease-standard)] focus-within:border-border-strong focus-within:shadow-md" aria-label="Start a new conversation">
        <label className="sr-only" htmlFor="welcome-composer-input">
          Message
        </label>
        <textarea
          id="welcome-composer-input"
          ref={textareaRef}
          className="min-h-22 max-h-[40vh] w-full resize-none border-0 bg-transparent p-0 font-sans text-2xl leading-normal text-text-primary outline-none placeholder:text-text-placeholder"
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

        <div className="flex flex-col flex-wrap items-start justify-between gap-3 app:flex-row app:items-center">
          <div className="flex items-center gap-2 text-sm text-text-tertiary">
            <kbd className="inline-flex items-center rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-text-secondary">⏎</kbd>
            <span>to send</span>
            <span aria-hidden="true">·</span>
            <kbd className="inline-flex items-center rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-text-secondary">⇧</kbd>
            <kbd className="inline-flex items-center rounded-sm border border-border-subtle bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-text-secondary">⏎</kbd>
            <span>for newline</span>
          </div>

          <div className="flex w-full items-center gap-2 app:w-auto">
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

      <section className="flex flex-col gap-4" aria-labelledby="welcome-overview-heading">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="welcome-overview-heading" className={sectionHeadingClassName}>
            Workspace at a glance
          </h2>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <Link href={modelSettingsHref} className={infoCardClassName}>
            <span className={infoCardEyebrowClassName}>Models</span>
            <span className={infoCardValueClassName}>
              {isStartupLoading ? "—" : readyProviderCount}
            </span>
            <p className={infoCardDescriptionClassName}>
              {providerSetupRequired
                ? "No provider validated yet. Configure your first model to start chatting."
                : readyProviderCount === 1
                  ? "One provider is ready to serve requests from this shell."
                  : `${readyProviderCount} provider routes are ready across your validated models.`}
            </p>
            <span className={infoCardFooterClassName}>
              <GearIcon />
              <span>Manage providers</span>
            </span>
          </Link>

          <Link href="/sessions" className={infoCardClassName}>
            <span className={infoCardEyebrowClassName}>Recent chats</span>
            <span className={infoCardValueClassName}>
              {isStartupLoading ? "—" : recentCount}
            </span>
            <p className={infoCardDescriptionClassName}>
              {recentCount === 0
                ? "You haven't started any sessions yet. Send your first prompt above."
                : "Open your active sessions, rename them, or archive ones you're done with."}
            </p>
            <span className={infoCardFooterClassName}>
              <ChatIcon />
              <span>Browse sessions</span>
            </span>
          </Link>

          <div className={infoCardClassName} role="group" aria-label="Workspace status">
            <span className={infoCardEyebrowClassName}>Workspace</span>
            <span className={`${infoCardValueClassName} capitalize`}>
              {controllerState?.state === "ready"
                ? "Ready"
                : controllerState?.state === "starting"
                  ? "Starting"
                  : controllerState?.state === "restarting"
                    ? "Restarting"
                    : controllerState?.state === "failed"
                      ? "Unavailable"
                      : controllerState?.state === "stopped"
                        ? "Stopped"
                        : isDesktop
                          ? "Preparing"
                          : "Browser"}
            </span>
            <p className={infoCardDescriptionClassName}>
              {workspaceMessage ??
                (isDesktop
                  ? "Health and restart actions live in the sidebar status footer."
                  : "Running in the browser — your workspace is managed externally.")}
            </p>
            <span className={infoCardFooterClassName}>
              <WrenchIcon />
              <span>{isDesktop ? "Desktop workspace" : "Browser workspace"}</span>
            </span>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="welcome-recent-heading">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="welcome-recent-heading" className={sectionHeadingClassName}>
            Pick up where you left off
          </h2>
          {recentCount > 0 ? (
            <Link href="/sessions" className="text-sm font-medium text-text-tertiary hover:text-text-primary">
              View all →
            </Link>
          ) : null}
        </div>

        {activeRecentSessions.length === 0 ? (
          <div
            className={`${infoCardClassName} cursor-default items-start`}
            role="note"
          >
            <span className="inline-flex text-accent">
              <SparkleIcon />
            </span>
            <span className="m-0 text-2xl font-semibold tracking-[-0.005em] text-text-heading">No chats yet</span>
            <p className={infoCardDescriptionClassName}>
              Every message you send is saved locally. Start a chat above and
              this list will fill up automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
            {activeRecentSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border-subtle bg-surface-1 p-4 text-left text-inherit transition-[transform,border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:-translate-y-px hover:border-border-strong hover:shadow-sm"
                onClick={() => onOpenSession(session.id)}
              >
                <h3 className="m-0 line-clamp-2 text-xl font-semibold leading-[1.35] text-text-heading">{session.title}</h3>
                <div className="flex items-center gap-2 text-sm text-text-tertiary">
                  <span>{formatRelativeTime(session.updatedAt)}</span>
                  <span className="size-1 rounded-full bg-text-tertiary" aria-hidden="true" />
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
