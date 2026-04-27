import { tool } from "ai";

import type { ChatStorage } from "../chat-storage";
import type { FeatureConfig } from "../config";
import type { Logger } from "../logger";

type ToolFactoryOptions = Parameters<typeof tool>[0];

export interface RegisteredToolExecuteContext {
  readonly toolCallId: string;
  readonly messages: readonly unknown[];
  readonly abortSignal: AbortSignal;
  readonly experimental_context?: unknown;
}

export interface ToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly requiresConfirmation: boolean;
}

export interface ToolExecutionContext {
  readonly runId: string;
  readonly chatStorage: ChatStorage;
  readonly logger: Logger;
}

export interface ToolExecutionHelpers {
  readonly persistedToolCallId: string;
}

export interface RegisteredToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly metadata: ToolMetadata;
  readonly inputSchema: unknown;
  readonly execute: (input: TInput, context: RegisteredToolExecuteContext & ToolExecutionHelpers) => TOutput | Promise<TOutput>;
}

export interface ToolRegistry {
  register<TInput, TOutput>(definition: RegisteredToolDefinition<TInput, TOutput>): void;
  listTools(): readonly ToolMetadata[];
  createRuntimeTools(context: ToolExecutionContext): Record<string, unknown>;
}

export interface CreateToolRegistryOptions {
  readonly connectorDefinitions?: ReadonlyArray<RegisteredToolDefinition<unknown, unknown>>;
  readonly features?: FeatureConfig;
}

export function createToolRegistry(
  initialDefinitions: ReadonlyArray<RegisteredToolDefinition<unknown, unknown>> = [],
  options: CreateToolRegistryOptions = {}
): ToolRegistry {
  const definitions = new Map<string, RegisteredToolDefinition<unknown, unknown>>();

  for (const definition of initialDefinitions) {
    registerDefinition(definition);
  }

  if (options.features?.connectors && options.connectorDefinitions) {
    for (const definition of options.connectorDefinitions) {
      registerDefinition(definition);
    }
  }

  function registerDefinition(definition: RegisteredToolDefinition<unknown, unknown>) {
    if (definitions.has(definition.metadata.name)) {
      throw new Error(`Tool already registered: ${definition.metadata.name}`);
    }

    definitions.set(definition.metadata.name, definition);
  }

  return {
    register(definition) {
      registerDefinition(definition as RegisteredToolDefinition<unknown, unknown>);
    },

    listTools() {
      return Array.from(definitions.values(), (definition) => definition.metadata);
    },

    createRuntimeTools(context) {
      return Object.fromEntries(
        Array.from(definitions.values(), (definition) => {
          const runtimeTool = tool({
            description: definition.metadata.description,
            inputSchema: definition.inputSchema as ToolFactoryOptions["inputSchema"],
            needsApproval: definition.metadata.requiresConfirmation,
            onInputAvailable: ({ input, toolCallId }) => {
              const persistedToolCallId = context.chatStorage.startToolCall({
                toolCallId,
                runId: context.runId,
                toolName: definition.metadata.name,
                input
              });

              context.logger.info("tool.input_available", {
                toolCallId: persistedToolCallId,
                sdkToolCallId: toolCallId,
                toolName: definition.metadata.name,
                requiresConfirmation: definition.metadata.requiresConfirmation
              });
            },
            execute: async (input, executionContext) => {
              const startedAt = Date.now();
              const persistedToolCallId = executionContext.toolCallId;

              context.chatStorage.startToolCall({
                toolCallId: persistedToolCallId,
                runId: context.runId,
                toolName: definition.metadata.name,
                input
              });
              context.chatStorage.markToolCallRunning(persistedToolCallId);

              context.logger.info("tool.execution_started", {
                toolCallId: persistedToolCallId,
                sdkToolCallId: executionContext.toolCallId,
                toolName: definition.metadata.name,
                requiresConfirmation: definition.metadata.requiresConfirmation
              });

              try {
                const output = await definition.execute(input, {
                  toolCallId: executionContext.toolCallId,
                  messages: executionContext.messages,
                  abortSignal: executionContext.abortSignal ?? new AbortController().signal,
                  experimental_context: executionContext.experimental_context,
                  persistedToolCallId
                });
                const completion = context.chatStorage.completeToolCall({
                  toolCallId: persistedToolCallId,
                  output
                });

                context.logger.info("tool.execution_completed", {
                  toolCallId: persistedToolCallId,
                  sdkToolCallId: executionContext.toolCallId,
                  toolName: definition.metadata.name,
                  durationMs: Date.now() - startedAt,
                  outputSizeBytes: completion.outputSizeBytes,
                  outputTruncated: completion.outputTruncated
                });

                return output;
              } catch (error) {
                context.chatStorage.failToolCall({
                  toolCallId: persistedToolCallId,
                  errorMessage: error instanceof Error ? error.message : "tool_execution_failed"
                });

                context.logger.error("tool.execution_failed", error, {
                  toolCallId: persistedToolCallId,
                  sdkToolCallId: executionContext.toolCallId,
                  toolName: definition.metadata.name,
                  durationMs: Date.now() - startedAt
                });

                throw error;
              }
            }
          });

          return [definition.metadata.name, runtimeTool] as const;
        })
      );
    }
  };
}
