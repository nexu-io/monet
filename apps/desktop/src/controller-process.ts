import path from "node:path";

export interface ManagedControllerEnvOptions {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly providerSecretEnv: NodeJS.ProcessEnv;
  readonly host: string;
  readonly port: string;
  readonly bearerToken: string;
  readonly userDataPath: string;
  readonly databasePath: string;
  readonly migrationsDirectory: string;
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

type ExitAwareChildProcess = Pick<NodeJS.EventEmitter, "once" | "removeListener">;

export function clearRuntimeChildOnExit<TRuntime extends { readonly child?: TChild }, TChild>(
  runtime: TRuntime | null,
  child: TChild
) {
  if (!runtime || runtime.child !== child) {
    return runtime;
  }

  const nextRuntime = { ...runtime } as TRuntime & { child?: TChild };
  delete nextRuntime.child;
  return nextRuntime as TRuntime;
}

export function buildManagedControllerEnv(options: ManagedControllerEnvOptions): NodeJS.ProcessEnv {
  return {
    ...options.baseEnv,
    ...options.providerSecretEnv,
    MONET_CONTROLLER_HOST: options.host,
    MONET_CONTROLLER_PORT: options.port,
    MONET_CONTROLLER_BEARER_TOKEN: options.bearerToken,
    MONET_USER_DATA_DIR: options.userDataPath,
    MONET_SESSION_WORKSPACE_DIR: path.join(options.userDataPath, "session-workspaces"),
    MONET_DATABASE_PATH: options.databasePath,
    MONET_MIGRATIONS_DIR: options.migrationsDirectory
  };
}

export function sendUtilityProcessSignal(
  pid: number,
  signal: NodeJS.Signals,
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill
) {
  try {
    kill(pid, signal);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ESRCH")) {
      return false;
    }

    throw error;
  }
}

export function waitForUtilityProcessExit(child: ExitAwareChildProcess, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const handleExit = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.removeListener("exit", handleExit);
      resolve(false);
    }, timeoutMs);

    child.once("exit", handleExit);
  });
}
