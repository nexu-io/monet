import { jsonSchema } from "ai";

import { CONNECTOR_CATALOG, requiresConnectorToolApproval } from "../connectors/catalog";
import type { ConnectorProvider, ConnectorToolDefinition } from "../connectors/provider";
import type { RegisteredToolDefinition, ToolMetadata, ToolSource, ToolSourceContext } from "./registry";

type AiSdkJsonSchemaInput = Parameters<typeof jsonSchema>[0];

export interface ConnectorToolSourceOptions {
  readonly provider: ConnectorProvider;
}

export function createConnectorToolSource(options: ConnectorToolSourceOptions): ToolSource {
  return new ConnectorToolSource(options.provider);
}

class ConnectorToolSource implements ToolSource {
  readonly id = "connectors";

  constructor(private readonly provider: ConnectorProvider) {}

  listTools(): readonly ToolMetadata[] {
    return [];
  }

  async resolveTools(context: ToolSourceContext): Promise<ReadonlyArray<RegisteredToolDefinition<unknown, unknown>>> {
    const userId = context.chatStorage.getMonetInstallId();
    const connectorTools = await this.listConnectorTools(userId, context);
    const connectorConnections = await this.resolveConnectorConnections(userId, connectorTools, context.abortSignal);
    const prefixedNames = new Set<string>();

    return connectorTools.map((connectorTool) => {
      const prefixedName = getPrefixedConnectorToolName(connectorTool);

      if (prefixedNames.has(prefixedName)) {
        throw new Error(`Connector tool name collision after prefixing: ${prefixedName}`);
      }

      prefixedNames.add(prefixedName);

      return toRegisteredToolDefinition({
        connectorTool,
        prefixedName,
        connection: connectorConnections.get(connectorTool.connectorId) ?? null,
        provider: this.provider,
        userId
      });
    });
  }

  private async listConnectorTools(userId: string, context: ToolSourceContext) {
    try {
      return await this.provider.listTools({
        userId,
        ...(context.abortSignal ? { abortSignal: context.abortSignal } : {})
      });
    } catch (error) {
      context.logger.warn("connector.tools.list_failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async resolveConnectorConnections(
    userId: string,
    connectorTools: readonly ConnectorToolDefinition[],
    abortSignal: AbortSignal | undefined
  ) {
    const connectorIds = Array.from(new Set(connectorTools.map((tool) => tool.connectorId)));
    const connections = new Map<string, {
      accountLabel: string | null;
      providerConnectionId: string | null;
      state: string;
      connected: boolean;
    }>();

    await Promise.all(
      connectorIds.map(async (connectorId) => {
        const status = await this.provider.getConnectionStatus({
          userId,
          connectorId,
          ...(abortSignal ? { abortSignal } : {})
        });

        connections.set(connectorId, {
          accountLabel: status.account?.accountLabel ?? null,
          providerConnectionId: status.account?.providerConnectionId ?? null,
          state: status.state,
          connected: status.connected
        });
      })
    );

    return connections;
  }
}

interface ConnectorRegisteredToolOptions {
  readonly connectorTool: ConnectorToolDefinition;
  readonly prefixedName: string;
  readonly connection: { accountLabel: string | null; providerConnectionId: string | null; state: string; connected: boolean } | null;
  readonly provider: ConnectorProvider;
  readonly userId: string;
}

function toRegisteredToolDefinition(options: ConnectorRegisteredToolOptions): RegisteredToolDefinition<unknown, unknown> {
  const { connectorTool, prefixedName, connection, provider, userId } = options;
  const connectorCatalogItem = CONNECTOR_CATALOG.find((item) => item.id === connectorTool.connectorId);

  return {
    metadata: {
      name: prefixedName,
      description: connectorTool.description,
      requiresConfirmation: requiresConnectorToolApproval(connectorTool.policy),
      connector: {
        connectorId: connectorTool.connectorId,
        connectorName: connectorCatalogItem?.displayName ?? connectorTool.connectorId,
        accountLabel: connection?.accountLabel ?? null,
        connected: connection?.connected ?? false,
        toolName: connectorTool.displayName,
        providerToolId: connectorTool.providerToolId,
        approvalPolicy: connectorTool.policy,
        ...(connection?.state ? { connectionState: connection.state } : {})
      }
    },
    inputSchema: jsonSchema(connectorTool.inputSchema as unknown as AiSdkJsonSchemaInput),
    async execute(input, context) {
      const result = await provider.executeTool({
        userId,
        toolId: connectorTool.providerToolId,
        args: input,
        ...(connection?.providerConnectionId ? { connectionId: connection.providerConnectionId } : {}),
        abortSignal: context.abortSignal
      });

      if (result.providerExecutionId || result.metadata) {
        context.setConnectorExecutionMetadata({
          providerExecutionId: result.providerExecutionId ?? null,
          providerExecutionMetadata: result.metadata ?? null
        });
      }

      return result.output;
    }
  };
}

function getPrefixedConnectorToolName(connectorTool: ConnectorToolDefinition): string {
  const connectorPrefix = normalizeToolNameSegment(connectorTool.connectorId);
  const providerConnectorPrefix = normalizeToolNameSegment(connectorTool.providerToolId.split("_")[0] ?? "");
  const normalizedToolName = normalizeToolNameSegment(connectorTool.name || connectorTool.providerToolId);
  const unprefixedToolName = normalizedToolName.startsWith(`${providerConnectorPrefix}_`)
    ? normalizedToolName.slice(providerConnectorPrefix.length + 1)
    : normalizedToolName;

  return `${connectorPrefix}_${unprefixedToolName}`;
}

function normalizeToolNameSegment(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
