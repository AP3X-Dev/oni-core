import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

const hubspotCreateContact: ActivePiecesAction = {
  name: "hubspot_create_contact",
  displayName: "Create Contact",
  description: "Create a new contact in HubSpot CRM",
  props: {
    email: { type: PropertyType.SHORT_TEXT, displayName: "Email", required: true },
    firstname: { type: PropertyType.SHORT_TEXT, displayName: "First Name", required: false },
    lastname: { type: PropertyType.SHORT_TEXT, displayName: "Last Name", required: false },
  },
  run: async (_ctx) => {
    throw new Error(
      "HubSpot tools require the '@activepieces/piece-hubspot' package. " +
      "Install it and import the actual action: import { hubspotCreateContactAction } from '@activepieces/piece-hubspot'",
    );
  },
};

const hubspotSearchContacts: ActivePiecesAction = {
  name: "hubspot_search_contacts",
  displayName: "Search Contacts",
  description: "Search for contacts in HubSpot CRM",
  props: {
    query: { type: PropertyType.SHORT_TEXT, displayName: "Search Query", required: true },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-hubspot"); },
};

const hubspotUpdateContact: ActivePiecesAction = {
  name: "hubspot_update_contact",
  displayName: "Update Contact",
  description: "Update an existing contact's properties in HubSpot CRM",
  props: {
    contactId: { type: PropertyType.SHORT_TEXT, displayName: "Contact ID", required: true },
    properties: { type: PropertyType.OBJECT, displayName: "Properties", required: true, description: "Key-value pairs of contact properties to update" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-hubspot"); },
};

/**
 * Get adapted HubSpot tool definitions.
 * @param authResolver - Provides OAuth2 credentials for HubSpot
 * @param actions - Optional: provide actual community actions to get real execution.
 */
export function adaptedHubspotTools(
  authResolver: AuthResolver,
  actions?: {
    createContact?: ActivePiecesAction;
    searchContacts?: ActivePiecesAction;
    updateContact?: ActivePiecesAction;
  },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.createContact ?? hubspotCreateContact, authResolver),
    adaptActivePiece(actions?.searchContacts ?? hubspotSearchContacts, authResolver),
    adaptActivePiece(actions?.updateContact ?? hubspotUpdateContact, authResolver),
  ];
}
