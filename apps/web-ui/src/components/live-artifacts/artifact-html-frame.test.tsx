import { describe, expect, it } from "vitest";

import { bindLiveArtifactHtml, buildSandboxDocument } from "./artifact-html-frame";

describe("bindLiveArtifactHtml", () => {
  it("renders declarative repeat, text, attribute, and style bindings", () => {
    const html = `
      <section>
        <h1 data-bind="text:title"></h1>
        <div class="grid" data-repeat="repos" data-as="r">
          <a class="card" data-bind-attr="href:r.url;aria-label:r.name" data-bind-style="--c1:r.color">
            <span data-bind="text:r.rank"></span>
            <strong data-bind="text:r.name"></strong>
            <div data-repeat="r.topics" data-as="t"><em data-bind="text:t"></em></div>
          </a>
        </div>
      </section>
    `;

    const bound = bindLiveArtifactHtml(html, {
      title: "GitHub Agent 风云榜",
      repos: [
        { rank: "01", name: "crewAI", url: "https://github.com/crewAIInc/crewAI", color: "#7ee8fa", topics: ["agents", "ai"] },
        { rank: "02", name: "khoj", url: "https://github.com/khoj-ai/khoj", color: "#c792ea", topics: ["rag"] }
      ]
    });

    const parsed = new DOMParser().parseFromString(bound, "text/html");
    const cards = parsed.querySelectorAll(".card");

    expect(parsed.querySelector("h1")?.textContent).toBe("GitHub Agent 风云榜");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.getAttribute("href")).toBe("https://github.com/crewAIInc/crewAI");
    expect(cards[0]?.getAttribute("aria-label")).toBe("crewAI");
    expect((cards[0] as HTMLElement | undefined)?.style.getPropertyValue("--c1")).toBe("#7ee8fa");
    expect(cards[0]?.textContent).toContain("01");
    expect(cards[0]?.textContent).toContain("crewAI");
    expect(cards[0]?.textContent).toContain("agents");
    expect(cards[0]?.textContent).toContain("ai");
    expect(cards[1]?.textContent).toContain("khoj");
    expect(bound).not.toContain("data-bind");
    expect(bound).not.toContain("data-repeat");
  });

  it("treats bare data-bind expressions as text bindings", () => {
    const bound = bindLiveArtifactHtml('<p data-bind="data.title"></p>', {
      title: "Legacy title"
    });

    const parsed = new DOMParser().parseFromString(bound, "text/html");
    const paragraph = parsed.querySelector("p");

    expect(paragraph?.textContent).toBe("Legacy title");
    expect(paragraph?.hasAttribute("data-bind")).toBe(false);
  });

  it("does not treat non-text data-bind targets as text bindings", () => {
    const bound = bindLiveArtifactHtml('<a data-bind="href:data.url">fallback</a>', {
      url: "https://example.com"
    });

    const parsed = new DOMParser().parseFromString(bound, "text/html");
    const link = parsed.querySelector("a");

    expect(link?.textContent).toBe("fallback");
    expect(link?.getAttribute("href")).toBeNull();
    expect(link?.hasAttribute("data-bind")).toBe(false);
  });
});

describe("buildSandboxDocument", () => {
  it("uses embedded live artifact data when dataJson is empty", () => {
    const srcDoc = buildSandboxDocument({
      format: "html_template_v1",
      sanitizedHtml: `
        <script id="live-artifact-data" type="application/json">{"title":"Legacy artifact title"}</script>
        <h1 data-bind="text:title"></h1>
      `,
      dataJson: {}
    });

    const parsed = new DOMParser().parseFromString(srcDoc, "text/html");
    const dataScript = parsed.querySelector("script#live-artifact-data");

    expect(parsed.querySelector("h1")?.textContent).toBe("Legacy artifact title");
    expect(dataScript?.textContent).toBe("{\"title\":\"Legacy artifact title\"}");
  });

  it("keeps a single canonical live-artifact-data script", () => {
    const srcDoc = buildSandboxDocument({
      format: "html_template_v1",
      sanitizedHtml: `
        <script id="live-artifact-data" type="application/json">{"title":"legacy"}</script>
        <main>hello</main>
        <script id="live-artifact-data" type="application/json">{"title":"duplicate"}</script>
      `,
      dataJson: { title: "current" }
    });

    const parsed = new DOMParser().parseFromString(srcDoc, "text/html");
    const dataScripts = parsed.querySelectorAll("script#live-artifact-data[type='application/json']");

    expect(dataScripts).toHaveLength(1);
    expect(dataScripts[0]?.textContent).toBe("{\"title\":\"current\"}");
    expect(parsed.body.textContent).toContain("hello");
  });
});
