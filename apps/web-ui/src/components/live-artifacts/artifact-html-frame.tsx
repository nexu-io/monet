import type { LiveArtifactHtmlDocument } from "../../lib/live-artifacts-api";

const LIVE_ARTIFACT_DATA_SCRIPT_ID = "live-artifact-data";

function escapeJsonForHtml(value: unknown) {
  return JSON.stringify(value ?? {})
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtmlText(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isEmptyObject(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function parseEmbeddedLiveArtifactData(html: string) {
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<body>${html}</body>`, "text/html");
    const script = parsed.body.querySelector(`script#${LIVE_ARTIFACT_DATA_SCRIPT_ID}[type="application/json"]`);

    if (!script?.textContent?.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(script.textContent);
    } catch {
      return undefined;
    }
  }

  const match = html.match(/<script\b[^>]*\bid=(['"])live-artifact-data\1[^>]*\btype=(['"])application\/json\2[^>]*>([\s\S]*?)<\/script>/i)
    ?? html.match(/<script\b[^>]*\btype=(['"])application\/json\1[^>]*\bid=(['"])live-artifact-data\2[^>]*>([\s\S]*?)<\/script>/i);
  const content = match?.[3];

  if (!content?.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function stripEmbeddedLiveArtifactDataScripts(html: string) {
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(`<body>${html}</body>`, "text/html");

    for (const script of parsed.body.querySelectorAll(`script#${LIVE_ARTIFACT_DATA_SCRIPT_ID}[type="application/json"]`)) {
      script.remove();
    }

    return parsed.body.innerHTML;
  }

  return html.replace(/<script\b[^>]*\bid=(['"])live-artifact-data\1[^>]*\btype=(['"])application\/json\2[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\btype=(['"])application\/json\1[^>]*\bid=(['"])live-artifact-data\2[^>]*>[\s\S]*?<\/script>/gi, "");
}

function readDataPath(data: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || !segment) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (typeof current === "object" && Object.prototype.hasOwnProperty.call(current, segment)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, data);
}

function readBindingExpression(data: unknown, scope: Record<string, unknown>, expression: string) {
  const trimmed = expression.trim();

  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split(".");
  const [head, ...tail] = parts;

  if (head === "data") {
    return readDataPath(data, tail.join("."));
  }

  if (head && Object.prototype.hasOwnProperty.call(scope, head)) {
    return tail.length > 0 ? readDataPath(scope[head], tail.join(".")) : scope[head];
  }

  return readDataPath(data, trimmed);
}

function bindDataPlaceholders(html: string, data: unknown) {
  return html.replace(/\{\{\s*data\.([a-zA-Z0-9_.-]{1,200})\s*\}\}/g, (_match, path: string) => {
    const value = readDataPath(data, path);
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "object") {
      return escapeHtmlText(JSON.stringify(value));
    }
    return escapeHtmlText(value);
  });
}

function applyTextBinding(element: Element, data: unknown, scope: Record<string, unknown>) {
  const binding = element.getAttribute("data-bind");

  if (!binding) {
    return;
  }

  for (const statement of binding.split(";")) {
    const [target, ...expressionParts] = statement.split(":");
    const hasExplicitTarget = expressionParts.length > 0;
    const trimmedTarget = target?.trim();
    const expression = hasExplicitTarget ? expressionParts.join(":") : statement;

    if (hasExplicitTarget && trimmedTarget !== "text") {
      continue;
    }

    const value = readBindingExpression(data, scope, expression);
    element.textContent = value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  }

  element.removeAttribute("data-bind");
}

function applyAttributeBindings(element: Element, data: unknown, scope: Record<string, unknown>) {
  const binding = element.getAttribute("data-bind-attr");

  if (!binding) {
    return;
  }

  for (const statement of binding.split(";")) {
    const [attribute, ...expressionParts] = statement.split(":");
    const attributeName = attribute?.trim();
    const expression = expressionParts.join(":");

    if (!attributeName) {
      continue;
    }

    const value = readBindingExpression(data, scope, expression);

    if (value === null || value === undefined) {
      element.removeAttribute(attributeName);
    } else {
      element.setAttribute(attributeName, String(value));
    }
  }

  element.removeAttribute("data-bind-attr");
}

function applyStyleBindings(element: Element, data: unknown, scope: Record<string, unknown>) {
  const binding = element.getAttribute("data-bind-style");

  if (!binding || !(element instanceof HTMLElement)) {
    return;
  }

  for (const statement of binding.split(";")) {
    const [property, ...expressionParts] = statement.split(":");
    const propertyName = property?.trim();
    const expression = expressionParts.join(":");

    if (!propertyName) {
      continue;
    }

    const value = readBindingExpression(data, scope, expression);
    element.style.setProperty(propertyName, value === null || value === undefined ? "" : String(value));
  }

  element.removeAttribute("data-bind-style");
}

function processBindingElement(element: Element, data: unknown, scope: Record<string, unknown>) {
  const repeatExpression = element.getAttribute("data-repeat");

  if (repeatExpression) {
    const items = readBindingExpression(data, scope, repeatExpression);
    const itemName = element.getAttribute("data-as")?.trim() || "item";
    const templateChildren = Array.from(element.childNodes).map((child) => child.cloneNode(true));

    element.replaceChildren();

    if (Array.isArray(items)) {
      items.forEach((item, index) => {
        const repeatedScope = { ...scope, [itemName]: item, $index: index };

        for (const templateChild of templateChildren) {
          const child = templateChild.cloneNode(true);
          element.appendChild(child);

          if (child instanceof Element) {
            processBindingElement(child, data, repeatedScope);
          }
        }
      });
    }

    element.removeAttribute("data-repeat");
    element.removeAttribute("data-as");
    return;
  }

  applyTextBinding(element, data, scope);
  applyAttributeBindings(element, data, scope);
  applyStyleBindings(element, data, scope);

  for (const child of Array.from(element.children)) {
    processBindingElement(child, data, scope);
  }
}

export function bindLiveArtifactHtml(html: string, data: unknown) {
  const placeholderBoundHtml = bindDataPlaceholders(html, data);

  if (typeof DOMParser === "undefined") {
    return placeholderBoundHtml;
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<body>${placeholderBoundHtml}</body>`, "text/html");

  for (const child of Array.from(parsed.body.children)) {
    processBindingElement(child, data, {});
  }

  return parsed.body.innerHTML;
}

export function buildSandboxDocument(artifactDocument: LiveArtifactHtmlDocument) {
  const embeddedData = parseEmbeddedLiveArtifactData(artifactDocument.sanitizedHtml);
  const effectiveData = artifactDocument.dataJson === undefined || artifactDocument.dataJson === null || isEmptyObject(artifactDocument.dataJson)
    ? (embeddedData ?? artifactDocument.dataJson)
    : artifactDocument.dataJson;
  const sanitizedHtml = stripEmbeddedLiveArtifactDataScripts(artifactDocument.sanitizedHtml);
  const dataJson = escapeJsonForHtml(effectiveData);
  const boundHtml = bindLiveArtifactHtml(sanitizedHtml, effectiveData);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" />
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; padding: 0; background: #ffffff; color: #111827; }
    @media (prefers-color-scheme: dark) { body { background: #0f172a; color: #e5e7eb; } }
    * { box-sizing: border-box; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid rgba(148, 163, 184, 0.35); padding: 0.5rem; text-align: left; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <script id="${LIVE_ARTIFACT_DATA_SCRIPT_ID}" type="application/json">${dataJson}</script>
  ${boundHtml}
</body>
</html>`;
}

export function ArtifactHtmlFrame({ document, title }: { readonly document: LiveArtifactHtmlDocument; readonly title: string }) {
  return (
    <iframe
      className="block h-full min-h-[72vh] w-full border-0 bg-white"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={buildSandboxDocument(document)}
    />
  );
}
