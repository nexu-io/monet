"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatusDot
} from "@nexu-design/ui-web";

import type { Provider, ProviderModel, ValidateProviderResponse } from "../lib/api/generated/types.gen";
import {
  getMonetClientConfig,
  type DesktopAppPathsSnapshot,
  type ProviderSecretStorageSnapshot
} from "../lib/monet-client";
import { PROVIDER_READINESS_EVENT } from "../lib/provider-readiness";
import { useTheme, type AppTheme } from "./theme-provider";

export const settingsPanels = [
  {
    id: "general",
    title: "General Settings",
    description: "Workspace preferences, appearance, and filesystem access."
  },
  {
    id: "models",
    title: "Model Settings",
    description: "Provider and model configuration."
  }
] as const;

export type SettingsPanelId = (typeof settingsPanels)[number]["id"];

type AsyncState<T> = {
  readonly loading: boolean;
  readonly data: T | null;
  readonly error: string | null;
};

type ProviderValidationState = AsyncState<ValidateProviderResponse>;
type ProviderSecretStorageState = AsyncState<ProviderSecretStorageSnapshot>;
type ProviderModelsCacheEntry = AsyncState<ProviderModel[]>;
type CreateProviderDraft = {
  readonly type: Provider["type"];
  readonly displayName: string;
  readonly baseUrl: string;
  readonly timeoutMs: string;
};
type AuthorizedDirectory = {
  readonly path: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};
type AuthorizedDirectoriesState = AsyncState<AuthorizedDirectory[]>;
type AppPathsState = AsyncState<DesktopAppPathsSnapshot>;

const initialProvidersState: AsyncState<Provider[]> = {
  loading: true,
  data: null,
  error: null
};

const initialModelsState: AsyncState<ProviderModel[]> = {
  loading: false,
  data: null,
  error: null
};

const initialSecretStorageState: ProviderSecretStorageState = {
  loading: false,
  data: null,
  error: null
};

const initialAuthorizedDirectoriesState: AuthorizedDirectoriesState = {
  loading: true,
  data: null,
  error: null
};

const initialAppPathsState: AppPathsState = {
  loading: false,
  data: null,
  error: null
};

const browserSecretStorageSnapshot: ProviderSecretStorageSnapshot = {
  available: false,
  message:
    "Secure provider secret storage is only available inside the Electron desktop shell. Browser-only development should keep using environment variables.",
  platform: "browser",
  providers: [],
  reason: "desktop_api_unavailable"
};

const validationReasonMeta: Record<
  ValidateProviderResponse["reason"],
  {
    label: string;
    badgeVariant: "success" | "warning" | "destructive" | "secondary";
    dotStatus: "success" | "warning" | "error" | "info";
    guidance: string;
  }
> = {
  ok: {
    label: "Ready",
    badgeVariant: "success",
    dotStatus: "success",
    guidance: "The provider has credentials, a resolved default model, and at least one enabled model available for chat."
  },
  disabled: {
    label: "Disabled",
    badgeVariant: "secondary",
    dotStatus: "info",
    guidance: "Enable this provider before using it as a default for new sessions."
  },
  no_enabled_models: {
    label: "No enabled models",
    badgeVariant: "warning",
    dotStatus: "warning",
    guidance: "This provider is configured, but no enabled chat models are currently available."
  },
  missing_default_model: {
    label: "Default model missing",
    badgeVariant: "warning",
    dotStatus: "warning",
    guidance: "Set a default model so new sessions can resolve provider/model IDs before sending messages."
  },
  default_model_unresolved: {
    label: "Default model unresolved",
    badgeVariant: "warning",
    dotStatus: "warning",
    guidance: "The saved default model is not present in the enabled model catalog returned by the provider."
  },
  missing_credentials: {
    label: "Missing credentials",
    badgeVariant: "destructive",
    dotStatus: "error",
    guidance: "Add local credentials for this provider, then validate again to refresh the catalog and status."
  },
  provider_api_error: {
    label: "Provider API error",
    badgeVariant: "destructive",
    dotStatus: "error",
    guidance: "The live provider check could not complete. Retry after fixing network, base URL, or credential issues."
  }
};

const surfaceCardClassName = "col-span-12 rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-xs";
const mutedSurfaceCardClassName = "col-span-12 rounded-xl border border-border-subtle bg-surface-2 p-4 shadow-none";
const settingsPanelStackClassName = "flex flex-col gap-3";
const settingsModelsStackClassName = "flex flex-col gap-4";
const settingsListStackClassName = "flex flex-col gap-3";
const settingsEmptyStateClassName = "flex flex-col items-start gap-3";
const settingsItemCardClassName = "flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-1 p-3 shadow-xs";
const settingsProviderItemClassName = "flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-1 p-4 text-left transition-all hover:border-border-strong hover:bg-surface-2 data-[active=true]:border-accent data-[active=true]:bg-accent/5 data-[active=true]:shadow-sm";
const settingsDirectoryItemClassName = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border-subtle bg-surface-1 p-3 shadow-xs max-sm:grid-cols-[auto_minmax(0,1fr)]";
const settingsDirectoryIconClassName = "inline-flex size-9 items-center justify-center rounded-md bg-accent/10 text-accent";
const settingsDirectoryPathClassName = "block truncate text-text-heading";
const settingsThemeOptionsClassName = "grid grid-cols-3 gap-3 max-app:grid-cols-1";
const settingsThemeOptionClassName = `${settingsItemCardClassName} cursor-pointer transition-colors hover:border-accent/40 data-[active=true]:border-accent/40 data-[active=true]:shadow-focus`;
const settingsThemeSwatchBaseClassName = "h-12 rounded-md border border-border-subtle";
const settingsProviderGridClassName = "grid grid-cols-[320px_minmax(0,1fr)] items-start gap-6 max-app:grid-cols-1";
const settingsProviderDetailClassName = "flex flex-col gap-3";
const settingsRowClassName = "flex flex-wrap items-center justify-between gap-2 max-sm:items-start";
const settingsChipRowClassName = "flex flex-wrap items-center justify-start gap-2";
const settingsMetaClassName = "m-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm leading-[1.5] text-text-muted";
const settingsSecretFieldClassName = "flex flex-col gap-1";
const settingsSecretInputClassName = "min-h-10 w-full rounded-md border border-border-subtle bg-surface-0 px-3 py-2 text-text-primary transition-colors focus:border-accent focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:opacity-60";
const settingsInlineActionClassName = "inline-flex cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60";
const settingsValidationCardClassName = `${mutedSurfaceCardClassName} flex flex-col gap-1`;
const statusBadgeBaseClassName = "inline-flex w-fit items-center gap-1.5 px-2.5 py-1.5 text-sm font-semibold";
const statusBadgeToneClassNames = {
  healthy: "bg-success-subtle text-success",
  offline: "bg-error-subtle text-error",
  unknown: "bg-warning-subtle text-warning"
} as const;

type ValidationBadgeTone = keyof typeof statusBadgeToneClassNames;

function formatProviderType(type: Provider["type"]) {
  return type === "openai" ? "OpenAI" : "OpenRouter";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getDesktopApi() {
  return typeof window === "undefined" ? undefined : window.monetDesktop;
}

function notifyProviderReadinessUpdated() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(PROVIDER_READINESS_EVENT));
}

function getSecretStatus(snapshot: ProviderSecretStorageSnapshot | null, providerType: Provider["type"]) {
  return snapshot?.providers.find((entry) => entry.providerType === providerType) ?? null;
}

function getStatusBadgeClassName(tone: ValidationBadgeTone) {
  return `${statusBadgeBaseClassName} ${statusBadgeToneClassNames[tone]}`;
}

function getThemeSwatchClassName(theme: AppTheme) {
  const previewClassName = {
    system: "bg-[linear-gradient(135deg,#0f172a_0%_50%,#f8fafc_50%_100%)]",
    light: "bg-[linear-gradient(135deg,#ffffff_0%,#e2e8f0_100%)]",
    dark: "bg-[linear-gradient(135deg,#020617_0%,#1e293b_100%)]"
  } satisfies Record<AppTheme, string>;

  return `${settingsThemeSwatchBaseClassName} ${previewClassName[theme]}`;
}

const settingsModelSplitPanelClassName =
  "overflow-hidden rounded-2xl border border-border-subtle bg-surface-0 shadow-xs";
const settingsModelPaneListClassName =
  "flex w-full shrink-0 flex-col border-b border-border-subtle bg-surface-2 md:w-[216px] md:border-b-0 md:border-r";
const settingsModelPaneDetailClassName =
  "min-w-0 flex-1 overflow-y-auto bg-surface-0 px-6 py-5 max-sm:px-4";

function getProviderInitial(provider: Provider) {
  const customLabel = provider.displayName.trim();

  if (customLabel.length > 0) {
    return customLabel.trim().charAt(0).toUpperCase();
  }

  return provider.type === "openai" ? "O" : "R";
}

function getProviderDescription(provider: Provider) {
  if (provider.type === "openai") {
    return "OpenAI-compatible API with chat, tools, and structured JSON responses.";
  }

  return "OpenRouter-compatible gateway for multiple model backends.";
}

function getProviderDocsUrl(provider: Provider) {
  return provider.type === "openai"
    ? "https://platform.openai.com/api-keys"
    : "https://openrouter.ai/keys";
}

function formatProviderReadinessLabel(validation: ProviderValidationState | null | undefined) {
  if (!validation) {
    return { status: "info" as const, label: "Not checked" };
  }

  if (validation.loading) {
    return { status: "info" as const, label: "Checking" };
  }

  if (validation.error) {
    return { status: "error" as const, label: "Needs setup" };
  }

  if (!validation.data) {
    return { status: "info" as const, label: "Not checked" };
  }

  if (validation.data.valid) {
    return { status: "success" as const, label: "Ready" };
  }

  return {
    status: validationReasonMeta[validation.data.reason].dotStatus,
    label: validationReasonMeta[validation.data.reason].label
  };
}

function statusDotGlyphClass(status: ReturnType<typeof formatProviderReadinessLabel>["status"]) {
  switch (status) {
    case "success":
      return "text-success";
    case "error":
      return "text-error";
    case "warning":
      return "text-warning";
    default:
      return "text-text-muted";
  }
}

function getPersistedSelectedModelIds(models: readonly ProviderModel[]) {
  const enabledModels = models.filter((model) => model.enabled);

  if (enabledModels.length > 1 && enabledModels.length === models.length) {
    return [];
  }

  return enabledModels.map((model) => model.id);
}

function requestHeaders() {
  const config = getMonetClientConfig();
  const headers = new Headers();

  if (config.bearerToken) {
    headers.set("Authorization", `Bearer ${config.bearerToken}`);
  }

  return {
    apiBase: config.apiBase,
    headers
  };
}

async function requestControllerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiBase, headers } = requestHeaders();
  const requestHeadersValue = new Headers(init?.headers ?? headers);

  headers.forEach((value, key) => {
    if (!requestHeadersValue.has(key)) {
      requestHeadersValue.set(key, value);
    }
  });

  if (init?.body && !requestHeadersValue.has("Content-Type")) {
    requestHeadersValue.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "omit",
    headers: requestHeadersValue
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;

    try {
      const payload = (await response.json()) as { message?: string };

      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

function ValidationBadge({ state }: { state: ProviderValidationState | null | undefined }) {
  if (!state) {
    return (
      <Badge variant="secondary" size="sm" radius="full" className={getStatusBadgeClassName("unknown")}>
        <StatusDot status="info" size="xs" className="size-2" />
        <span>Not checked yet</span>
      </Badge>
    );
  }

  if (state.loading) {
    return (
      <Badge variant="warning" size="sm" radius="full" className={getStatusBadgeClassName("unknown")}>
        <StatusDot status="warning" size="xs" pulse className="size-2" />
        <span>Validating…</span>
      </Badge>
    );
  }

  if (state.error) {
    return (
      <Badge variant="destructive" size="sm" radius="full" className={getStatusBadgeClassName("offline")}>
        <StatusDot status="error" size="xs" className="size-2" />
        <span>Validation failed</span>
      </Badge>
    );
  }

  if (!state.data) {
    return null;
  }

  const meta = validationReasonMeta[state.data.reason];
  const tone: ValidationBadgeTone = state.data.valid ? "healthy" : meta.badgeVariant === "destructive" ? "offline" : "unknown";

  return (
    <Badge variant={meta.badgeVariant} size="sm" radius="full" className={getStatusBadgeClassName(tone)}>
      <StatusDot status={meta.dotStatus} size="xs" className="size-2" />
      <span>{meta.label}</span>
    </Badge>
  );
}

function GeneralSettingsPanel() {
  const desktopApi = getDesktopApi();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [authorizedDirectoriesState, setAuthorizedDirectoriesState] = useState<AuthorizedDirectoriesState>(
    initialAuthorizedDirectoriesState
  );
  const [appPathsState, setAppPathsState] = useState<AppPathsState>(initialAppPathsState);
  const [directoryDraft, setDirectoryDraft] = useState("");
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [directoryFeedback, setDirectoryFeedback] = useState<string | null>(null);
  const [pathFeedback, setPathFeedback] = useState<string | null>(null);

  const loadAuthorizedDirectories = useCallback(async () => {
    setAuthorizedDirectoriesState((current) => ({
      loading: true,
      data: current.data,
      error: null
    }));

    try {
      const result = await requestControllerJson<{ authorizedDirectories: AuthorizedDirectory[] }>(
        "/api/settings/authorized-directories"
      );

      setAuthorizedDirectoriesState({
        loading: false,
        data: result.authorizedDirectories,
        error: null
      });
    } catch (error) {
      setAuthorizedDirectoriesState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to load authorized directories."
      });
    }
  }, []);

  const loadAppPaths = useCallback(async () => {
    if (!desktopApi?.getAppPaths) {
      setAppPathsState({
        loading: false,
        data: null,
        error: "Desktop app paths are only available inside the Electron shell."
      });
      return;
    }

    setAppPathsState((current) => ({
      loading: true,
      data: current.data,
      error: null
    }));

    try {
      setAppPathsState({
        loading: false,
        data: await desktopApi.getAppPaths(),
        error: null
      });
    } catch (error) {
      setAppPathsState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to inspect app paths."
      });
    }
  }, [desktopApi]);

  useEffect(() => {
    void loadAuthorizedDirectories();
    void loadAppPaths();
  }, [loadAppPaths, loadAuthorizedDirectories]);

  const replaceAuthorizedDirectories = useCallback(async (paths: readonly string[], successMessage: string) => {
    setDirectoryBusy(true);
    setDirectoryFeedback(null);

    try {
      const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
      const result = await requestControllerJson<{ authorizedDirectories: AuthorizedDirectory[] }>(
        "/api/settings/authorized-directories",
        {
          method: "PUT",
          body: JSON.stringify({
            paths: uniquePaths
          })
        }
      );

      setAuthorizedDirectoriesState({
        loading: false,
        data: result.authorizedDirectories,
        error: null
      });
      setDirectoryFeedback(successMessage);
      setDirectoryDraft("");
    } catch (error) {
      setDirectoryFeedback(error instanceof Error ? error.message : "Unable to update authorized directories.");
    } finally {
      setDirectoryBusy(false);
    }
  }, []);

  const authorizedDirectories = authorizedDirectoriesState.data ?? [];

  const addDirectory = useCallback(
    async (rawPath: string) => {
      const nextPath = rawPath.trim();

      if (!nextPath) {
        return;
      }

      await replaceAuthorizedDirectories(
        [...authorizedDirectories.map((entry) => entry.path), nextPath],
        `Authorized ${nextPath}`
      );
    },
    [authorizedDirectories, replaceAuthorizedDirectories]
  );

  const removeDirectory = useCallback(
    async (targetPath: string) => {
      await replaceAuthorizedDirectories(
        authorizedDirectories.map((entry) => entry.path).filter((path) => path !== targetPath),
        `Revoked ${targetPath}`
      );
    },
    [authorizedDirectories, replaceAuthorizedDirectories]
  );

  const pickDirectory = useCallback(async () => {
    if (!desktopApi?.pickDirectory) {
      return;
    }

    try {
      const pickedPath = await desktopApi.pickDirectory();

      if (pickedPath) {
        await addDirectory(pickedPath);
      }
    } catch (error) {
      setDirectoryFeedback(error instanceof Error ? error.message : "Unable to open the directory picker.");
    }
  }, [addDirectory, desktopApi]);

  const openPath = useCallback(
    async (targetPath: string) => {
      if (!desktopApi?.openPath) {
        return;
      }

      setPathFeedback(null);

      try {
        const result = await desktopApi.openPath({ path: targetPath });
        setPathFeedback(result.opened ? `Opened ${targetPath}` : result.error ?? `Unable to open ${targetPath}`);
      } catch (error) {
        setPathFeedback(error instanceof Error ? error.message : "Unable to open the requested path.");
      }
    },
    [desktopApi]
  );

  const copyPath = useCallback(async (targetPath: string) => {
    try {
      await navigator.clipboard.writeText(targetPath);
      setPathFeedback(`Copied ${targetPath}`);
    } catch (error) {
      setPathFeedback(error instanceof Error ? error.message : "Unable to copy the requested path.");
    }
  }, []);

  const themeOptions: ReadonlyArray<{ value: AppTheme; label: string; detail: string }> = [
    {
      value: "system",
      label: "System",
      detail: "Follow the OS appearance preference."
    },
    {
      value: "light",
      label: "Light",
      detail: "Use the brighter canvas and surface palette."
    },
    {
      value: "dark",
      label: "Dark",
      detail: "Keep the current dark workspace look."
    }
  ];

  return (
    <div className={settingsPanelStackClassName}>
      <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Filesystem access</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Authorized directories</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">
              File tools can only read and write inside directories you explicitly authorize here.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className={settingsMetaClassName}>
            <span>{authorizedDirectories.length} authorized</span>
              <span>Saved to your local workspace</span>
          </div>

          <label className={settingsSecretFieldClassName}>
            <span className="m-0 leading-[1.5] text-text-muted">Add a directory path manually</span>
            <input
              type="text"
              value={directoryDraft}
              placeholder="/Users/example/Projects"
              className={`${settingsSecretInputClassName} mono`}
              disabled={directoryBusy}
              onChange={(event) => setDirectoryDraft(event.currentTarget.value)}
            />
          </label>

          <div className={settingsChipRowClassName}>
            <Button type="button" variant="primary" disabled={directoryBusy || !directoryDraft.trim()} onClick={() => void addDirectory(directoryDraft)}>
              {directoryBusy ? "Saving…" : "Add directory"}
            </Button>
            <Button type="button" variant="secondary" disabled={directoryBusy || !desktopApi?.pickDirectory} onClick={() => void pickDirectory()}>
              Choose folder…
            </Button>
          </div>

          {!desktopApi?.pickDirectory ? (
            <p className="m-0 leading-[1.5] text-text-muted">Native folder picking is only available inside the Electron desktop shell.</p>
          ) : null}

          {authorizedDirectoriesState.loading ? <p className="m-0 leading-[1.5] text-text-muted">Loading authorized directories…</p> : null}
          {authorizedDirectoriesState.error ? <p className="m-0 leading-[1.5] text-text-muted mono">{authorizedDirectoriesState.error}</p> : null}

          {!authorizedDirectoriesState.loading && !authorizedDirectoriesState.error && authorizedDirectories.length === 0 ? (
            <div className={settingsEmptyStateClassName}>
              <p className="m-0 leading-[1.5] text-text-muted">No directories are authorized yet.</p>
              <p className="m-0 leading-[1.5] text-text-muted">Add one before using read_file or write_file in agent runs.</p>
            </div>
          ) : null}

          <div className={settingsListStackClassName} role="list" aria-label="Authorized directories">
            {authorizedDirectories.map((entry) => (
              <div key={entry.path} className={settingsDirectoryItemClassName} role="listitem">
                <span className={settingsDirectoryIconClassName} aria-hidden="true">
                  📁
                </span>
                <div className="flex flex-col gap-1">
                  <strong className={`${settingsDirectoryPathClassName} mono`} title={entry.path}>
                    {entry.path}
                  </strong>
                  <div className={settingsMetaClassName}>
                    <span>Updated {formatTimestamp(entry.updatedAt)}</span>
                    <span>Added {formatTimestamp(entry.createdAt)}</span>
                  </div>
                </div>
                <Button type="button" variant="secondary" className="max-sm:col-span-full" disabled={directoryBusy} onClick={() => void removeDirectory(entry.path)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>

          {directoryFeedback ? <p className="m-0 leading-[1.5] text-text-muted mono">{directoryFeedback}</p> : null}
        </CardContent>
      </Card>

      <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Local storage</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Data directory</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">
              Monet stores desktop state, secrets metadata, window state, and your local workspace database in the app data directory.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <ul className="grid list-none gap-2.5 p-0 m-0">
            <li className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-3">
              <Card variant="muted" padding="sm" className={`${mutedSurfaceCardClassName} flex flex-col gap-1`}>
                <div className={settingsRowClassName}>
                  <strong>Application data path</strong>
                  <div className={settingsChipRowClassName}>
                    <button
                      type="button"
                      className={settingsInlineActionClassName}
                      disabled={!appPathsState.data?.userDataPath}
                      onClick={() => void copyPath(appPathsState.data?.userDataPath ?? "")}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className={settingsInlineActionClassName}
                      disabled={!desktopApi?.openPath || !appPathsState.data?.userDataPath}
                      onClick={() => void openPath(appPathsState.data?.userDataPath ?? "")}
                    >
                      Reveal
                    </button>
                  </div>
                </div>
                <div className="m-0 leading-[1.5] text-text-muted mono">{appPathsState.data?.userDataPath ?? "Unavailable outside the desktop shell."}</div>
              </Card>
            </li>
          </ul>

          {appPathsState.loading ? <p className="m-0 leading-[1.5] text-text-muted">Loading app paths…</p> : null}
          {appPathsState.error ? <p className="m-0 leading-[1.5] text-text-muted">{appPathsState.error}</p> : null}
          {pathFeedback ? <p className="m-0 leading-[1.5] text-text-muted mono">{pathFeedback}</p> : null}
        </CardContent>
      </Card>

      <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Appearance</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Theme</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">Choose whether the renderer follows the system appearance or forces a specific theme.</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className={settingsThemeOptionsClassName} role="list" aria-label="Theme options">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={settingsThemeOptionClassName}
                data-active={theme === option.value ? "true" : "false"}
                onClick={() => setTheme(option.value)}
              >
                <span className={getThemeSwatchClassName(option.value)} aria-hidden="true" />
                <div className="flex flex-col gap-1">
                  <strong>{option.label}</strong>
                  <span className="m-0 leading-[1.5] text-text-muted">{option.detail}</span>
                </div>
              </button>
            ))}
          </div>

          <div className={settingsMetaClassName}>
            <span>Saved preference: {theme}</span>
            <span>Currently applied: {resolvedTheme}</span>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

function ModelSettingsPanel() {
  const [providersState, setProvidersState] = useState<AsyncState<Provider[]>>(initialProvidersState);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [modelsState, setModelsState] = useState<AsyncState<ProviderModel[]>>(initialModelsState);
  const [modelsCacheByProviderId, setModelsCacheByProviderId] = useState<Record<string, ProviderModelsCacheEntry>>({});
  const [modelSearch, setModelSearch] = useState("");
  const [selectedModelIdsByProviderId, setSelectedModelIdsByProviderId] = useState<Record<string, string[]>>({});
  const [modelSelectionBusyId, setModelSelectionBusyId] = useState<string | null>(null);
  const [validationByProviderId, setValidationByProviderId] = useState<Record<string, ProviderValidationState>>({});
  const [secretStorageState, setSecretStorageState] = useState<ProviderSecretStorageState>(initialSecretStorageState);
  const [secretInput, setSecretInput] = useState("");
  const [secretBusyAction, setSecretBusyAction] = useState<"save" | "clear" | null>(null);
  const [secretFeedback, setSecretFeedback] = useState<string | null>(null);
  const [providerBaseUrlInput, setProviderBaseUrlInput] = useState("");

  const [isCreatingProvider, setIsCreatingProvider] = useState(false);
  const [createProviderDraft, setCreateProviderDraft] = useState<CreateProviderDraft>({
    type: "openai",
    displayName: "",
    baseUrl: "",
    timeoutMs: ""
  });
  const [createProviderBusy, setCreateProviderBusy] = useState(false);
  const [createProviderError, setCreateProviderError] = useState<string | null>(null);

  const providers = providersState.data ?? [];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedValidation = selectedProviderId ? validationByProviderId[selectedProviderId] : null;
  const selectedValidationMeta = selectedValidation?.data ? validationReasonMeta[selectedValidation.data.reason] : null;
  const selectedProviderSecretStatus = getSecretStatus(secretStorageState.data, selectedProvider?.type ?? "openai");
  const modelCatalog = modelsState.data ?? [];
  const selectedModelIds = selectedProviderId ? (selectedModelIdsByProviderId[selectedProviderId] ?? []) : [];
  const selectedModels = selectedModelIds
    .map((modelId) => modelCatalog.find((model) => model.id === modelId))
    .filter((model): model is ProviderModel => Boolean(model));
  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const modelSearchResults = normalizedModelSearch
    ? modelCatalog
        .filter((model) => !selectedModelIds.includes(model.id))
        .filter((model) =>
          model.displayName.toLowerCase().includes(normalizedModelSearch) ||
          model.modelName.toLowerCase().includes(normalizedModelSearch)
        )
        .slice(0, 8)
    : [];

  const filteredProviders = useMemo(() => {
    const normalized = providerSearch.trim().toLowerCase();

    if (!normalized) {
      return providers;
    }

    return providers.filter((provider) =>
      provider.displayName.toLowerCase().includes(normalized) ||
      provider.type.toLowerCase().includes(normalized)
    );
  }, [providers, providerSearch]);

  const allValidationsSettled = useMemo(
    () => providers.length > 0 && providers.every((provider) => validationByProviderId[provider.id] && !validationByProviderId[provider.id]?.loading),
    [providers, validationByProviderId]
  );

  const hasReadyProvider = useMemo(
    () => providers.some((provider) => validationByProviderId[provider.id]?.data?.valid),
    [providers, validationByProviderId]
  );

  const showCreateForm = isCreatingProvider || providers.length === 0;
  const providerBaseUrlChanged = (providerBaseUrlInput.trim() || null) !== (selectedProvider?.baseUrl ?? null);

  const loadSecretStorage = useCallback(async () => {
    const desktopApi = getDesktopApi();

    if (!desktopApi?.getProviderSecretStorage) {
      setSecretStorageState({
        loading: false,
        data: browserSecretStorageSnapshot,
        error: null
      });
      return;
    }

    setSecretStorageState((current) => ({
      loading: true,
      data: current.data,
      error: null
    }));

    try {
      setSecretStorageState({
        loading: false,
        data: await desktopApi.getProviderSecretStorage(),
        error: null
      });
    } catch (error) {
      setSecretStorageState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to inspect local secret storage."
      });
    }
  }, []);

  const validateProvider = useCallback(async (providerId: string) => {
    setValidationByProviderId((current) => ({
      ...current,
      [providerId]: {
        loading: true,
        data: current[providerId]?.data ?? null,
        error: null
      }
    }));

    try {
      const result = await requestControllerJson<ValidateProviderResponse>(`/api/providers/${providerId}/validate`, {
        method: "POST"
      });

      setValidationByProviderId((current) => ({
        ...current,
        [providerId]: {
          loading: false,
          data: result,
          error: null
        }
      }));
      notifyProviderReadinessUpdated();
    } catch (error) {
      setValidationByProviderId((current) => ({
        ...current,
        [providerId]: {
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Unable to validate provider."
        }
      }));
      notifyProviderReadinessUpdated();
    }
  }, []);

  const loadProviders = useCallback(async () => {
    setProvidersState({
      loading: true,
      data: null,
      error: null
    });

    try {
      const result = await requestControllerJson<{ providers: Provider[] }>("/api/providers");
      const nextProviders = result.providers;

      setProvidersState({
        loading: false,
        data: nextProviders,
        error: null
      });

      setSelectedProviderId((current) => {
        if (current && nextProviders.some((provider) => provider.id === current) && !isCreatingProvider) {
          return current;
        }

        return nextProviders.find((provider) => provider.enabled)?.id ?? nextProviders[0]?.id ?? null;
      });

      if (nextProviders.length === 0) {
        setValidationByProviderId({});
        notifyProviderReadinessUpdated();
        return;
      }

      const loadingStates = Object.fromEntries(
        nextProviders.map((provider) => [
          provider.id,
          {
            loading: true,
            data: null,
            error: null
          } satisfies ProviderValidationState
        ])
      );

      setValidationByProviderId(loadingStates);

      await Promise.all(nextProviders.map(async (provider) => validateProvider(provider.id)));
      notifyProviderReadinessUpdated();
    } catch (error) {
      setProvidersState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to load providers."
      });
      notifyProviderReadinessUpdated();
    }
  }, [isCreatingProvider, validateProvider]);

  const loadProviderModels = useCallback(async (options?: { refresh?: boolean }) => {
    const providerId = selectedProviderId;

    if (!providerId) {
      setModelsState(initialModelsState);
      return;
    }

    const cachedState = modelsCacheByProviderId[providerId];

    if (!options?.refresh && cachedState) {
      setModelsState(cachedState);
      setSelectedModelIdsByProviderId((current) => ({
        ...current,
        [providerId]: getPersistedSelectedModelIds(cachedState.data ?? [])
      }));
      return;
    }

    setModelsState({
      loading: true,
      data: cachedState?.data ?? null,
      error: null
    });
    setModelsCacheByProviderId((current) => ({
      ...current,
      [providerId]: {
        loading: true,
        data: cachedState?.data ?? null,
        error: null
      }
    }));

    try {
      const result = await requestControllerJson<{ models: ProviderModel[] }>(`/api/providers/${providerId}/models`);
      const nextState = {
        loading: false,
        data: result.models,
        error: null
      } satisfies ProviderModelsCacheEntry;

      setModelsCacheByProviderId((current) => ({
        ...current,
        [providerId]: nextState
      }));
      setSelectedModelIdsByProviderId((current) => ({
        ...current,
        [providerId]: getPersistedSelectedModelIds(result.models)
      }));
      setModelsState(nextState);
    } catch (error) {
      const nextState = {
        loading: false,
        data: cachedState?.data ?? null,
        error: error instanceof Error ? error.message : "Unable to load provider models."
      } satisfies ProviderModelsCacheEntry;

      setModelsCacheByProviderId((current) => ({
        ...current,
        [providerId]: nextState
      }));
      setModelsState(nextState);
    }
  }, [modelsCacheByProviderId, selectedProviderId]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    void loadSecretStorage();
  }, [loadSecretStorage]);

  useEffect(() => {
    setSecretInput("");
    setProviderBaseUrlInput(selectedProvider?.baseUrl ?? "");
    setModelSearch("");
  }, [selectedProvider?.baseUrl, selectedProviderId]);

  useEffect(() => {
    if (!selectedProviderId) {
      setModelsState(initialModelsState);
      return;
    }

    void loadProviderModels();
  }, [loadProviderModels, selectedProviderId]);

  const saveSelectedProviderSettings = useCallback(async () => {
    if (!selectedProvider) {
      return;
    }

    const nextBaseUrl = providerBaseUrlInput.trim() || null;
    const shouldUpdateProvider = nextBaseUrl !== selectedProvider.baseUrl;
    const shouldSaveSecret = secretInput.trim().length > 0;

    if (!shouldUpdateProvider && !shouldSaveSecret) {
      return;
    }

    const desktopApi = getDesktopApi();

    if (shouldSaveSecret && !desktopApi?.saveProviderSecret) {
      setSecretFeedback(browserSecretStorageSnapshot.message);
      return;
    }

    setSecretBusyAction("save");
    setSecretFeedback(null);

    try {
      if (shouldUpdateProvider) {
        await requestControllerJson<Provider>(`/api/providers/${selectedProvider.id}`, {
          method: "PATCH",
          body: JSON.stringify({ baseUrl: nextBaseUrl })
        });
      }

      let restartResult: { restarted?: boolean } | undefined;

      if (shouldSaveSecret && desktopApi?.saveProviderSecret) {
        setSecretStorageState({
          loading: false,
          data: await desktopApi.saveProviderSecret({
            providerType: selectedProvider.type,
            secret: secretInput
          }),
          error: null
        });

        restartResult = await desktopApi.restartController?.();
      }

      await loadProviders();
      await validateProvider(selectedProvider.id);
      setSecretInput("");
      setSecretFeedback(
        shouldUpdateProvider && shouldSaveSecret
          ? restartResult?.restarted === false
            ? "Provider URL and secret saved. Restart the workspace manually before revalidating provider access."
            : "Provider URL and secret saved."
          : shouldUpdateProvider
            ? "Provider URL saved."
            : restartResult?.restarted === false
              ? "Secret saved to secure storage. Restart the workspace manually before revalidating provider access."
              : "Secret saved to secure storage and the workspace was restarted."
      );
    } catch (error) {
      setSecretFeedback(error instanceof Error ? error.message : "Unable to save provider settings.");
    } finally {
      setSecretBusyAction(null);
    }
  }, [loadProviders, providerBaseUrlInput, secretInput, selectedProvider, validateProvider]);

  const saveProvider = useCallback(async () => {
    setCreateProviderBusy(true);
    setCreateProviderError(null);

    try {
      const body = {
        type: createProviderDraft.type,
        displayName: createProviderDraft.displayName.trim() || (createProviderDraft.type === "openai" ? "OpenAI" : "OpenRouter"),
        baseUrl: createProviderDraft.baseUrl.trim() || null,
        timeoutMs: createProviderDraft.timeoutMs.trim() ? parseInt(createProviderDraft.timeoutMs, 10) : null
      };

      const result = await requestControllerJson<Provider>('/api/providers', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      await loadProviders();
      setIsCreatingProvider(false);
      setSelectedProviderId(result.id);
      setCreateProviderDraft({
        type: "openai",
        displayName: "",
        baseUrl: "",
        timeoutMs: ""
      });
    } catch (error) {
      setCreateProviderError(error instanceof Error ? error.message : "Unable to create provider.");
    } finally {
      setCreateProviderBusy(false);
    }
  }, [createProviderDraft, loadProviders]);

  const deleteProvider = useCallback(async (providerId: string) => {
    try {
      await requestControllerJson(`/api/providers/${providerId}`, {
        method: "DELETE"
      });

      if (selectedProviderId === providerId) {
        setSelectedProviderId(null);
      }

      await loadProviders();
    } catch (error) {
      console.error("Failed to delete provider", error);
    }
  }, [loadProviders, selectedProviderId]);

  const clearProviderSecret = useCallback(async () => {
    if (!selectedProvider) {
      return;
    }

    const desktopApi = getDesktopApi();

    if (!desktopApi?.clearProviderSecret) {
      setSecretFeedback(browserSecretStorageSnapshot.message);
      return;
    }

    setSecretBusyAction("clear");
    setSecretFeedback(null);

    try {
      setSecretStorageState({
        loading: false,
        data: await desktopApi.clearProviderSecret({
          providerType: selectedProvider.type
        }),
        error: null
      });

      const restartResult = await desktopApi.restartController?.();

      await loadProviders();
      await validateProvider(selectedProvider.id);
      setSecretInput("");
      setSecretFeedback(
        restartResult?.restarted === false
          ? "Saved secret cleared. Restart the workspace manually if it should stop using any previous environment-based credentials."
          : "Saved secret cleared and the workspace was restarted."
      );
    } catch (error) {
      setSecretFeedback(error instanceof Error ? error.message : "Unable to clear the provider secret.");
    } finally {
      setSecretBusyAction(null);
    }
  }, [loadProviders, selectedProvider, validateProvider]);

  const handleAddProvider = useCallback(() => {
    setIsCreatingProvider(true);
    setSelectedProviderId(null);
  }, []);

  const updateCachedModel = useCallback((providerId: string, updatedModel: ProviderModel, options?: { autoEnabledCatalogReset?: boolean }) => {
    setModelsCacheByProviderId((current) => {
      const currentState = current[providerId];
      const sourceData = currentState?.data ?? [];
      const autoEnabledCatalogReset = options?.autoEnabledCatalogReset && sourceData.length > 1 && sourceData.every((model) => model.enabled);
      const nextData = sourceData.map((model) => {
        if (model.id === updatedModel.id) {
          return updatedModel;
        }

        return autoEnabledCatalogReset ? { ...model, enabled: false } : model;
      });
      const nextState = {
        loading: false,
        data: nextData,
        error: currentState?.error ?? null
      } satisfies ProviderModelsCacheEntry;

      return {
        ...current,
        [providerId]: nextState
      };
    });
    setModelsState((current) => ({
      ...current,
      data: (current.data ?? []).map((model) => {
        if (model.id === updatedModel.id) {
          return updatedModel;
        }

        return options?.autoEnabledCatalogReset ? { ...model, enabled: false } : model;
      })
    }));
  }, []);

  const addSelectedModel = useCallback(async (providerId: string, modelId: string) => {
    setModelSelectionBusyId(modelId);

    try {
      const updatedModel = await requestControllerJson<ProviderModel>(`/api/provider-models/${modelId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true })
      });

      const catalogLooksAutoEnabled = modelCatalog.length > 1 && modelCatalog.every((model) => model.enabled) && selectedModelIds.length === 0;

      updateCachedModel(providerId, updatedModel, { autoEnabledCatalogReset: catalogLooksAutoEnabled });
      setSelectedModelIdsByProviderId((current) => {
        const currentIds = catalogLooksAutoEnabled ? [] : (current[providerId] ?? []);

        return {
          ...current,
          [providerId]: currentIds.includes(modelId) ? currentIds : [...currentIds, modelId]
        };
      });
      setModelSearch("");
      await validateProvider(providerId);
    } finally {
      setModelSelectionBusyId(null);
    }
  }, [modelCatalog, selectedModelIds.length, updateCachedModel, validateProvider]);

  const removeSelectedModel = useCallback(async (providerId: string, modelId: string) => {
    setModelSelectionBusyId(modelId);

    try {
      const updatedModel = await requestControllerJson<ProviderModel>(`/api/provider-models/${modelId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: false })
      });

      updateCachedModel(providerId, updatedModel);
      setSelectedModelIdsByProviderId((current) => ({
        ...current,
        [providerId]: (current[providerId] ?? []).filter((id) => id !== modelId)
      }));
      await validateProvider(providerId);
    } finally {
      setModelSelectionBusyId(null);
    }
  }, [updateCachedModel, validateProvider]);

  if (providersState.loading) {
    return (
      <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Model providers</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Provider setup</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">Loading providers, model catalogs, and validation status.</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <div className={settingsEmptyStateClassName}>
            <ValidationBadge state={{ loading: true, data: null, error: null }} />
            <p className="m-0 leading-[1.5] text-text-muted">Loading provider configuration…</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (providersState.error) {
    return (
      <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Model providers</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Provider setup</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">Settings could not load provider metadata.</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <Badge variant="destructive" size="sm" radius="full" className={getStatusBadgeClassName("offline")}>
            <StatusDot status="error" size="xs" className="size-2" />
            <span>Provider list unavailable</span>
          </Badge>
          <p className="m-0 leading-[1.5] text-text-muted mono">{providersState.error}</p>
          <Button type="button" variant="primary" onClick={() => void loadProviders()}>
            Retry provider load
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={settingsModelsStackClassName}>
      {!hasReadyProvider && allValidationsSettled && providers.length > 0 ? (
        <Card className={`${surfaceCardClassName} flex flex-col gap-2 border-dashed`}>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Setup guidance</span>
              <CardTitle className="m-0 text-xl font-semibold text-text-heading">No provider is ready yet</CardTitle>
              <CardDescription className="m-0 leading-[1.5] text-text-muted">Add a provider and save a secret to enable chat.</CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Card className={settingsModelSplitPanelClassName}>
        <div className="flex min-h-[600px] max-h-[calc(100vh-220px)] flex-col md:flex-row">
          <section className={settingsModelPaneListClassName}>
            <div className="px-4 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">Providers</div>
            <div className="px-2 pb-2">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">⌕</span>
                <input
                  type="text"
                  placeholder="Search providers"
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.currentTarget.value)}
                  className="h-7 w-full rounded-lg border border-border-subtle bg-surface-0 py-1 pl-7 pr-2 text-[11px] text-text-primary placeholder:text-text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                />
              </div>
            </div>

            <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
              {filteredProviders.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-text-muted">No providers found.</p>
              ) : (
                filteredProviders.map((provider) => {
                  const readiness = formatProviderReadinessLabel(validationByProviderId[provider.id]);
                  const isActive = provider.id === selectedProviderId && !showCreateForm;

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => {
                        setSelectedProviderId(provider.id);
                        setIsCreatingProvider(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left transition-colors ${
                        isActive ? "bg-surface-0" : "hover:bg-surface-1"
                      }`}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface-0 font-semibold">
                        {getProviderInitial(provider)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">{provider.displayName}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                        <StatusDot status={readiness.status} size="xs" className={statusDotGlyphClass(readiness.status)} />
                        {readiness.label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="shrink-0 border-t border-border-subtle px-2 py-2">
              <button
                type="button"
                onClick={handleAddProvider}
                className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-1.5 text-left transition-colors hover:bg-surface-1"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-0 text-text-secondary">＋</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-secondary">Add provider</span>
              </button>
            </div>
          </section>

          <section className={settingsModelPaneDetailClassName}>
            {showCreateForm ? (
              <div className="mx-auto flex w-full max-w-[700px] flex-col gap-5">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-text-tertiary">New provider</div>
                  <div className="text-[22px] font-semibold text-text-heading">Add custom provider</div>
                  <p className="mt-1 text-sm text-text-muted">Create a provider using an OpenAI-compatible proxy endpoint.</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-text-primary">Compatibility</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateProviderDraft((draft) => ({ ...draft, type: "openai" }))}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        createProviderDraft.type === "openai" ? "border-accent bg-accent text-text-heading" : "border-border-subtle text-text-secondary"
                      }`}
                      disabled={createProviderBusy}
                    >
                      OpenAI
                    </button>

                    <button
                      type="button"
                      onClick={() => setCreateProviderDraft((draft) => ({ ...draft, type: "openrouter" }))}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        createProviderDraft.type === "openrouter"
                          ? "border-accent bg-accent text-text-heading"
                          : "border-border-subtle text-text-secondary"
                      }`}
                      disabled={createProviderBusy}
                    >
                      OpenRouter
                    </button>
                  </div>
                </div>

                <label className={settingsSecretFieldClassName}>
                  <span className="m-0 text-sm font-medium text-text-primary">Display name</span>
                  <input
                    type="text"
                    value={createProviderDraft.displayName}
                    onChange={(event) => setCreateProviderDraft((draft) => ({ ...draft, displayName: event.currentTarget.value }))}
                    className={settingsSecretInputClassName}
                    placeholder={createProviderDraft.type === "openai" ? "OpenAI" : "OpenRouter"}
                    disabled={createProviderBusy}
                  />
                </label>

                <label className={settingsSecretFieldClassName}>
                  <span className="m-0 text-sm font-medium text-text-primary">API proxy URL</span>
                  <input
                    type="url"
                    value={createProviderDraft.baseUrl}
                    onChange={(event) => setCreateProviderDraft((draft) => ({ ...draft, baseUrl: event.currentTarget.value }))}
                    placeholder={createProviderDraft.type === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1"}
                    className={settingsSecretInputClassName}
                    disabled={createProviderBusy}
                  />
                </label>

                <label className={settingsSecretFieldClassName}>
                  <span className="m-0 text-sm font-medium text-text-primary">Timeout (ms)</span>
                  <input
                    type="number"
                    value={createProviderDraft.timeoutMs}
                    onChange={(event) => setCreateProviderDraft((draft) => ({ ...draft, timeoutMs: event.currentTarget.value }))}
                    placeholder="30000"
                    className={settingsSecretInputClassName}
                    disabled={createProviderBusy}
                  />
                </label>

                {createProviderError ? <p className="m-0 text-sm text-error mono">{createProviderError}</p> : null}

                <div className="flex items-center gap-2">
                  <Button type="button" variant="primary" onClick={() => void saveProvider()} disabled={createProviderBusy}>
                    {createProviderBusy ? "Creating…" : "Create provider"}
                  </Button>

                  {providers.length > 0 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={createProviderBusy}
                      onClick={() => {
                        setIsCreatingProvider(false);
                        setSelectedProviderId(providers[0]?.id ?? null);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : selectedProvider ? (
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-1 text-sm font-semibold text-text-primary">
                      {getProviderInitial(selectedProvider)}
                    </span>
                    <div className="truncate text-base font-semibold text-text-primary">
                      {selectedProvider.displayName}
                    </div>
                    <Badge variant="secondary" size="sm" className="hidden sm:inline-flex">{formatProviderType(selectedProvider.type)}</Badge>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <a
                      className="text-xs text-text-secondary hover:text-text-primary"
                      href={getProviderDocsUrl(selectedProvider)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get API key
                    </a>
                    <button
                      type="button"
                      onClick={() => void deleteProvider(selectedProvider.id)}
                      className="text-xs text-text-secondary hover:text-error"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {selectedValidation?.error ? (
                  <p className="m-0 text-xs text-error mono">{selectedValidation.error}</p>
                ) : selectedValidation?.data ? (
                  selectedValidation.data.valid ? (
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <StatusDot status="success" size="xs" />
                      <span>Ready</span>
                      <span>·</span>
                      <span>{selectedValidation.data.availableModelCount} models</span>
                      <span>·</span>
                      <span>default {selectedValidation.data.defaultModelName ?? "none"}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md border border-warning/20 bg-warning-subtle px-3 py-2 text-xs text-warning">
                      <StatusDot status={selectedValidationMeta?.dotStatus ?? "warning"} size="xs" />
                      <span>{selectedValidationMeta?.label}: {selectedValidationMeta?.guidance}</span>
                    </div>
                  )
                ) : null}

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <label className={`${settingsSecretFieldClassName} flex-1`}>
                      <span className="text-[11px] font-medium text-text-secondary">API proxy URL</span>
                      <input
                        type="text"
                        value={providerBaseUrlInput}
                        onChange={(event) => setProviderBaseUrlInput(event.currentTarget.value)}
                        placeholder={selectedProvider.type === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1"}
                        className={`${settingsSecretInputClassName} h-8 text-xs`}
                        disabled={secretBusyAction != null}
                      />
                    </label>

                    <label className={`${settingsSecretFieldClassName} flex-1`}>
                      <span className="text-[11px] font-medium text-text-secondary">API key</span>
                      <input
                        type="password"
                        value={secretInput}
                        onChange={(event) => setSecretInput(event.currentTarget.value)}
                        placeholder={selectedProviderSecretStatus?.hasSecret ? "••••••••••••••••" : (selectedProvider.type === "openai" ? "sk-..." : "or-...")}
                        className={`${settingsSecretInputClassName} h-8 text-xs`}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={!secretStorageState.data?.available || secretBusyAction != null}
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      {selectedProviderSecretStatus?.hasSecret ? (
                         <span className="text-success flex items-center gap-1"><StatusDot status="success" size="xs" /> Key saved</span>
                      ) : (
                         <span className="text-text-muted">No key saved</span>
                      )}
                      
                      {selectedProviderSecretStatus?.hasSecret ? (
                        <>
                          <span className="text-border-subtle">|</span>
                          <button
                            type="button"
                            onClick={() => void clearProviderSecret()}
                            disabled={!secretStorageState.data?.available || secretBusyAction != null}
                            className="text-text-secondary hover:text-text-primary disabled:opacity-50"
                          >
                            Clear
                          </button>
                        </>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void validateProvider(selectedProvider.id)}
                        disabled={selectedValidation?.loading}
                        className="text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-50"
                      >
                        {selectedValidation?.loading ? "Testing…" : "Test connection"}
                      </button>
                      <Button
                        type="button"
                        variant="primary"
                        className="h-7 px-3 text-xs"
                        disabled={(!providerBaseUrlChanged && (!secretStorageState.data?.available || !secretInput.trim())) || secretBusyAction != null}
                        onClick={() => void saveSelectedProviderSettings()}
                      >
                        {secretBusyAction === "save" ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                  
                  {secretFeedback ? <p className="m-0 text-[11px] text-text-muted mono">{secretFeedback}</p> : null}
                  {secretStorageState.error ? <p className="m-0 text-[11px] text-error">{secretStorageState.error}</p> : null}
                </div>

                <div className="border-t border-border-subtle" />

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
                      Models
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadProviderModels({ refresh: true })}
                      className="text-[11px] text-text-secondary hover:text-text-primary"
                      disabled={modelsState.loading}
                    >
                      {modelsState.loading ? "Refreshing…" : "Refresh catalog"}
                    </button>
                  </div>

                  {modelsState.loading ? <p className="m-0 text-xs text-text-muted">Loading cached catalog…</p> : null}
                  {modelsState.error ? <p className="m-0 text-xs text-error mono">{modelsState.error}</p> : null}

                  {!modelsState.loading && !modelsState.error && !modelCatalog.length ? (
                    <p className="m-0 text-xs text-text-muted">No models in cache.</p>
                  ) : null}

                  {modelCatalog.length > 0 ? (
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">⌕</span>
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.currentTarget.value)}
                        placeholder="Search models..."
                        className="h-8 w-full rounded-md border border-border-subtle bg-surface-0 py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
                      />
                    </div>
                  ) : null}

                  {modelSearchResults.length > 0 ? (
                    <div className="space-y-0.5 rounded-xl border border-border-subtle bg-surface-0 p-1" role="list" aria-label="Model search results">
                      {modelSearchResults.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => selectedProviderId && void addSelectedModel(selectedProviderId, model.id)}
                          disabled={modelSelectionBusyId != null}
                          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-1 disabled:opacity-60"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface-0 text-xs font-bold text-text-primary">
                            {model.modelName.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-text-primary">{model.displayName}</span>
                            <span className="block truncate text-xs text-text-muted">{model.modelName}</span>
                          </span>
                          <span className="text-xs font-medium text-text-secondary">{modelSelectionBusyId === model.id ? "Adding…" : "Add"}</span>
                        </button>
                      ))}
                    </div>
                  ) : normalizedModelSearch && modelCatalog.length > 0 ? (
                    <p className="m-0 text-xs text-text-muted">No matching models in cache.</p>
                  ) : null}

                  <div className="space-y-1" role="list" aria-label="Model list">
                    {selectedModels.map((model) => {
                      const isDefault = model.modelName === selectedProvider.defaultModelName;

                      return (
                        <div key={model.id} className="group/model flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-1" role="listitem">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface-0 text-xs font-bold text-text-primary">
                            {model.modelName.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-text-primary">{model.displayName}</div>
                            <div className="truncate text-xs text-text-muted">{model.modelName}</div>
                          </div>
                          <span className="inline-flex flex-shrink-0 gap-2 items-center">
                            {model.supportsTools ? <Badge variant="secondary" size="sm" className="max-sm:hidden">Tools</Badge> : null}
                            {model.supportsReasoning ? <Badge variant="secondary" size="sm" className="max-sm:hidden">Reasoning</Badge> : null}
                            {isDefault ? <Badge variant="accent" size="sm">Default</Badge> : null}
                            {isDefault ? (
                              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-success-subtle text-success">✓</span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => selectedProviderId && void removeSelectedModel(selectedProviderId, model.id)}
                              disabled={modelSelectionBusyId != null}
                              className="ml-1 text-xs text-text-muted hover:text-error disabled:opacity-50"
                            >
                              {modelSelectionBusyId === model.id ? "Removing…" : "Remove"}
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {modelCatalog.length > 0 && selectedModels.length === 0 && !normalizedModelSearch ? (
                    <p className="m-0 text-xs text-text-muted">No models added yet.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </Card>
    </div>
  );
}

export function SettingsPanelContent({ panelId }: { panelId: SettingsPanelId }) {
  if (panelId === "models") {
    return <ModelSettingsPanel />;
  }

  return <GeneralSettingsPanel />;
}
