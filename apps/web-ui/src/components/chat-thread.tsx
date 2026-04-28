"use client";

import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  TextLink
} from "@nexu-design/ui-web";
import { ChevronRight, Component, FilePenLine, FileText, Globe, Wrench, type LucideIcon } from "lucide-react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";

import githubIconUrl from "../assets/connectors/github.svg";
import googleDriveIconUrl from "../assets/connectors/google-drive.svg";
import notionIconUrl from "../assets/connectors/notion.svg";

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
  readonly toolName?: string;
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

const partCardClassName = "flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-3";
const partTitleClassName = "text-text-heading";
const partLabelClassName = "text-xs font-semibold uppercase tracking-[0.08em] text-accent";
const toolSectionClassName = "flex flex-col gap-1.5";
const toolPreClassName = "m-0 overflow-auto whitespace-pre-wrap rounded-md bg-surface-0 p-2.5 font-mono text-sm text-text-secondary";
const mutedPartTextClassName = "m-0 leading-[1.5] text-text-muted";
const markdownClassName = "leading-[1.6] text-text-primary [&_*:first-child]:mt-0 [&_*:last-child]:mb-0 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1 [&_li>ol]:my-1 [&_li>ul]:my-1";
const internalToolLineClassName = "flex min-h-8 items-center gap-2 text-sm leading-[1.5] text-text-muted";
const executingToolLineClassName = "bg-[linear-gradient(90deg,var(--color-text-muted)_0%,var(--color-text-heading)_38%,var(--color-accent)_50%,var(--color-text-heading)_62%,var(--color-text-muted)_100%)] bg-[length:240%_100%] bg-clip-text text-transparent motion-safe:animate-[tool-shimmer_2.2s_ease-in-out_infinite]";

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

function isTextPart(part: ChatMessagePart): part is TextPart {
  return part.type === "text" && typeof part.text === "string";
}

function hasVisibleText(value: string) {
  return value.trim().length > 0;
}

function getLastTextPartIndex(parts: readonly ChatMessagePart[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part && isTextPart(part)) {
      return index;
    }
  }

  return -1;
}

function isReasoningPart(part: ChatMessagePart): part is ReasoningPart {
  return part.type === "reasoning" && typeof part.text === "string";
}

function isStepStartPart(part: ChatMessagePart): part is StepStartPart {
  return part.type === "step-start";
}

function isInternalStepStartPart(part: ChatMessagePart) {
  return (
    isStepStartPart(part) ||
    (part.type === "unknown" &&
      part.reason === "unsupported-part" &&
      part.originalType === "step-start")
  );
}

function isFilePart(part: ChatMessagePart): part is FilePart {
  return part.type === "file";
}

function isSourceUrlPart(part: ChatMessagePart): part is SourceUrlPart {
  return part.type === "source-url" && typeof part.url === "string";
}

function getSafeSourceUrl(url: string) {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:" ? parsedUrl.href : null;
  } catch {
    return null;
  }
}

function isSourceDocumentPart(part: ChatMessagePart): part is SourceDocumentPart {
  return part.type === "source-document";
}

function isToolPart(part: ChatMessagePart): part is ToolPart {
  const candidate = part as Partial<ToolPart>;

  return (
    (part.type === "dynamic-tool" && typeof candidate.toolName === "string" && typeof candidate.state === "string") ||
    (part.type.startsWith("tool-") && typeof candidate.state === "string")
  );
}

function hasTextContent(message: ChatMessage) {
  return message.parts.some((part) => isTextPart(part) && hasVisibleText(part.text));
}

function getToolName(part: ToolPart) {
  if (typeof part.toolName === "string" && part.toolName.trim().length > 0) {
    return part.toolName;
  }

  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : "tool";
}

function getStringField(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const fieldValue = (value as Record<string, unknown>)[key];

  return typeof fieldValue === "string" && fieldValue.trim().length > 0 ? fieldValue : null;
}

function getRecordField(value: unknown, key: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const fieldValue = (value as Record<string, unknown>)[key];

  return typeof fieldValue === "object" && fieldValue !== null && !Array.isArray(fieldValue) ? fieldValue : null;
}

function getToolErrorDetails(part: ToolPart) {
  if (part.state !== "output-error" && part.state !== "error") {
    return null;
  }

  if (typeof part.errorText === "string" && part.errorText.trim().length > 0) {
    return part.errorText.trim();
  }

  const outputMessage = getStringField(part.output, "message") ?? getStringField(part.output, "errorMessage") ?? getStringField(part.output, "error");

  if (outputMessage) {
    return outputMessage;
  }

  const nestedError = getRecordField(part.output, "error");

  return getStringField(nestedError, "message") ?? getStringField(nestedError, "details") ?? getStringField(part.output, "details");
}

function getSuccessfulWriteFileOutputPath(part: ToolPart) {
  if (part.state !== "output-available") {
    return null;
  }

  return getStringField(part.output, "resolvedPath") ?? getStringField(part.output, "path");
}

function getArtifactDetailPath(part: ToolPart) {
  const artifact = getRecordField(part.output, "artifact");
  const artifactUrl = getStringField(part.output, "artifactUrl") ?? getStringField(part.output, "url");

  if (artifactUrl?.startsWith("/artifacts/")) {
    return artifactUrl;
  }

  const artifactId = getStringField(part.output, "artifactId") ?? getStringField(artifact, "id");

  return artifactId ? `/artifacts/${encodeURIComponent(artifactId)}` : null;
}

function getLiveArtifactId(part: ToolPart) {
  const artifact = getRecordField(part.output, "artifact");
  const artifactId = getStringField(part.output, "artifactId") ?? getStringField(artifact, "id");

  if (artifactId) {
    return artifactId;
  }

  const artifactPath = getArtifactDetailPath(part);
  const match = artifactPath?.match(/^\/artifacts\/(.+)$/);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function isLiveArtifactCardOpen(part: ToolPart, openArtifactId: string | null | undefined) {
  const artifactId = getLiveArtifactId(part);

  return Boolean(artifactId && artifactId === openArtifactId);
}

function getLiveArtifactTitle(part: ToolPart) {
  const artifact = getRecordField(part.output, "artifact");

  return (
    getStringField(artifact, "title") ??
    getStringField(part.output, "title") ??
    getStringField(part.input, "title") ??
    "Untitled artifact"
  );
}

function getPathDisplayName(path: string) {
  const normalizedPath = path.trim().replace(/[\\/]+$/, "");

  if (!normalizedPath) {
    return path;
  }

  return normalizedPath.split(/[\\/]/).pop() ?? normalizedPath;
}

function getConnectorIconUrl(toolName: string) {
  const normalized = toolName.toLowerCase();
  
  if (normalized.includes("github")) {
    return githubIconUrl;
  }
  
  if (normalized.includes("notion")) {
    return notionIconUrl;
  }
  
  if (normalized.includes("google_drive") || normalized.includes("googledrive") || normalized.includes("gdrive")) {
    return googleDriveIconUrl;
  }
  
  return null;
}

function getInternalToolIcon(toolName: string): LucideIcon {
  switch (toolName) {
    case "fetch_url":
      return Globe;
    case "read_file":
      return FileText;
    case "write_file":
      return FilePenLine;
    default:
      return Wrench;
  }
}

function isInternalToolName(toolName: string) {
  return toolName === "fetch_url" || toolName === "read_file" || toolName === "write_file";
}

function isExecutingToolState(state: ToolPart["state"]) {
  return state === "input-streaming" || state === "input-available" || state === "running";
}

function getConnectorToolDescription(part: ToolPart) {
  if (part.state === "output-error" || part.state === "error") {
    const errorDetails = getToolErrorDetails(part);
    return errorDetails ? `Failed: ${errorDetails}` : "Tool failed.";
  }

  if (part.state === "output-available") {
    return "Tool completed.";
  }

  const entries = getToolInputEntries(part.input);
  if (entries.length > 0) {
    return entries.map(e => `${e.key}: ${e.value}`).join(", ");
  }

  if (part.input !== undefined && part.input !== null) {
    return formatToolInputValue(part.input);
  }

  return `${formatToolState(part.state)}.`;
}

function getInternalToolMessage(toolName: string, part: ToolPart) {
  const url = getStringField(part.input, "url");
  const path = getStringField(part.input, "path");
  const target = toolName === "fetch_url" ? url : path;
  const displayTarget = toolName === "write_file" && target ? getPathDisplayName(target) : target;
  const destination = target ? ` ${target}` : "";

  if (part.state === "output-error" || part.state === "error") {
    const errorDetails = getToolErrorDetails(part);
    const withDetails = (fallback: string) => errorDetails ? `${fallback}: ${errorDetails}` : `${fallback}.`;

    switch (toolName) {
      case "fetch_url":
        return withDetails(target ? `Couldn't fetch from ${target}` : "Couldn't fetch URL");
      case "read_file":
        return withDetails(displayTarget ? `Couldn't read ${displayTarget}` : "Couldn't read file");
      case "write_file":
        return withDetails(displayTarget ? `Couldn't write ${displayTarget}` : "Couldn't write file");
      default:
        return withDetails("Tool failed");
    }
  }

  if (part.state === "output-available") {
    switch (toolName) {
      case "fetch_url":
        return target ? `Fetched from ${target}.` : "Fetched URL.";
      case "read_file":
        return displayTarget ? `Read ${displayTarget}.` : "Read file.";
      case "write_file":
        return displayTarget ? `Wrote ${displayTarget}.` : "Wrote file.";
      default:
        return "Tool completed.";
    }
  }

  if (part.state === "approval-requested") {
    return displayTarget ? `Ready to write ${displayTarget}.` : "Ready to write file.";
  }

  switch (toolName) {
    case "fetch_url":
      return target ? `Fetching from ${target}.` : "Fetching URL.";
    case "read_file":
      return displayTarget ? `Reading ${displayTarget}.` : "Reading file.";
    case "write_file":
      return displayTarget ? `Writing ${displayTarget}.` : "Writing file.";
    default:
      return `${formatToolState(part.state)}.`;
  }
}

function isLikelyJsonString(value: string) {
  const trimmed = value.trim();

  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function formatToolInputValue(value: unknown): string {
  if (value == null) {
    return "None";
  }

  if (typeof value === "string") {
    return isLikelyJsonString(value) ? "Structured input" : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }

  if (typeof value === "object") {
    return "Nested data";
  }

  return "Provided";
}

function getToolInputEntries(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({
    key,
    value: formatToolInputValue(entryValue)
  }));
}

function renderToolInputSummary(value: unknown) {
  const entries = getToolInputEntries(value);

  if (entries.length === 0) {
    return <p className={mutedPartTextClassName}>{formatToolInputValue(value)}</p>;
  }

  return (
    <dl className="m-0 grid gap-2 rounded-md bg-surface-0 p-2.5 text-sm">
      {entries.map((entry) => (
        <div key={entry.key} className="grid gap-1 sm:grid-cols-[minmax(8rem,14rem)_1fr]">
          <dt className="font-semibold text-text-heading [overflow-wrap:anywhere]">{entry.key}</dt>
          <dd className="m-0 text-text-secondary [overflow-wrap:anywhere]">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
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
    readonly isStreamingPart: boolean;
    readonly isArchived: boolean;
    readonly pendingToolApprovalIds: ReadonlySet<string>;
    readonly onToolApproval?: (input: {
      runId: string;
      toolCallId: string;
      confirmationToken: string;
      decision: "approved" | "rejected";
    }) => void | Promise<void>;
    readonly openPathLabel: string;
    readonly openingPath: string | null;
    readonly onOpenPath?: (path: string) => void;
    readonly openArtifactId?: string | null;
    readonly onOpenArtifact?: (artifactId: string) => void;
  }
) {
  if (isTextPart(part)) {
    if (!hasVisibleText(part.text)) {
      return null;
    }

    return (
      <Streamdown
        key={`${part.type}-${index}`}
        animated={{ animation: "blurIn", duration: 180, easing: "ease-out", sep: "word", stagger: 0 }}
        isAnimating={options.isStreamingPart}
        mode={options.isStreamingPart ? "streaming" : "static"}
        plugins={{ code, mermaid, math, cjk }}
        controls={{ mermaid: { fullscreen: true, download: true, copy: true, panZoom: true } }}
        className={markdownClassName}
      >
        {part.text}
      </Streamdown>
    );
  }

  if (isReasoningPart(part)) {
    if (!hasVisibleText(part.text)) {
      return null;
    }

    return (
      <Accordion key={`${part.type}-${index}`} type="single" collapsible className="rounded-lg border border-border-subtle bg-surface-2">
        <AccordionItem value="reasoning" className="border-b-0">
          <AccordionTrigger className="px-3.5 py-3 text-base font-semibold text-text-heading">
            {part.label ?? "Reasoning"}
          </AccordionTrigger>
          <AccordionContent className="px-3.5 pb-3 text-base text-text-secondary">
            <p className="m-0 whitespace-pre-wrap">{part.text}</p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  }

  if (isInternalStepStartPart(part)) {
    return null;
  }

  if (isFilePart(part)) {
    return (
      <div key={`${part.type}-${index}`} className={partCardClassName}>
        <span className={partLabelClassName}>File</span>
        <strong className={partTitleClassName}>{part.filename ?? "Attachment"}</strong>
        <span>{part.mediaType ?? "Unknown type"}</span>
        {part.url ? <span className="mono overflow-auto [overflow-wrap:anywhere]">{part.url}</span> : null}
      </div>
    );
  }

  if (isSourceUrlPart(part)) {
    const safeUrl = getSafeSourceUrl(part.url);

    if (!safeUrl) {
      return (
        <div key={`${part.type}-${index}`} className={partCardClassName}>
          <span className={partLabelClassName}>Source URL</span>
          <strong className={`${partTitleClassName} [overflow-wrap:anywhere]`}>{part.title ?? part.url}</strong>
          <span>{part.host ?? part.url}</span>
        </div>
      );
    }

    return (
      <TextLink key={`${part.type}-${index}`} className={partCardClassName} href={safeUrl}>
        <span className={partLabelClassName}>Source URL</span>
        <strong className={`${partTitleClassName} [overflow-wrap:anywhere]`}>{part.title ?? part.url}</strong>
        <span>{part.host ?? part.url}</span>
      </TextLink>
    );
  }

  if (isSourceDocumentPart(part)) {
    return (
      <div key={`${part.type}-${index}`} className={partCardClassName}>
        <span className={partLabelClassName}>Source document</span>
        <strong className={partTitleClassName}>{part.title ?? "Document"}</strong>
        {part.snippet ? <span>{part.snippet}</span> : null}
      </div>
    );
  }

  if (isToolPart(part)) {
    const runId = getMessageRunId(message);
    const toolName = getToolName(part);
    const toolStateMeta = getToolStateMeta(part.state);
    const canApprove =
      part.state === "approval-requested" &&
      toolName !== "create_live_artifact" &&
      typeof part.toolCallId === "string" &&
      typeof part.approval?.id === "string" &&
      typeof runId === "string" &&
      typeof options.onToolApproval === "function";
    const isPendingApproval = typeof part.toolCallId === "string" && options.pendingToolApprovalIds.has(part.toolCallId);
    const isWriteFileCall = toolName === "write_file" && isWriteFileInput(part.input);
    const writeFilePreview = isWriteFileCall ? getWriteFilePreview(part.input.content) : null;
    const successfulWriteFilePath = toolName === "write_file" ? getSuccessfulWriteFileOutputPath(part) : null;
    const successfulWriteFileName = successfulWriteFilePath ? getPathDisplayName(successfulWriteFilePath) : null;
    const toolErrorDetails = getToolErrorDetails(part);
    const connectorIconUrl = getConnectorIconUrl(toolName);

    if (toolName === "create_live_artifact") {
      const artifactTitle = getLiveArtifactTitle(part);
      const artifactId = part.state === "output-available" ? getLiveArtifactId(part) : null;
      const canOpenArtifact = Boolean(artifactId && options.onOpenArtifact);
      const isOpenArtifact = isLiveArtifactCardOpen(part, options.openArtifactId);
      const isExecuting = isExecutingToolState(part.state);
      const cardClassName = `group flex min-h-11 w-full items-center justify-between gap-2.5 rounded-lg border px-3 py-2.5 text-left text-inherit no-underline shadow-xs transition-colors focus-visible:outline-none focus-visible:shadow-focus ${
        isOpenArtifact
          ? "border-accent/40 bg-accent/5"
          : "border-border-subtle bg-surface-1 hover:border-border-strong hover:bg-surface-2"
      } ${canOpenArtifact ? "cursor-pointer" : "cursor-default"}`;
      const content = (
        <>
          <span className="flex min-w-0 items-center gap-2.5">
            <Component aria-hidden="true" className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 truncate text-sm font-medium text-text-heading">
              {part.state === "output-available" ? `Created artifact: ${artifactTitle}` : `${formatToolState(part.state)} artifact: ${artifactTitle}`}
            </span>
          </span>
          {canOpenArtifact ? (
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-heading" strokeWidth={1.8} />
          ) : (
            <Badge variant={toolStateMeta.badgeVariant} size="sm" radius="full" className="shrink-0">{toolStateMeta.label}</Badge>
          )}
        </>
      );

      if (canOpenArtifact) {
        return (
          <button key={`${part.type}-${index}`} type="button" className={cardClassName} aria-label={`Open artifact ${artifactTitle}`} aria-pressed={isOpenArtifact} onClick={() => options.onOpenArtifact?.(artifactId!)}>
            {content}
          </button>
        );
      }

      return (
        <div key={`${part.type}-${index}`} className={cardClassName} data-tool-phase={toolStateMeta.phase}>
          {content}
          {toolErrorDetails ? <span className="min-w-0 truncate text-error" title={toolErrorDetails}>{toolErrorDetails}</span> : null}
          {isExecuting ? <span className="sr-only">{toolStateMeta.label}</span> : null}
        </div>
      );
    }

    if (isInternalToolName(toolName)) {
      const Icon = getInternalToolIcon(toolName);
      const isExecuting = isExecutingToolState(part.state);
      const message = getInternalToolMessage(toolName, part);
      const canOpenSuccessfulWriteFile = Boolean(successfulWriteFilePath && successfulWriteFileName && options.onOpenPath);

      return (
        <div key={`${part.type}-${index}`} className={internalToolLineClassName} data-tool-phase={toolStateMeta.phase}>
          <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
          <span className={`${isExecuting ? executingToolLineClassName : "text-text-muted"} min-w-0 truncate`} title={message}>
            {canOpenSuccessfulWriteFile ? (
              <>
                Wrote{" "}
                <TextLink asChild size="sm" className="mono align-baseline disabled:pointer-events-none disabled:opacity-60" showArrowUpRight={false}>
                  <Button
                    variant="link"
                    size="inline"
                    type="button"
                    title={`${options.openPathLabel}: ${successfulWriteFileName}`}
                    disabled={options.openingPath === successfulWriteFilePath}
                    onClick={() => options.onOpenPath?.(successfulWriteFilePath!)}
                  >
                    {options.openingPath === successfulWriteFilePath ? "Opening…" : successfulWriteFileName}
                  </Button>
                </TextLink>
                .
              </>
            ) : message}
          </span>
          {toolErrorDetails ? <span className="min-w-0 truncate text-error" title={toolErrorDetails}>{toolErrorDetails}</span> : null}
          {part.state === "approval-requested" && canApprove ? (
            <span className="ml-1 inline-flex shrink-0 gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
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
                size="sm"
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
                Reject
              </Button>
            </span>
          ) : null}
        </div>
      );
    }

    return (
      <Accordion key={`${part.type}-${index}`} type="single" collapsible className="flex flex-col" data-tool-phase={toolStateMeta.phase}>
        <AccordionItem value="tool" className="border-b-0">
          <AccordionTrigger className="flex min-h-8 cursor-pointer items-center justify-between gap-3 px-1 py-1 text-sm hover:no-underline [&>span]:min-w-0">
            <div className="flex w-full min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {connectorIconUrl ? (
                  <img src={connectorIconUrl} alt={`${toolName} icon`} className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Wrench aria-hidden="true" className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
                )}
                <strong className="truncate font-medium text-text-heading">{toolName}</strong>
                <span className={`${isExecutingToolState(part.state) ? executingToolLineClassName : "text-text-muted"} min-w-0 truncate`} title={getConnectorToolDescription(part)}>
                  {getConnectorToolDescription(part)}
                </span>
              </div>
              <Badge variant={toolStateMeta.badgeVariant} size="sm" radius="full" className="shrink-0">{toolStateMeta.label}</Badge>
            </div>
          </AccordionTrigger>

        <AccordionContent className="mt-2 px-0 pb-0 text-base text-text-secondary">
        <div className="flex flex-col gap-3">
          {isWriteFileCall ? (
            <>
              <div className={toolSectionClassName}>
                <span className={partLabelClassName}>Target path</span>
                <div className="mono overflow-auto rounded-md bg-surface-0 p-2.5 text-sm text-text-heading [overflow-wrap:anywhere]">{part.input.path}</div>
              </div>

              <div className={toolSectionClassName}>
                <span className={partLabelClassName}>Content preview</span>
                <pre className={toolPreClassName}>{writeFilePreview?.content}</pre>
                {writeFilePreview?.wasTruncated ? (
                  <p className={mutedPartTextClassName}>
                    Showing the first {Math.min(writeFilePreview.lineCount, WRITE_FILE_PREVIEW_MAX_LINES)} lines and up to {WRITE_FILE_PREVIEW_MAX_CHARS} characters.
                  </p>
                ) : (
                  <p className={mutedPartTextClassName}>{writeFilePreview?.lineCount ?? 0} lines · {writeFilePreview?.charCount ?? 0} characters</p>
                )}
              </div>
            </>
          ) : null}

          {part.input !== undefined && !isWriteFileCall ? (
            <div className={toolSectionClassName}>
              <span className={partLabelClassName}>Input summary</span>
              {renderToolInputSummary(part.input)}
            </div>
          ) : null}

          {part.state === "approval-requested" && isWriteFileCall ? (
            <div className={toolSectionClassName}>
              <span className={partLabelClassName}>Risk</span>
              <p className={mutedPartTextClassName}>This tool can create or overwrite the target file. Approve only if the destination path and previewed content are expected.</p>
            </div>
          ) : null}

          {part.state === "approval-requested" && canApprove ? (
            <div className={toolSectionClassName}>
              <span className={partLabelClassName}>Confirmation</span>
              <p className={mutedPartTextClassName}>
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
              {isPendingApproval ? <p className={mutedPartTextClassName}>Confirmation submitted. Waiting for the run to continue…</p> : null}
            </div>
          ) : null}

          {toolErrorDetails ? (
            <div className={toolSectionClassName}>
              <span className={partLabelClassName}>Error</span>
              <pre className={toolPreClassName}>{toolErrorDetails}</pre>
            </div>
          ) : null}
        </div>
        </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  }

  return (
    <div key={`${part.type}-${index}`} className={partCardClassName}>
      <span className={partLabelClassName}>Message detail</span>
      <strong className={partTitleClassName}>{part.type}</strong>
      <p className={mutedPartTextClassName}>This message part is not displayed.</p>
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
  readonly openArtifactId?: string | null;
  readonly onOpenArtifact?: (artifactId: string) => void;
}

export function ChatThread({ messages, status, errorText, isArchived, onToolApproval, openArtifactId, onOpenArtifact }: ChatThreadProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const lastLocatedUserMessageIdRef = useRef<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [pendingToolApprovalIds, setPendingToolApprovalIds] = useState<Set<string>>(new Set());
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [openPathFeedback, setOpenPathFeedback] = useState<string | null>(null);
  const desktopApi = typeof window === "undefined" ? undefined : window.monetDesktop;
  const canOpenPaths = typeof desktopApi?.openPath === "function";
  const openPathLabel = desktopApi?.platform === "darwin" ? "Open" : "Open file";

  function getScrollContainer() {
    return rootRef.current?.closest('[data-chat-scroll-container="true"]') ?? null;
  }

  function scrollToBottomNow(behavior: ScrollBehavior = "auto") {
    const scrollContainer = getScrollContainer();

    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior
    });
  }

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
    const scrollContainer = getScrollContainer();

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
    const scrollContainer = getScrollContainer();
    const isStreamingAssistantMessage = status === "streaming" && messages.at(-1)?.role === "assistant";

    if (!(scrollContainer instanceof HTMLElement) || (!shouldStickToBottomRef.current && !isStreamingAssistantMessage)) {
      return;
    }

    if (isStreamingAssistantMessage) {
      shouldStickToBottomRef.current = true;
      setShowScrollToBottom(false);
    }

    scrollToBottomNow(status === "streaming" ? "auto" : "smooth");
  }, [messages, status]);

  useEffect(() => {
    const latestMessage = messages.at(-1);

    if (!latestMessage || latestMessage.role !== "user" || latestMessage.id === lastLocatedUserMessageIdRef.current) {
      return;
    }

    lastLocatedUserMessageIdRef.current = latestMessage.id;
    shouldStickToBottomRef.current = false;

    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector(`[data-message-id="${latestMessage.id}"]`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, [messages]);

  useEffect(() => {
    if (status !== "streaming" || messages.at(-1)?.role !== "assistant" || !rootRef.current) {
      return;
    }

    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollToBottomNow("auto");

    const observer = new ResizeObserver(() => {
      scrollToBottomNow("auto");
    });

    observer.observe(rootRef.current);

    return () => {
      observer.disconnect();
    };
  }, [messages, status]);

  function scrollToBottom() {
    const scrollContainer = getScrollContainer();

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

  async function handleOpenPath(targetPath: string) {
    if (!desktopApi?.openPath) {
      return;
    }

    setOpeningPath(targetPath);
    setOpenPathFeedback(null);

    try {
      const result = await desktopApi.openPath({ path: targetPath });
      setOpenPathFeedback(result.opened ? null : result.error ?? `Unable to open ${targetPath}.`);
    } catch (error) {
      setOpenPathFeedback(error instanceof Error ? error.message : "Unable to open the written file.");
    } finally {
      setOpeningPath((currentPath) => (currentPath === targetPath ? null : currentPath));
    }
  }

  return (
    <section ref={rootRef} className="relative flex flex-col gap-4" aria-label="Conversation transcript">
      {messages.map((message, messageIndex) => {
        const isStreamingAssistant = status === "streaming" && message.role === "assistant" && messageIndex === messages.length - 1;
        const streamingTextPartIndex = isStreamingAssistant ? getLastTextPartIndex(message.parts) : -1;
        const renderedParts = message.parts.map((part, index) =>
          renderPart(message, part, index, {
            status,
            isStreamingPart: isStreamingAssistant && index === streamingTextPartIndex,
            isArchived,
            pendingToolApprovalIds,
            onToolApproval: handleToolApproval,
            openPathLabel,
            openingPath,
            onOpenPath: canOpenPaths ? handleOpenPath : undefined,
            openArtifactId,
            onOpenArtifact
          })
        );
        const visibleParts = renderedParts.filter((part) => part !== null);

        if (visibleParts.length === 0) {
          return null;
        }

        if (message.role === "assistant") {
          return (
            <article key={message.id} className="flex w-full flex-col gap-3" data-message-id={message.id} data-role={message.role}>
              {visibleParts}
            </article>
          );
        }

        return (
          <article key={message.id} className="flex flex-col gap-2 data-[role=user]:items-end" data-message-id={message.id} data-role={message.role}>
            <Card className={`rounded-xl border border-border-subtle px-4.5 shadow-xs ${message.role === "user" ? "w-fit max-w-[75%] border-[hsl(var(--accent)/0.2)] bg-[hsl(var(--accent)/0.08)] py-2 [overflow-wrap:anywhere] max-[960px]:max-w-full" : "w-full bg-surface-1 py-4"}`}>
              <div className="flex flex-col gap-3">
                {visibleParts}
              </div>
            </Card>
          </article>
        );
      })}

      {(status === "submitted" || (status === "streaming" && messages.at(-1)?.role === "assistant" && !hasTextContent(messages.at(-1)!))) ? (
        <div className="w-full py-1 text-sm font-medium" aria-live="polite">
          <span className="inline-block animate-[thinking-shimmer_1.35s_linear_infinite] bg-[linear-gradient(90deg,var(--color-text-muted),var(--color-text-primary),var(--color-text-muted))] bg-[length:200%_100%] bg-clip-text text-transparent">
            Thinking...
          </span>
        </div>
      ) : null}

      {errorText ? (
        <Card className="rounded-xl border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.05)] px-4.5 py-4 shadow-xs">
          <div className="flex flex-col gap-1">
            <span className={partLabelClassName}>Request error</span>
            <strong className={partTitleClassName}>Chat transport returned an error.</strong>
            <p className="m-0 leading-[1.5] text-text-muted">{errorText}</p>
          </div>
        </Card>
      ) : null}

      {openPathFeedback ? (
        <p className="m-0 rounded-lg border border-border-subtle bg-surface-2 px-3.5 py-2 text-sm leading-[1.5] text-text-muted mono" role="status">
          {openPathFeedback}
        </p>
      ) : null}

      {showScrollToBottom && messages.length > 0 ? (
        <div className="pointer-events-none sticky bottom-2 flex justify-center">
          <Button type="button" variant="secondary" className="pointer-events-auto shadow-dropdown" onClick={scrollToBottom}>Back to bottom</Button>
        </div>
      ) : null}
    </section>
  );
}
