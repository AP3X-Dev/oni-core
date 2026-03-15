import type { ToolDefinition, ToolContext } from "../types.js";

interface StripeCustomerCreateParams {
  email?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, string>;
}

interface StripeInvoiceCreateParams {
  customer: string;
  description?: string;
  metadata?: Record<string, string>;
  auto_advance?: boolean;
}

interface StripeChargeListParams {
  limit?: number;
  customer?: string;
  starting_after?: string;
}

interface StripeInstance {
  customers: {
    create: (params: StripeCustomerCreateParams) => Promise<unknown>;
  };
  invoices: {
    create: (params: StripeInvoiceCreateParams) => Promise<unknown>;
  };
  charges: {
    list: (params: StripeChargeListParams) => Promise<unknown>;
  };
}

interface StripeModule {
  default: new (apiKey: string) => StripeInstance;
}

interface CreateCustomerInput {
  email?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, string>;
}

interface CreateInvoiceInput {
  customer: string;
  description?: string;
  autoAdvance?: boolean;
  metadata?: Record<string, string>;
}

interface ListTransactionsInput {
  limit?: number;
  customer?: string;
  startingAfter?: string;
}

async function loadStripeInstance(apiKey: string): Promise<StripeInstance> {
  let mod: StripeModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mod = (await import("stripe" as any)) as StripeModule;
  } catch {
    throw new Error("stripeTools requires 'stripe'. Install it: pnpm add stripe");
  }
  return new mod.default(apiKey);
}

export function stripeTools(config: { apiKey: string }): ToolDefinition[] {
  const createCustomerTool: ToolDefinition = {
    name: "stripe_create_customer",
    description: "Create a new customer in Stripe",
    schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer email address" },
        name: { type: "string", description: "Customer full name" },
        description: { type: "string", description: "Optional description" },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Key-value metadata pairs",
        },
      },
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as CreateCustomerInput;
      const stripe = await loadStripeInstance(config.apiKey);
      return stripe.customers.create({
        email: i.email,
        name: i.name,
        description: i.description,
        metadata: i.metadata,
      });
    },
  };

  const createInvoiceTool: ToolDefinition = {
    name: "stripe_create_invoice",
    description: "Create an invoice for a Stripe customer",
    schema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Stripe customer ID (cus_...)" },
        description: { type: "string", description: "Invoice description" },
        autoAdvance: {
          type: "boolean",
          description: "Automatically finalize the invoice (default: false)",
        },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Key-value metadata pairs",
        },
      },
      required: ["customer"],
      additionalProperties: false,
    },
    parallelSafe: false,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as CreateInvoiceInput;
      const stripe = await loadStripeInstance(config.apiKey);
      return stripe.invoices.create({
        customer: i.customer,
        description: i.description,
        auto_advance: i.autoAdvance ?? false,
        metadata: i.metadata,
      });
    },
  };

  const listTransactionsTool: ToolDefinition = {
    name: "stripe_list_transactions",
    description: "List charges (transactions) from Stripe",
    schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of charges to return (default 10, max 100)" },
        customer: { type: "string", description: "Filter by customer ID" },
        startingAfter: {
          type: "string",
          description: "Pagination cursor — charge ID to start after",
        },
      },
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as ListTransactionsInput;
      const stripe = await loadStripeInstance(config.apiKey);
      return stripe.charges.list({
        limit: i.limit ?? 10,
        customer: i.customer,
        starting_after: i.startingAfter,
      });
    },
  };

  return [createCustomerTool, createInvoiceTool, listTransactionsTool];
}
