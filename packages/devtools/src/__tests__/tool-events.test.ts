import { describe, it, expect, afterEach } from "vitest";
import { startDevtools } from "../server.js";
import { createMockGraph, createMockRegistry, collectSSE } from "./helpers.js";
import type { DevtoolsServer } from "../types.js";

describe("devtools — tool registration SSE events", () => {
  let server: DevtoolsServer | undefined;

  afterEach(async () => {
    await server?.stop();
  });

  it("emits tool_registered event via SSE", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18930 });

    const eventsPromise = collectSSE(`${server.url}/stream`, 500);
    await new Promise((r) => setTimeout(r, 100));

    server.emitToolRegistered("search_web", "extensions/search.ts");

    const events = await eventsPromise;
    const regEvents = events.filter((e) => e.event === "tool_registered");

    expect(regEvents.length).toBeGreaterThanOrEqual(1);
    const data = regEvents[0].data as { name: string; source: string };
    expect(data.name).toBe("search_web");
    expect(data.source).toBe("extensions/search.ts");
  });

  it("emits tool_unregistered event via SSE", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18931 });

    const eventsPromise = collectSSE(`${server.url}/stream`, 500);
    await new Promise((r) => setTimeout(r, 100));

    server.emitToolUnregistered("search_web");

    const events = await eventsPromise;
    const unregEvents = events.filter((e) => e.event === "tool_unregistered");

    expect(unregEvents.length).toBeGreaterThanOrEqual(1);
    const data = unregEvents[0].data as { name: string };
    expect(data.name).toBe("search_web");
  });

  it("emits both register and unregister in sequence", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18932 });

    const eventsPromise = collectSSE(`${server.url}/stream`, 600);
    await new Promise((r) => setTimeout(r, 100));

    server.emitToolRegistered("temp_tool");
    await new Promise((r) => setTimeout(r, 50));
    server.emitToolUnregistered("temp_tool");

    const events = await eventsPromise;

    const regEvents = events.filter((e) => e.event === "tool_registered");
    const unregEvents = events.filter((e) => e.event === "tool_unregistered");

    expect(regEvents.length).toBeGreaterThanOrEqual(1);
    expect(unregEvents.length).toBeGreaterThanOrEqual(1);
  });
});
