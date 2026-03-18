import { describe, it, expect } from "vitest";
import { A2AServer } from "../server/index.js";
import { generateAgentCard } from "../card/generator.js";

describe("BUG-0077: A2A server rejects oversized request bodies", () => {
  it("BUG-0077: should return 413 when Content-Length exceeds 1MB", async () => {
    const card = generateAgentCard({
      name: "Test",
      description: "Test",
      url: "http://test",
    });
    const server = new A2AServer(card, async () => "ok");
    const handler = server.requestHandler();

    // Create a request with Content-Length claiming > 1MB
    const oversizedBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tasks/send", params: {} });
    const req = new Request("http://test/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(2 * 1024 * 1024), // 2MB
      },
      body: oversizedBody,
    });

    const res = await handler(req);
    expect(res.status).toBe(413);
    const data = await res.json() as { error: { message: string } };
    expect(data.error.message).toContain("too large");
  });

  it("BUG-0077: should return 413 when actual body text exceeds 1MB", async () => {
    const card = generateAgentCard({
      name: "Test",
      description: "Test",
      url: "http://test",
    });
    const server = new A2AServer(card, async () => "ok");
    const handler = server.requestHandler();

    // Create a request with body text > 1MB but no Content-Length header hint
    const largePayload = "x".repeat(1.5 * 1024 * 1024);
    const req = new Request("http://test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: largePayload,
    });

    const res = await handler(req);
    expect(res.status).toBe(413);
    const data = await res.json() as { error: { message: string } };
    expect(data.error.message).toContain("too large");
  });
});
