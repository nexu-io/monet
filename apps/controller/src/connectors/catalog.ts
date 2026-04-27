export type ConnectorId = "github" | "notion" | "google_drive";

export type ConnectorCategory = "developer" | "productivity" | "files";

export type ConnectorToolSideEffect = "read" | "write" | "destructive" | "external_send";

export type ConnectorToolApproval = "never" | "first_use" | "always";

export interface ConnectorToolPolicy {
  readonly sideEffect: ConnectorToolSideEffect;
  readonly approval: ConnectorToolApproval;
}

export interface ConnectorAllowedTool {
  readonly providerToolId: string;
  readonly displayName: string;
  readonly summary: string;
  readonly policy: ConnectorToolPolicy;
}

export interface ConnectorCatalogItem {
  readonly id: ConnectorId;
  readonly providerConnectorId: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: ConnectorCategory;
  readonly icon: string;
  readonly featuredTools: readonly string[];
  readonly enabledByDefault: boolean;
  readonly minimumApprovalPolicy: ConnectorToolPolicy;
  readonly capabilitySummaries: readonly string[];
  readonly allowedTools: readonly ConnectorAllowedTool[];
}

const READ_TOOL_POLICY: ConnectorToolPolicy = {
  sideEffect: "read",
  approval: "first_use"
};

export const CONNECTOR_CATALOG = [
  {
    id: "github",
    providerConnectorId: "GITHUB",
    displayName: "GitHub",
    description: "Search repositories, issues, pull requests, commits, and releases from connected GitHub accounts.",
    category: "developer",
    icon: "github",
    featuredTools: ["GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS", "GITHUB_LIST_PULL_REQUESTS", "GITHUB_LIST_COMMITS"],
    enabledByDefault: true,
    minimumApprovalPolicy: READ_TOOL_POLICY,
    capabilitySummaries: [
      "Inspect authenticated user, repository, and organization context.",
      "Search and list repositories, issues, pull requests, commits, and releases.",
      "Curated v1 tools are read-only to avoid unintended repository changes."
    ],
    allowedTools: [
      {
        providerToolId: "GITHUB_GET_THE_AUTHENTICATED_USER",
        displayName: "Get authenticated user",
        summary: "Read profile details for the connected GitHub account.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
        displayName: "List user repositories",
        summary: "List repositories visible to the connected GitHub account.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_LIST_ORGANIZATIONS_FOR_THE_AUTHENTICATED_USER",
        displayName: "List user organizations",
        summary: "List organizations associated with the connected GitHub account.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_LIST_ISSUES_FOR_A_REPOSITORY",
        displayName: "List repository issues",
        summary: "List issues for a selected repository.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_LIST_PULL_REQUESTS",
        displayName: "List pull requests",
        summary: "List pull requests for a selected repository.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_GET_A_REPOSITORY",
        displayName: "Get repository",
        summary: "Fetch metadata for a selected repository.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_SEARCH_REPOSITORIES",
        displayName: "Search repositories",
        summary: "Search GitHub repositories by query.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_SEARCH_ISSUES_AND_PULL_REQUESTS",
        displayName: "Search issues and pull requests",
        summary: "Search issues and pull requests across accessible repositories.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_LIST_COMMITS",
        displayName: "List commits",
        summary: "List commits for a selected repository or branch.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GITHUB_LIST_RELEASES",
        displayName: "List releases",
        summary: "List releases published by a selected repository.",
        policy: READ_TOOL_POLICY
      }
    ]
  },
  {
    id: "notion",
    providerConnectorId: "NOTION",
    displayName: "Notion",
    description: "Find and read connected Notion pages, databases, blocks, and database query results.",
    category: "productivity",
    icon: "notion",
    featuredTools: ["NOTION_SEARCH_NOTION_PAGE", "NOTION_QUERY_DATABASE", "NOTION_FETCH_PAGE"],
    enabledByDefault: true,
    minimumApprovalPolicy: READ_TOOL_POLICY,
    capabilitySummaries: [
      "Search pages and databases in connected Notion workspaces.",
      "Fetch page, database, block, and filtered database-query content.",
      "Curated v1 tools are read-only to avoid creating or mutating workspace content."
    ],
    allowedTools: [
      {
        providerToolId: "NOTION_FETCH_DATA",
        displayName: "Fetch data",
        summary: "Fetch general Notion data exposed by the connected workspace.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "NOTION_SEARCH_NOTION_PAGE",
        displayName: "Search pages",
        summary: "Search for Notion pages by query.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "NOTION_QUERY_DATABASE",
        displayName: "Query database",
        summary: "Read rows from a selected Notion database.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "NOTION_QUERY_DATABASE_WITH_FILTER",
        displayName: "Query database with filter",
        summary: "Read filtered rows from a selected Notion database.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "NOTION_FETCH_DATABASE",
        displayName: "Fetch database",
        summary: "Fetch metadata for a selected Notion database.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "NOTION_FETCH_PAGE",
        displayName: "Fetch page",
        summary: "Fetch content and metadata for a selected Notion page.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "NOTION_FETCH_BLOCK_CHILDREN",
        displayName: "Fetch block children",
        summary: "Read child blocks for a selected Notion block or page.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "NOTION_SEARCH_DATABASES",
        displayName: "Search databases",
        summary: "Search for Notion databases in the connected workspace.",
        policy: READ_TOOL_POLICY
      }
    ]
  },
  {
    id: "google_drive",
    providerConnectorId: "GOOGLEDRIVE",
    displayName: "Google Drive",
    description: "Find and inspect files, folders, permissions, comments, changes, and labels in connected Google Drive accounts.",
    category: "files",
    icon: "google-drive",
    featuredTools: ["GOOGLEDRIVE_FIND_FILE", "GOOGLEDRIVE_LIST_FILES_AND_FOLDERS", "GOOGLEDRIVE_GET_FILE"],
    enabledByDefault: true,
    minimumApprovalPolicy: READ_TOOL_POLICY,
    capabilitySummaries: [
      "Find files and folders in connected Google Drive accounts.",
      "Inspect file metadata, permissions, comments, labels, and change history.",
      "Curated v1 tools are read-only to avoid modifying or sharing Drive content."
    ],
    allowedTools: [
      {
        providerToolId: "GOOGLEDRIVE_FIND_FILE",
        displayName: "Find file",
        summary: "Find Google Drive files by query or metadata.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_FIND_FOLDER",
        displayName: "Find folder",
        summary: "Find Google Drive folders by query or metadata.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_LIST_FILES_AND_FOLDERS",
        displayName: "List files and folders",
        summary: "List files and folders visible to the connected account.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_LIST_FILES",
        displayName: "List files",
        summary: "List files visible to the connected account.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_GET_FILE",
        displayName: "Get file",
        summary: "Fetch metadata or content reference for a selected file.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_LIST_FOLDERS",
        displayName: "List folders",
        summary: "List folders visible to the connected account.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_LIST_PERMISSIONS",
        displayName: "List permissions",
        summary: "Inspect sharing permissions for a selected file or folder.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_LIST_CHANGES",
        displayName: "List changes",
        summary: "Read change history for the connected Drive account.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_LIST_COMMENTS",
        displayName: "List comments",
        summary: "Read comments on a selected Drive file.",
        policy: READ_TOOL_POLICY
      },
      {
        providerToolId: "GOOGLEDRIVE_LIST_FILE_LABELS",
        displayName: "List file labels",
        summary: "Read labels applied to a selected Drive file.",
        policy: READ_TOOL_POLICY
      }
    ]
  }
] as const satisfies readonly ConnectorCatalogItem[];

export function listConnectorCatalog(): readonly ConnectorCatalogItem[] {
  return CONNECTOR_CATALOG;
}

export function getConnectorCatalogItem(connectorId: string): ConnectorCatalogItem | undefined {
  return CONNECTOR_CATALOG.find((connector) => connector.id === connectorId);
}

export function isConnectorId(connectorId: string): connectorId is ConnectorId {
  return CONNECTOR_CATALOG.some((connector) => connector.id === connectorId);
}
