import { describe, it, expect, vi, beforeEach } from "vitest";
import { tavilySearch } from "../web-search/tavily.js";
import type { ToolContext } from "../types.js";

// BUG-0026 regression: Tavily API key must be sent in Authorization: Bearer header,
// not in the request body. All other search tools use header-based auth.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ctx = {} as ToolContext;

describe("tavilySearch BUG-0026: API key in Authorization header, not body", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("BUG-0026: sends API key as Authorization Bearer header", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const tool = tavilySearch({ apiKey: "tvly-secret-key" });
    await tool.execute({ query: "test" }, ctx);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tvly-secret-key");
  });

  it("BUG-0026: does not include api_key in request body", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const tool = tavilySearch({ apiKey: "tvly-secret-key" });
    await tool.execute({ query: "test" }, ctx);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["api_key"]).toBeUndefined();
  });
});
