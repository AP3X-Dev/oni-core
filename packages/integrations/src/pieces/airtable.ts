import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

const airtableCreateRecord: ActivePiecesAction = {
  name: "airtable_create_record",
  displayName: "Create Record",
  description: "Create a new record in an Airtable table",
  props: {
    baseId: { type: PropertyType.SHORT_TEXT, displayName: "Base ID", required: true },
    tableId: { type: PropertyType.SHORT_TEXT, displayName: "Table ID or Name", required: true },
    fields: { type: PropertyType.OBJECT, displayName: "Fields", required: true, description: "Key-value pairs of field names and values" },
  },
  run: async (_ctx) => {
    throw new Error(
      "Airtable tools require the '@activepieces/piece-airtable' package. " +
      "Install it and import the actual action: import { airtableCreateRecordAction } from '@activepieces/piece-airtable'",
    );
  },
};

const airtableListRecords: ActivePiecesAction = {
  name: "airtable_list_records",
  displayName: "List Records",
  description: "Retrieve records from an Airtable table, optionally filtered",
  props: {
    baseId: { type: PropertyType.SHORT_TEXT, displayName: "Base ID", required: true },
    tableId: { type: PropertyType.SHORT_TEXT, displayName: "Table ID or Name", required: true },
    filterFormula: { type: PropertyType.SHORT_TEXT, displayName: "Filter Formula", required: false, description: "Airtable formula to filter records (e.g., \"{Status}='Active'\")" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-airtable"); },
};

const airtableUpdateRecord: ActivePiecesAction = {
  name: "airtable_update_record",
  displayName: "Update Record",
  description: "Update an existing record in an Airtable table",
  props: {
    baseId: { type: PropertyType.SHORT_TEXT, displayName: "Base ID", required: true },
    tableId: { type: PropertyType.SHORT_TEXT, displayName: "Table ID or Name", required: true },
    recordId: { type: PropertyType.SHORT_TEXT, displayName: "Record ID", required: true },
    fields: { type: PropertyType.OBJECT, displayName: "Fields", required: true, description: "Key-value pairs of field names and new values" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-airtable"); },
};

/**
 * Get adapted Airtable tool definitions.
 * @param authResolver - Provides API key credentials for Airtable
 * @param actions - Optional: provide actual community actions to get real execution.
 */
export function adaptedAirtableTools(
  authResolver: AuthResolver,
  actions?: {
    createRecord?: ActivePiecesAction;
    listRecords?: ActivePiecesAction;
    updateRecord?: ActivePiecesAction;
  },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.createRecord ?? airtableCreateRecord, authResolver),
    adaptActivePiece(actions?.listRecords ?? airtableListRecords, authResolver),
    adaptActivePiece(actions?.updateRecord ?? airtableUpdateRecord, authResolver),
  ];
}
