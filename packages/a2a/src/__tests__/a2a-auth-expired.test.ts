import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { A2AClient } from "../client/index.js";
import { A2AAuthExpiredError } from "../errors.js";

/**
 * BUG-0284: A2AClient has no mechanism to surface expired auth credentials.
 * OAuth2 tokens expire, causing generic 401 failures with no typed error.
 *
 * Fix: detect 401 responses and throw A2AAuthExpiredError so callers can
 * catch it specifically and trigger token refresh / retry logic.
 */

describe("BUG-0284: A2AClient throws A2AAuthExpiredError on 401", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mock401() {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );
  }

  function mock403() {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );
  }

  it("getCard throws A2AAuthExpiredError on 401", async () => {
    mock401();
    const client = new A2AClient({ baseUrl: "http://localhost:3001" });

    await expect(client.getCard()).rejects.toThrow(A2AAuthExpiredError);
    await expect(client.getCard()).rejects.toMatchObject({
      name: "A2AAuthExpiredError",
      statusCode: 401,
      url: "http://localhost:3001/.well-known/agent.json",
    });
  });

  it("sendTask throws A2AAuthExpiredError on 401", async () => {
    mock401();
    const client = new A2AClient({ baseUrl: "http://localhost:3001" });

    await expect(client.sendTask("hello")).rejects.toThrow(A2AAuthExpiredError);
    await expect(client.sendTask("hello")).rejects.toMatchObject({
      statusCode: 401,
      url: "http://localhost:3001",
    });
  });

  it("streamTask throws A2AAuthExpiredError on 401", async () => {
    mock401();
    const client = new A2AClient({ baseUrl: "http://localhost:3001" });

    const gen = client.streamTask("hello");
    await expect(gen.next()).rejects.toThrow(A2AAuthExpiredError);
  });

  it("A2AAuthExpiredError extends Error for backward compatibility", () => {
    const err = new A2AAuthExpiredError("test", "http://example.com");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(A2AAuthExpiredError);
    expect(err.name).toBe("A2AAuthExpiredError");
    expect(err.statusCode).toBe(401);
    expect(err.url).toBe("http://example.com");
  });

  it("non-401 errors still throw generic Error (e.g. 403)", async () => {
    mock403();
    const client = new A2AClient({ baseUrl: "http://localhost:3001" });

    await expect(client.sendTask("hello")).rejects.toThrow(Error);
    await expect(client.sendTask("hello")).rejects.not.toThrow(A2AAuthExpiredError);
  });
});
