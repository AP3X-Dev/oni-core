import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, appendList } from "../../src/index.js";
import { createInjectedTool } from "../../src/injected.js";
import { InMemoryStore } from "../../src/store/index.js";

describe("createInjectedTool", () => {
  it("injects state and store into tool function", async () => {
    type S = { messages: any[]; result: string };

    const store = new InMemoryStore();
    await store.put(["cache"], "key1", "cached-value");

    const myTool = createInjectedTool<S, { query: string }>({
      name: "my_tool",
      description: "A tool that reads state and store",
      schema: { query: { type: "string" } },
      fn: async (args, { state, store: s }) => {
        const cached = await s?.get<string>(["cache"], "key1");
        return `query=${args.query} messages=${state.messages.length} cached=${cached?.value}`;
      },
    });

    expect(myTool.name).toBe("my_tool");
    expect(myTool.description).toBe("A tool that reads state and store");
    // Schema should NOT include state/store
    expect(myTool.schema).toEqual({ query: { type: "string" } });

    // Build a graph that uses this tool via a node
    const g = new StateGraph<S>({
      channels: {
        messages: appendList(() => []),
        result: lastValue(() => ""),
      },
    });

    g.addNode("tool-runner", async (state) => {
      // Simulate calling the tool (in real usage, createToolNode would call this)
      const output = await myTool.fn({ query: "hello" });
      return { result: String(output) };
    });
    g.addEdge(START, "tool-runner");
    g.addEdge("tool-runner", END);

    const app = g.compile({ store });
    const result = await app.invoke({ messages: [{ role: "user", content: "hi" }], result: "" });
    expect(result.result).toBe("query=hello messages=1 cached=cached-value");
  });

  it("works without store", async () => {
    type S = { count: number };

    const myTool = createInjectedTool<S, { x: number }>({
      name: "counter",
      description: "reads count from state",
      schema: { x: { type: "number" } },
      fn: async (args, { state }) => {
        return state.count + args.x;
      },
    });

    const g = new StateGraph<S>({
      channels: { count: lastValue(() => 0) },
    });
    g.addNode("run", async () => {
      const val = await myTool.fn({ x: 5 });
      return { count: val as number };
    });
    g.addEdge(START, "run");
    g.addEdge("run", END);

    const app = g.compile();
    const result = await app.invoke({ count: 10 });
    expect(result.count).toBe(15);
  });
});
