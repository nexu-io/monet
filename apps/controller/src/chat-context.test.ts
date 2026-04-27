import assert from "node:assert/strict";
import test from "node:test";

import type { UIMessage } from "ai";

import { buildReplayContext } from "./chat-context";

test("buildReplayContext keeps leading system prompt and summarizes older history", () => {
  const messages = [
    {
      id: "msg_system",
      role: "system",
      parts: [{ type: "text", text: "You are Monet." }]
    } as unknown as UIMessage,
    ...Array.from({ length: 14 }, (_unused, index) => ({
      id: `msg_${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text: `message ${index} `.repeat(600) }]
    }) as unknown as UIMessage)
  ] satisfies UIMessage[];

  const result = buildReplayContext(messages);

  assert.equal(result.messages[0]?.role, "system");
  assert.equal((result.messages[0]?.parts?.[0] as { text?: string }).text, "You are Monet.");
  assert.equal(result.messages[1]?.role, "system");
  assert.match((result.messages[1]?.parts?.[0] as { text?: string }).text ?? "", /Conversation summary for/);
  assert.ok(result.stats.summarizedMessageCount > 0);
  assert.ok(result.messages.length < messages.length);
  assert.equal(result.messages.at(-1)?.id, messages.at(-1)?.id);
});

test("buildReplayContext injects current session workspace guidance after leading system prompt", () => {
  const messages = [
    {
      id: "msg_system",
      role: "system",
      parts: [{ type: "text", text: "You are Monet." }]
    } as unknown as UIMessage,
    {
      id: "msg_user",
      role: "user",
      parts: [{ type: "text", text: "Create hello.html." }]
    } as unknown as UIMessage
  ] satisfies UIMessage[];

  const result = buildReplayContext(messages, {
    sessionWorkspacePath: "/tmp/monet-session-workspaces/ses_context/workspace"
  });
  const workspaceContext = result.messages[1];
  const workspaceContextText = (workspaceContext?.parts?.[0] as { text?: string } | undefined)?.text ?? "";

  assert.equal(result.messages[0]?.id, "msg_system");
  assert.equal(workspaceContext?.id, "msg_session_workspace_context");
  assert.equal(workspaceContext?.role, "system");
  assert.match(workspaceContextText, /\/tmp\/monet-session-workspaces\/ses_context\/workspace/);
  assert.match(workspaceContextText, /Relative paths for file tools resolve inside this session workspace/);
  assert.match(workspaceContextText, /not the controller working directory/);
  assert.match(workspaceContextText, /Writes inside this session workspace do not require confirmation/);
  assert.equal(result.messages[2]?.id, "msg_user");
});

test("buildReplayContext drops historical reasoning and truncates replayed tool outputs", () => {
  const toolOutput = {
    content: "x".repeat(6_000)
  };
  const messages = [
    {
      id: "msg_user_1",
      role: "user",
      parts: [{ type: "text", text: "Read the file." }]
    } as unknown as UIMessage,
    {
      id: "msg_assistant_1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "private chain of thought" },
        {
          type: "tool-read_file",
          toolName: "read_file",
          state: "output-available",
          output: toolOutput
        }
      ]
    } as unknown as UIMessage,
    {
      id: "msg_user_2",
      role: "user",
      parts: [{ type: "text", text: "Now answer briefly." }]
    } as unknown as UIMessage,
    {
      id: "msg_assistant_2",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "recent reasoning stays available" },
        { type: "text", text: "Done." }
      ]
    } as unknown as UIMessage
  ] satisfies UIMessage[];

  const result = buildReplayContext(messages);
  const firstAssistant = result.messages.find((message) => message.id === "msg_assistant_1");
  const secondAssistant = result.messages.find((message) => message.id === "msg_assistant_2");
  const toolPart = firstAssistant?.parts?.find((part) => typeof (part as { type?: unknown }).type === "string" && (part as { type: string }).type === "tool-read_file") as
    | { output?: { truncated?: boolean; preview?: string } }
    | undefined;

  assert.ok(firstAssistant);
  assert.ok(secondAssistant);
  assert.equal(firstAssistant?.parts?.some((part) => (part as { type?: unknown }).type === "reasoning"), false);
  assert.equal(secondAssistant?.parts?.some((part) => (part as { type?: unknown }).type === "reasoning"), true);
  assert.equal(toolPart?.output?.truncated, true);
  assert.match(toolPart?.output?.preview ?? "", /content/);
  assert.equal(result.stats.removedReasoningPartCount, 1);
  assert.equal(result.stats.truncatedToolOutputCount, 1);
});
