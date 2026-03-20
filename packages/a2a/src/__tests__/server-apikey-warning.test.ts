import { describe, it, expect, vi, afterEach } from "vitest";
import { generateAgentCard } from "../card/generator.js";
import { A2AServer } from "../server/index.js";

describe("A2AServer unauthenticated deployment warning (BUG-0256)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("BUG-0256: logs a warning to console.warn when no apiKey is configured", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const card = generateAgentCard({
      name: "Open Agent",
      description: "No auth",
      url: "http://test",
    });

    new A2AServer(card, async () => "ok");

    expect(warnSpy).toHaveBeenCalledOnce();
    const [msg] = warnSpy.mock.calls[0]!;
    expect(typeof msg).toBe("string");
    expect((msg as string).toLowerCase()).toContain("unauthenticated");
  });

  it("BUG-0256: does NOT log a warning when apiKey is provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const card = generateAgentCard({
      name: "Secure Agent",
      description: "With auth",
      url: "http://test",
    });

    new A2AServer(card, async () => "ok", { apiKey: "my-secret-key" });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("BUG-0256: unauthenticated server still handles requests (no regression)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const card = generateAgentCard({
      name: "Open Agent",
      description: "No auth",
      url: "http://test",
    });

    const server = new A2AServer(card, async (message) => `echo:${message}`);
    const handler = server.requestHandler();

    // Without apiKey, requests should be served with no auth gate
    const req = new Request("http://test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/send",
        params: {
          id: "t1",
          message: { role: "user", parts: [{ type: "text", text: "hello" }] },
        },
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
  });
});
