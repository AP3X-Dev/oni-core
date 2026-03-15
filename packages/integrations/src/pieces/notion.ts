import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

const notionCreatePage: ActivePiecesAction = {
  name: "notion_create_page",
  displayName: "Create Page",
  description: "Create a new page in a Notion database",
  props: {
    databaseId: { type: PropertyType.SHORT_TEXT, displayName: "Database ID", required: true },
    properties: { type: PropertyType.OBJECT, displayName: "Page Properties", required: true, description: "Key-value pairs of Notion page properties" },
    content: { type: PropertyType.ARRAY, displayName: "Page Content", required: false, description: "Array of Notion block objects for the page body" },
  },
  run: async (_ctx) => {
    throw new Error(
      "Notion tools require the '@activepieces/piece-notion' package. " +
      "Install it and import the actual action: import { notionCreatePageAction } from '@activepieces/piece-notion'",
    );
  },
};

const notionQueryDatabase: ActivePiecesAction = {
  name: "notion_query_database",
  displayName: "Query Database",
  description: "Query a Notion database and retrieve matching pages",
  props: {
    databaseId: { type: PropertyType.SHORT_TEXT, displayName: "Database ID", required: true },
    filter: { type: PropertyType.OBJECT, displayName: "Filter", required: false, description: "Notion filter object to narrow results" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-notion"); },
};

const notionGetPage: ActivePiecesAction = {
  name: "notion_get_page",
  displayName: "Get Page",
  description: "Retrieve a Notion page by its ID",
  props: {
    pageId: { type: PropertyType.SHORT_TEXT, displayName: "Page ID", required: true },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-notion"); },
};

/**
 * Get adapted Notion tool definitions.
 * @param authResolver - Provides OAuth2 credentials for Notion
 * @param actions - Optional: provide actual community actions to get real execution.
 */
export function adaptedNotionTools(
  authResolver: AuthResolver,
  actions?: {
    createPage?: ActivePiecesAction;
    queryDatabase?: ActivePiecesAction;
    getPage?: ActivePiecesAction;
  },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.createPage ?? notionCreatePage, authResolver),
    adaptActivePiece(actions?.queryDatabase ?? notionQueryDatabase, authResolver),
    adaptActivePiece(actions?.getPage ?? notionGetPage, authResolver),
  ];
}
