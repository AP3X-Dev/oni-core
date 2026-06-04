import { describe, expect, it } from "vitest";
import { END, START, type Edge } from "../types.js";
import { buildGraphDescriptor, toMermaidDetailed } from "../inspect.js";

describe("graph inspection", () => {
  it("builds node metadata, static edges, terminals, and topo order", () => {
    const nodes = new Map([
      ["agent", { name: "agent", retry: { maxAttempts: 2 } }],
      ["final", { name: "final", subgraph: {} }],
    ]);
    const edges: Edge<Record<string, unknown>>[] = [
      { type: "static", from: START, to: "agent" },
      { type: "static", from: "agent", to: END },
    ];

    const descriptor = buildGraphDescriptor(nodes, edges);

    expect(descriptor.nodes).toEqual(expect.arrayContaining([
      { id: START, type: "start", hasRetry: false, isSubgraph: false },
      { id: END, type: "end", hasRetry: false, isSubgraph: false },
      { id: "agent", type: "node", hasRetry: true, isSubgraph: false },
      { id: "final", type: "subgraph", hasRetry: false, isSubgraph: true },
    ]));
    expect(descriptor.edges).toEqual([
      { from: START, to: "agent", type: "static" },
      { from: "agent", to: END, type: "static" },
    ]);
    expect(descriptor.terminals).toEqual(["final"]);
    expect(descriptor.cycles).toEqual([]);
    expect(descriptor.topoOrder).toEqual(expect.arrayContaining([START, "agent", "final", END]));
  });

  it("expands conditional path maps and reports cycles", () => {
    const nodes = new Map([
      ["router", { name: "router" }],
      ["worker", { name: "worker" }],
    ]);
    const edges: Edge<Record<string, unknown>>[] = [
      { type: "static", from: START, to: "router" },
      {
        type: "conditional",
        from: "router",
        condition: () => "worker",
        pathMap: { work: "worker", done: END },
      },
      { type: "static", from: "worker", to: "router" },
    ];

    const descriptor = buildGraphDescriptor(nodes, edges);

    expect(descriptor.edges).toEqual(expect.arrayContaining([
      { from: "router", to: "worker", type: "conditional", label: "condition" },
      { from: "router", to: END, type: "conditional", label: "condition" },
    ]));
    expect(descriptor.cycles).toEqual([["router", "worker"]]);
    expect(descriptor.topoOrder).toBeNull();
  });

  it("keeps unknown conditional targets conservative without false cycles", () => {
    const nodes = new Map([["router", { name: "router" }]]);
    const edges: Edge<Record<string, unknown>>[] = [
      { type: "static", from: START, to: "router" },
      { type: "conditional", from: "router", condition: () => END },
    ];

    const descriptor = buildGraphDescriptor(nodes, edges);

    expect(descriptor.edges).toContainEqual({
      from: "router",
      to: "conditional",
      type: "conditional",
      label: "condition",
    });
    expect(descriptor.cycles).toEqual([]);
    expect(descriptor.topoOrder).not.toBeNull();
  });

  it("renders sanitized Mermaid with conditional router styling", () => {
    const mermaid = toMermaidDetailed({
      nodes: [
        { id: START, type: "start", hasRetry: false, isSubgraph: false },
        { id: "worker\nclick evil", type: "node", hasRetry: true, isSubgraph: false },
        { id: END, type: "end", hasRetry: false, isSubgraph: false },
      ],
      edges: [
        { from: START, to: "worker\nclick evil", type: "static" },
        { from: "worker\nclick evil", to: END, type: "conditional", label: "ok" },
      ],
      terminals: [],
      cycles: [],
      topoOrder: [START, "worker\nclick evil", END],
    });

    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain("__start__ --> worker_click evil");
    expect(mermaid).toContain("worker_click evil -->|ok| worker_click evil_router");
    expect(mermaid).toContain("classDef conditional");
    expect(mermaid).not.toContain("\nclick");
  });
});
