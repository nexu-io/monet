import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";

import type { ControllerApp } from "../app";

interface ChatRequestBody {
  readonly messages?: UIMessage[];
  readonly sessionId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getLatestUserText(messages: readonly UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!message || message.role !== "user") {
      continue;
    }

    const text = message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function buildStubReply(body: ChatRequestBody, prompt: string) {
  return [
    "The local controller chat route is now wired.",
    `Session: ${body.sessionId ?? "ses_local-shell"}`,
    `Provider: ${body.providerId ?? "pro_local-stub"}`,
    `Model: ${body.modelId ?? "mod_controller-echo"}`,
    prompt ? `\nEchoing your last prompt:\n${prompt}` : "\nNo user text was found in the submitted UI messages."
  ].join("\n");
}

export function registerChatRoutes(app: ControllerApp) {
  app.post("/api/chat", async (context) => {
    const body = (await context.req.json()) as ChatRequestBody;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const reply = buildStubReply(body, getLatestUserText(messages));
    const stream = createUIMessageStream({
      originalMessages: messages,
      async execute({ writer }) {
        const textId = `txt_${Date.now()}`;

        writer.write({ type: "text-start", id: textId });

        for (const token of reply.split(/(\s+)/)) {
          if (!token) {
            continue;
          }

          writer.write({ type: "text-delta", id: textId, delta: token });
          await sleep(18);
        }

        writer.write({ type: "text-end", id: textId });
      }
    });

    return createUIMessageStreamResponse({ stream });
  });
}
