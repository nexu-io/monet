import type { UIMessage } from "ai";

import { sanitizeUiMessage } from "./ui-message-sanitize";

const MAX_REPLAY_WINDOW_MESSAGES = 12;
const MAX_REPLAY_WINDOW_BYTES = 48 * 1024;
const MAX_REPLAY_TOOL_OUTPUT_BYTES = 4 * 1024;
const MAX_SUMMARY_TEXT_LENGTH = 4_000;
const MAX_SUMMARY_LINE_LENGTH = 280;
const ALWAYS_TRUNCATED_TOOL_NAMES = new Set(["fetch_url", "read_file"]);

interface MessagePartRecord extends Record<string, unknown> {
  readonly type?: unknown;
}

export interface ReplayContextStats {
  readonly originalMessageCount: number;
  readonly replayMessageCount: number;
  readonly summarizedMessageCount: number;
  readonly truncatedToolOutputCount: number;
  readonly removedReasoningPartCount: number;
}

export interface ReplayContextResult {
  readonly messages: UIMessage[];
  readonly stats: ReplayContextStats;
}

export interface ReplayContextOptions {
  readonly sessionWorkspacePath?: string;
}

export function buildReplayContext(messages: UIMessage[], options: ReplayContextOptions = {}): ReplayContextResult {
  if (messages.length === 0) {
    const workspaceContextMessages = createSessionWorkspaceContextMessages(options.sessionWorkspacePath);

    return {
      messages: workspaceContextMessages,
      stats: {
        originalMessageCount: 0,
        replayMessageCount: workspaceContextMessages.length,
        summarizedMessageCount: 0,
        truncatedToolOutputCount: 0,
        removedReasoningPartCount: 0
      }
    };
  }

  const leadingSystemCount = countLeadingSystemMessages(messages);
  const leadingSystemMessages = messages.slice(0, leadingSystemCount);
  const conversationMessages = messages.slice(leadingSystemCount);
  const workspaceContextMessages = createSessionWorkspaceContextMessages(options.sessionWorkspacePath);
  const recentStartIndex = selectRecentWindowStart(conversationMessages);
  const summarizedMessages = conversationMessages.slice(0, recentStartIndex);
  const recentMessages = conversationMessages.slice(recentStartIndex);
  const lastAssistantIndex = findLastAssistantIndex(recentMessages);
  let truncatedToolOutputCount = 0;
  let removedReasoningPartCount = 0;

  const replayMessages = [
    ...leadingSystemMessages,
    ...workspaceContextMessages,
    ...createSummaryMessage(summarizedMessages),
    ...recentMessages.map((message, index) => {
      const sanitized = sanitizeMessageForReplay({
        message,
        includeReasoning: index === lastAssistantIndex,
        onReasoningRemoved: () => {
          removedReasoningPartCount += 1;
        },
        onToolOutputTruncated: () => {
          truncatedToolOutputCount += 1;
        }
      });

      return sanitized;
    })
    .filter((message): message is UIMessage => message !== null)
  ] as UIMessage[];

  return {
    messages: replayMessages,
    stats: {
      originalMessageCount: messages.length,
      replayMessageCount: replayMessages.length,
      summarizedMessageCount: summarizedMessages.length,
      truncatedToolOutputCount,
      removedReasoningPartCount
    }
  };
}

function createSessionWorkspaceContextMessages(sessionWorkspacePath: string | undefined) {
  if (!sessionWorkspacePath) {
    return [];
  }

  return [
    {
      id: "msg_session_workspace_context",
      role: "system",
      parts: [
        {
          type: "text",
          text: [
            "Current session workspace:",
            sessionWorkspacePath,
            "",
            "File tool path behavior:",
            "- Relative paths for file tools resolve inside this session workspace, not the controller working directory, repository root, home directory, or an authorized external directory.",
            "- Use relative paths when creating or reading files for this session unless the user explicitly asks for an authorized external path.",
            "- Writes inside this session workspace do not require confirmation; writes to authorized external directories still require confirmation; paths outside both are denied."
          ].join("\n")
        }
      ]
    } satisfies UIMessage
  ];
}

function countLeadingSystemMessages(messages: UIMessage[]) {
  let count = 0;

  for (const message of messages) {
    if (message.role !== "system") {
      break;
    }

    count += 1;
  }

  return count;
}

function selectRecentWindowStart(messages: UIMessage[]) {
  if (messages.length <= MAX_REPLAY_WINDOW_MESSAGES) {
    return 0;
  }

  const lastUserIndex = findLastUserIndex(messages);
  let accumulatedBytes = 0;
  let selectedCount = 0;
  let startIndex = messages.length;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!message) {
      continue;
    }

    const estimatedBytes = estimateMessageBytes(message);
    const nextCount = selectedCount + 1;
    const nextBytes = accumulatedBytes + estimatedBytes;
    const shouldKeep = selectedCount === 0 || (nextCount <= MAX_REPLAY_WINDOW_MESSAGES && nextBytes <= MAX_REPLAY_WINDOW_BYTES);

    if (!shouldKeep) {
      break;
    }

    startIndex = index;
    selectedCount = nextCount;
    accumulatedBytes = nextBytes;
  }

  if (lastUserIndex !== -1) {
    startIndex = Math.min(startIndex, lastUserIndex);
  }

  return Math.max(0, Math.min(startIndex, messages.length));
}

function findLastUserIndex(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function findLastAssistantIndex(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return index;
    }
  }

  return -1;
}

function estimateMessageBytes(message: UIMessage) {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function createSummaryMessage(messages: UIMessage[]) {
  if (messages.length === 0) {
    return [];
  }

  const lines = messages
    .map(summarizeMessage)
    .filter((line): line is string => typeof line === "string" && line.length > 0);

  const summaryBody = buildSummaryText(lines, messages.length);

  if (!summaryBody) {
    return [];
  }

  return [
    {
      id: "msg_context_summary",
      role: "system",
      parts: [
        {
          type: "text",
          text: summaryBody
        }
      ]
    } satisfies UIMessage
  ];
}

function buildSummaryText(lines: string[], summarizedMessageCount: number) {
  const prefix = `Conversation summary for ${summarizedMessageCount} earlier message${summarizedMessageCount === 1 ? "" : "s"}:\n`;

  if (lines.length === 0) {
    return `${prefix}- Earlier messages contained no replayable text, only intermediate tool/reasoning state.`;
  }

  let body = "";

  for (const line of lines) {
    const nextLine = `- ${line}\n`;

    if ((prefix.length + body.length + nextLine.length) > MAX_SUMMARY_TEXT_LENGTH) {
      body += `- Additional earlier context omitted after summarization.\n`;
      break;
    }

    body += nextLine;
  }

  return `${prefix}${body.trimEnd()}`;
}

function summarizeMessage(message: UIMessage) {
  const segments: string[] = [];

  for (const rawPart of message.parts ?? []) {
    const part = rawPart as unknown;

    if (!isRecord(part)) {
      continue;
    }

    const type = typeof part.type === "string" ? part.type : "unknown";

    if (type === "text" && typeof part.text === "string") {
      const text = compactWhitespace(part.text);

      if (text) {
        segments.push(text);
      }

      continue;
    }

    if (type === "reasoning") {
      continue;
    }

    if (isToolPart(part)) {
      segments.push(summarizeToolPart(part));
    }
  }

  const roleLabel = message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System";
  const content = compactWhitespace(segments.join(" ")) || `${message.role} message without text content`;

  return `${roleLabel}: ${truncateText(content, MAX_SUMMARY_LINE_LENGTH)}`;
}

function summarizeToolPart(part: MessagePartRecord) {
  const toolName = typeof part.toolName === "string" ? part.toolName : "tool";
  const state = typeof part.state === "string" ? part.state : "unknown";
  const base = `${toolName} (${state})`;

  if (!("output" in part)) {
    return `Tool ${base}`;
  }

  return `Tool ${base}: ${summarizeUnknownValue((part as { output?: unknown }).output)}`;
}

function sanitizeMessageForReplay(options: {
  readonly message: UIMessage;
  readonly includeReasoning: boolean;
  readonly onReasoningRemoved: () => void;
  readonly onToolOutputTruncated: () => void;
}) {
  const message = sanitizeUiMessage(options.message);

  if (!message) {
    return null;
  }

  const sanitizedParts: unknown[] = [];

  for (const rawPart of message.parts ?? []) {
    const part = rawPart as unknown;

    if (!isRecord(part)) {
      sanitizedParts.push(rawPart);
      continue;
    }

    const type = typeof part.type === "string" ? part.type : "unknown";

    if (type === "reasoning" && !options.includeReasoning) {
      options.onReasoningRemoved();
      continue;
    }

    if (isToolPart(part) && "output" in part) {
      const maybeTruncatedOutput = truncateToolOutputForReplay(part);

      if (maybeTruncatedOutput !== (part as { output?: unknown }).output) {
        options.onToolOutputTruncated();
        sanitizedParts.push({ ...part, output: maybeTruncatedOutput });
        continue;
      }
    }

    sanitizedParts.push(rawPart);
  }

  return {
    ...message,
    parts: sanitizedParts as UIMessage["parts"]
  } as UIMessage;
}

function truncateToolOutputForReplay(part: MessagePartRecord) {
  const toolName = typeof part.toolName === "string" ? part.toolName : "tool";
  const output = (part as { output?: unknown }).output;
  const serializedOutput = JSON.stringify(output ?? null);
  const outputSizeBytes = Buffer.byteLength(serializedOutput, "utf8");
  const shouldTruncate = ALWAYS_TRUNCATED_TOOL_NAMES.has(toolName) || outputSizeBytes > MAX_REPLAY_TOOL_OUTPUT_BYTES;

  if (!shouldTruncate) {
    return output;
  }

  return {
    truncated: true,
    toolName,
    outputSizeBytes,
    preview: truncateText(summarizeUnknownValue(output), 600)
  };
}

function summarizeUnknownValue(value: unknown) {
  if (typeof value === "string") {
    return truncateText(compactWhitespace(value), MAX_SUMMARY_LINE_LENGTH);
  }

  return truncateText(compactWhitespace(JSON.stringify(value ?? null)), MAX_SUMMARY_LINE_LENGTH);
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function compactWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isToolPart(part: MessagePartRecord) {
  const type = typeof part.type === "string" ? part.type : "";

  return (type === "dynamic-tool" || type.startsWith("tool-")) && typeof part.toolName === "string" && typeof part.state === "string";
}

function isRecord(value: unknown): value is MessagePartRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
