import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, appendList, Send } from "../../src/index.js";

describe("Map-reduce Send", () => {
  it("executes each Send as a separate parallel invocation", async () => {
    type S = { topics: string[]; results: string[] };
    const g = new StateGraph<S>({
      channels: {
        topics: lastValue(() => [] as string[]),
        results: appendList(() => [] as string[]),
      },
    });

    // Fan-out: generate sends for each topic
    g.addNode("router", async (state) => {
      // Will be routed via conditional edges returning Send[]
      return {};
    });
    g.addConditionalEdges("router", (state) => {
      return state.topics.map(t => new Send("analyzer", { topics: [t] }));
    });

    // Each analyzer instance processes one topic
    const callLog: string[] = [];
    g.addNode("analyzer", async (state) => {
      const topic = state.topics[0] ?? "unknown";
      callLog.push(topic);
      return { results: [`analyzed:${topic}`] };
    });
    g.addEdge("analyzer", END);

    g.addEdge(START, "router");

    const app = g.compile();
    const result = await app.invoke({ topics: ["A", "B", "C"], results: [] });

    // Each topic should have been processed separately
    expect(callLog.sort()).toEqual(["A", "B", "C"]);
    // Results should be collected via appendList reducer
    expect(result.results.sort()).toEqual(["analyzed:A", "analyzed:B", "analyzed:C"]);
  });

  it("single Send works like before", async () => {
    type S = { value: string; output: string };
    const g = new StateGraph<S>({
      channels: {
        value: lastValue(() => ""),
        output: lastValue(() => ""),
      },
    });

    g.addNode("start", async () => ({}));
    g.addConditionalEdges("start", () => new Send("worker", { value: "x" }));
    g.addNode("worker", async (state) => ({ output: `got:${state.value}` }));
    g.addEdge("worker", END);
    g.addEdge(START, "start");

    const app = g.compile();
    const result = await app.invoke({ value: "init", output: "" });
    expect(result.output).toBe("got:x");
  });

  it("multiple sends to same node create separate executions", async () => {
    type S = { input: string; collected: string[] };
    const g = new StateGraph<S>({
      channels: {
        input: lastValue(() => ""),
        collected: appendList(() => [] as string[]),
      },
    });

    const executions: string[] = [];
    g.addNode("fan-out", async () => ({}));
    g.addConditionalEdges("fan-out", () => [
      new Send("worker", { input: "one" }),
      new Send("worker", { input: "two" }),
      new Send("worker", { input: "three" }),
    ]);

    g.addNode("worker", async (state) => {
      executions.push(state.input);
      return { collected: [`result:${state.input}`] };
    });
    g.addEdge("worker", END);
    g.addEdge(START, "fan-out");

    const app = g.compile();
    const result = await app.invoke({ input: "", collected: [] });

    // Should have 3 separate executions
    expect(executions.length).toBe(3);
    expect(executions.sort()).toEqual(["one", "three", "two"]);
    // Results collected via appendList
    expect(result.collected.sort()).toEqual(["result:one", "result:three", "result:two"]);
  });
});
