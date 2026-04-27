"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  },
  {
    id: "connectors",
    title: "Connectors",
    description: "External connector provider configuration."
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
type ConnectorId = "github" | "notion" | "google_drive";
type ConnectorProviderComposioSettings = {
  readonly provider: "composio";
  readonly apiKeyConfigured: boolean;
  readonly baseUrl: string;
  readonly timeoutMs: number | null;
  readonly authConfigIds: Partial<Record<ConnectorId, string>>;
  readonly updatedAt: string;
};
type ConnectorProviderSettingsState = AsyncState<ConnectorProviderComposioSettings>;

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

const initialConnectorProviderSettingsState: ConnectorProviderSettingsState = {
  loading: true,
  data: null,
  error: null
};

const connectorAuthConfigFields = [
  { id: "github", label: "GitHub auth config ID", placeholder: "github-auth-config-id" },
  { id: "notion", label: "Notion auth config ID", placeholder: "notion-auth-config-id" },
  { id: "google_drive", label: "Google Drive auth config ID", placeholder: "google-drive-auth-config-id" }
] as const satisfies ReadonlyArray<{ readonly id: ConnectorId; readonly label: string; readonly placeholder: string }>;

const browserSecretStorageSnapshot: ProviderSecretStorageSnapshot = {
  available: false,
  message:
    "Secure provider secret storage is only available inside the Electron desktop shell. Browser-only development should keep using environment variables.",
  platform: "browser",
  providers: [],
  reason: "desktop_api_unavailable"
};

const surfaceCardClassName = "col-span-12 rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-xs";
const mutedSurfaceCardClassName = "col-span-12 rounded-xl border border-border-subtle bg-surface-2 p-4 shadow-none";
const settingsPanelStackClassName = "m-6 flex flex-col gap-3 max-app:m-4";
const settingsModelsStackClassName = "m-6 flex min-h-0 flex-1 flex-col gap-4 max-app:m-4";
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

function getSecretStatus(snapshot: ProviderSecretStorageSnapshot | null, providerType: Provider["type"]) {
  return snapshot?.providers.find((entry) => entry.providerType === providerType) ?? null;
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
  "h-full overflow-hidden rounded-2xl border border-border-subtle bg-surface-1 p-0 shadow-xs";
const settingsModelPaneListClassName =
  "flex w-full shrink-0 flex-col border-b border-border-subtle bg-surface-1 md:w-[216px] md:border-b-0 md:border-r";
const settingsModelPaneDetailClassName =
  "min-w-0 flex-1 overflow-y-auto bg-surface-1 px-6 py-5 max-sm:px-4";

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

function getComposioDocsUrl() {
  return "https://app.composio.dev";
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

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.text();

  if (!body.trim()) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
}

async function applyProviderCredentialToController(providerType: Provider["type"], secret: string | null) {
  await requestControllerJson(`/api/provider-credentials/${providerType}`, {
    method: secret?.trim() ? "PUT" : "DELETE",
    ...(secret?.trim() ? { body: JSON.stringify({ apiKey: secret.trim() }) } : {})
  });
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
              Session files use each session workspace automatically. Authorize directories only for external files; writes outside the workspace still require
              confirmation.
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
              <p className="m-0 leading-[1.5] text-text-muted">No external directories are authorized yet.</p>
              <p className="m-0 leading-[1.5] text-text-muted">Agents can still use relative paths in the current session workspace without setup.</p>
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

function ConnectorSettingsPanel() {
  const [settingsState, setSettingsState] = useState<ConnectorProviderSettingsState>(initialConnectorProviderSettingsState);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [baseUrlDraft, setBaseUrlDraft] = useState("https://backend.composio.dev");
  const [timeoutMsDraft, setTimeoutMsDraft] = useState("");
  const [authConfigDraft, setAuthConfigDraft] = useState<Record<ConnectorId, string>>({
    github: "",
    notion: "",
    google_drive: ""
  });
  const [saving, setSaving] = useState(false);
  const [clearingApiKey, setClearingApiKey] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const applySettingsToDraft = useCallback((settings: ConnectorProviderComposioSettings) => {
    setApiKeyDraft("");
    setBaseUrlDraft(settings.baseUrl);
    setTimeoutMsDraft(settings.timeoutMs === null ? "" : String(settings.timeoutMs));
    setAuthConfigDraft({
      github: settings.authConfigIds.github ?? "",
      notion: settings.authConfigIds.notion ?? "",
      google_drive: settings.authConfigIds.google_drive ?? ""
    });
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsState((current) => ({ loading: true, data: current.data, error: null }));

    try {
      const settings = await requestControllerJson<ConnectorProviderComposioSettings>("/api/settings/connectors/composio");
      setSettingsState({ loading: false, data: settings, error: null });
      applySettingsToDraft(settings);
    } catch (error) {
      setSettingsState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to load connector settings."
      });
    }
  }, [applySettingsToDraft]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function saveSettings(apiKeyOverride?: string | null) {
    setSaving(apiKeyOverride === undefined);
    setClearingApiKey(apiKeyOverride === null);
    setFeedback(null);

    const timeoutMs = timeoutMsDraft.trim() ? Number.parseInt(timeoutMsDraft.trim(), 10) : null;
    const body: {
      apiKey?: string | null;
      baseUrl: string;
      timeoutMs: number | null;
      authConfigIds: Partial<Record<ConnectorId, string>>;
    } = {
      baseUrl: baseUrlDraft.trim() || "https://backend.composio.dev",
      timeoutMs: Number.isInteger(timeoutMs) && timeoutMs !== null && timeoutMs > 0 ? timeoutMs : null,
      authConfigIds: Object.fromEntries(
        connectorAuthConfigFields
          .map((field) => [field.id, authConfigDraft[field.id].trim()] as const)
          .filter(([, value]) => value.length > 0)
      ) as Partial<Record<ConnectorId, string>>
    };

    if (apiKeyOverride !== undefined) {
      body.apiKey = apiKeyOverride;
    } else if (apiKeyDraft.trim()) {
      body.apiKey = apiKeyDraft.trim();
    }

    try {
      const settings = await requestControllerJson<ConnectorProviderComposioSettings>("/api/settings/connectors/composio", {
        method: "PUT",
        body: JSON.stringify(body)
      });

      setSettingsState({ loading: false, data: settings, error: null });
      applySettingsToDraft(settings);
      setFeedback(apiKeyOverride === null ? "Composio API key cleared." : "Connector provider settings saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to save connector provider settings.");
    } finally {
      setSaving(false);
      setClearingApiKey(false);
    }
  }

  const apiKeyConfigured = settingsState.data?.apiKeyConfigured ?? false;

  return (
    <div className={settingsPanelStackClassName}>
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border-subtle bg-surface-1 p-5">
          <div className={settingsRowClassName}>
            <div>
              <CardTitle>Composio provider</CardTitle>
              <CardDescription>
                Configure the connector provider used by GitHub, Notion, and Google Drive. These settings are saved in Monet and take effect without restarting.
              </CardDescription>
            </div>
            <Badge variant={apiKeyConfigured ? "accent" : "secondary"}>{apiKeyConfigured ? "API key saved" : "Setup required"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5">
          {settingsState.error ? <p className="m-0 text-sm text-error" role="alert">{settingsState.error}</p> : null}
          {settingsState.loading ? <p className="m-0 text-sm text-text-muted">Loading connector provider settings…</p> : null}

          <label className={settingsSecretFieldClassName}>
            <span className="text-sm font-medium text-text-heading">Composio API key</span>
            <input
              className={`${settingsSecretInputClassName} mono`}
              type="password"
              value={apiKeyDraft}
              placeholder={apiKeyConfigured ? "Saved key is hidden. Enter a new key to replace it." : "Enter your Composio API key"}
              autoComplete="off"
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
            <span className="text-xs text-text-muted">Leaving this blank preserves the currently saved key.</span>
          </label>

          <label className={settingsSecretFieldClassName}>
            <span className="text-sm font-medium text-text-heading">Composio base URL</span>
            <input
              className={`${settingsSecretInputClassName} mono`}
              type="url"
              value={baseUrlDraft}
              onChange={(event) => setBaseUrlDraft(event.target.value)}
            />
          </label>

          <label className={settingsSecretFieldClassName}>
            <span className="text-sm font-medium text-text-heading">Request timeout (ms)</span>
            <input
              className={`${settingsSecretInputClassName} mono`}
              type="number"
              min="1"
              value={timeoutMsDraft}
              placeholder="Default"
              onChange={(event) => setTimeoutMsDraft(event.target.value)}
            />
          </label>

          <div className="flex flex-col gap-3">
            <div>
              <h3 className="m-0 text-sm font-semibold text-text-heading">Auth config IDs</h3>
              <p className="m-0 text-sm text-text-muted">Create auth configs in Composio for each connector, then paste their IDs here.</p>
            </div>
            {connectorAuthConfigFields.map((field) => (
              <label key={field.id} className={settingsSecretFieldClassName}>
                <span className="text-sm font-medium text-text-heading">{field.label}</span>
                <input
                  className={`${settingsSecretInputClassName} mono`}
                  type="text"
                  value={authConfigDraft[field.id]}
                  placeholder={field.placeholder}
                  onChange={(event) => setAuthConfigDraft((current) => ({ ...current, [field.id]: event.target.value }))}
                />
              </label>
            ))}
          </div>

          {feedback ? <p className="m-0 text-sm text-text-muted" role="status">{feedback}</p> : null}

          <div className={settingsChipRowClassName}>
            <Button type="button" variant="primary" size="sm" disabled={saving || clearingApiKey} onClick={() => void saveSettings()}>
              {saving ? "Saving…" : "Save connector settings"}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={!apiKeyConfigured || saving || clearingApiKey} onClick={() => void saveSettings(null)}>
              {clearingApiKey ? "Clearing…" : "Clear API key"}
            </Button>
            <a className={settingsInlineActionClassName} href={getComposioDocsUrl()} target="_blank" rel="noreferrer">
              Open Composio
            </a>
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
  const [isModelSearchOpen, setIsModelSearchOpen] = useState(false);
  const [highlightedModelResultIndex, setHighlightedModelResultIndex] = useState(0);
  const [manualModelError, setManualModelError] = useState<string | null>(null);
  const [selectedModelIdsByProviderId, setSelectedModelIdsByProviderId] = useState<Record<string, string[]>>({});
  const [modelSelectionBusyId, setModelSelectionBusyId] = useState<string | null>(null);
  const [isCatalogRefreshLoading, setIsCatalogRefreshLoading] = useState(false);
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
  const backgroundCatalogRefreshProviderIdsRef = useRef(new Set<string>());
  const selectedProviderIdRef = useRef<string | null>(selectedProviderId);

  selectedProviderIdRef.current = selectedProviderId;

  const providers = providersState.data ?? [];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedValidation = selectedProviderId ? validationByProviderId[selectedProviderId] : null;
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

  const showCreateForm = !providersState.loading && !providersState.error && (isCreatingProvider || providers.length === 0);
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

      return result;
    } catch (error) {
      setValidationByProviderId((current) => ({
        ...current,
        [providerId]: {
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Unable to validate provider."
        }
      }));

      return null;
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
        return;
      }
    } catch (error) {
      setProvidersState({
        loading: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to load providers."
      });
    }
  }, [isCreatingProvider]);

  const loadProviderModels = useCallback(async () => {
    const providerId = selectedProviderId;

    if (!providerId) {
      setModelsState(initialModelsState);
      return;
    }

    const cachedState = modelsCacheByProviderId[providerId];

    if (cachedState) {
      setModelsState(cachedState);
      setSelectedModelIdsByProviderId((current) => ({
        ...current,
        [providerId]: getPersistedSelectedModelIds(cachedState.data ?? [])
      }));
      return;
    }

    setModelsState({
      loading: true,
      data: null,
      error: null
    });
    setModelsCacheByProviderId((current) => ({
      ...current,
      [providerId]: {
        loading: true,
        data: null,
        error: null
      }
    }));

    try {
      const result = await requestControllerJson<{ models: ProviderModel[] }>(
        `/api/providers/${providerId}/models`
      );
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
        data: null,
        error: error instanceof Error ? error.message : "Unable to load provider models."
      } satisfies ProviderModelsCacheEntry;

      setModelsCacheByProviderId((current) => ({
        ...current,
        [providerId]: nextState
      }));
      setModelsState(nextState);
    }
  }, [modelsCacheByProviderId, selectedProviderId]);

  const refreshProviderCatalog = useCallback(async (providerId: string, options?: { visible?: boolean }) => {
    if (options?.visible) {
      setIsCatalogRefreshLoading(true);
    }

    try {
      const result = await requestControllerJson<{ models: ProviderModel[] }>(`/api/providers/${providerId}/catalog`, {
        method: "POST"
      });
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

      if (selectedProviderIdRef.current === providerId) {
        setModelsState(nextState);
      }
    } catch (error) {
      if (options?.visible) {
        const nextState = {
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Unable to load provider catalog."
        } satisfies ProviderModelsCacheEntry;

        setModelsCacheByProviderId((current) => ({
          ...current,
          [providerId]: nextState
        }));

        if (selectedProviderIdRef.current === providerId) {
          setModelsState(nextState);
        }
      }
    } finally {
      if (options?.visible) {
        setIsCatalogRefreshLoading(false);
      }
    }
  }, []);

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
    setIsModelSearchOpen(false);
    setHighlightedModelResultIndex(0);
    setManualModelError(null);
  }, [selectedProvider?.baseUrl, selectedProviderId]);

  useEffect(() => {
    setHighlightedModelResultIndex(0);
  }, [normalizedModelSearch]);

  useEffect(() => {
    setHighlightedModelResultIndex((current) => Math.min(current, Math.max(modelSearchResults.length - 1, 0)));
  }, [modelSearchResults.length]);

  useEffect(() => {
    if (!selectedProviderId) {
      setModelsState(initialModelsState);
      return;
    }

    void (async () => {
      await loadProviderModels();

      if (backgroundCatalogRefreshProviderIdsRef.current.has(selectedProviderId)) {
        return;
      }

      backgroundCatalogRefreshProviderIdsRef.current.add(selectedProviderId);
      void refreshProviderCatalog(selectedProviderId);
    })();
  }, [loadProviderModels, refreshProviderCatalog, selectedProviderId]);

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

      let controllerSync: { applied: boolean; reason?: string } | undefined;

      if (shouldSaveSecret && desktopApi?.saveProviderSecret) {
        const result = await desktopApi.saveProviderSecret({
          providerType: selectedProvider.type,
          secret: secretInput
        });

        controllerSync = result.controllerSync;

        try {
          await applyProviderCredentialToController(selectedProvider.type, secretInput);
          controllerSync = { applied: true };
        } catch (error) {
          controllerSync = {
            applied: false,
            reason: error instanceof Error ? error.message : "controller request failed"
          };
        }

        setSecretStorageState({
          loading: false,
          data: result.storage,
          error: null
        });
      }

      if (shouldSaveSecret && controllerSync?.applied !== false) {
        await refreshProviderCatalog(selectedProvider.id, { visible: true });
      }

      await loadProviders();
      const validationResult = await validateProvider(selectedProvider.id);
      setSecretInput("");
      const validationStillMissingCredentials = validationResult?.reason === "missing_credentials";
      setSecretFeedback(
        shouldUpdateProvider && shouldSaveSecret
          ? validationStillMissingCredentials
            ? "Provider URL and secret saved, but this controller still reports missing credentials. Reconnect the controller or restart it before testing."
            : controllerSync?.applied === false
            ? `Provider URL and secret saved, but the running controller could not be updated: ${controllerSync.reason ?? "unknown reason"}. Restart or reconnect the controller before testing.`
            : "Provider URL and secret saved and applied to the running controller."
          : shouldUpdateProvider
            ? "Provider URL saved."
            : validationStillMissingCredentials
              ? "Secret saved to secure storage, but this controller still reports missing credentials. Reconnect the controller or restart it before testing."
              : controllerSync?.applied === false
              ? `Secret saved to secure storage, but the running controller could not be updated: ${controllerSync.reason ?? "unknown reason"}. Restart or reconnect the controller before testing.`
              : "Secret saved to secure storage and applied to the running controller."
      );
    } catch (error) {
      setSecretFeedback(error instanceof Error ? error.message : "Unable to save provider settings.");
    } finally {
      setSecretBusyAction(null);
    }
  }, [loadProviders, providerBaseUrlInput, refreshProviderCatalog, secretInput, selectedProvider, validateProvider]);

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
      await validateProvider(result.id);
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
      const result = await desktopApi.clearProviderSecret({
        providerType: selectedProvider.type
      });

      let controllerSync = result.controllerSync;

      try {
        await applyProviderCredentialToController(selectedProvider.type, null);
        controllerSync = { applied: true };
      } catch (error) {
        controllerSync = {
          applied: false,
          reason: error instanceof Error ? error.message : "controller request failed"
        };
      }

      setSecretStorageState({
        loading: false,
        data: result.storage,
        error: null
      });

      await loadProviders();
      await validateProvider(selectedProvider.id);
      setSecretInput("");
      setSecretFeedback(
        controllerSync.applied
          ? "Saved secret cleared and removed from the running controller."
          : `Saved secret cleared, but the running controller may continue using the previous in-memory key until it restarts: ${controllerSync.reason ?? "unknown reason"}.`
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

  const upsertCachedModel = useCallback((providerId: string, updatedModel: ProviderModel) => {
    setModelsCacheByProviderId((current) => {
      const currentState = current[providerId];
      const sourceData = currentState?.data ?? [];
      const existingIndex = sourceData.findIndex((model) => model.id === updatedModel.id || model.modelName === updatedModel.modelName);
      const nextData = existingIndex >= 0
        ? sourceData.map((model, index) => (index === existingIndex ? updatedModel : model))
        : [...sourceData, updatedModel];
      const nextState = {
        loading: false,
        data: nextData,
        error: null
      } satisfies ProviderModelsCacheEntry;

      return {
        ...current,
        [providerId]: nextState
      };
    });
    setModelsState((current) => {
      const sourceData = current.data ?? [];
      const existingIndex = sourceData.findIndex((model) => model.id === updatedModel.id || model.modelName === updatedModel.modelName);
      const nextData = existingIndex >= 0
        ? sourceData.map((model, index) => (index === existingIndex ? updatedModel : model))
        : [...sourceData, updatedModel];

      return {
        loading: false,
        data: nextData,
        error: null
      };
    });
  }, []);

  const addManualModel = useCallback(async (providerId: string) => {
    const modelName = modelSearch.trim();

    if (!modelName) {
      return;
    }

    setModelSelectionBusyId(`manual:${modelName}`);
    setManualModelError(null);

    try {
      const createdModel = await requestControllerJson<ProviderModel>("/api/provider-models", {
        method: "POST",
        body: JSON.stringify({
          providerId,
          modelName,
          displayName: modelName,
          supportsTools: true,
          supportsReasoning: /^(o1|o3|o4)/i.test(modelName) || /reason/i.test(modelName)
        })
      });

      upsertCachedModel(providerId, createdModel);
      setSelectedModelIdsByProviderId((current) => {
        const currentIds = current[providerId] ?? [];

        return {
          ...current,
          [providerId]: currentIds.includes(createdModel.id) ? currentIds : [...currentIds, createdModel.id]
        };
      });
      await loadProviders();
      await validateProvider(providerId);
      setModelSearch("");
      setIsModelSearchOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add model.";
      setManualModelError(
        /404|not found|Route not found|Unknown providerId/i.test(message)
          ? `${message} If this controller was already running, restart/reconnect it so the new manual model API is available.`
          : message
      );
    } finally {
      setModelSelectionBusyId(null);
    }
  }, [loadProviders, modelSearch, upsertCachedModel, validateProvider]);

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
      setIsModelSearchOpen(false);
    } finally {
      setModelSelectionBusyId(null);
    }
  }, [modelCatalog, selectedModelIds.length, updateCachedModel]);

  const addModelFromInput = useCallback(async (providerId: string) => {
    const normalizedInput = modelSearch.trim().toLowerCase();
    const highlightedModel = modelSearchResults[highlightedModelResultIndex] ?? modelSearchResults[0];
    const highlightedModelMatchesInput = highlightedModel
      ? highlightedModel.modelName.toLowerCase() === normalizedInput || highlightedModel.displayName.toLowerCase() === normalizedInput
      : false;

    if (highlightedModel && highlightedModelMatchesInput) {
      await addSelectedModel(providerId, highlightedModel.id);
      return;
    }

    await addManualModel(providerId);
  }, [addManualModel, addSelectedModel, highlightedModelResultIndex, modelSearch, modelSearchResults]);

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
    } finally {
      setModelSelectionBusyId(null);
    }
  }, [updateCachedModel]);

  return (
    <div className={settingsModelsStackClassName}>
      <Card className={settingsModelSplitPanelClassName}>
        <div className="flex h-full min-h-[600px] flex-col md:flex-row">
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
              {providersState.loading ? (
                <p className="px-2 py-2 text-[11px] text-text-muted">Loading providers…</p>
              ) : providersState.error ? (
                <p className="px-2 py-2 text-[11px] text-text-muted">Providers unavailable.</p>
              ) : filteredProviders.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-text-muted">No providers found.</p>
              ) : (
                filteredProviders.map((provider) => {
                  const isReady = validationByProviderId[provider.id]?.data?.valid === true;
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
                      {isReady ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                          <StatusDot status="success" size="xs" className="text-success" />
                          Ready
                        </span>
                      ) : null}
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
            {providersState.loading ? (
              <div className={settingsEmptyStateClassName}>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-text-tertiary">Model providers</div>
                  <div className="text-[22px] font-semibold text-text-heading">Provider setup</div>
                  <p className="mt-1 text-sm text-text-muted">Loading provider configuration…</p>
                </div>
              </div>
            ) : providersState.error ? (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-text-tertiary">Model providers</div>
                  <div className="text-[22px] font-semibold text-text-heading">Provider setup</div>
                  <p className="mt-1 text-sm text-text-muted">Settings could not load provider metadata.</p>
                </div>
                <p className="m-0 leading-[1.5] text-text-muted mono">{providersState.error}</p>
                <Button type="button" variant="primary" onClick={() => void loadProviders()}>
                  Retry provider load
                </Button>
              </div>
            ) : showCreateForm ? (
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
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setCreateProviderDraft((draft) => ({ ...draft, displayName: value }));
                    }}
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
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setCreateProviderDraft((draft) => ({ ...draft, baseUrl: value }));
                    }}
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
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setCreateProviderDraft((draft) => ({ ...draft, timeoutMs: value }));
                    }}
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

                {selectedValidation?.data?.valid ? (
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <StatusDot status="success" size="xs" />
                    <span>Ready</span>
                    <span>·</span>
                    <span>{selectedValidation.data.availableModelCount} models</span>
                    <span>·</span>
                    <span>default {selectedValidation.data.defaultModelName ?? "none"}</span>
                  </div>
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
                        className="text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-50"
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
                      onClick={() => selectedProviderId && void refreshProviderCatalog(selectedProviderId, { visible: true })}
                      className="text-[10px] text-text-secondary hover:text-text-primary"
                      disabled={isCatalogRefreshLoading}
                    >
                      {isCatalogRefreshLoading ? "Refreshing…" : modelCatalog.length > 0 ? "Refresh catalog" : "Load catalog"}
                    </button>
                  </div>

                  {modelsState.loading ? (
                    <p className="m-0 text-xs text-text-muted">
                      {isCatalogRefreshLoading ? "Loading provider catalog…" : "Loading configured models…"}
                    </p>
                  ) : null}
                  {modelsState.error ? <p className="m-0 text-xs text-error mono">{modelsState.error}</p> : null}

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

                  <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                    <div className="relative min-w-0 flex-1">
                      {modelCatalog.length > 0 ? (
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">⌕</span>
                      ) : null}
                      <input
                        id="model-add-input"
                        type="text"
                        value={modelSearch}
                        onChange={(event) => {
                          setModelSearch(event.currentTarget.value);
                          setIsModelSearchOpen(true);
                          setManualModelError(null);
                        }}
                        onFocus={() => setIsModelSearchOpen(true)}
                        onBlur={() => setIsModelSearchOpen(false)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && modelSearch.trim() && selectedProviderId && modelSelectionBusyId == null) {
                            event.preventDefault();
                            void addModelFromInput(selectedProviderId);
                          }

                          if (event.key === "ArrowDown" && modelSearchResults.length > 0) {
                            event.preventDefault();
                            setIsModelSearchOpen(true);
                            setHighlightedModelResultIndex((current) => (current + 1) % modelSearchResults.length);
                          }

                          if (event.key === "ArrowUp" && modelSearchResults.length > 0) {
                            event.preventDefault();
                            setIsModelSearchOpen(true);
                            setHighlightedModelResultIndex((current) => (current - 1 + modelSearchResults.length) % modelSearchResults.length);
                          }
                        }}
                        role="combobox"
                        aria-label="Add model"
                        aria-expanded={isModelSearchOpen && modelSearchResults.length > 0}
                        aria-controls="model-search-results"
                        aria-describedby={manualModelError ? "model-add-error" : undefined}
                        placeholder={modelCatalog.length > 0 ? "Search or enter model ID" : selectedProvider.type === "openai" ? "gpt-4.1-mini" : "openai/gpt-4.1-mini"}
                        className={`h-8 w-full rounded-md border border-border-subtle bg-surface-0 py-1 pr-2.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 ${modelCatalog.length > 0 ? "pl-7" : "pl-2.5"}`}
                        disabled={modelSelectionBusyId != null}
                      />
                      {isModelSearchOpen && modelSearchResults.length > 0 ? (
                        <div id="model-search-results" className="absolute left-0 right-0 top-[calc(100%+0.25rem)] z-20 max-h-72 overflow-y-auto rounded-xl border border-border-subtle bg-surface-0 p-1 shadow-lg" role="listbox" aria-label="Model search results">
                          {modelSearchResults.map((model, index) => (
                            <button
                              key={model.id}
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => selectedProviderId && void addSelectedModel(selectedProviderId, model.id)}
                              disabled={modelSelectionBusyId != null}
                              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-1 disabled:opacity-60 data-[highlighted=true]:bg-surface-1"
                              data-highlighted={index === highlightedModelResultIndex ? "true" : "false"}
                              role="option"
                              aria-selected={index === highlightedModelResultIndex}
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
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 px-3 text-xs max-sm:w-full"
                      disabled={!modelSearch.trim() || modelSelectionBusyId != null}
                      onClick={() => selectedProviderId && void addModelFromInput(selectedProviderId)}
                    >
                      {modelSelectionBusyId != null ? "Adding…" : "Add"}
                    </Button>
                  </div>
                  {manualModelError ? <p id="model-add-error" className="m-0 text-xs text-error mono" role="alert">{manualModelError}</p> : null}
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

  if (panelId === "connectors") {
    return <ConnectorSettingsPanel />;
  }

  return <GeneralSettingsPanel />;
}
