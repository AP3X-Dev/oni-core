import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

const googleSheetsAppendRow: ActivePiecesAction = {
  name: "google_sheets_append_row",
  displayName: "Append Row",
  description: "Append a new row of values to a Google Sheet",
  props: {
    spreadsheetId: { type: PropertyType.SHORT_TEXT, displayName: "Spreadsheet ID", required: true },
    sheetName: { type: PropertyType.SHORT_TEXT, displayName: "Sheet Name", required: true },
    values: { type: PropertyType.ARRAY, displayName: "Row Values", required: true, description: "Array of cell values for the new row" },
  },
  run: async (_ctx) => {
    throw new Error(
      "Google Sheets tools require the '@activepieces/piece-google-sheets' package. " +
      "Install it and import the actual action: import { googleSheetsAppendRowAction } from '@activepieces/piece-google-sheets'",
    );
  },
};

const googleSheetsGetRows: ActivePiecesAction = {
  name: "google_sheets_get_rows",
  displayName: "Get Rows",
  description: "Read rows from a range in a Google Sheet",
  props: {
    spreadsheetId: { type: PropertyType.SHORT_TEXT, displayName: "Spreadsheet ID", required: true },
    sheetName: { type: PropertyType.SHORT_TEXT, displayName: "Sheet Name", required: true },
    range: { type: PropertyType.SHORT_TEXT, displayName: "Range", required: false, description: "A1 notation range (e.g., 'A1:D10'). Omit for all rows." },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-google-sheets"); },
};

const googleSheetsUpdateRow: ActivePiecesAction = {
  name: "google_sheets_update_row",
  displayName: "Update Row",
  description: "Update cell values in a specific range of a Google Sheet",
  props: {
    spreadsheetId: { type: PropertyType.SHORT_TEXT, displayName: "Spreadsheet ID", required: true },
    sheetName: { type: PropertyType.SHORT_TEXT, displayName: "Sheet Name", required: true },
    range: { type: PropertyType.SHORT_TEXT, displayName: "Range", required: true, description: "A1 notation range to update (e.g., 'A2:D2')" },
    values: { type: PropertyType.ARRAY, displayName: "Row Values", required: true, description: "Array of cell values to write" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-google-sheets"); },
};

/**
 * Get adapted Google Sheets tool definitions.
 * @param authResolver - Provides OAuth2 credentials for Google Sheets
 * @param actions - Optional: provide actual community actions to get real execution.
 */
export function adaptedGoogleSheetsTools(
  authResolver: AuthResolver,
  actions?: {
    appendRow?: ActivePiecesAction;
    getRows?: ActivePiecesAction;
    updateRow?: ActivePiecesAction;
  },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.appendRow ?? googleSheetsAppendRow, authResolver),
    adaptActivePiece(actions?.getRows ?? googleSheetsGetRows, authResolver),
    adaptActivePiece(actions?.updateRow ?? googleSheetsUpdateRow, authResolver),
  ];
}
