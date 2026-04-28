import { describe, expect, it } from "vitest";

import { bindLiveArtifactHtml } from "./artifact-html-frame";

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
});
