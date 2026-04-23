"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";
import { getMonetClientConfig } from "../lib/monet-client";

export default function HomePage() {
  const [input, setInput] = useState("");
  const controllerConfig = getMonetClientConfig();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${controllerConfig.apiBase}/api/chat`,
        headers: () => {
          if (!controllerConfig.bearerToken) {
            return {};
          }

          return {
            Authorization: `Bearer ${controllerConfig.bearerToken}`
          };
        },
        body: {
          sessionId: "ses_local-shell",
          providerId: "pro_local-stub",
          modelId: "mod_controller-echo"
        }
      }),
    [controllerConfig.apiBase, controllerConfig.bearerToken]
  );
  const { messages, sendMessage, regenerate, stop, status, error, clearError } = useChat({ transport });
  const isBusy = status === "submitted" || status === "streaming";
  const canRegenerate = !isBusy && messages.some((message) => message.role === "user");

  async function handleSubmit() {
    const text = input.trim();

    if (!text || isBusy) {
      return;
    }

    await sendMessage({ text });
    setInput("");
  }

  async function handleRegenerate() {
    if (!canRegenerate) {
      return;
    }

    if (error) {
      clearError();
    }

    await regenerate();
  }

  function handleStop() {
    if (!isBusy) {
      return;
    }

    stop();
  }

  function handleInputChange(value: string) {
    if (error) {
      clearError();
    }

    setInput(value);
  }

  return (
    <PageFrame
      pathname="/"
      title="Agent Chat"
      description="Desktop-first chat shell wired for a local Hono controller and ready for AI SDK UI message rendering."
      header={(
        <ConversationHeader
          status={status}
          messageCount={messages.length}
          hasError={error != null}
          canRegenerate={canRegenerate}
          onRegenerate={() => void handleRegenerate()}
          onStop={handleStop}
        />
      )}
      composer={(
        <Composer
          value={input}
          status={status}
          canRegenerate={canRegenerate}
          onValueChange={handleInputChange}
          onSubmit={() => void handleSubmit()}
          onRegenerate={() => void handleRegenerate()}
          onStop={handleStop}
        />
      )}
    >
      <div className="chat-thread-layout">
        <ControllerStatusCard />
        <ChatThread messages={messages} status={status} errorText={error?.message} />
      </div>
    </PageFrame>
  );
}
