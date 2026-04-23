"use client";

import { ChatThread } from "../components/chat-thread";
import { Composer } from "../components/composer";
import { ConversationHeader } from "../components/conversation-header";
import { ControllerStatusCard } from "../components/controller-status-card";
import { PageFrame } from "../components/page-frame";

export default function HomePage() {
  return (
    <PageFrame
      pathname="/"
      title="Agent Chat"
      description="Desktop-first chat shell wired for a local Hono controller and ready for AI SDK UI message rendering."
      header={<ConversationHeader />}
      composer={<Composer />}
    >
      <div className="chat-thread-layout">
        <ControllerStatusCard />
        <ChatThread />
      </div>
    </PageFrame>
  );
}
