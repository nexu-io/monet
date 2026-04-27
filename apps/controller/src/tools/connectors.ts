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
    const connectorTools = await this.provider.listTools({ userId });
    const connectorAccountLabels = await this.resolveConnectorAccountLabels(userId, connectorTools);
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
        accountLabel: connectorAccountLabels.get(connectorTool.connectorId) ?? null,
        provider: this.provider,
        userId
      });
    });
  }

  private async resolveConnectorAccountLabels(userId: string, connectorTools: readonly ConnectorToolDefinition[]) {
    const connectorIds = Array.from(new Set(connectorTools.map((tool) => tool.connectorId)));
    const accountLabels = new Map<string, string | null>();

    await Promise.all(
      connectorIds.map(async (connectorId) => {
        const status = await this.provider.getConnectionStatus({ userId, connectorId });

        accountLabels.set(connectorId, status.account?.accountLabel ?? null);
      })
    );

    return accountLabels;
  }
}

interface ConnectorRegisteredToolOptions {
  readonly connectorTool: ConnectorToolDefinition;
  readonly prefixedName: string;
  readonly accountLabel: string | null;
  readonly provider: ConnectorProvider;
  readonly userId: string;
}

function toRegisteredToolDefinition(options: ConnectorRegisteredToolOptions): RegisteredToolDefinition<unknown, unknown> {
  const { connectorTool, prefixedName, accountLabel, provider, userId } = options;
  const connectorCatalogItem = CONNECTOR_CATALOG.find((item) => item.id === connectorTool.connectorId);

  return {
    metadata: {
      name: prefixedName,
      description: connectorTool.description,
      requiresConfirmation: requiresConnectorToolApproval(connectorTool.policy),
      connector: {
        connectorId: connectorTool.connectorId,
        connectorName: connectorCatalogItem?.displayName ?? connectorTool.connectorId,
        accountLabel,
        toolName: connectorTool.displayName,
        providerToolId: connectorTool.providerToolId,
        approvalPolicy: connectorTool.policy
      }
    },
    inputSchema: jsonSchema(connectorTool.inputSchema as unknown as AiSdkJsonSchemaInput),
    async execute(input, context) {
      const result = await provider.executeTool({
        userId,
        toolId: connectorTool.providerToolId,
        args: input,
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
