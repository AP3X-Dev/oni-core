import { describe, it, expect, vi } from "vitest";
import { generateAgentCard } from "../card/generator.js";
import { A2AServer } from "../server/index.js";

// Suppress the "no apiKey" warning for tests that don't need auth
const silenceWarn = () => vi.spyOn(console, "warn").mockImplementation(() => {});

const REQUIRED_SECURITY_HEADERS: [string, string][] = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["content-security-policy", "default-src 'none'"],
];

function makeCard() {
  return generateAgentCard({
    name: "Security Header Test Agent",
    description: "Tests security headers",
    url: "http://test",
  });
}

describe("A2AServer security headers (BUG-0257)", () => {
  it("BUG-0257: includes security headers on a successful tasks/send response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = new A2AServer(makeCard(), async (message) => `echo:${message}`);
    const handler = server.requestHandler();

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

    for (const [header, value] of REQUIRED_SECURITY_HEADERS) {
      expect(
        res.headers.get(header),
        `Expected ${header}: ${value} on 200 response`,
      ).toBe(value);
    }
  });

  it("BUG-0257: includes security headers on agent-card GET response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = new A2AServer(makeCard(), async () => "ok");
    const handler = server.requestHandler();

    const req = new Request("http://test/.well-known/agent.json");
    const res = await handler(req);
    expect(res.status).toBe(200);

    for (const [header, value] of REQUIRED_SECURITY_HEADERS) {
      expect(
        res.headers.get(header),
        `Expected ${header}: ${value} on agent card response`,
      ).toBe(value);
    }
  });

  it("BUG-0257: includes security headers on 401 Unauthorized response", async () => {
    const server = new A2AServer(makeCard(), async () => "ok", {
      apiKey: "secret",
    });
    const handler = server.requestHandler();

    const req = new Request("http://test/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tasks/send", params: {} }),
    });

    const res = await handler(req);
    expect(res.status).toBe(401);

    for (const [header, value] of REQUIRED_SECURITY_HEADERS) {
      expect(
        res.headers.get(header),
        `Expected ${header}: ${value} on 401 response`,
      ).toBe(value);
    }
  });

  it("BUG-0257: includes security headers on 405 Method Not Allowed response", async () => {
    silenceWarn();
    const server = new A2AServer(makeCard(), async () => "ok");
    const handler = server.requestHandler();

    const req = new Request("http://test/", { method: "DELETE" });
    const res = await handler(req);
    expect(res.status).toBe(405);

    for (const [header, value] of REQUIRED_SECURITY_HEADERS) {
      expect(
        res.headers.get(header),
        `Expected ${header}: ${value} on 405 response`,
      ).toBe(value);
    }
  });
});
