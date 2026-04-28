"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Component } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  NavigationMenu,
  NavigationMenuButton,
  NavigationMenuItem,
  NavigationMenuLabel,
  NavigationMenuList,
  NavItem,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader
} from "@nexu-design/ui-web";

import { useControllerState } from "../lib/controller-state";
import { DEFAULT_SESSION_TITLE, useSessions } from "./session-provider";

const CONNECTOR_DETAIL_QUERY_PARAM = "connector";
const mainNavigationButtonClassName = "group inline-flex w-full items-center justify-start gap-2 rounded-md px-2 py-1 text-lg font-medium text-text-secondary transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)] hover:bg-app-hover hover:text-text-primary focus-visible:shadow-focus focus-visible:outline-none data-[active=true]:bg-app-hover data-[active=true]:font-semibold data-[active=true]:text-text-heading data-[state=selected]:bg-app-hover data-[state=selected]:font-semibold data-[state=selected]:text-text-heading";
const mainNavigationIconClassName = "inline-flex size-[18px] items-center justify-center text-current opacity-75 group-hover:opacity-100 group-data-[active=true]:opacity-100";

function isConnectorsNavigationActive(pathname: string, search: string) {
  if (pathname === "/connectors" || pathname.startsWith("/connectors/")) {
    return true;
  }

  if (!search) {
    return false;
  }

  return new URLSearchParams(search).has(CONNECTOR_DETAIL_QUERY_PARAM);
}

function isArtifactsNavigationActive(pathname: string) {
  return pathname === "/artifacts" || pathname.startsWith("/artifacts/");
}

export function AppShell({
  pathname,
  header,
  composer,
  contentClassName,
  contentWrapper,
  onDesktopStopShortcut,
  children
}: {
  pathname: string;
  header?: ReactNode;
  composer?: ReactNode;
  contentClassName?: string;
  contentWrapper?: "default" | "none";
  onDesktopStopShortcut?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    createSession,
    currentSessionId,
    isSessionsLoading,
    openSession,
    sessions
  } = useSessions();
  const recentSessions = sessions.filter((session) => session.archivedAt === null).slice(0, 20);
  const { isDesktop } = useControllerState();
  const [desktopPlatform, setDesktopPlatform] = useState<string | undefined>();
  const isArtifactsOpen = isArtifactsNavigationActive(pathname);
  const isConnectorsOpen = isConnectorsNavigationActive(pathname, location.search);
  const isSettingsOpen = pathname.startsWith("/settings");
  const hasHeader = Boolean(header);
  const hasComposer = Boolean(composer);
  const pagePaddingXClassName = "px-[var(--app-page-padding-x)]";
  const pageHeaderPaddingTopClassName = "pt-8";
  const openSettingsHref = "/settings/general";
  const pendingBlankSessionPromiseRef = useRef<Promise<{ id: string }> | null>(null);

  useEffect(() => {
    setDesktopPlatform(window.monetDesktop?.platform);
  }, []);

  const handleCreateSession = useCallback(async () => {
    if (isSessionsLoading) {
      return;
    }

    const latestBlankSession = sessions.find(
      (session) => session.archivedAt === null && session.messageCount === 0 && session.title === DEFAULT_SESSION_TITLE
    );

    if (latestBlankSession) {
      openSession(latestBlankSession.id, "/");
      return;
    }

    if (pendingBlankSessionPromiseRef.current) {
      const pendingSession = await pendingBlankSessionPromiseRef.current;
      openSession(pendingSession.id, "/");
      return;
    }

    const pendingSessionPromise = createSession({ pathname: "/" });
    pendingBlankSessionPromiseRef.current = pendingSessionPromise;

    try {
      await pendingSessionPromise;
    } finally {
      if (pendingBlankSessionPromiseRef.current === pendingSessionPromise) {
        pendingBlankSessionPromiseRef.current = null;
      }
    }
  }, [createSession, isSessionsLoading, openSession, sessions]);

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
  }, [handleCreateSession, navigate]);

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
      <Sidebar className={`sticky top-0 flex h-screen min-h-0 flex-col gap-4 overflow-hidden border-r border-border-subtle bg-app-sidebar px-4 pb-5 max-app:static max-app:h-auto max-app:overflow-visible max-app:border-r-0 max-app:border-b ${isDesktop ? "pt-3" : "pt-5"}`}>
        <div className={isDesktop ? "mb-2 block min-h-[28px] [-webkit-app-region:drag]" : "hidden"} aria-hidden="true" />
        <SidebarHeader className="sr-only">Monet navigation</SidebarHeader>

        <SidebarContent className="flex min-h-0 flex-1 flex-col gap-5">
          <NavigationMenu aria-label="Main navigation">
            <NavigationMenuList className="flex flex-col gap-0.5">
              <NavigationMenuItem>
                <NavigationMenuButton
                  className={mainNavigationButtonClassName}
                  disabled={isSessionsLoading}
                  type="button"
                  onClick={() => void handleCreateSession()}
                >
                  <span className={mainNavigationIconClassName} aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 3.25v9.5" />
                      <path d="M3.25 8h9.5" />
                    </svg>
                  </span>
                  <span>New chat</span>
                </NavigationMenuButton>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuButton
                  asChild
                  active={isConnectorsOpen}
                  className={mainNavigationButtonClassName}
                >
                  <Link to="/connectors">
                    <span className={mainNavigationIconClassName} aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5.5 5.5h-1a3 3 0 0 0 0 6h1" />
                        <path d="M10.5 5.5h1a3 3 0 0 1 0 6h-1" />
                        <path d="M6 8.5h4" />
                      </svg>
                    </span>
                    <span>Connectors</span>
                  </Link>
                </NavigationMenuButton>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuButton
                  asChild
                  active={isArtifactsOpen}
                  className={mainNavigationButtonClassName}
                >
                  <Link to="/artifacts" aria-current={isArtifactsOpen ? "page" : undefined}>
                    <span className={mainNavigationIconClassName} aria-hidden="true">
                      <Component className="size-3.5" strokeWidth={1.8} />
                    </span>
                    <span>Live artifacts</span>
                  </Link>
                </NavigationMenuButton>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>

          <section className="flex min-h-0 flex-1 flex-col gap-1.5" aria-labelledby="recent-sessions-heading">
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
                  No active chats yet.
                </p>
              ) : null}
              {recentSessions.map((session) => {
                const isActive = session.id === currentSessionId;

                return (
                  <NavItem
                    key={session.id}
                    type="button"
                    selected={isActive}
                    className="grid grid-cols-[minmax(0,1fr)] rounded-md px-2.5 py-1.5 text-left text-text-secondary hover:bg-app-hover hover:text-text-primary focus-visible:shadow-focus data-[state=selected]:bg-surface-3 data-[state=selected]:text-text-heading data-[state=selected]:hover:bg-surface-3"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => openSession(session.id, "/")}
                  >
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm leading-5 font-medium text-inherit">{session.title}</span>
                  </NavItem>
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
                  className={mainNavigationButtonClassName}
                >
                  <Link to={openSettingsHref}>
                    <span className={mainNavigationIconClassName} aria-hidden="true">
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
        className={`grid h-screen min-h-0 overflow-hidden bg-app-canvas max-app:h-auto max-app:min-h-0 max-app:overflow-visible ${
          hasHeader
            ? hasComposer ? "grid-rows-[auto_minmax(0,1fr)_auto]" : "grid-rows-[auto_minmax(0,1fr)]"
            : hasComposer ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-rows-[minmax(0,1fr)]"
        }`}
        data-has-composer={hasComposer ? "true" : "false"}
        data-has-header={hasHeader ? "true" : "false"}
      >
        {header ? (
          <div className="bg-app-canvas">
            <div className={`mx-auto w-full max-w-[var(--app-content-max-width)] ${pagePaddingXClassName} ${pageHeaderPaddingTopClassName} pb-3 max-app:pt-6`}>{header}</div>
          </div>
        ) : null}
        <div className={`min-h-0 overflow-auto ${contentWrapper === "none" ? contentClassName ?? "" : ""}`} data-chat-scroll-container="true">
          {contentWrapper === "none" ? children : (
            <div className={`mx-auto flex max-w-[var(--app-content-max-width)] flex-col gap-[var(--app-section-gap)] ${pagePaddingXClassName} pt-7 pb-10 ${contentClassName ?? ""}`}>{children}</div>
          )}
        </div>
        {composer ? (
          <div className="bg-app-canvas pb-6 pt-2">
            <div className="mx-auto w-full max-w-[var(--app-composer-max-width)] px-[var(--app-page-padding-x)]">
              {composer}
            </div>
          </div>
        ) : null}
      </main>

    </div>
  );
}
