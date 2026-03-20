import { describe, it, expect, vi } from "vitest";
import { generateAgentCard } from "../card/generator.js";
import { A2AServer } from "../server/index.js";

/**
 * Regression test for BUG-0285:
 * The SSE response path (tasks/sendSubscribe with Accept: text/event-stream)
 * calls createSSEResponse() directly without merging SECURITY_HEADERS, leaving
 * X-Content-Type-Options, X-Frame-Options, and Content-Security-Policy absent.
 * All other response paths in A2AServer include these headers.
 */

const REQUIRED_SECURITY_HEADERS: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["content-security-policy", "default-src 'none'"],
];

function makeStreamingCard() {
  return generateAgentCard({
    name: "SSE Security Header Test Agent",
    description: "Streaming agent for SSE security header test",
    url: "http://test",
    streaming: true,
  });
}

describe("A2AServer SSE security headers (BUG-0285)", () => {
  it("BUG-0285: SSE response includes required security headers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    async function* streamingHandler(): AsyncGenerator<string> {
      yield "hello";
      yield " world";
    }

    const server = new A2AServer(makeStreamingCard(), () => streamingHandler());
    const handler = server.requestHandler();

    const req = new Request("http://test/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/sendSubscribe",
        params: {
          id: "t-sse-1",
          message: { role: "user", parts: [{ type: "text", text: "stream me" }] },
        },
      }),
    });

    const res = await handler(req);

    // Verify SSE content-type so we know we hit the SSE path
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    for (const [header, value] of REQUIRED_SECURITY_HEADERS) {
      expect(
        res.headers.get(header),
        `Expected ${header}: ${value} on SSE response (BUG-0285: SSE path omits security headers)`,
      ).toBe(value);
    }
  });

  it("BUG-0285: non-SSE tasks/sendSubscribe response includes security headers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const server = new A2AServer(makeStreamingCard(), async () => "done");
    const handler = server.requestHandler();

    const req = new Request("http://test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/sendSubscribe",
        params: {
          id: "t-sse-2",
          message: { role: "user", parts: [{ type: "text", text: "no sse" }] },
        },
      }),
    });

    const res = await handler(req);
    // Non-SSE path returns JSON response — security headers should already be present
    for (const [header, value] of REQUIRED_SECURITY_HEADERS) {
      expect(
        res.headers.get(header),
        `Expected ${header}: ${value} on non-SSE tasks/sendSubscribe response`,
      ).toBe(value);
    }
  });
});
