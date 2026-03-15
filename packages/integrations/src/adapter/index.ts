import { propsToJsonSchema, type Property, type JSONSchema } from "./props-to-schema.js";
import type { AuthResolver } from "./auth-resolver.js";

export interface ActivePiecesAction {
  name: string;
  displayName: string;
  description: string;
  auth?: unknown;
  props: Record<string, Property>;
  run: (context: {
    auth: unknown;
    propsValue: Record<string, unknown>;
    server: { publicUrl: string };
    project: { id: string };
    files: { write: (opts: unknown) => Promise<{ url: string; mimeType: string }> };
  }) => Promise<unknown>;
}

export interface AdaptedToolDefinition {
  name: string;
  description: string;
  schema: JSONSchema;
  parallelSafe: boolean;
  execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
}

function isReadOnly(name: string): boolean {
  return /^(get|list|search|find|fetch|read)/i.test(name);
}

export function adaptActivePiece(
  action: ActivePiecesAction,
  authResolver: AuthResolver,
): AdaptedToolDefinition {
  return {
    name: action.name,
    description: `${action.displayName}: ${action.description}`,
    schema: propsToJsonSchema(action.props),
    parallelSafe: isReadOnly(action.name),
    execute: async (input: Record<string, unknown>, ctx: unknown) => {
      const auth = await authResolver.resolve(action.auth, ctx);
      return action.run({
        auth,
        propsValue: input,
        server: { publicUrl: "" },
        project: { id: "" },
        files: {
          write: async () => ({ url: "", mimeType: "application/octet-stream" }),
        },
      });
    },
  };
}

export { propsToJsonSchema } from "./props-to-schema.js";
export { apiKeyAuthResolver, oauth2AuthResolver, storeAuthResolver } from "./auth-resolver.js";
export type { AuthResolver, SimpleStore } from "./auth-resolver.js";
export type { Property, JSONSchema };
