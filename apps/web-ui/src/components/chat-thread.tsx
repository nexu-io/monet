"use client";

import { Badge, Card } from "@nexu-design/ui-web";

type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly status?: "streaming" | "done";
  readonly parts: readonly ChatMessagePart[];
};

type TextPart = { readonly type: "text"; readonly text: string };
type ReasoningPart = { readonly type: "reasoning"; readonly text: string; readonly label?: string };
type StepStartPart = { readonly type: "step-start"; readonly title: string };
type FilePart = { readonly type: "file"; readonly filename: string; readonly mediaType?: string; readonly url?: string };
type SourceUrlPart = { readonly type: "source-url"; readonly title: string; readonly url: string; readonly host?: string };
type SourceDocumentPart = { readonly type: "source-document"; readonly title: string; readonly snippet?: string };
type ToolPart = {
  readonly type: `tool-${string}` | "dynamic-tool";
  readonly toolName: string;
  readonly state: "input-available" | "running" | "output-available" | "error";
  readonly input?: string;
  readonly output?: string;
  readonly errorText?: string;
};
type UnknownPart = { readonly type: string; readonly [key: string]: unknown };

type ChatMessagePart = TextPart | ReasoningPart | StepStartPart | FilePart | SourceUrlPart | SourceDocumentPart | ToolPart | UnknownPart;

const sampleMessages: readonly ChatMessage[] = [
  {
    id: "msg-user-install-upgrade",
    role: "user",
    status: "done",
    parts: [
      {
        type: "text",
        text: "Implement the install and upgrade strategy spec, then show the chat canvas using AI SDK UI parts instead of placeholder cards."
      }
    ]
  },
  {
    id: "msg-assistant-install-upgrade",
    role: "assistant",
    status: "streaming",
    parts: [
      {
        type: "step-start",
        title: "Inspect current shell and map the missing chat states"
      },
      {
        type: "reasoning",
        label: "Renderer plan",
        text: "The shell already separates sidebar, header, body, and composer. The missing piece is a renderer that respects UIMessage.parts, keeps reasoning hidden by default, and degrades unknown parts without dropping them."
      },
      {
        type: "text",
        text: "I swapped the placeholder hero with a conversation thread that renders each message part individually, so the next iteration can plug `useChat` into the same surface with minimal churn."
      },
      {
        type: "tool-read_file",
        toolName: "read_file",
        state: "output-available",
        input: "apps/web-ui/src/app/page.tsx\napps/web-ui/src/components/app-shell.tsx",
        output: "Confirmed the app shell already provides a dedicated scroll region and pinned composer rail."
      },
      {
        type: "dynamic-tool",
        toolName: "fetch_spec_context",
        state: "running",
        input: "specs/2026-04-23-initial-plan/spec.md#11.1"
      },
      {
        type: "source-url",
        title: "Chat UI rendering requirements",
        url: "file:///Users/mrc/Projects/monet/specs/2026-04-23-initial-plan/spec.md",
        host: "local spec"
      },
      {
        type: "source-document",
        title: "Implementation gap checklist",
        snippet: "Chat UI needs parts[] rendering, reasoning collapse, stop/regenerate, and scroll affordances in later iterations."
      },
      {
        type: "file",
        filename: "apps/web-ui/src/components/chat-thread.tsx",
        mediaType: "text/tsx"
      },
      {
        type: "tool-unknown-state",
        rawState: "buffering",
        detail: "This intentionally exercises the fallback renderer so unsupported parts stay visible during development."
      }
    ]
  }
];

function formatToolState(state: string) {
  switch (state) {
    case "input-available":
      return "Input available";
    case "output-available":
      return "Completed";
    case "running":
      return "Running";
    case "error":
      return "Error";
    default:
      return state;
  }
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
  return part.type === "step-start" && typeof part.title === "string";
}

function isFilePart(part: ChatMessagePart): part is FilePart {
  return part.type === "file" && typeof part.filename === "string";
}

function isSourceUrlPart(part: ChatMessagePart): part is SourceUrlPart {
  return part.type === "source-url" && typeof part.title === "string" && typeof part.url === "string";
}

function isSourceDocumentPart(part: ChatMessagePart): part is SourceDocumentPart {
  return part.type === "source-document" && typeof part.title === "string";
}

function isToolPart(part: ChatMessagePart): part is ToolPart {
  const candidate = part as Partial<ToolPart>;

  return (part.type === "dynamic-tool" || part.type.startsWith("tool-")) && typeof candidate.toolName === "string" && typeof candidate.state === "string";
}

function renderPart(part: ChatMessagePart, index: number) {
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
        <strong>{part.title}</strong>
      </div>
    );
  }

  if (isFilePart(part)) {
    return (
      <div key={`${part.type}-${index}`} className="attachment-card">
        <span className="attachment-label">File</span>
        <strong>{part.filename}</strong>
        <span>{part.mediaType ?? "Unknown type"}</span>
        {part.url ? <span className="mono">{part.url}</span> : null}
      </div>
    );
  }

  if (isSourceUrlPart(part)) {
    return (
      <a key={`${part.type}-${index}`} className="source-card" href={part.url}>
        <span className="attachment-label">Source URL</span>
        <strong>{part.title}</strong>
        <span>{part.host ?? part.url}</span>
      </a>
    );
  }

  if (isSourceDocumentPart(part)) {
    return (
      <div key={`${part.type}-${index}`} className="source-card">
        <span className="attachment-label">Source document</span>
        <strong>{part.title}</strong>
        {part.snippet ? <span>{part.snippet}</span> : null}
      </div>
    );
  }

  if (isToolPart(part)) {
    return (
      <div key={`${part.type}-${index}`} className="tool-card">
        <div className="tool-card-header">
          <div className="stack-tight">
            <span className="attachment-label">Tool call</span>
            <strong>{part.toolName}</strong>
          </div>
          <Badge variant="secondary" size="sm" radius="full">{formatToolState(part.state)}</Badge>
        </div>

        {part.input ? (
          <div className="tool-card-section">
            <span className="attachment-label">Input</span>
            <pre>{part.input}</pre>
          </div>
        ) : null}

        {part.output ? (
          <div className="tool-card-section">
            <span className="attachment-label">Output</span>
            <pre>{part.output}</pre>
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

export function ChatThread() {
  return (
    <section className="chat-thread" aria-label="Conversation transcript">
      {sampleMessages.map((message) => (
        <article key={message.id} className="chat-message" data-role={message.role}>
          <div className="chat-message-meta">
            <Badge variant={message.role === "assistant" ? "secondary" : "accent"} size="sm" radius="full">
              {getRoleLabel(message.role)}
            </Badge>
            {message.status === "streaming" ? (
              <Badge variant="secondary" size="sm" radius="full">Streaming</Badge>
            ) : null}
          </div>

          <Card className="chat-message-card">
            <div className="chat-message-parts">{message.parts.map((part, index) => renderPart(part, index))}</div>
          </Card>
        </article>
      ))}
    </section>
  );
}
