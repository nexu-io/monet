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
      <Badge variant="secondary" size="sm" radius="full" className="status-badge" data-tone="unknown">
        <StatusDot status="info" size="xs" />
        <span>Not checked yet</span>
      </Badge>
    );
  }

  if (state.loading) {
    return (
      <Badge variant="warning" size="sm" radius="full" className="status-badge" data-tone="unknown">
        <StatusDot status="warning" size="xs" pulse />
        <span>Validating…</span>
      </Badge>
    );
  }

  if (state.error) {
    return (
      <Badge variant="destructive" size="sm" radius="full" className="status-badge" data-tone="offline">
        <StatusDot status="error" size="xs" />
        <span>Validation failed</span>
      </Badge>
    );
  }

  if (!state.data) {
    return null;
  }

  const meta = validationReasonMeta[state.data.reason];
  const tone = state.data.valid ? "healthy" : meta.badgeVariant === "destructive" ? "offline" : "unknown";

  return (
    <Badge variant={meta.badgeVariant} size="sm" radius="full" className="status-badge" data-tone={tone}>
      <StatusDot status={meta.dotStatus} size="xs" />
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
    <div className="settings-general-layout">
      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Filesystem access</span>
            <CardTitle>Authorized directories</CardTitle>
            <CardDescription className="muted">
              File tools can only read and write inside directories you explicitly authorize here.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="stack">
          <div className="settings-provider-item-meta muted">
            <span>{authorizedDirectories.length} authorized</span>
              <span>Saved to your local workspace</span>
          </div>

          <label className="settings-secret-field">
            <span className="muted">Add a directory path manually</span>
            <input
              type="text"
              value={directoryDraft}
              placeholder="/Users/example/Projects"
              className="settings-secret-input mono"
              disabled={directoryBusy}
              onChange={(event) => setDirectoryDraft(event.currentTarget.value)}
            />
          </label>

          <div className="settings-provider-chip-row">
            <Button type="button" variant="primary" disabled={directoryBusy || !directoryDraft.trim()} onClick={() => void addDirectory(directoryDraft)}>
              {directoryBusy ? "Saving…" : "Add directory"}
            </Button>
            <Button type="button" variant="secondary" disabled={directoryBusy || !desktopApi?.pickDirectory} onClick={() => void pickDirectory()}>
              Choose folder…
            </Button>
          </div>

          {!desktopApi?.pickDirectory ? (
            <p className="muted">Native folder picking is only available inside the Electron desktop shell.</p>
          ) : null}

          {authorizedDirectoriesState.loading ? <p className="muted">Loading authorized directories…</p> : null}
          {authorizedDirectoriesState.error ? <p className="muted mono">{authorizedDirectoriesState.error}</p> : null}

          {!authorizedDirectoriesState.loading && !authorizedDirectoriesState.error && authorizedDirectories.length === 0 ? (
            <div className="settings-empty-state">
              <p className="muted">No directories are authorized yet.</p>
              <p className="muted">Add one before using read_file or write_file in agent runs.</p>
            </div>
          ) : null}

          <div className="settings-directory-list" role="list" aria-label="Authorized directories">
            {authorizedDirectories.map((entry) => (
              <div key={entry.path} className="settings-directory-item" role="listitem">
                <span className="settings-directory-item-icon" aria-hidden="true">
                  📁
                </span>
                <div className="stack-tight">
                  <strong className="settings-directory-item-path mono" title={entry.path}>
                    {entry.path}
                  </strong>
                  <div className="settings-provider-item-meta muted">
                    <span>Updated {formatTimestamp(entry.updatedAt)}</span>
                    <span>Added {formatTimestamp(entry.createdAt)}</span>
                  </div>
                </div>
                <Button type="button" variant="secondary" disabled={directoryBusy} onClick={() => void removeDirectory(entry.path)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>

          {directoryFeedback ? <p className="muted mono">{directoryFeedback}</p> : null}
        </CardContent>
      </Card>

      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Local storage</span>
            <CardTitle>Data directory</CardTitle>
            <CardDescription className="muted">
              Monet stores desktop state, secrets metadata, window state, and your local workspace database in the app data directory.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="stack">
          <ul className="kv-list">
            <li>
              <Card variant="muted" padding="sm" className="card card-muted stack-tight">
                <div className="settings-provider-item-header">
                  <strong>Application data path</strong>
                  <div className="settings-provider-chip-row">
                    <button
                      type="button"
                      className="kv-inline-action"
                      disabled={!appPathsState.data?.userDataPath}
                      onClick={() => void copyPath(appPathsState.data?.userDataPath ?? "")}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="kv-inline-action"
                      disabled={!desktopApi?.openPath || !appPathsState.data?.userDataPath}
                      onClick={() => void openPath(appPathsState.data?.userDataPath ?? "")}
                    >
                      Reveal
                    </button>
                  </div>
                </div>
                <div className="muted mono">{appPathsState.data?.userDataPath ?? "Unavailable outside the desktop shell."}</div>
              </Card>
            </li>
          </ul>

          {appPathsState.loading ? <p className="muted">Loading app paths…</p> : null}
          {appPathsState.error ? <p className="muted">{appPathsState.error}</p> : null}
          {pathFeedback ? <p className="muted mono">{pathFeedback}</p> : null}
        </CardContent>
      </Card>

      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Appearance</span>
            <CardTitle>Theme</CardTitle>
            <CardDescription className="muted">Choose whether the renderer follows the system appearance or forces a specific theme.</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="stack">
          <div className="settings-theme-options" role="list" aria-label="Theme options">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="settings-theme-option"
                data-active={theme === option.value ? "true" : "false"}
                onClick={() => setTheme(option.value)}
              >
                <span className="settings-theme-swatch" data-theme-preview={option.value} aria-hidden="true" />
                <div className="stack-tight">
                  <strong>{option.label}</strong>
                  <span className="muted">{option.detail}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="settings-provider-item-meta muted">
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
      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Provider configuration</span>
            <CardTitle>Model routing and defaults</CardTitle>
            <CardDescription className="muted">Loading providers, models, and validation status from your workspace.</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <div className="settings-empty-state">
            <ValidationBadge state={{ loading: true, data: null, error: null }} />
            <p className="muted">Checking provider records and syncing the current model catalog.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (providersState.error) {
    return (
      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Provider configuration</span>
            <CardTitle>Model routing and defaults</CardTitle>
            <CardDescription className="muted">Settings could not load provider metadata from your workspace.</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="stack">
          <Badge variant="destructive" size="sm" radius="full" className="status-badge" data-tone="offline">
            <StatusDot status="error" size="xs" />
            <span>Provider list unavailable</span>
          </Badge>
          <p className="muted mono">{providersState.error}</p>
          <Button type="button" variant="primary" onClick={() => void loadProviders()}>
            Retry provider load
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (providers.length === 0) {
    return (
      <Card className="card stack">
        <CardHeader>
          <div className="stack-tight">
            <span className="eyebrow">Provider configuration</span>
            <CardTitle>No providers configured yet</CardTitle>
            <CardDescription className="muted">
              Monet needs at least one persisted provider record before new sessions can resolve a default model.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="stack">
          <div className="settings-empty-state">
            <Badge variant="warning" size="sm" radius="full" className="status-badge" data-tone="unknown">
              <StatusDot status="warning" size="xs" />
              <span>No provider records</span>
            </Badge>

            <ul className="settings-list">
              <li>
                <Card variant="muted" padding="sm" className="card card-muted">
                  Supported provider types in the current build are OpenAI and OpenRouter.
                </Card>
              </li>
              <li>
                <Card variant="muted" padding="sm" className="card card-muted">
                  Once a provider exists, this page will surface its default model, enabled catalog, and validation result.
                </Card>
              </li>
              <li>
                <Card variant="muted" padding="sm" className="card card-muted">
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
    <div className="settings-models-layout">
      {!hasReadyProvider && allValidationsSettled ? (
        <Card className="card stack settings-callout-card">
          <CardHeader>
            <div className="stack-tight">
              <span className="eyebrow">Setup guidance</span>
              <CardTitle>No provider is ready for chat yet</CardTitle>
              <CardDescription className="muted">
                A session needs a validated provider and a resolved default model before it can call <span className="mono">/api/chat</span>.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <ul className="settings-list">
              <li>
                <Card variant="muted" padding="sm" className="card card-muted">
                  Start by fixing the provider cards marked with missing credentials, API errors, or default-model issues.
                </Card>
              </li>
              <li>
                <Card variant="muted" padding="sm" className="card card-muted">
                  Re-run validation after local provider setup changes so the model catalog is refreshed.
                </Card>
              </li>
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="settings-provider-grid">
        <Card className="card stack settings-provider-list-card">
          <CardHeader>
            <div className="stack-tight">
              <span className="eyebrow">Configured providers</span>
              <CardTitle>Choose a provider</CardTitle>
              <CardDescription className="muted">Validation status is loaded inline so you can see which provider is ready for new sessions.</CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <div className="settings-provider-list" role="list" aria-label="Configured providers">
              {providers.map((provider) => {
                const validationState = validationByProviderId[provider.id];
                const isSelected = provider.id === selectedProviderId;

                return (
                  <button
                    key={provider.id}
                    type="button"
                    className="settings-provider-item"
                    data-active={isSelected ? "true" : "false"}
                    onClick={() => setSelectedProviderId(provider.id)}
                  >
                    <div className="settings-provider-item-header">
                      <div className="stack-tight">
                        <strong>{provider.displayName}</strong>
                        <span className="muted">{formatProviderType(provider.type)}</span>
                      </div>
                      <Badge variant={provider.enabled ? "secondary" : "warning"} size="sm" radius="full">
                        {provider.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>

                    <ValidationBadge state={validationState} />

                    <div className="settings-provider-item-meta muted">
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
          <div className="settings-provider-detail stack">
            <Card className="card stack">
              <CardHeader>
                <div className="stack-tight">
                  <span className="eyebrow">Selected provider</span>
                  <div className="settings-title-row">
                    <CardTitle>{selectedProvider.displayName}</CardTitle>
                    <ValidationBadge state={selectedValidation} />
                  </div>
                  <CardDescription className="muted">
                    Review the persisted provider metadata, current validation result, and enabled model catalog.
                  </CardDescription>
                </div>
              </CardHeader>

              <CardContent className="stack">
                <div className="settings-provider-chip-row">
                  <Badge variant="secondary" size="sm" radius="full">{formatProviderType(selectedProvider.type)}</Badge>
                  <Badge variant={selectedProvider.enabled ? "success" : "warning"} size="sm" radius="full">
                    {selectedProvider.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Badge variant="secondary" size="sm" radius="full">
                    {selectedProvider.timeoutMs ? `${selectedProvider.timeoutMs} ms timeout` : "Default timeout"}
                  </Badge>
                </div>

                <ul className="kv-list">
                  <li>
                    <strong>Default model</strong>
                    <div className="muted mono">{selectedProvider.defaultModelName ?? "Not configured"}</div>
                  </li>
                  <li>
                    <strong>Base URL</strong>
                    <div className="muted mono">{selectedProvider.baseUrl ?? "Provider default"}</div>
                  </li>
                  <li>
                    <strong>Updated</strong>
                    <div className="muted">{formatTimestamp(selectedProvider.updatedAt)}</div>
                  </li>
                  <li>
                    <strong>Provider ID</strong>
                    <div className="muted mono">{selectedProvider.id}</div>
                  </li>
                </ul>

                <div className="settings-validation-card card card-muted stack-tight">
                  <div className="settings-provider-item-header">
                    <strong>Local credentials</strong>
                    <div className="settings-provider-chip-row">
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

                  <p className="muted">
                    {secretStorageState.error ?? secretStorageState.data?.message ?? browserSecretStorageSnapshot.message}
                  </p>
                  <p className="muted">
                    Saved secrets are loaded on startup. Explicit environment variables still take precedence.
                  </p>

                  <label className="settings-secret-field">
                    <span className="muted">{formatProviderType(selectedProvider.type)} API key</span>
                    <input
                      type="password"
                      value={secretInput}
                      placeholder={selectedProvider.type === "openai" ? "sk-..." : "or-..."}
                      className="settings-secret-input"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={!secretStorageState.data?.available || secretBusyAction != null}
                      onChange={(event) => setSecretInput(event.currentTarget.value)}
                    />
                  </label>

                  <div className="settings-provider-chip-row">
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
                    <p className="muted">
                      Linux fallback: secret persistence stays disabled until a supported system keyring is available. Validation can still succeed when provider credentials are supplied through environment variables.
                    </p>
                  ) : null}

                  {secretFeedback ? <p className="muted mono">{secretFeedback}</p> : null}
                </div>

                <div className="settings-validation-card card card-muted stack-tight">
                  <div className="settings-provider-item-header">
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

                  {selectedValidation?.error ? <p className="muted mono">{selectedValidation.error}</p> : null}
                  {selectedValidation?.data ? (
                    <>
                      <p className="muted">{selectedValidation.data.message}</p>
                      <p className="muted">{selectedValidationMeta?.guidance}</p>
                      <div className="settings-provider-item-meta muted">
                        <span>Enabled models: {selectedValidation.data.availableModelCount}</span>
                        <span>Resolved default: {selectedValidation.data.defaultModelName ?? "Not resolved"}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="card stack">
              <CardHeader>
                <div className="stack-tight">
                  <span className="eyebrow">Enabled catalog</span>
                  <CardTitle>Provider models</CardTitle>
                  <CardDescription className="muted">This list is refreshed from the selected provider when the panel loads.</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="stack">
                {modelsState.loading ? <p className="muted">Loading models…</p> : null}
                {modelsState.error ? <p className="muted mono">{modelsState.error}</p> : null}
                {!modelsState.loading && !modelsState.error && (modelsState.data?.length ?? 0) === 0 ? (
                  <p className="muted">No enabled models are currently available for this provider.</p>
                ) : null}

                <div className="settings-model-list" role="list" aria-label="Provider models">
                  {(modelsState.data ?? []).map((model) => {
                    const isDefault = model.modelName === selectedProvider.defaultModelName;

                    return (
                      <div key={model.id} className="settings-model-item" role="listitem">
                        <div className="settings-provider-item-header">
                          <div className="stack-tight">
                            <strong>{model.displayName}</strong>
                            <span className="muted mono">{model.modelName}</span>
                          </div>
                          <div className="settings-provider-chip-row">
                            {isDefault ? <Badge variant="accent" size="sm" radius="full">Default</Badge> : null}
                            <Badge variant={model.enabled ? "success" : "warning"} size="sm" radius="full">
                              {model.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </div>
                        </div>

                        <div className="settings-provider-chip-row">
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
