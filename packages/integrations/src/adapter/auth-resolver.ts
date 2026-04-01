export interface AuthResolver {
  resolve(authDef: unknown, ctx: unknown): Promise<unknown>;
}

/** API key auth — for Stripe, Airtable, Discord, etc. */
export function apiKeyAuthResolver(
  keyProvider: (ctx: unknown) => string,
): AuthResolver {
  return {
    resolve: async (_authDef, ctx) => keyProvider(ctx),
  };
}

/** OAuth2 auth — for Gmail, Slack, GitHub, HubSpot, etc. */
export interface OAuth2Token {
  accessToken: string;
  tokenType?: string;
}

export function oauth2AuthResolver(
  tokenProvider: (ctx: unknown) => Promise<OAuth2Token>,
): AuthResolver {
  return {
    resolve: async (_authDef, ctx) => {
      const token = await tokenProvider(ctx);
      return {
        access_token: token.accessToken,
        token_type: token.tokenType ?? "Bearer",
      };
    },
  };
}

/**
 * Store auth resolver — reads credentials from a key-value store.
 * Compatible with @oni.bot/core BaseStore + AgentMemoryStore pattern.
 */
export interface SimpleStore {
  get(namespace: string[], key: string): Promise<{ value: unknown } | null>;
}

export function storeAuthResolver(
  store: SimpleStore,
  integrationKey: string,
  options?: { scope?: string },
): AuthResolver {
  if (!options?.scope) {
    console.warn(
      `[auth-resolver] storeAuthResolver for "${integrationKey}" was created without an access scope. ` +
      `Credentials are readable by any caller. Pass options.scope to restrict access.`,
    );
  }
  return {
    resolve: async () => {
      const item = await store.get(["credentials"], integrationKey);
      if (!item) {
        throw new Error(
          `No credentials found for integration "${integrationKey}".`,
        );
      }
      return item.value;
    },
  };
}
