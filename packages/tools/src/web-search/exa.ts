import type { ToolDefinition, ToolContext } from "../types.js";

interface ExaInput {
  query: string;
  numResults?: number;
  type?: "neural" | "keyword";
  useAutoprompt?: boolean;
}

export function exaSearch(config: { apiKey: string }): ToolDefinition {
  return {
    name: "exa_search",
    description: "Search the web using Exa neural search engine",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: { type: "number", description: "Number of results (default 10)" },
        type: {
          type: "string",
          enum: ["neural", "keyword"],
          description: "Search type (default: neural)",
        },
        useAutoprompt: {
          type: "boolean",
          description: "Whether to use autoprompt for better results (default: true)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as ExaInput;
      const res = await fetch("https://api.exa.ai/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
        },
        body: JSON.stringify({
          query: i.query,
          numResults: i.numResults ?? 10,
          type: i.type ?? "neural",
          useAutoprompt: i.useAutoprompt ?? true,
        }),
      });
      if (!res.ok) throw new Error(`Exa Search API error: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}
