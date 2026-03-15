import type { ToolDefinition, ToolContext } from "../types.js";

interface FirecrawlInput {
  url: string;
  formats?: ("markdown" | "html")[];
  onlyMainContent?: boolean;
}

export function firecrawlScrape(config: { apiKey: string }): ToolDefinition {
  return {
    name: "firecrawl_scrape",
    description: "Scrape and extract content from a webpage using Firecrawl",
    schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to scrape" },
        formats: {
          type: "array",
          items: { type: "string", enum: ["markdown", "html"] },
          description: "Output formats (default: ['markdown'])",
        },
        onlyMainContent: {
          type: "boolean",
          description: "Extract only main content, excluding navigation/footer (default: true)",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    parallelSafe: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as FirecrawlInput;
      const res = await fetch("https://api.firecrawl.dev/v0/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          url: i.url,
          pageOptions: {
            includeHtml: (i.formats ?? ["markdown"]).includes("html"),
            onlyMainContent: i.onlyMainContent ?? true,
          },
        }),
      });
      if (!res.ok) throw new Error(`Firecrawl API error: ${res.status} ${await res.text()}`);
      return res.json();
    },
  };
}
