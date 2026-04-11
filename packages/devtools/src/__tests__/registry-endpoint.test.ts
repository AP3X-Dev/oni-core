import { describe, it, expect, afterEach } from "vitest";
import { startDevtools } from "../server.js";
import { createMockGraph, createMockRegistry, fetchJSON } from "./helpers.js";
import type { DevtoolsServer } from "../types.js";

describe("devtools — /registry endpoint", () => {
  let server: DevtoolsServer | undefined;

  afterEach(async () => {
    await server?.stop();
  });

  it("returns empty tools array when registry is empty", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18910 });

    const data = await fetchJSON(`${server.url}/registry`) as { tools: unknown[] };
    expect(data.tools).toEqual([]);
  });

  it("returns registered tools with name, description, and schema", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();
    registry.register("read_file", "Read a file from disk");
    registry.register("write_file", "Write content to a file");

    server = await startDevtools({ graph, registry, port: 18911 });

    const data = await fetchJSON(`${server.url}/registry`) as {
      tools: Array<{ name: string; description: string; schema: unknown }>;
    };

    expect(data.tools).toHaveLength(2);
    const names = data.tools.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");

    const readFile = data.tools.find((t) => t.name === "read_file")!;
    expect(readFile.description).toBe("Read a file from disk");
    expect(readFile.schema).toBeDefined();
  });

  it("reflects live registry changes on subsequent requests", async () => {
    const graph = createMockGraph();
    const registry = createMockRegistry();

    server = await startDevtools({ graph, registry, port: 18912 });

    // Initially empty
    const before = await fetchJSON(`${server.url}/registry`) as { tools: unknown[] };
    expect(before.tools).toHaveLength(0);

    // Register a tool
    registry.register("new_tool", "A new tool");

    const after = await fetchJSON(`${server.url}/registry`) as { tools: unknown[] };
    expect(after.tools).toHaveLength(1);

    // Unregister
    registry.unregister("new_tool");

    const final = await fetchJSON(`${server.url}/registry`) as { tools: unknown[] };
    expect(final.tools).toHaveLength(0);
  });
});
