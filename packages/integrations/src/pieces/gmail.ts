import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

// Defines the Gmail send email action shape (matches community/gmail/send-email-action.ts)
const gmailSendEmail: ActivePiecesAction = {
  name: "gmail_send_email",
  displayName: "Send Email",
  description: "Send an email through a Gmail account",
  props: {
    to: { type: PropertyType.ARRAY, displayName: "Receiver Email (To)", required: true },
    subject: { type: PropertyType.SHORT_TEXT, displayName: "Subject", required: true },
    body: { type: PropertyType.LONG_TEXT, displayName: "Body", required: true },
    cc: { type: PropertyType.ARRAY, displayName: "CC Email", required: false },
    bcc: { type: PropertyType.ARRAY, displayName: "BCC Email", required: false },
  },
  run: async (_ctx) => {
    throw new Error(
      "Gmail tools require the '@activepieces/piece-gmail' package. " +
      "Install it and import the actual action: import { gmailSendEmailAction } from '@activepieces/piece-gmail'",
    );
  },
};

const gmailSearchEmail: ActivePiecesAction = {
  name: "gmail_search_email",
  displayName: "Search Emails",
  description: "Search Gmail messages using a query",
  props: {
    query: { type: PropertyType.SHORT_TEXT, displayName: "Search Query", required: true, description: "Gmail search syntax (e.g., 'from:user@example.com')" },
    maxResults: { type: PropertyType.NUMBER, displayName: "Max Results", required: false },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-gmail"); },
};

/**
 * Get adapted Gmail tool definitions.
 * @param authResolver - Provides OAuth2 credentials for Gmail
 * @param actions - Optional: provide actual community actions (e.g., from @activepieces/piece-gmail)
 *                  to get real execution instead of the stub run() that throws.
 */
export function adaptedGmailTools(
  authResolver: AuthResolver,
  actions?: { sendEmail?: ActivePiecesAction; searchEmail?: ActivePiecesAction },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.sendEmail ?? gmailSendEmail, authResolver),
    adaptActivePiece(actions?.searchEmail ?? gmailSearchEmail, authResolver),
  ];
}
