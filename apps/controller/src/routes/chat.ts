import { simulateReadableStream, streamText, convertToModelMessages, validateUIMessages, type UIMessage } from "ai";

import type { ControllerApp } from "../app";
import { ChatStorageResolutionError, type ChatStorage, type ResolvedChatRequest } from "../chat-storage";

interface ChatRequestBody {
  readonly messages?: unknown;
  readonly sessionId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly runtimeOptions?: {
    readonly maxSteps?: number;
  };
}

const STREAM_CHUNK_DELAY_MS = 18;

function getLatestUserText(prompt: Array<{ role: string; content: unknown }>) {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];

    if (!message || message.role !== "user" || !Array.isArray(message.content)) {
      continue;
    }

    const text = message.content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" && part !== null && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"
      )
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function buildStubReply(body: ChatRequestBody, prompt: string, resolved: ResolvedChatRequest) {
  return [
    "The controller chat route is now streaming through `streamText(...).toUIMessageStreamResponse()`.",
    `Session: ${resolved.sessionId}`,
    `Provider: ${resolved.providerId}`,
    `Model: ${resolved.modelId}`,
    body.runtimeOptions?.maxSteps != null ? `Max steps: ${body.runtimeOptions.maxSteps}` : null,
    prompt ? `\nEchoing your last prompt:\n${prompt}` : "\nNo user text was found in the submitted UI messages."
  ]
    .filter((value): value is string => value != null)
    .join("\n");
}

function splitReplyIntoChunks(reply: string) {
  return reply.split(/(\s+)/).filter((chunk) => chunk.length > 0);
}

function createUsage(prompt: Array<{ role: string; content: unknown }>, reply: string) {
  const inputCharacters = JSON.stringify(prompt).length;

  return {
    inputTokens: {
      total: Math.max(1, Math.ceil(inputCharacters / 4)),
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined
    },
    outputTokens: {
      total: Math.max(1, Math.ceil(reply.length / 4)),
      text: Math.max(1, Math.ceil(reply.length / 4)),
      reasoning: undefined
    }
  };
}

function createLocalChatModel(body: ChatRequestBody, resolved: ResolvedChatRequest): Parameters<typeof streamText>[0]["model"] {
  const responseModelId = resolved.modelId;
  const responseId = `resp_${Date.now()}`;

  return {
    specificationVersion: "v3",
    provider: resolved.providerId,
    modelId: responseModelId,
    supportedUrls: {},
    async doGenerate(options) {
      const reply = buildStubReply(body, getLatestUserText(options.prompt), resolved);

      return {
        content: [{ type: "text", text: reply }],
        finishReason: {
          unified: "stop",
          raw: "stop"
        },
        usage: createUsage(options.prompt, reply),
        warnings: [],
        response: {
          id: responseId,
          modelId: responseModelId,
          timestamp: new Date()
        }
      };
    },
    async doStream(options) {
      const reply = buildStubReply(body, getLatestUserText(options.prompt), resolved);
      const textId = `txt_${Date.now()}`;

      return {
        stream: simulateReadableStream({
          initialDelayInMs: null,
          chunkDelayInMs: STREAM_CHUNK_DELAY_MS,
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "response-metadata",
              id: responseId,
              modelId: responseModelId,
              timestamp: new Date()
            },
            { type: "text-start", id: textId },
            ...splitReplyIntoChunks(reply).map((delta) => ({
              type: "text-delta" as const,
              id: textId,
              delta
            })),
            { type: "text-end", id: textId },
            {
              type: "finish",
              finishReason: {
                unified: "stop" as const,
                raw: "stop"
              },
              usage: createUsage(options.prompt, reply)
            }
          ]
        })
      };
    }
  };
}

function toModelMessages(messages: UIMessage[]) {
  return convertToModelMessages(messages.map(({ id: _id, ...message }) => message));
}

export function registerChatRoutes(app: ControllerApp, options: { getChatStorage: () => ChatStorage }) {
  app.post("/api/chat", async (context) => {
    let body: ChatRequestBody;

    try {
      body = (await context.req.json()) as ChatRequestBody;
    } catch {
      return context.json(
        {
          error: "invalid_request",
          message: "Request body must be valid JSON."
        },
        400
      );
    }

    let messages: UIMessage[];

    try {
      messages = await validateUIMessages({
        messages: Array.isArray(body.messages) ? body.messages : []
      });
    } catch {
      return context.json(
        {
          error: "invalid_request",
          message: "`messages` must be a valid AI SDK UIMessage[] payload."
        },
        400
      );
    }

    let resolvedChatRequest: ResolvedChatRequest;

    try {
      resolvedChatRequest = options.getChatStorage().prepareChatRequest({
        ...(body.sessionId ? { sessionId: body.sessionId } : {}),
        ...(body.providerId ? { providerId: body.providerId } : {}),
        ...(body.modelId ? { modelId: body.modelId } : {}),
        messages,
        ...(body.runtimeOptions?.maxSteps != null ? { maxSteps: body.runtimeOptions.maxSteps } : {})
      });
    } catch (error) {
      if (error instanceof ChatStorageResolutionError) {
        const status = error.statusCode === 422 ? 422 : 400;

        return context.json(
          {
            error: error.errorCode,
            message: error.message
          },
          status
        );
      }

      console.error("Failed to prepare chat request persistence.", error);

      return context.json(
        {
          error: "internal_error",
          message: "Failed to persist the chat request."
        },
        500
      );
    }

    const result = streamText({
      model: createLocalChatModel(body, resolvedChatRequest),
      messages: await toModelMessages(messages),
      onFinish: ({ finishReason }) => {
        try {
          options.getChatStorage().completeRun({
            runId: resolvedChatRequest.runId,
            finishReason: finishReason ?? null
          });
        } catch (error) {
          console.error("Failed to finalize chat run.", error);
        }
      }
    });

    result.consumeStream();

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      generateMessageId: () => `msg_${Date.now()}${Math.random().toString(16).slice(2, 10)}`,
      onFinish: ({ responseMessage }) => {
        try {
          options.getChatStorage().persistAssistantMessage({
            sessionId: resolvedChatRequest.sessionId,
            runId: resolvedChatRequest.runId,
            providerId: resolvedChatRequest.providerId,
            modelId: resolvedChatRequest.modelId,
            message: responseMessage
          });
        } catch (error) {
          console.error("Failed to persist assistant message.", error);
        }
      },
      onError: (error) => {
        try {
          options.getChatStorage().failRun({
            runId: resolvedChatRequest.runId,
            finishReason: error instanceof Error ? error.message : "stream_error"
          });
        } catch (persistError) {
          console.error("Failed to mark chat run as failed.", persistError);
        }

        return "An error occurred.";
      }
    });
  });
}
