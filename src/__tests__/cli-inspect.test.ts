import { describe, it, expect } from "vitest";
import { formatGraphTable } from "../cli/inspect.js";
import type { GraphDescriptor } from "../inspect.js";

describe("oni inspect", () => {
  const descriptor: GraphDescriptor = {
    nodes: [
      { id: "__start__", type: "start", hasRetry: false, isSubgraph: false },
      { id: "agent", type: "node", hasRetry: false, isSubgraph: false },
      { id: "__end__", type: "end", hasRetry: false, isSubgraph: false },
    ],
    edges: [
      { from: "__start__", to: "agent", type: "static" },
      { from: "agent", to: "__end__", type: "static" },
    ],
    terminals: ["__end__"],
    cycles: [],
    topoOrder: ["__start__", "agent", "__end__"],
  };

  describe("formatGraphTable", () => {
    it("includes all node names", () => {
      const table = formatGraphTable(descriptor);
      expect(table).toContain("agent");
      expect(table).toContain("__start__");
      expect(table).toContain("__end__");
    });

    it("shows edge connections", () => {
      const table = formatGraphTable(descriptor);
      expect(table).toContain("__start__");
      expect(table).toContain("agent");
    });

    it("shows cycle info when no cycles", () => {
      const table = formatGraphTable(descriptor);
      expect(table).toContain("No cycles");
    });

    it("shows topological order", () => {
      const table = formatGraphTable(descriptor);
      expect(table).toContain("Topological Order");
    });

    it("shows terminal nodes", () => {
      const table = formatGraphTable(descriptor);
      expect(table).toContain("__end__");
    });
  });
});
