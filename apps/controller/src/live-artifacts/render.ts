import { z } from "@hono/zod-openapi";

import {
  LIVE_ARTIFACT_LIMITS,
  LiveArtifactRenderJsonSchema,
  type LiveArtifactRenderJson
} from "./schema";

export type LiveArtifactRenderSanitizationSuccess = {
  ok: true;
  renderJson: LiveArtifactRenderJson;
  preservedPrevious: false;
};

export type LiveArtifactRenderSanitizationFailure = {
  ok: false;
  renderJson: LiveArtifactRenderJson | null;
  preservedPrevious: boolean;
  error: string;
};

export type LiveArtifactRenderSanitizationResult =
  | LiveArtifactRenderSanitizationSuccess
  | LiveArtifactRenderSanitizationFailure;

export function sanitizeLiveArtifactRenderJson(value: unknown): LiveArtifactRenderJson {
  return LiveArtifactRenderJsonSchema.parse(value);
}

export function sanitizeLiveArtifactRefreshRenderJson(
  value: unknown,
  previousRenderJson: LiveArtifactRenderJson | null | undefined
): LiveArtifactRenderSanitizationResult {
  const parsed = LiveArtifactRenderJsonSchema.safeParse(value);
  if (parsed.success) {
    return {
      ok: true,
      renderJson: parsed.data,
      preservedPrevious: false
    };
  }

  const previous = previousRenderJson ? LiveArtifactRenderJsonSchema.safeParse(previousRenderJson) : null;

  return {
    ok: false,
    renderJson: previous?.success ? previous.data : null,
    preservedPrevious: Boolean(previous?.success),
    error: summarizeRenderJsonError(parsed.error)
  };
}

export function assertLiveArtifactRenderJsonSafe(value: unknown): asserts value is LiveArtifactRenderJson {
  LiveArtifactRenderJsonSchema.parse(value);
}

export function summarizeRenderJsonError(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) {
    return "Invalid render JSON";
  }

  const path = firstIssue.path.length > 0 ? `${firstIssue.path.join(".")}: ` : "";
  const message = `${path}${firstIssue.message}`;
  return message.length > LIVE_ARTIFACT_LIMITS.error
    ? `${message.slice(0, LIVE_ARTIFACT_LIMITS.error - 1)}…`
    : message;
}
