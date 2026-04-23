"use client";

import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { Badge, Button, Card } from "@nexu-design/ui-web";

type ChatMessage = UIMessage;

type TextPart = { readonly type: "text"; readonly text: string };
type ReasoningPart = { readonly type: "reasoning"; readonly text: string; readonly label?: string };
type StepStartPart = { readonly type: "step-start"; readonly title?: string };
type FilePart = { readonly type: "file"; readonly filename?: string; readonly mediaType?: string; readonly url?: string };
type SourceUrlPart = { readonly type: "source-url"; readonly title?: string; readonly url: string; readonly host?: string };
type SourceDocumentPart = { readonly type: "source-document"; readonly title?: string; readonly snippet?: string };
type ToolPart = {
  readonly type: `tool-${string}` | "dynamic-tool";
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "running"
    | "output-available"
    | "output-error"
    | "error";
  readonly input?: unknown;
  readonly output?: unknown;
  readonly errorText?: string;
  readonly approval?: {
    readonly id: string;
  };
};
type UnknownPart = { readonly type: string; readonly [key: string]: unknown };

type ChatMessagePart = TextPart | ReasoningPart | StepStartPart | FilePart | SourceUrlPart | SourceDocumentPart | ToolPart | UnknownPart;

function formatToolState(state: string) {
  switch (state) {
    case "approval-requested":
      return "Needs approval";
    case "input-available":
      return "Input available";
    case "input-streaming":
      return "Preparing";
    case "output-available":
      return "Completed";
    case "running":
      return "Running";
    case "output-error":
    case "error":
      return "Error";
    default:
      return state;
  }
}

function formatPartPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function getRoleLabel(role: ChatMessage["role"]) {
  switch (role) {
    case "assistant":
      return "Assistant";
    case "system":
      return "System";
    default:
      return "You";
  }
}

function isTextPart(part: ChatMessagePart): part is TextPart {
  return part.type === "text" && typeof part.text === "string";
}

function isReasoningPart(part: ChatMessagePart): part is ReasoningPart {
  return part.type === "reasoning" && typeof part.text === "string";
}

function isStepStartPart(part: ChatMessagePart): part is StepStartPart {
  return part.type === "step-start";
}

function isFilePart(part: ChatMessagePart): part is FilePart {
  return part.type === "file";
}

function isSourceUrlPart(part: ChatMessagePart): part is SourceUrlPart {
  return part.type === "source-url" && typeof part.url === "string";
}

function isSourceDocumentPart(part: ChatMessagePart): part is SourceDocumentPart {
  return part.type === "source-document";
}

function isToolPart(part: ChatMessagePart): part is ToolPart {
  const candidate = part as Partial<ToolPart>;

  return (part.type === "dynamic-tool" || part.type.startsWith("tool-")) && typeof candidate.toolName === "string" && typeof candidate.state === "string";
}

function getMessageRunId(message: ChatMessage) {
  const metadata = message.metadata;

  if (typeof metadata !== "object" || metadata === null || !("runId" in metadata)) {
    return null;
  }

  return typeof (metadata as { runId?: unknown }).runId === "string" ? (metadata as { runId: string }).runId : null;
}

function renderPart(
  message: ChatMessage,
  part: ChatMessagePart,
  index: number,
  options: {
    readonly status: "submitted" | "streaming" | "ready" | "error";
    readonly isArchived: boolean;
    readonly onToolApproval?: (input: {
      runId: string;
      toolCallId: string;
      confirmationToken: string;
      decision: "approved" | "rejected";
    }) => void | Promise<void>;
  }
) {
  if (isTextPart(part)) {
    return (
      <p key={`${part.type}-${index}`} className="message-text">
        {part.text}
      </p>
    );
  }

  if (isReasoningPart(part)) {
    return (
      <details key={`${part.type}-${index}`} className="reasoning-block">
        <summary>{part.label ?? "Reasoning"}</summary>
        <p>{part.text}</p>
      </details>
    );
  }

  if (isStepStartPart(part)) {
    return (
      <div key={`${part.type}-${index}`} className="step-start">
        <span />
        <strong>{part.title ?? "Step"}</strong>
      </div>
    );
  }

  if (isFilePart(part)) {
    return (
      <div key={`${part.type}-${index}`} className="attachment-card">
        <span className="attachment-label">File</span>
        <strong>{part.filename ?? "Attachment"}</strong>
        <span>{part.mediaType ?? "Unknown type"}</span>
        {part.url ? <span className="mono">{part.url}</span> : null}
      </div>
    );
  }

  if (isSourceUrlPart(part)) {
    return (
      <a key={`${part.type}-${index}`} className="source-card" href={part.url}>
        <span className="attachment-label">Source URL</span>
        <strong>{part.title ?? part.url}</strong>
        <span>{part.host ?? part.url}</span>
      </a>
    );
  }

  if (isSourceDocumentPart(part)) {
    return (
      <div key={`${part.type}-${index}`} className="source-card">
        <span className="attachment-label">Source document</span>
        <strong>{part.title ?? "Document"}</strong>
        {part.snippet ? <span>{part.snippet}</span> : null}
      </div>
    );
  }

  if (isToolPart(part)) {
    const runId = getMessageRunId(message);
    const canApprove =
      part.state === "approval-requested" &&
      typeof part.toolCallId === "string" &&
      typeof part.approval?.id === "string" &&
      typeof runId === "string" &&
      typeof options.onToolApproval === "function";
    const toolStateBadgeVariant = part.state === "approval-requested" ? "accent" : "secondary";

    return (
      <div key={`${part.type}-${index}`} className="tool-card">
        <div className="tool-card-header">
          <div className="stack-tight">
            <span className="attachment-label">Tool call</span>
            <strong>{part.toolName}</strong>
          </div>
          <Badge variant={toolStateBadgeVariant} size="sm" radius="full">{formatToolState(part.state)}</Badge>
        </div>

        {part.input !== undefined ? (
          <div className="tool-card-section">
            <span className="attachment-label">Input</span>
            <pre>{formatPartPayload(part.input)}</pre>
          </div>
        ) : null}

        {part.state === "approval-requested" && canApprove ? (
          <div className="tool-card-section">
            <span className="attachment-label">Confirmation</span>
            <p className="muted">Review the tool input, then approve or deny execution.</p>
            <div className="chat-thread-jump" style={{ justifyContent: "flex-start", marginTop: 12 }}>
              <Button
                type="button"
                variant="primary"
                disabled={options.isArchived || options.status === "submitted" || options.status === "streaming"}
                onClick={() => {
                  void options.onToolApproval?.({
                    runId,
                    toolCallId: part.toolCallId!,
                    confirmationToken: part.approval!.id,
                    decision: "approved"
                  });
                }}
              >
                Approve
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={options.isArchived || options.status === "submitted" || options.status === "streaming"}
                onClick={() => {
                  void options.onToolApproval?.({
                    runId,
                    toolCallId: part.toolCallId!,
                    confirmationToken: part.approval!.id,
                    decision: "rejected"
                  });
                }}
              >
                Deny
              </Button>
            </div>
          </div>
        ) : null}

        {part.output !== undefined ? (
          <div className="tool-card-section">
            <span className="attachment-label">Output</span>
            <pre>{formatPartPayload(part.output)}</pre>
          </div>
        ) : null}

        {part.errorText ? (
          <div className="tool-card-section">
            <span className="attachment-label">Error</span>
            <pre>{part.errorText}</pre>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div key={`${part.type}-${index}`} className="unknown-part-card">
      <span className="attachment-label">Unsupported part</span>
      <strong>{part.type}</strong>
      <pre>{JSON.stringify(part, null, 2)}</pre>
    </div>
  );
}

export interface ChatThreadProps {
  readonly messages: readonly ChatMessage[];
  readonly status: "submitted" | "streaming" | "ready" | "error";
  readonly errorText: string | undefined;
  readonly isArchived: boolean;
  readonly onToolApproval?: (input: {
    runId: string;
    toolCallId: string;
    confirmationToken: string;
    decision: "approved" | "rejected";
  }) => void | Promise<void>;
}

export function ChatThread({ messages, status, errorText, isArchived, onToolApproval }: ChatThreadProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  useEffect(() => {
    const scrollContainer = rootRef.current?.closest(".canvas-body");

    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    const updateScrollState = () => {
      const distanceToBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      const isAtBottom = distanceToBottom <= 96;

      shouldStickToBottomRef.current = isAtBottom;
      setShowScrollToBottom(!isAtBottom);
    };

    updateScrollState();
    scrollContainer.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      scrollContainer.removeEventListener("scroll", updateScrollState);
    };
  }, []);

  useEffect(() => {
    const scrollContainer = rootRef.current?.closest(".canvas-body");

    if (!(scrollContainer instanceof HTMLElement) || !shouldStickToBottomRef.current) {
      return;
    }

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: status === "streaming" ? "auto" : "smooth"
    });
  }, [messages, status]);

  function scrollToBottom() {
    const scrollContainer = rootRef.current?.closest(".canvas-body");

    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: "smooth" });
  }

  return (
    <section ref={rootRef} className="chat-thread" aria-label="Conversation transcript">
      {messages.length === 0 ? (
        <Card className="chat-empty-state">
          <div className="stack-tight">
            <span className="attachment-label">Ready for first prompt</span>
            <strong>Send a message to verify the local chat stream.</strong>
            <p className="muted">The web UI is now using `useChat`, and the next response should arrive from the controller instead of local sample data.</p>
          </div>
        </Card>
      ) : null}

      {messages.map((message, messageIndex) => {
        const isStreamingAssistant = status === "streaming" && message.role === "assistant" && messageIndex === messages.length - 1;

        return (
          <article key={message.id} className="chat-message" data-role={message.role}>
            <div className="chat-message-meta">
              <Badge variant={message.role === "assistant" ? "secondary" : "accent"} size="sm" radius="full">
                {getRoleLabel(message.role)}
              </Badge>
              {isStreamingAssistant ? <Badge variant="secondary" size="sm" radius="full">Streaming</Badge> : null}
            </div>

            <Card className="chat-message-card">
              <div className="chat-message-parts">
                {message.parts.map((part, index) =>
                  renderPart(message, part, index, {
                    status,
                    isArchived,
                    onToolApproval
                  })
                )}
              </div>
            </Card>
          </article>
        );
      })}

      {errorText ? (
        <Card className="chat-error-card">
          <div className="stack-tight">
            <span className="attachment-label">Request error</span>
            <strong>Chat transport returned an error.</strong>
            <p className="muted">{errorText}</p>
          </div>
        </Card>
      ) : null}

      {showScrollToBottom && messages.length > 0 ? (
        <div className="chat-thread-jump">
          <Button type="button" variant="secondary" onClick={scrollToBottom}>Back to bottom</Button>
        </div>
      ) : null}
    </section>
  );
}
