import { describe, it, expect, afterEach } from "vitest";
import { startDevtools } from "../server.js";
import { createMockGraph, createMockRegistry, fetchJSON } from "./helpers.js";
import type { DevtoolsServer } from "../types.js";

describe("devtools — server start", () => {
  let server: DevtoolsServer | undefined;

  afterEach(async () => {
    await server?.stop();
  });

  it("starts on the specified port and serves /graph", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 0 });
    // port: 0 isn't supported by our simple impl, use a fixed high port
    await server.stop();

    server = await startDevtools({ graph, registry, port: 18901 });
    expect(server.url).toBe("http://localhost:18901");

    const data = await fetchJSON(`${server.url}/graph`) as { nodes: unknown[]; edges: unknown[] };
    expect(data.nodes).toBeInstanceOf(Array);
    expect(data.edges).toBeInstanceOf(Array);
    expect(data.nodes.length).toBe(4);
  });

  it("/graph returns correct node and edge structure", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18902 });

    const data = await fetchJSON(`${server.url}/graph`) as {
      nodes: Array<{ id: string; type: string }>;
      edges: Array<{ from: string; to: string; condition?: string }>;
    };

    const nodeIds = data.nodes.map((n) => n.id);
    expect(nodeIds).toContain("__start__");
    expect(nodeIds).toContain("llm_call");
    expect(nodeIds).toContain("tool_executor");
    expect(nodeIds).toContain("__end__");

    const conditionalEdge = data.edges.find((e) => e.condition === "has_tools");
    expect(conditionalEdge).toBeDefined();
    expect(conditionalEdge!.from).toBe("llm_call");
    expect(conditionalEdge!.to).toBe("tool_executor");
  });

  it("/runs returns empty array initially", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18903 });

    const data = await fetchJSON(`${server.url}/runs`) as unknown[];
    expect(data).toEqual([]);
  });

  it("returns 404 for unknown routes", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18904 });

    const res = await fetch(`${server.url}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("/ serves the HTML UI", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18905 });

    const res = await fetch(server.url);
    expect(res.headers.get("content-type")).toBe("text/html");
    const html = await res.text();
    expect(html).toContain("ONI Devtools");
  });
});
