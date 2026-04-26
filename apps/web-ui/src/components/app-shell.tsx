"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Button,
  NavigationMenu,
  NavigationMenuButton,
  NavigationMenuItem,
  NavigationMenuLabel,
  NavigationMenuList,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader
} from "@nexu-design/ui-web";

import { useControllerState } from "../lib/controller-state";
import { useSessions } from "./session-provider";

function formatSessionPreview(updatedAt: string) {
  const value = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(updatedAt));

  return value;
}

export function AppShell({
  children,
  pathname,
  header,
  composer,
  onDesktopStopShortcut
}: {
  children: ReactNode;
  pathname: string;
  header?: ReactNode;
  composer?: ReactNode;
  onDesktopStopShortcut?: () => void;
}) {
  const navigate = useNavigate();
  const {
    createSession,
    currentSessionId,
    isSessionsLoading,
    openSession,
    providerReadiness,
    sessions
  } = useSessions();
  const recentSessions = sessions.filter((session) => session.archivedAt === null).slice(0, 20);
  const isProviderReadinessLoading = providerReadiness.loading;
  const providerSetupRequired = !providerReadiness.loading && !providerReadiness.error && !providerReadiness.data?.hasReadyProvider;
  const { isDesktop } = useControllerState();
  const [desktopPlatform, setDesktopPlatform] = useState<string | undefined>();
  const isSettingsOpen = pathname.startsWith("/settings");
  const openSettingsHref = "/settings/general";

  useEffect(() => {
    setDesktopPlatform(window.monetDesktop?.platform);
  }, []);

  async function handleCreateSession() {
    if (providerSetupRequired) {
      navigate("/settings/models");
      return;
    }

    await createSession({ pathname: "/" });
  }

  useEffect(() => {
    const desktopApi = typeof window === "undefined" ? undefined : window.monetDesktop;

    if (!desktopApi?.onShortcut) {
      return;
    }

    return desktopApi.onShortcut(({ action }) => {
      if (action === "new-session") {
        void handleCreateSession();
        return;
      }

      if (action === "open-settings") {
        navigate("/settings/general");
      }
    });
  }, [navigate, onDesktopStopShortcut, pathname]);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      const isStopShortcut = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === ".";

      if (isStopShortcut) {
        event.preventDefault();
        onDesktopStopShortcut?.();
        return;
      }

      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();

      if (pathname.startsWith("/settings")) {
        navigate("/");
        return;
      }

      onDesktopStopShortcut?.();

      const activeElement = document.activeElement;

      if (!(activeElement instanceof HTMLElement) || activeElement === document.body) {
        return;
      }

      activeElement.blur();
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isDesktop, navigate, onDesktopStopShortcut, pathname]);

  return (
    <div
      className="grid h-screen min-h-0 grid-cols-[var(--app-shell-width)_minmax(0,1fr)] overflow-hidden bg-app-canvas max-app:h-auto max-app:min-h-screen max-app:grid-cols-1 max-app:overflow-visible"
      data-desktop-shell={isDesktop ? "true" : "false"}
      data-desktop-platform={desktopPlatform}
    >
      <Sidebar className={`sticky top-0 flex h-screen min-h-0 flex-col gap-5 overflow-hidden border-r border-border-subtle bg-app-sidebar px-4 pb-5 max-app:static max-app:h-auto max-app:overflow-visible max-app:border-r-0 max-app:border-b ${isDesktop ? "pt-3" : "pt-5"}`}>
        {isDesktop ? <div className="mb-2 block min-h-[28px] [-webkit-app-region:drag]" aria-hidden="true" /> : null}

        <SidebarHeader className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5 p-1">
            <span className="inline-flex size-8 items-center justify-center rounded-md bg-accent font-heading text-lg font-bold tracking-[-0.02em] text-accent-foreground" aria-hidden="true">M</span>
            <div className="flex flex-col gap-1">
              <span className="font-heading text-2xl leading-none font-semibold tracking-[-0.01em] text-text-heading">Monet</span>
              <span className="text-xs tracking-[0.04em] text-text-tertiary uppercase">Your local AI workspace</span>
            </div>
          </div>

          <Button
            type="button"
            variant="primary"
            size="md"
            className="w-full justify-start"
            onClick={() => void handleCreateSession()}
            disabled={isProviderReadinessLoading}
          >
            {isProviderReadinessLoading
              ? "Checking setup…"
              : providerSetupRequired
                ? "Finish model setup"
                : "+ New chat"}
          </Button>

        </SidebarHeader>

        <SidebarContent className="flex min-h-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 flex-col gap-2" aria-labelledby="recent-sessions-heading">
            <div className="flex items-baseline justify-between gap-2 px-2">
              <NavigationMenuLabel className="text-2xs font-semibold tracking-[0.1em] text-text-tertiary uppercase" id="recent-sessions-heading">
                Recent
              </NavigationMenuLabel>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto">
              {isSessionsLoading && recentSessions.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-text-tertiary">Loading sessions…</p>
              ) : null}
              {!isSessionsLoading && recentSessions.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-text-tertiary">
                  {providerSetupRequired ? "Finish provider setup to create the first chat." : "No active chats yet."}
                </p>
              ) : null}
              {recentSessions.map((session) => {
                const isActive = session.id === currentSessionId;

                return (
                  <button
                    key={session.id}
                    type="button"
                    className="grid grid-cols-[minmax(0,1fr)] gap-0 rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-text-secondary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-app-hover hover:text-text-primary focus-visible:shadow-focus focus-visible:outline-none data-[active=true]:bg-app-hover data-[active=true]:text-text-heading"
                    data-active={isActive ? "true" : "false"}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => openSession(session.id, "/")}
                  >
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-lg leading-[1.3] font-medium text-inherit">{session.title}</span>
                    <span className="text-xs leading-[1.3] text-text-tertiary">{formatSessionPreview(session.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </SidebarContent>

        <SidebarFooter className="flex flex-col gap-4">
          {/*
            Single settings entry point. Tabs for General / Model live on the page.
            Keeping this as a Link (not a button) preserves
            keyboard + right-click semantics and plays nicely with Next's
            prefetch.
          */}
          <NavigationMenu aria-label="Settings">
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuButton
                  asChild
                  active={isSettingsOpen}
                  className="group inline-flex w-full items-center justify-start gap-2 rounded-md px-2.5 py-2 text-lg font-medium text-text-secondary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-app-hover hover:text-text-primary focus-visible:shadow-focus focus-visible:outline-none data-[active=true]:bg-app-hover data-[active=true]:font-semibold data-[active=true]:text-text-heading data-[state=selected]:bg-app-hover data-[state=selected]:font-semibold data-[state=selected]:text-text-heading"
                >
                  <Link to={openSettingsHref}>
                    <span className="inline-flex size-[18px] items-center justify-center text-current opacity-75 group-hover:opacity-100 group-data-[active=true]:opacity-100" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="8" r="2" />
                        <path d="M13.3 9.4a5.4 5.4 0 0 0 0-2.8l1.3-1-1.5-2.6-1.6.5a5.4 5.4 0 0 0-2.4-1.4L8.8.5H7.2l-.3 1.6a5.4 5.4 0 0 0-2.4 1.4l-1.6-.5-1.5 2.6 1.3 1a5.4 5.4 0 0 0 0 2.8l-1.3 1 1.5 2.6 1.6-.5a5.4 5.4 0 0 0 2.4 1.4l.3 1.6h1.6l.3-1.6a5.4 5.4 0 0 0 2.4-1.4l1.6.5 1.5-2.6-1.3-1z" />
                      </svg>
                    </span>
                    <span>Settings</span>
                  </Link>
                </NavigationMenuButton>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </SidebarFooter>
      </Sidebar>

      <main
        className="grid h-screen min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-app-canvas data-[has-composer=false]:grid-rows-[auto_minmax(0,1fr)] max-app:h-auto max-app:min-h-0 max-app:overflow-visible"
        data-has-composer={composer ? "true" : "false"}
      >
        {header ? <div className="border-b border-border-subtle bg-app-canvas px-[var(--app-page-padding-x)] pt-5 pb-4">{header}</div> : null}
        <div className="min-h-0 overflow-auto" data-chat-scroll-container="true">
          <div className="mx-auto flex max-w-[var(--app-content-max-width)] flex-col gap-[var(--app-section-gap)] px-[var(--app-page-padding-x)] pt-6 pb-8">{children}</div>
        </div>
        {composer ? (
          <div className="bg-app-canvas [&>*]:mx-auto [&>*]:mb-4 [&>*]:max-w-[var(--app-content-max-width)] [&>*]:px-[var(--app-page-padding-x)] [&>*]:pt-4 [&>*]:pb-5">
            {composer}
          </div>
        ) : null}
      </main>

    </div>
  );
}
