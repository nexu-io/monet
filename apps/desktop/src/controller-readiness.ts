export interface ControllerReadinessDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

export interface ControllerReadinessOptions extends ControllerReadinessDependencies {
  readonly attempts?: number;
  readonly attemptTimeoutMs?: number;
  readonly intervalMs?: number;
  readonly onReady?: (attempt: number, healthUrl: string) => void;
}

const defaultAttemptCount = 40;
const defaultAttemptTimeoutMs = 250;
const defaultIntervalMs = 250;

export async function waitForControllerReady(
  apiBase: string,
  bearerToken: string,
  options: ControllerReadinessOptions = {}
) {
  const healthUrl = `${apiBase}/api/health`;
  const attempts = options.attempts ?? defaultAttemptCount;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? defaultAttemptTimeoutMs;
  const intervalMs = options.intervalMs ?? defaultIntervalMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, healthUrl, {
        headers: {
          Authorization: `Bearer ${bearerToken}`
        }
      }, attemptTimeoutMs);

      if (response.ok) {
        options.onReady?.(attempt + 1, healthUrl);
        return;
      }
    } catch {
      // Ignore early boot failures while the controller binds its port.
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  throw new Error(`Timed out waiting for controller readiness at ${healthUrl}.`);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function defaultSleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
