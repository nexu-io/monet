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
const settingsProviderItemClassName = `${settingsItemCardClassName} text-left transition-colors hover:border-accent/40 hover:bg-accent/5 data-[active=true]:border-accent/40 data-[active=true]:bg-accent/5`;
const settingsDirectoryItemClassName = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border-subtle bg-surface-1 p-3 shadow-xs max-sm:grid-cols-[auto_minmax(0,1fr)]";
const settingsDirectoryIconClassName = "inline-flex size-9 items-center justify-center rounded-md bg-accent/10 text-accent";
const settingsDirectoryPathClassName = "block truncate text-text-heading";
const settingsThemeOptionsClassName = "grid grid-cols-3 gap-3 max-app:grid-cols-1";
const settingsThemeOptionClassName = `${settingsItemCardClassName} cursor-pointer transition-colors hover:border-accent/40 data-[active=true]:border-accent/40 data-[active=true]:shadow-focus`;
const settingsThemeSwatchBaseClassName = "h-12 rounded-md border border-border-subtle";
const settingsProviderGridClassName = "grid grid-cols-[minmax(280px,0.9fr)_minmax(0,1.6fr)] items-start gap-4 max-app:grid-cols-1";
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
  const [modelsState, setModelsState] = useState<AsyncState<ProviderModel[]>>(initialModelsState);
  const [validationByProviderId, setValidationByProviderId] = useState<Record<string, ProviderValidationState>>({});
  const [secretStorageState, setSecretStorageState] = useState<ProviderSecretStorageState>(initialSecretStorageState);
  const [secretInput, setSecretInput] = useState("");
  const [secretBusyAction, setSecretBusyAction] = useState<"save" | "clear" | null>(null);
  const [secretFeedback, setSecretFeedback] = useState<string | null>(null);

  const providers = providersState.data ?? [];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;

  const allValidationsSettled = useMemo(
    () => providers.length > 0 && providers.every((provider) => validationByProviderId[provider.id] && !validationByProviderId[provider.id]?.loading),
    [providers, validationByProviderId]
  );

  const hasReadyProvider = useMemo(
    () => providers.some((provider) => validationByProviderId[provider.id]?.data?.valid),
    [providers, validationByProviderId]
  );

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
        if (current && nextProviders.some((provider) => provider.id === current)) {
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
  }, [validateProvider]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    void loadSecretStorage();
  }, [loadSecretStorage]);

  useEffect(() => {
    if (!selectedProviderId) {
      setModelsState(initialModelsState);
      return;
    }

    let cancelled = false;

    async function loadProviderModels() {
      setModelsState({
        loading: true,
        data: null,
        error: null
      });

      try {
        const result = await requestControllerJson<{ models: ProviderModel[] }>(`/api/providers/${selectedProviderId}/models`);

        if (cancelled) {
          return;
        }

        setModelsState({
          loading: false,
          data: result.models,
          error: null
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setModelsState({
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Unable to load provider models."
        });
      }
    }

    void loadProviderModels();

    return () => {
      cancelled = true;
    };
  }, [selectedProviderId]);

  const selectedValidation = selectedProviderId ? validationByProviderId[selectedProviderId] : null;
  const selectedValidationMeta = selectedValidation?.data ? validationReasonMeta[selectedValidation.data.reason] : null;
  const selectedProviderSecretStatus = getSecretStatus(secretStorageState.data, selectedProvider?.type ?? "openai");

  const saveProviderSecret = useCallback(async () => {
    if (!selectedProvider) {
      return;
    }

    const desktopApi = getDesktopApi();

    if (!desktopApi?.saveProviderSecret) {
      setSecretFeedback(browserSecretStorageSnapshot.message);
      return;
    }

    setSecretBusyAction("save");
    setSecretFeedback(null);

    try {
      setSecretStorageState({
        loading: false,
        data: await desktopApi.saveProviderSecret({
          providerType: selectedProvider.type,
          secret: secretInput
        }),
        error: null
      });

      const restartResult = await desktopApi.restartController?.();

      await loadProviders();
      await validateProvider(selectedProvider.id);
      setSecretInput("");
      setSecretFeedback(
        restartResult?.restarted === false
          ? "Secret saved to secure storage. Restart the workspace manually before revalidating provider access."
          : "Secret saved to secure storage and the workspace was restarted."
      );
    } catch (error) {
      setSecretFeedback(error instanceof Error ? error.message : "Unable to save the provider secret.");
    } finally {
      setSecretBusyAction(null);
    }
  }, [loadProviders, secretInput, selectedProvider, validateProvider]);

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

  if (providersState.loading) {
    return (
      <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Provider configuration</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Model routing and defaults</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">Loading providers, models, and validation status from your workspace.</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <div className={settingsEmptyStateClassName}>
            <ValidationBadge state={{ loading: true, data: null, error: null }} />
            <p className="m-0 leading-[1.5] text-text-muted">Checking provider records and syncing the current model catalog.</p>
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
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Provider configuration</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Model routing and defaults</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">Settings could not load provider metadata from your workspace.</CardDescription>
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

  if (providers.length === 0) {
    return (
      <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Provider configuration</span>
            <CardTitle className="m-0 text-2xl font-semibold text-text-heading">No providers configured yet</CardTitle>
            <CardDescription className="m-0 leading-[1.5] text-text-muted">
              Monet needs at least one persisted provider record before new sessions can resolve a default model.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className={settingsEmptyStateClassName}>
            <Badge variant="warning" size="sm" radius="full" className={getStatusBadgeClassName("unknown")}>
              <StatusDot status="warning" size="xs" className="size-2" />
              <span>No provider records</span>
            </Badge>

            <ul className="grid list-none gap-2.5 p-0 m-0">
              <li>
                <Card variant="muted" padding="sm" className={mutedSurfaceCardClassName}>
                  Supported provider types in the current build are OpenAI and OpenRouter.
                </Card>
              </li>
              <li>
                <Card variant="muted" padding="sm" className={mutedSurfaceCardClassName}>
                  Once a provider exists, this page will surface its default model, enabled catalog, and validation result.
                </Card>
              </li>
              <li>
                <Card variant="muted" padding="sm" className={mutedSurfaceCardClassName}>
                  After provider setup is available, return here and run validation to confirm the desktop app can start chats.
                </Card>
              </li>
            </ul>

            <Button type="button" variant="primary" onClick={() => void loadProviders()}>
              Refresh providers
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={settingsModelsStackClassName}>
      {!hasReadyProvider && allValidationsSettled ? (
        <Card className={`${surfaceCardClassName} flex flex-col gap-3 border-dashed`}>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Setup guidance</span>
              <CardTitle className="m-0 text-2xl font-semibold text-text-heading">No provider is ready for chat yet</CardTitle>
              <CardDescription className="m-0 leading-[1.5] text-text-muted">
                A session needs a validated provider and a resolved default model before it can call <span className="mono">/api/chat</span>.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <ul className="grid list-none gap-2.5 p-0 m-0">
              <li>
                <Card variant="muted" padding="sm" className={mutedSurfaceCardClassName}>
                  Start by fixing the provider cards marked with missing credentials, API errors, or default-model issues.
                </Card>
              </li>
              <li>
                <Card variant="muted" padding="sm" className={mutedSurfaceCardClassName}>
                  Re-run validation after local provider setup changes so the model catalog is refreshed.
                </Card>
              </li>
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className={settingsProviderGridClassName}>
        <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Configured providers</span>
              <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Choose a provider</CardTitle>
              <CardDescription className="m-0 leading-[1.5] text-text-muted">Validation status is loaded inline so you can see which provider is ready for new sessions.</CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <div className={settingsListStackClassName} role="list" aria-label="Configured providers">
              {providers.map((provider) => {
                const validationState = validationByProviderId[provider.id];
                const isSelected = provider.id === selectedProviderId;

                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={settingsProviderItemClassName}
                    data-active={isSelected ? "true" : "false"}
                    onClick={() => setSelectedProviderId(provider.id)}
                  >
                    <div className={settingsRowClassName}>
                      <div className="flex flex-col gap-1">
                        <strong>{provider.displayName}</strong>
                        <span className="m-0 leading-[1.5] text-text-muted">{formatProviderType(provider.type)}</span>
                      </div>
                      <Badge variant={provider.enabled ? "secondary" : "warning"} size="sm" radius="full">
                        {provider.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>

                    <ValidationBadge state={validationState} />

                    <div className={settingsMetaClassName}>
                      <span>Default: {provider.defaultModelName ?? "Not set"}</span>
                      <span>ID: {provider.id}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {selectedProvider ? (
          <div className={settingsProviderDetailClassName}>
            <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
              <CardHeader>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selected provider</span>
                  <div className={settingsRowClassName}>
                    <CardTitle className="m-0 text-2xl font-semibold text-text-heading">{selectedProvider.displayName}</CardTitle>
                    <ValidationBadge state={selectedValidation} />
                  </div>
                  <CardDescription className="m-0 leading-[1.5] text-text-muted">
                    Review the persisted provider metadata, current validation result, and enabled model catalog.
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-3">
                <div className={settingsChipRowClassName}>
                  <Badge variant="secondary" size="sm" radius="full">{formatProviderType(selectedProvider.type)}</Badge>
                  <Badge variant={selectedProvider.enabled ? "success" : "warning"} size="sm" radius="full">
                    {selectedProvider.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Badge variant="secondary" size="sm" radius="full">
                    {selectedProvider.timeoutMs ? `${selectedProvider.timeoutMs} ms timeout` : "Default timeout"}
                  </Badge>
                </div>

                <ul className="grid list-none gap-2.5 p-0 m-0">
                  <li className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-3">
                    <strong>Default model</strong>
                    <div className="m-0 leading-[1.5] text-text-muted mono">{selectedProvider.defaultModelName ?? "Not configured"}</div>
                  </li>
                  <li className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-3">
                    <strong>Base URL</strong>
                    <div className="m-0 leading-[1.5] text-text-muted mono">{selectedProvider.baseUrl ?? "Provider default"}</div>
                  </li>
                  <li className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-3">
                    <strong>Updated</strong>
                    <div className="m-0 leading-[1.5] text-text-muted">{formatTimestamp(selectedProvider.updatedAt)}</div>
                  </li>
                  <li className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-3">
                    <strong>Provider ID</strong>
                    <div className="m-0 leading-[1.5] text-text-muted mono">{selectedProvider.id}</div>
                  </li>
                </ul>

                <div className={settingsValidationCardClassName}>
                  <div className={settingsRowClassName}>
                    <strong>Local credentials</strong>
                    <div className={settingsChipRowClassName}>
                      <Badge
                        variant={secretStorageState.data?.available ? "success" : "warning"}
                        size="sm"
                        radius="full"
                      >
                        {secretStorageState.loading
                          ? "Checking secure storage…"
                          : secretStorageState.data?.available
                            ? "Secure storage ready"
                            : "Secure storage unavailable"}
                      </Badge>
                      <Badge
                        variant={selectedProviderSecretStatus?.hasSecret ? "secondary" : "warning"}
                        size="sm"
                        radius="full"
                      >
                        {selectedProviderSecretStatus?.hasSecret ? "Secret saved" : "No saved secret"}
                      </Badge>
                    </div>
                  </div>

                  <p className="m-0 leading-[1.5] text-text-muted">
                    {secretStorageState.error ?? secretStorageState.data?.message ?? browserSecretStorageSnapshot.message}
                  </p>
                  <p className="m-0 leading-[1.5] text-text-muted">
                    Saved secrets are loaded on startup. Explicit environment variables still take precedence.
                  </p>

                  <label className={settingsSecretFieldClassName}>
                    <span className="m-0 leading-[1.5] text-text-muted">{formatProviderType(selectedProvider.type)} API key</span>
                    <input
                      type="password"
                      value={secretInput}
                      placeholder={selectedProvider.type === "openai" ? "sk-..." : "or-..."}
                      className={settingsSecretInputClassName}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={!secretStorageState.data?.available || secretBusyAction != null}
                      onChange={(event) => setSecretInput(event.currentTarget.value)}
                    />
                  </label>

                  <div className={settingsChipRowClassName}>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={!secretStorageState.data?.available || !secretInput.trim() || secretBusyAction != null}
                      onClick={() => void saveProviderSecret()}
                    >
                      {secretBusyAction === "save" ? "Saving…" : "Save secret"}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!secretStorageState.data?.available || !selectedProviderSecretStatus?.hasSecret || secretBusyAction != null}
                      onClick={() => void clearProviderSecret()}
                    >
                      {secretBusyAction === "clear" ? "Clearing…" : "Clear saved secret"}
                    </Button>
                  </div>

                  {secretStorageState.data?.reason === "linux_keyring_unavailable" ? (
                    <p className="m-0 leading-[1.5] text-text-muted">
                      Linux fallback: secret persistence stays disabled until a supported system keyring is available. Validation can still succeed when provider credentials are supplied through environment variables.
                    </p>
                  ) : null}

                  {secretFeedback ? <p className="m-0 leading-[1.5] text-text-muted mono">{secretFeedback}</p> : null}
                </div>

                <div className={settingsValidationCardClassName}>
                  <div className={settingsRowClassName}>
                    <strong>Validate status</strong>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void validateProvider(selectedProvider.id)}
                      disabled={selectedValidation?.loading}
                    >
                      {selectedValidation?.loading ? "Validating…" : "Revalidate provider"}
                    </Button>
                  </div>

                  {selectedValidation?.error ? <p className="m-0 leading-[1.5] text-text-muted mono">{selectedValidation.error}</p> : null}
                  {selectedValidation?.data ? (
                    <>
                      <p className="m-0 leading-[1.5] text-text-muted">{selectedValidation.data.message}</p>
                      <p className="m-0 leading-[1.5] text-text-muted">{selectedValidationMeta?.guidance}</p>
                      <div className={settingsMetaClassName}>
                        <span>Enabled models: {selectedValidation.data.availableModelCount}</span>
                        <span>Resolved default: {selectedValidation.data.defaultModelName ?? "Not resolved"}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className={`${surfaceCardClassName} flex flex-col gap-3`}>
              <CardHeader>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-tertiary">Enabled catalog</span>
                  <CardTitle className="m-0 text-2xl font-semibold text-text-heading">Provider models</CardTitle>
                  <CardDescription className="m-0 leading-[1.5] text-text-muted">This list is refreshed from the selected provider when the panel loads.</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-3">
                {modelsState.loading ? <p className="m-0 leading-[1.5] text-text-muted">Loading models…</p> : null}
                {modelsState.error ? <p className="m-0 leading-[1.5] text-text-muted mono">{modelsState.error}</p> : null}
                {!modelsState.loading && !modelsState.error && (modelsState.data?.length ?? 0) === 0 ? (
                  <p className="m-0 leading-[1.5] text-text-muted">No enabled models are currently available for this provider.</p>
                ) : null}

                <div className={settingsListStackClassName} role="list" aria-label="Provider models">
                  {(modelsState.data ?? []).map((model) => {
                    const isDefault = model.modelName === selectedProvider.defaultModelName;

                    return (
                      <div key={model.id} className={settingsItemCardClassName} role="listitem">
                        <div className={settingsRowClassName}>
                          <div className="flex flex-col gap-1">
                            <strong>{model.displayName}</strong>
                            <span className="m-0 leading-[1.5] text-text-muted mono">{model.modelName}</span>
                          </div>
                          <div className={settingsChipRowClassName}>
                            {isDefault ? <Badge variant="accent" size="sm" radius="full">Default</Badge> : null}
                            <Badge variant={model.enabled ? "success" : "warning"} size="sm" radius="full">
                              {model.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </div>
                        </div>

                        <div className={settingsChipRowClassName}>
                          <Badge variant="secondary" size="sm" radius="full">
                            {model.supportsTools ? "Tools" : "No tools"}
                          </Badge>
                          <Badge variant="secondary" size="sm" radius="full">
                            {model.supportsReasoning ? "Reasoning" : "No reasoning"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsPanelContent({ panelId }: { panelId: SettingsPanelId }) {
  if (panelId === "models") {
    return <ModelSettingsPanel />;
  }

  return <GeneralSettingsPanel />;
}
