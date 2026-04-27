import { jsonSchema } from "ai";

import { requiresConnectorToolApproval } from "../connectors/catalog";
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
    const prefixedNames = new Set<string>();

    return connectorTools.map((connectorTool) => {
      const prefixedName = getPrefixedConnectorToolName(connectorTool);

      if (prefixedNames.has(prefixedName)) {
        throw new Error(`Connector tool name collision after prefixing: ${prefixedName}`);
      }

      prefixedNames.add(prefixedName);

      return toRegisteredToolDefinition(connectorTool, prefixedName);
    });
  }
}

function toRegisteredToolDefinition(
  connectorTool: ConnectorToolDefinition,
  prefixedName: string
): RegisteredToolDefinition<unknown, unknown> {
  return {
    metadata: {
      name: prefixedName,
      description: connectorTool.description,
      requiresConfirmation: requiresConnectorToolApproval(connectorTool.policy)
    },
    inputSchema: jsonSchema(connectorTool.inputSchema as unknown as AiSdkJsonSchemaInput),
    execute() {
      throw new Error("Connector tool execution bridge is not available yet.");
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
