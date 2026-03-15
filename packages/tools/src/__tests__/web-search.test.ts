import { describe, it, expect, vi, beforeEach } from "vitest";
import { tavilySearch } from "../web-search/tavily.js";
import { braveSearch } from "../web-search/brave.js";
import { exaSearch } from "../web-search/exa.js";
import type { ToolContext } from "../types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ctx = {} as ToolContext;

describe("tavilySearch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns a ToolDefinition with correct shape", () => {
    const tool = tavilySearch({ apiKey: "test-key" });
    expect(tool.name).toBe("tavily_search");
    expect(tool.schema.type).toBe("object");
    expect(tool.parallelSafe).toBe(true);
    expect(typeof tool.execute).toBe("function");
  });

  it("has required query in schema", () => {
    const tool = tavilySearch({ apiKey: "test-key" });
    expect(tool.schema.required).toContain("query");
  });

  it("calls Tavily API with correct payload", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const tool = tavilySearch({ apiKey: "test-key" });
    await tool.execute({ query: "test query" }, ctx);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" })
    );
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(callBody.api_key).toBe("test-key");
    expect(callBody.query).toBe("test query");
  });

  it("uses default max_results of 5", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const tool = tavilySearch({ apiKey: "test-key" });
    await tool.execute({ query: "test" }, ctx);
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(callBody.max_results).toBe(5);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: async () => "Unauthorized" });
    const tool = tavilySearch({ apiKey: "bad-key" });
    await expect(tool.execute({ query: "test" }, ctx)).rejects.toThrow("Tavily API error: 401");
  });
});

describe("braveSearch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns a ToolDefinition with correct shape", () => {
    const tool = braveSearch({ apiKey: "test-key" });
    expect(tool.name).toBe("brave_search");
    expect(tool.schema.type).toBe("object");
    expect(tool.parallelSafe).toBe(true);
    expect(typeof tool.execute).toBe("function");
  });

  it("has required query in schema", () => {
    const tool = braveSearch({ apiKey: "test-key" });
    expect(tool.schema.required).toContain("query");
  });

  it("calls Brave Search API with correct endpoint and auth", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ web: { results: [] } }) });
    const tool = braveSearch({ apiKey: "brave-key" });
    await tool.execute({ query: "test query" }, ctx);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("https://api.search.brave.com/res/v1/web/search"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Subscription-Token": "brave-key" }),
      })
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => "Rate limited" });
    const tool = braveSearch({ apiKey: "test-key" });
    await expect(tool.execute({ query: "test" }, ctx)).rejects.toThrow("Brave Search API error: 429");
  });
});

describe("exaSearch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns a ToolDefinition with correct shape", () => {
    const tool = exaSearch({ apiKey: "test-key" });
    expect(tool.name).toBe("exa_search");
    expect(tool.schema.type).toBe("object");
    expect(tool.parallelSafe).toBe(true);
    expect(typeof tool.execute).toBe("function");
  });

  it("has required query in schema", () => {
    const tool = exaSearch({ apiKey: "test-key" });
    expect(tool.schema.required).toContain("query");
  });

  it("calls Exa API with correct endpoint and auth header", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const tool = exaSearch({ apiKey: "exa-key" });
    await tool.execute({ query: "test query" }, ctx);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.exa.ai/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "exa-key" }),
      })
    );
  });

  it("sends correct body with defaults", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const tool = exaSearch({ apiKey: "exa-key" });
    await tool.execute({ query: "test" }, ctx);
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(callBody.type).toBe("neural");
    expect(callBody.useAutoprompt).toBe(true);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "Internal error" });
    const tool = exaSearch({ apiKey: "test-key" });
    await expect(tool.execute({ query: "test" }, ctx)).rejects.toThrow("Exa Search API error: 500");
  });
});
