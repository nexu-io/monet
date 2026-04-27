import { jsonSchema } from "ai";

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

    return connectorTools.map((connectorTool) => toRegisteredToolDefinition(connectorTool));
  }
}

function toRegisteredToolDefinition(connectorTool: ConnectorToolDefinition): RegisteredToolDefinition<unknown, unknown> {
  return {
    metadata: {
      name: connectorTool.name,
      description: connectorTool.description,
      requiresConfirmation: connectorTool.policy.approval !== "never"
    },
    inputSchema: jsonSchema(connectorTool.inputSchema as unknown as AiSdkJsonSchemaInput),
    execute() {
      throw new Error("Connector tool execution bridge is not available yet.");
    }
  };
}
