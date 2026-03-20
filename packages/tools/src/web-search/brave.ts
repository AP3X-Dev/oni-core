import type { ToolDefinition, ToolContext } from "../types.js";

interface BraveInput {
  query: string;
  count?: number;
  offset?: number;
}

export function braveSearch(config: { apiKey: string }): ToolDefinition {
  return {
    name: "brave_search",
    description: "Search the web using Brave Search API",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Number of results (default 10, max 20)" },
        offset: { type: "number", description: "Offset for pagination (default 0)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as BraveInput;
      const params = new URLSearchParams({
        q: i.query,
        count: String(i.count ?? 10),
        offset: String(i.offset ?? 0),
      });
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "X-Subscription-Token": config.apiKey,
          },
        }
      );
      if (!res.ok) {
        console.error(`[brave] API error ${res.status} ${res.statusText}`);
        throw new Error(`Brave Search API error: ${res.status} ${res.statusText}`);
      }
      try {
        return await res.json();
      } catch {
        throw new Error(`brave_search: invalid JSON response from https://api.search.brave.com/res/v1/web/search`);
      }
    },
  };
}
