import type { ToolDefinition, ToolContext } from "../types.js";

interface TavilyInput {
  query: string;
  maxResults?: number;
  searchDepth?: string;
}

export function tavilySearch(config: { apiKey: string }): ToolDefinition {
  return {
    name: "tavily_search",
    description: "Search the web using Tavily AI search engine",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results (default 5)" },
        searchDepth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "Search depth",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as TavilyInput;
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          query: i.query,
          max_results: i.maxResults ?? 5,
          search_depth: i.searchDepth ?? "basic",
        }),
      });
      if (!res.ok) {
        console.error(`[tavily] API error ${res.status} ${res.statusText}`);
        throw new Error(`Tavily API error: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },
  };
}
