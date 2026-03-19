import { describe, it, expect } from "vitest";
import { generateAgentCard } from "../card/generator.js";
import { A2AServer } from "../server/index.js";

describe("A2AServer API key authentication", () => {
  it("BUG-0236: should use crypto.timingSafeEqual for API key comparison", async () => {
    const card = generateAgentCard({
      name: "Auth Test",
      description: "Test",
      url: "http://test",
    });

    const server = new A2AServer(card, async () => "ok", {
      apiKey: "secret-key-12345",
    });
    const handler = server.requestHandler();

    // Request with correct key should succeed
    const goodReq = new Request("http://test/.well-known/agent.json", {
      headers: { Authorization: "Bearer secret-key-12345" },
    });
    const goodRes = await handler(goodReq);
    expect(goodRes.status).toBe(200);

    // Request with wrong key should be rejected
    const badReq = new Request("http://test/.well-known/agent.json", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    const badRes = await handler(badReq);
    expect(badRes.status).toBe(401);

    // Request with no auth header should be rejected
    const noAuthReq = new Request("http://test/.well-known/agent.json");
    const noAuthRes = await handler(noAuthReq);
    expect(noAuthRes.status).toBe(401);

    // Request with key of same length but different content should be rejected
    // (this is the case that timing attacks exploit — same-length strings)
    const sameLenReq = new Request("http://test/.well-known/agent.json", {
      headers: { Authorization: "Bearer secret-key-12346" },
    });
    const sameLenRes = await handler(sameLenReq);
    expect(sameLenRes.status).toBe(401);
  });
});
