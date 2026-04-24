"use client";

import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { Badge, Button, Card } from "@nexu-design/ui-web";

type ChatMessage = UIMessage;
const WRITE_FILE_PREVIEW_MAX_LINES = 24;
const WRITE_FILE_PREVIEW_MAX_CHARS = 1_200;

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
    case "input-available":
    case "input-streaming":
      return "Preparing";
    case "approval-requested":
      return "Awaiting confirm";
    case "output-available":
      return "Completed";
    case "running":
      return "Running";
    case "output-error":
    case "error":
      return "Failed";
    default:
      return state;
  }
}

function getToolStateMeta(state: string) {
  switch (state) {
    case "input-streaming":
    case "input-available":
      return { label: "Preparing", badgeVariant: "warning" as const, phase: "preparing" as const };
    case "approval-requested":
      return { label: "Awaiting confirm", badgeVariant: "accent" as const, phase: "awaiting-confirm" as const };
    case "running":
      return { label: "Running", badgeVariant: "secondary" as const, phase: "running" as const };
    case "output-available":
      return { label: "Completed", badgeVariant: "success" as const, phase: "completed" as const };
    case "output-error":
    case "error":
      return { label: "Failed", badgeVariant: "destructive" as const, phase: "failed" as const };
    default:
      return { label: formatToolState(state), badgeVariant: "secondary" as const, phase: "unknown" as const };
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

function isWriteFileInput(value: unknown): value is { readonly path: string; readonly content: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return typeof (value as { path?: unknown }).path === "string" && typeof (value as { content?: unknown }).content === "string";
}

function getWriteFilePreview(content: string) {
  const lines = content.split("\n");
  const limitedLines = lines.slice(0, WRITE_FILE_PREVIEW_MAX_LINES).join("\n");
  const limitedContent = limitedLines.length > WRITE_FILE_PREVIEW_MAX_CHARS
    ? `${limitedLines.slice(0, WRITE_FILE_PREVIEW_MAX_CHARS)}…`
    : limitedLines;
  const wasLineTruncated = lines.length > WRITE_FILE_PREVIEW_MAX_LINES;
  const wasCharTruncated = limitedLines.length > WRITE_FILE_PREVIEW_MAX_CHARS || content.length > WRITE_FILE_PREVIEW_MAX_CHARS;

  return {
    content: limitedContent,
    wasTruncated: wasLineTruncated || wasCharTruncated,
    lineCount: lines.length,
    charCount: content.length
  };
}

function renderPart(
  message: ChatMessage,
  part: ChatMessagePart,
  index: number,
  options: {
    readonly status: "submitted" | "streaming" | "ready" | "error";
    readonly isArchived: boolean;
    readonly pendingToolApprovalIds: ReadonlySet<string>;
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
      <p key={`${part.type}-${index}`} className="m-0 whitespace-pre-wrap leading-[1.6] text-text-primary">
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
    const toolStateMeta = getToolStateMeta(part.state);
    const canApprove =
      part.state === "approval-requested" &&
      typeof part.toolCallId === "string" &&
      typeof part.approval?.id === "string" &&
      typeof runId === "string" &&
      typeof options.onToolApproval === "function";
    const isPendingApproval = typeof part.toolCallId === "string" && options.pendingToolApprovalIds.has(part.toolCallId);
    const isWriteFileCall = part.toolName === "write_file" && isWriteFileInput(part.input);
    const writeFilePreview = isWriteFileCall ? getWriteFilePreview(part.input.content) : null;

    return (
      <div key={`${part.type}-${index}`} className="tool-card" data-tool-phase={toolStateMeta.phase}>
        <div className="tool-card-header">
          <div className="flex flex-col gap-1">
            <span className="attachment-label">Tool call</span>
            <strong>{part.toolName}</strong>
          </div>
          <Badge variant={toolStateMeta.badgeVariant} size="sm" radius="full">{toolStateMeta.label}</Badge>
        </div>

        {isWriteFileCall ? (
          <>
            <div className="tool-card-section">
              <span className="attachment-label">Target path</span>
              <div className="tool-card-path mono">{part.input.path}</div>
            </div>

            <div className="tool-card-section">
              <span className="attachment-label">Content preview</span>
              <pre>{writeFilePreview?.content}</pre>
              {writeFilePreview?.wasTruncated ? (
                <p className="m-0 leading-[1.5] text-text-muted">
                  Showing the first {Math.min(writeFilePreview.lineCount, WRITE_FILE_PREVIEW_MAX_LINES)} lines and up to {WRITE_FILE_PREVIEW_MAX_CHARS} characters.
                </p>
              ) : (
                <p className="m-0 leading-[1.5] text-text-muted">{writeFilePreview?.lineCount ?? 0} lines · {writeFilePreview?.charCount ?? 0} characters</p>
              )}
            </div>
          </>
        ) : null}

        {part.input !== undefined && !isWriteFileCall ? (
          <div className="tool-card-section">
            <span className="attachment-label">Input</span>
            <pre>{formatPartPayload(part.input)}</pre>
          </div>
        ) : null}

        {part.state === "approval-requested" && isWriteFileCall ? (
          <div className="tool-card-section">
            <span className="attachment-label">Risk</span>
            <p className="m-0 leading-[1.5] text-text-muted">This tool can create or overwrite the target file. Approve only if the destination path and previewed content are expected.</p>
          </div>
        ) : null}

        {part.state === "approval-requested" && canApprove ? (
          <div className="tool-card-section">
            <span className="attachment-label">Confirmation</span>
            <p className="m-0 leading-[1.5] text-text-muted">
              {isWriteFileCall
                ? "This action can create or overwrite a file inside an authorized directory. Review the path and content preview before continuing."
                : "Review the tool input, then approve or reject execution."}
            </p>
            <div className="mt-3 flex justify-start gap-2">
              <Button
                type="button"
                variant="primary"
                disabled={isPendingApproval || options.isArchived || options.status === "submitted" || options.status === "streaming"}
                onClick={() => {
                  void options.onToolApproval?.({
                    runId,
                    toolCallId: part.toolCallId!,
                    confirmationToken: part.approval!.id,
                    decision: "approved"
                  });
                }}
              >
                {isPendingApproval ? "Submitting..." : "Approve"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isPendingApproval || options.isArchived || options.status === "submitted" || options.status === "streaming"}
                onClick={() => {
                  void options.onToolApproval?.({
                    runId,
                    toolCallId: part.toolCallId!,
                    confirmationToken: part.approval!.id,
                    decision: "rejected"
                  });
                }}
              >
                {isPendingApproval ? "Submitting..." : "Reject"}
              </Button>
            </div>
            {isPendingApproval ? <p className="m-0 leading-[1.5] text-text-muted">Confirmation submitted. Waiting for the run to continue…</p> : null}
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
  const [pendingToolApprovalIds, setPendingToolApprovalIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const activeApprovalIds = new Set(
      messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          isToolPart(part) && part.state === "approval-requested" && typeof part.toolCallId === "string" ? [part.toolCallId] : []
        )
      )
    );

    setPendingToolApprovalIds((current) => {
      const next = new Set(Array.from(current).filter((toolCallId) => activeApprovalIds.has(toolCallId)));

      if (next.size === current.size && Array.from(next).every((toolCallId) => current.has(toolCallId))) {
        return current;
      }

      return next;
    });
  }, [messages]);

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

  async function handleToolApproval(input: {
    runId: string;
    toolCallId: string;
    confirmationToken: string;
    decision: "approved" | "rejected";
  }) {
    if (!onToolApproval) {
      return;
    }

    setPendingToolApprovalIds((current) => new Set(current).add(input.toolCallId));

    try {
      await onToolApproval(input);
    } catch {
      setPendingToolApprovalIds((current) => {
        const next = new Set(current);
        next.delete(input.toolCallId);
        return next;
      });
    }
  }

  return (
    <section ref={rootRef} className="relative flex flex-col gap-4" aria-label="Conversation transcript">
      {messages.length === 0 ? (
        <Card className="chat-empty-state">
          <div className="flex flex-col gap-1">
            <span className="attachment-label">Ready for first prompt</span>
            <strong>Send a message to verify the local chat stream.</strong>
            <p className="m-0 leading-[1.5] text-text-muted">The chat surface is live — your next message will be answered by the configured model.</p>
          </div>
        </Card>
      ) : null}

      {messages.map((message, messageIndex) => {
        const isStreamingAssistant = status === "streaming" && message.role === "assistant" && messageIndex === messages.length - 1;

        return (
          <article key={message.id} className="flex flex-col gap-2 data-[role=user]:items-end" data-role={message.role}>
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <Badge variant={message.role === "assistant" ? "secondary" : "accent"} size="sm" radius="full">
                {getRoleLabel(message.role)}
              </Badge>
              {isStreamingAssistant ? <Badge variant="secondary" size="sm" radius="full">Streaming</Badge> : null}
            </div>

            <Card className={`w-[min(100%,calc(var(--spacing)*180))] rounded-xl border border-border-subtle px-4.5 py-4 shadow-xs max-[960px]:w-full ${message.role === "user" ? "border-[hsl(var(--accent)/0.2)] bg-[hsl(var(--accent)/0.08)]" : "bg-surface-1"}`}>
              <div className="flex flex-col gap-3">
                {message.parts.map((part, index) =>
                  renderPart(message, part, index, {
                    status,
                    isArchived,
                    pendingToolApprovalIds,
                    onToolApproval: handleToolApproval
                  })
                )}
              </div>
            </Card>
          </article>
        );
      })}

      {errorText ? (
        <Card className="chat-error-card">
          <div className="flex flex-col gap-1">
            <span className="attachment-label">Request error</span>
            <strong>Chat transport returned an error.</strong>
            <p className="m-0 leading-[1.5] text-text-muted">{errorText}</p>
          </div>
        </Card>
      ) : null}

      {showScrollToBottom && messages.length > 0 ? (
        <div className="pointer-events-none sticky bottom-2 flex justify-center">
          <Button type="button" variant="secondary" className="pointer-events-auto shadow-dropdown" onClick={scrollToBottom}>Back to bottom</Button>
        </div>
      ) : null}
    </section>
  );
}
