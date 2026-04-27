import { tool } from "ai";

import type { ChatStorage } from "../chat-storage";
import type { FeatureConfig } from "../config";
import type { Logger } from "../logger";

type ToolFactoryOptions = Parameters<typeof tool>[0];
type MaybePromise<T> = T | Promise<T>;

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

export type ToolSourceContext = ToolExecutionContext;

export interface ToolExecutionHelpers {
  readonly persistedToolCallId: string;
}

export interface RegisteredToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly metadata: ToolMetadata;
  readonly inputSchema: unknown;
  readonly execute: (input: TInput, context: RegisteredToolExecuteContext & ToolExecutionHelpers) => TOutput | Promise<TOutput>;
}

export interface ToolSource {
  readonly id: string;
  listTools(): MaybePromise<readonly ToolMetadata[]>;
  resolveTools(context: ToolSourceContext): MaybePromise<ReadonlyArray<RegisteredToolDefinition<unknown, unknown>>>;
}

export interface ToolRegistry {
  register<TInput, TOutput>(definition: RegisteredToolDefinition<TInput, TOutput>): void;
  registerSource(source: ToolSource): void;
  listTools(): Promise<readonly ToolMetadata[]>;
  createRuntimeTools(context: ToolExecutionContext): Promise<Record<string, unknown>>;
}

export interface CreateToolRegistryOptions {
  readonly connectorDefinitions?: ReadonlyArray<RegisteredToolDefinition<unknown, unknown>>;
  readonly features?: FeatureConfig;
  readonly sources?: readonly ToolSource[];
}

export interface StaticToolSource extends ToolSource {
  register<TInput, TOutput>(definition: RegisteredToolDefinition<TInput, TOutput>): void;
}

export function createStaticToolSource(
  id: string,
  initialDefinitions: ReadonlyArray<RegisteredToolDefinition<unknown, unknown>> = []
): StaticToolSource {
  const definitions = new Map<string, RegisteredToolDefinition<unknown, unknown>>();

  function registerDefinition(definition: RegisteredToolDefinition<unknown, unknown>) {
    if (definitions.has(definition.metadata.name)) {
      throw new Error(`Tool already registered in source ${id}: ${definition.metadata.name}`);
    }

    definitions.set(definition.metadata.name, definition);
  }

  for (const definition of initialDefinitions) {
    registerDefinition(definition);
  }

  return {
    id,

    register(definition) {
      registerDefinition(definition as RegisteredToolDefinition<unknown, unknown>);
    },

    listTools() {
      return Array.from(definitions.values(), (definition) => definition.metadata);
    },

    resolveTools() {
      return Array.from(definitions.values());
    }
  };
}

export function createToolRegistry(
  initialDefinitions: ReadonlyArray<RegisteredToolDefinition<unknown, unknown>> = [],
  options: CreateToolRegistryOptions = {}
): ToolRegistry {
  const staticSource = createStaticToolSource("static", initialDefinitions);
  const sources = new Map<string, ToolSource>();

  registerSource(staticSource);

  if (options.features?.connectors && options.connectorDefinitions) {
    for (const definition of options.connectorDefinitions) {
      staticSource.register(definition);
    }
  }

  for (const source of options.sources ?? []) {
    registerSource(source);
  }

  function registerSource(source: ToolSource) {
    if (sources.has(source.id)) {
      throw new Error(`Tool source already registered: ${source.id}`);
    }

    sources.set(source.id, source);
  }

  async function resolveDefinitions(context: ToolSourceContext) {
    const definitions = new Map<string, RegisteredToolDefinition<unknown, unknown>>();

    for (const source of sources.values()) {
      const sourceDefinitions = await source.resolveTools(context);

      for (const definition of sourceDefinitions) {
        if (definitions.has(definition.metadata.name)) {
          throw new Error(`Tool name collision: ${definition.metadata.name}`);
        }

        definitions.set(definition.metadata.name, definition);
      }
    }

    return Array.from(definitions.values());
  }

  return {
    register(definition) {
      staticSource.register(definition as RegisteredToolDefinition<unknown, unknown>);
    },

    registerSource(source) {
      registerSource(source);
    },

    async listTools() {
      const tools = new Map<string, ToolMetadata>();

      for (const source of sources.values()) {
        const sourceTools = await source.listTools();

        for (const metadata of sourceTools) {
          if (tools.has(metadata.name)) {
            throw new Error(`Tool name collision: ${metadata.name}`);
          }

          tools.set(metadata.name, metadata);
        }
      }

      return Array.from(tools.values());
    },

    async createRuntimeTools(context) {
      const definitions = await resolveDefinitions(context);

      return Object.fromEntries(
        definitions.map((definition) => {
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
