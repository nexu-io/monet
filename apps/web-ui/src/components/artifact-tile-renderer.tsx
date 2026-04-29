import type { ReactNode } from "react";

import type { LiveArtifactTile } from "../lib/live-artifacts-api";

type ArtifactRenderJson = LiveArtifactTile["renderJson"];
type ArtifactJsonValue = Extract<ArtifactRenderJson, { kind: "json" }>["value"];

const MAX_MARKDOWN_CHARS = 20_000;
const MAX_LIST_ITEMS = 100;
const MAX_TABLE_COLUMNS = 30;
const MAX_TABLE_ROWS = 200;
const MAX_CELL_CHARS = 1_000;
const MAX_JSON_CHARS = 64_000;

function boundedText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;
}

function getSafeExternalUrl(url: string | undefined) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]{1,200}\]\([^\s)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em] text-text-primary">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-text-heading">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      const href = getSafeExternalUrl(linkMatch?.[2]);
      const label = linkMatch?.[1] ?? token;

      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
            {label}
          </a>
        ) : (
          label
        )
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function renderMarkdown(markdown: string) {
  const lines = boundedText(markdown, MAX_MARKDOWN_CHARS).replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`code-${index}`} className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs text-text-primary">
          <code>{boundedText(codeLines.join("\n"), 8_000)}</code>
        </pre>
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const content = renderInlineText(heading[2]!, `heading-${index}`);
      const className = "m-0 font-heading font-semibold text-text-heading";

      blocks.push(
        level === 1 ? (
          <h4 key={`heading-${index}`} className={`${className} text-lg`}>
            {content}
          </h4>
        ) : level === 2 ? (
          <h5 key={`heading-${index}`} className={`${className} text-base`}>
            {content}
          </h5>
        ) : (
          <h6 key={`heading-${index}`} className={`${className} text-sm`}>
            {content}
          </h6>
        )
      );
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="m-0 list-disc space-y-1 pl-5 text-sm text-text-primary">
          {items.slice(0, MAX_LIST_ITEMS).map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{renderInlineText(item, `ul-${index}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="m-0 list-decimal space-y-1 pl-5 text-sm text-text-primary">
          {items.slice(0, MAX_LIST_ITEMS).map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{renderInlineText(item, `ol-${index}-${itemIndex}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote-${index}`} className="m-0 border-l-2 border-border-strong pl-3 text-sm text-text-secondary">
          {renderInlineText(quoteLines.join(" "), `quote-${index}`)}
        </blockquote>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !/^(#{1,3})\s+/.test(lines[index] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[index] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[index] ?? "") &&
      !/^\s*>\s?/.test(lines[index] ?? "") &&
      !(lines[index] ?? "").trimStart().startsWith("```")
    ) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }

    blocks.push(
      <p key={`p-${index}`} className="m-0 text-sm leading-6 text-text-primary">
        {renderInlineText(paragraphLines.join(" "), `p-${index}`)}
      </p>
    );
  }

  return blocks.length > 0 ? <div className="flex flex-col gap-3">{blocks}</div> : <EmptyTileContent label="No markdown content." />;
}

function EmptyTileContent({ label }: { readonly label: string }) {
  return <div className="rounded-lg border border-dashed border-border-subtle bg-surface-2 px-3 py-4 text-center text-sm text-text-tertiary">{label}</div>;
}

function TrendIndicator({ trend }: { readonly trend: "up" | "down" | "flat" | undefined }) {
  if (!trend) {
    return null;
  }

  const config = {
    up: { label: "Trending up", icon: "↑", className: "text-success" },
    down: { label: "Trending down", icon: "↓", className: "text-warning" },
    flat: { label: "Flat trend", icon: "→", className: "text-text-tertiary" }
  }[trend];

  return (
    <span aria-label={config.label} title={config.label} className={`text-sm font-semibold ${config.className}`}>
      {config.icon}
    </span>
  );
}

function JsonFallback({ value }: { readonly value: ArtifactJsonValue }) {
  let formatted = "null";

  try {
    formatted = JSON.stringify(value, null, 2) ?? "null";
  } catch {
    formatted = String(value);
  }

  return (
    <pre className="max-h-[32rem] overflow-auto rounded-lg bg-surface-2 p-4 text-xs leading-5 text-text-primary">
      <code>{boundedText(formatted, MAX_JSON_CHARS)}</code>
    </pre>
  );
}

export function ArtifactTileRenderContent({ renderJson }: { readonly renderJson: ArtifactRenderJson }) {
  switch (renderJson.kind) {
    case "markdown":
      return renderMarkdown(renderJson.markdown);

    case "metric":
      return (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-secondary">{renderJson.label}</span>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="break-words text-3xl font-bold text-text-heading">{renderJson.value}</span>
            <TrendIndicator trend={renderJson.trend} />
          </div>
          {renderJson.caption ? <span className="text-xs leading-5 text-text-tertiary">{renderJson.caption}</span> : null}
        </div>
      );

    case "list": {
      const items = renderJson.items.slice(0, MAX_LIST_ITEMS);

      return items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((item, index) => {
            const href = getSafeExternalUrl(item.url);

            return (
              <li key={`${item.title}-${index}`} className="flex flex-col gap-0.5 border-b border-border-subtle/50 pb-3 last:border-0 last:pb-0">
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="break-words text-sm font-medium text-accent hover:underline">
                    {item.title}
                  </a>
                ) : (
                  <span className="break-words text-sm font-medium text-text-primary">{item.title}</span>
                )}
                {item.subtitle ? <span className="break-words text-xs leading-5 text-text-secondary">{item.subtitle}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyTileContent label="No list items." />
      );
    }

    case "table": {
      const columns = renderJson.columns.slice(0, MAX_TABLE_COLUMNS);
      const rows = renderJson.rows.slice(0, MAX_TABLE_ROWS);

      return columns.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead className="bg-surface-2 text-text-secondary">
              <tr>
                {columns.map((column, index) => (
                  <th key={`${column}-${index}`} scope="col" className="border-b border-border-subtle px-3 py-2 font-semibold">
                    {boundedText(column, MAX_CELL_CHARS)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-border-subtle/50 last:border-0">
                    {columns.map((_, columnIndex) => (
                      <td key={columnIndex} className="max-w-[24rem] whitespace-pre-wrap break-words px-3 py-2 align-top text-text-primary">
                        {boundedText(row[columnIndex] ?? "", MAX_CELL_CHARS)}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-4 text-center text-text-tertiary">
                    No table rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyTileContent label="No table columns." />
      );
    }

    case "link_card": {
      const href = getSafeExternalUrl(renderJson.url);
      const content = (
        <>
          <span className="break-words font-medium text-accent">{renderJson.title}</span>
          {renderJson.description ? <span className="break-words text-sm leading-5 text-text-secondary">{renderJson.description}</span> : null}
          {renderJson.sourceLabel ? <span className="break-words text-xs text-text-tertiary">{renderJson.sourceLabel}</span> : null}
          {!href ? <span className="text-xs text-warning">Link unavailable: unsupported URL.</span> : null}
        </>
      );

      return href ? (
        <a href={href} target="_blank" rel="noreferrer" className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-0 p-4 transition-colors hover:border-border-strong">
          {content}
        </a>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-0 p-4">{content}</div>
      );
    }

    case "json":
      return <JsonFallback value={renderJson.value} />;

    default:
      return <JsonFallback value={renderJson satisfies never} />;
  }
}
