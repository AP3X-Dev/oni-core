import { adaptActivePiece, type AdaptedToolDefinition, type ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";

const stripeCreateCustomer: ActivePiecesAction = {
  name: "stripe_create_customer",
  displayName: "Create Customer",
  description: "Create a new customer in Stripe",
  props: {
    email: { type: PropertyType.SHORT_TEXT, displayName: "Email", required: true },
    name: { type: PropertyType.SHORT_TEXT, displayName: "Name", required: false },
  },
  run: async (_ctx) => {
    throw new Error(
      "Stripe tools require the '@activepieces/piece-stripe' package. " +
      "Install it and import the actual action: import { stripeCreateCustomerAction } from '@activepieces/piece-stripe'",
    );
  },
};

const stripeCreateInvoice: ActivePiecesAction = {
  name: "stripe_create_invoice",
  displayName: "Create Invoice",
  description: "Create and send an invoice to a Stripe customer",
  props: {
    customerId: { type: PropertyType.SHORT_TEXT, displayName: "Customer ID", required: true },
    items: { type: PropertyType.ARRAY, displayName: "Line Items", required: true, description: "Array of invoice line items" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-stripe"); },
};

const stripeListTransactions: ActivePiecesAction = {
  name: "stripe_list_transactions",
  displayName: "List Transactions",
  description: "List recent transactions (balance history) from Stripe",
  props: {
    limit: { type: PropertyType.NUMBER, displayName: "Limit", required: false, description: "Number of transactions to retrieve (max 100)" },
    customerId: { type: PropertyType.SHORT_TEXT, displayName: "Customer ID", required: false, description: "Filter by customer" },
  },
  run: async (_ctx) => { throw new Error("Requires @activepieces/piece-stripe"); },
};

/**
 * Get adapted Stripe tool definitions.
 * @param authResolver - Provides API key credentials for Stripe
 * @param actions - Optional: provide actual community actions to get real execution.
 */
export function adaptedStripeTools(
  authResolver: AuthResolver,
  actions?: {
    createCustomer?: ActivePiecesAction;
    createInvoice?: ActivePiecesAction;
    listTransactions?: ActivePiecesAction;
  },
): AdaptedToolDefinition[] {
  return [
    adaptActivePiece(actions?.createCustomer ?? stripeCreateCustomer, authResolver),
    adaptActivePiece(actions?.createInvoice ?? stripeCreateInvoice, authResolver),
    adaptActivePiece(actions?.listTransactions ?? stripeListTransactions, authResolver),
  ];
}
