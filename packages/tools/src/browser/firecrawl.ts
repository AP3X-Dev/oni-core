import type { ToolDefinition, ToolContext } from "../types.js";

interface FirecrawlInput {
  url: string;
  formats?: ("markdown" | "html")[];
  onlyMainContent?: boolean;
}

/**
 * Validate that a URL is safe to send to Firecrawl.
 * Rejects non-http(s) schemes, private/reserved IPs, and localhost.
 */
function validateUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  // 1. Scheme must be http or https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" — only http: and https: are allowed`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Reject localhost and IPv6 loopback
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    throw new Error("URLs pointing to localhost are not allowed");
  }

  // 3. Reject private/reserved IPv4 ranges
  //    127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 127 ||                          // 127.0.0.0/8  loopback
      a === 10 ||                           // 10.0.0.0/8   private
      (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12 private
      (a === 192 && b === 168) ||           // 192.168.0.0/16 private
      (a === 169 && b === 254) ||           // 169.254.0.0/16 link-local
      a === 0                               // 0.0.0.0
    ) {
      throw new Error(`URL points to a private/reserved IP address: ${hostname}`);
    }
  }

  // 4. Reject bracketed IPv6 private/reserved addresses
  if (hostname.startsWith("[")) {
    const inner = hostname.slice(1, -1).toLowerCase();
    if (
      inner === "::1" ||
      inner.startsWith("fc") ||
      inner.startsWith("fd") ||
      inner.startsWith("fe80")
    ) {
      throw new Error(`URL points to a private/reserved IPv6 address: ${hostname}`);
    }
  }
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
      validateUrl(i.url);
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
            includeMarkdown: (i.formats ?? ["markdown"]).includes("markdown"),
            onlyMainContent: i.onlyMainContent ?? true,
          },
        }),
      });
      if (!res.ok) {
        console.error(`[firecrawl] API error ${res.status} ${res.statusText}`);
        throw new Error(`Firecrawl API error: ${res.status} ${res.statusText}`);
      }
      try {
        return await res.json();
      } catch {
        throw new Error(`firecrawl_scrape: invalid JSON response from https://api.firecrawl.dev/v0/scrape`);
      }
    },
  };
}
