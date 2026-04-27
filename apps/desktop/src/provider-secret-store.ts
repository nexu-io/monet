import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const providerTypes = ["openai", "openrouter"] as const;

export type ProviderType = (typeof providerTypes)[number];
export type ProviderSecretStoreReason =
  | "available"
  | "desktop_api_unavailable"
  | "linux_keyring_unavailable"
  | "encryption_unavailable";

export interface ProviderSecretStorageSnapshot {
  readonly available: boolean;
  readonly message: string;
  readonly platform: NodeJS.Platform | "browser";
  readonly providers: ReadonlyArray<{
    readonly providerType: ProviderType;
    readonly hasSecret: boolean;
  }>;
  readonly reason: ProviderSecretStoreReason;
}

interface PersistedProviderSecretsFile {
  readonly version: 1;
  readonly providers?: Partial<Record<ProviderType, string>>;
}

interface SafeStorageLike {
  decryptString(buffer: Buffer): string;
  encryptString(value: string): Buffer;
  isEncryptionAvailable(): boolean;
}

export interface ProviderSecretStore {
  clearSecret(providerType: ProviderType): void;
  getSnapshot(): ProviderSecretStorageSnapshot;
  loadSecretsForControllerEnv(): Partial<Record<ProviderType, string>>;
  saveSecret(providerType: ProviderType, secret: string): void;
}

export function createProviderSecretStore(options: {
  readonly platform: NodeJS.Platform;
  readonly safeStorage: SafeStorageLike;
  readonly secretsFilePath: string;
}): ProviderSecretStore {
  return {
    clearSecret(providerType) {
      assertPersistenceAvailable(options);

      const file = readSecretsFile(options.secretsFilePath);

      if (!file.providers?.[providerType]) {
        return;
      }

      const nextProviders = { ...(file.providers ?? {}) };
      delete nextProviders[providerType];

      writeSecretsFile(options.secretsFilePath, {
        version: 1,
        providers: nextProviders
      });
    },

    getSnapshot() {
      const availability = getAvailability(options);
      const file = readSecretsFile(options.secretsFilePath);

      return {
        available: availability.available,
        message: availability.message,
        platform: options.platform,
        providers: providerTypes.map((providerType) => ({
          providerType,
          hasSecret: Boolean(file.providers?.[providerType])
        })),
        reason: availability.reason
      };
    },

    loadSecretsForControllerEnv() {
      if (!options.safeStorage.isEncryptionAvailable()) {
        return {};
      }

      const file = readSecretsFile(options.secretsFilePath);
      const result: Partial<Record<ProviderType, string>> = {};

      for (const providerType of providerTypes) {
        const encodedValue = file.providers?.[providerType];

        if (!encodedValue) {
          continue;
        }

        result[providerType] = options.safeStorage.decryptString(Buffer.from(encodedValue, "base64"));
      }

      return result;
    },

    saveSecret(providerType, secret) {
      assertPersistenceAvailable(options);

      const normalizedSecret = secret.trim();

      if (!normalizedSecret) {
        throw new Error("Provider secret cannot be empty.");
      }

      const file = readSecretsFile(options.secretsFilePath);

      writeSecretsFile(options.secretsFilePath, {
        version: 1,
        providers: {
          ...(file.providers ?? {}),
          [providerType]: options.safeStorage.encryptString(normalizedSecret).toString("base64")
        }
      });
    }
  };
}

function getAvailability(options: { readonly platform: NodeJS.Platform; readonly safeStorage: SafeStorageLike }): {
  readonly available: boolean;
  readonly message: string;
  readonly reason: ProviderSecretStoreReason;
} {
  if (options.safeStorage.isEncryptionAvailable()) {
    return {
      available: true,
      message: "Provider secrets are encrypted with the desktop OS secure storage and injected into the managed controller at startup.",
      reason: "available"
    };
  }

  if (options.platform === "linux") {
    return {
      available: false,
      message:
        "This Linux session does not expose a system keyring for Electron safeStorage, so Monet disables saving provider secrets. Use environment variables or enable a Secret Service/KWallet backend.",
      reason: "linux_keyring_unavailable"
    };
  }

  return {
    available: false,
    message: "The desktop OS secure storage backend is unavailable, so Monet cannot persist provider secrets on this device.",
    reason: "encryption_unavailable"
  };
}

function assertPersistenceAvailable(options: { readonly platform: NodeJS.Platform; readonly safeStorage: SafeStorageLike }) {
  const availability = getAvailability(options);

  if (!availability.available) {
    throw new Error(availability.message);
  }
}

function readSecretsFile(filePath: string): PersistedProviderSecretsFile {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as PersistedProviderSecretsFile;

    if (parsed.version !== 1) {
      return { version: 1, providers: {} };
    }

    return {
      version: 1,
      providers: parsed.providers ?? {}
    };
  } catch {
    return {
      version: 1,
      providers: {}
    };
  }
}

function writeSecretsFile(filePath: string, file: PersistedProviderSecretsFile) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(file, null, 2), "utf8");
}
