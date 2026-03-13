import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue, NodeNotFoundError } from "../index.js";

type S = { value: string };
const channels = { value: lastValue(() => "") };

describe("graph validate() — conditional edge validation", () => {
  it("throws NodeNotFoundError when conditional edge 'from' node does not exist", () => {
    const g = new StateGraph<S>({ channels });
    g.addNode("a", async () => ({ value: "a" }));
    g.addEdge(START, "a");
    // Conditional edge from a node that doesn't exist
    g.addConditionalEdges("nonexistent", () => END);
    g.addEdge("a", END);

    expect(() => g.compile()).toThrow(NodeNotFoundError);
  });

  it("accepts conditional edge from a valid node", () => {
    const g = new StateGraph<S>({ channels });
    g.addNode("a", async () => ({ value: "a" }));
    g.addEdge(START, "a");
    g.addConditionalEdges("a", () => END);

    expect(() => g.compile()).not.toThrow();
  });

  it("accepts conditional edge from START", () => {
    const g = new StateGraph<S>({ channels });
    g.addNode("a", async () => ({ value: "a" }));
    g.addNode("b", async () => ({ value: "b" }));
    g.addConditionalEdges(START, (s) => (s.value === "go" ? "a" : "b"));
    g.addEdge("a", END);
    g.addEdge("b", END);

    expect(() => g.compile()).not.toThrow();
  });

  it("error message includes the missing node name", () => {
    const g = new StateGraph<S>({ channels });
    g.addNode("a", async () => ({ value: "a" }));
    g.addEdge(START, "a");
    g.addConditionalEdges("ghost_node", () => END);
    g.addEdge("a", END);

    expect(() => g.compile()).toThrow(/ghost_node/);
  });
});
