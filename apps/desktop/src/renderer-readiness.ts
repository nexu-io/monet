export interface RendererReadinessDependencies {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

export interface RendererReadinessOptions extends RendererReadinessDependencies {
  readonly attempts?: number;
  readonly attemptTimeoutMs?: number;
  readonly intervalMs?: number;
  readonly onReady?: (attempt: number, rendererUrl: string) => void;
}

const defaultAttemptCount = 60;
const defaultAttemptTimeoutMs = 250;
const defaultIntervalMs = 500;

export async function waitForRendererReady(rendererUrl: string, options: RendererReadinessOptions = {}) {
  const attempts = options.attempts ?? defaultAttemptCount;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? defaultAttemptTimeoutMs;
  const intervalMs = options.intervalMs ?? defaultIntervalMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, rendererUrl, attemptTimeoutMs);

      if (response.ok) {
        options.onReady?.(attempt + 1, rendererUrl);
        return;
      }
    } catch {
      // Ignore early boot failures while the renderer dev server starts.
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  throw new Error(`Timed out waiting for renderer readiness at ${rendererUrl}.`);
}

async function fetchWithTimeout(fetchImpl: typeof fetch, input: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(input, {
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
