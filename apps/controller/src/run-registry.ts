import type { RunFinishReason } from "./agent-runtime";

export interface ActiveRunHandle {
  readonly abort: (reason: RunFinishReason) => void;
}

export interface RunRegistry {
  register(runId: string, handle: ActiveRunHandle): () => void;
  stop(runId: string): boolean;
}

export function createRunRegistry(): RunRegistry {
  const activeRuns = new Map<string, ActiveRunHandle>();

  return {
    register(runId, handle) {
      activeRuns.set(runId, handle);

      return () => {
        if (activeRuns.get(runId) === handle) {
          activeRuns.delete(runId);
        }
      };
    },

    stop(runId) {
      const handle = activeRuns.get(runId);

      if (!handle) {
        return false;
      }

      handle.abort("stop_requested");
      return true;
    }
  };
}
