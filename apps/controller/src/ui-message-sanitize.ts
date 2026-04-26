import type { UIMessage } from "ai";

interface MessagePartRecord extends Record<string, unknown> {
  readonly type?: unknown;
}

export function sanitizeUiMessages(messages: readonly UIMessage[]) {
  return messages
    .map(sanitizeUiMessage)
    .filter((message): message is UIMessage => message !== null);
}

export function sanitizeUiMessage(message: UIMessage): UIMessage | null {
  const parts = (message.parts ?? []).filter((part) => !isInternalStepStartPart(part)) as UIMessage["parts"];

  if (message.role === "assistant" && parts.length === 0) {
    return null;
  }

  if (parts.length === (message.parts ?? []).length) {
    return message;
  }

  return {
    ...message,
    parts
  } as UIMessage;
}

function isInternalStepStartPart(part: unknown) {
  if (!isRecord(part)) {
    return false;
  }

  if (part.type === "step-start") {
    return true;
  }

  return part.type === "unknown" && part.reason === "unsupported-part" && part.originalType === "step-start";
}

function isRecord(value: unknown): value is MessagePartRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
