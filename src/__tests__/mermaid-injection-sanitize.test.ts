import { describe, it, expect } from "vitest";
import { StateGraph, lastValue, START, END } from "../index.js";
import { toMermaidDetailed } from "../inspect.js";
import type { GraphDescriptor } from "../inspect.js";

/**
 * Regression tests for BUG-0294 and BUG-0295.
 *
 * BUG-0294: StateGraph.toMermaid() embeds raw node names without sanitization,
 *   enabling injection via crafted names containing newlines/Mermaid directives.
 *
 * BUG-0295: toMermaidDetailed() in inspect.ts has the same unsanitized
 *   interpolation for edge.from and edge.to.
 *
 * A properly fixed implementation must sanitize node IDs before interpolating
 * them into the Mermaid markup so that injected directives are not present in
 * the output.
 */

const INJECTED_DIRECTIVE = "style injected fill:#ff0000";
const INJECTED_CLICK = 'click node call alert("XSS")';

// Node name that contains a newline followed by a Mermaid style directive
const CRAFTED_NODE_ID = `node\n    ${INJECTED_DIRECTIVE}`;
// Node name that contains a Mermaid click directive
const CRAFTED_CLICK_NODE = `node\n    ${INJECTED_CLICK}`;

type S = { x: number };

function makeGraph() {
  return new StateGraph<S>({ channels: { x: lastValue(() => 0) } });
}

describe("StateGraph.toMermaid() node injection sanitization (BUG-0294)", () => {
  it("BUG-0294: crafted node ID containing newline should not inject Mermaid directives", () => {
    const g = makeGraph();
    g.addNode(CRAFTED_NODE_ID, (s) => s);
    g.addEdge(START, CRAFTED_NODE_ID);
    g.addEdge(CRAFTED_NODE_ID, END);

    const mermaid = g.toMermaid();

    // The injected directive must not appear as a separate directive line
    expect(mermaid).not.toContain(INJECTED_DIRECTIVE);
  });

  it("BUG-0294: crafted node ID containing Mermaid click directive should be escaped", () => {
    const g = makeGraph();
    g.addNode(CRAFTED_CLICK_NODE, (s) => s);
    g.addEdge(START, CRAFTED_CLICK_NODE);
    g.addEdge(CRAFTED_CLICK_NODE, END);

    const mermaid = g.toMermaid();

    expect(mermaid).not.toContain(INJECTED_CLICK);
  });

  it("BUG-0294: normal node names render correctly", () => {
    const g = makeGraph();
    g.addNode("step_one", (s) => s);
    g.addEdge(START, "step_one");
    g.addEdge("step_one", END);

    const mermaid = g.toMermaid();

    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain("step_one");
    expect(mermaid).toContain("__start__");
    expect(mermaid).toContain("__end__");
  });
});

describe("toMermaidDetailed() node injection sanitization (BUG-0295)", () => {
  function makeDescriptor(
    nodes: { id: string; isSubgraph?: boolean; hasRetry?: boolean }[],
    edges: GraphDescriptor["edges"],
  ): GraphDescriptor {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: "node" as const,
        hasRetry: n.hasRetry ?? false,
        isSubgraph: n.isSubgraph ?? false,
      })),
      edges,
      terminals: [],
      cycles: [],
      topoOrder: null,
    };
  }

  it("BUG-0295: crafted edge.from with newline should not inject Mermaid directives", () => {
    const descriptor = makeDescriptor(
      [{ id: CRAFTED_NODE_ID }, { id: "__end__" }],
      [{ type: "static", from: CRAFTED_NODE_ID, to: "__end__" }],
    );

    const mermaid = toMermaidDetailed(descriptor);

    expect(mermaid).not.toContain(INJECTED_DIRECTIVE);
  });

  it("BUG-0295: crafted edge.to with newline should not inject Mermaid directives", () => {
    const descriptor = makeDescriptor(
      [{ id: "__start__" }, { id: CRAFTED_NODE_ID }],
      [{ type: "static", from: "__start__", to: CRAFTED_NODE_ID }],
    );

    const mermaid = toMermaidDetailed(descriptor);

    expect(mermaid).not.toContain(INJECTED_DIRECTIVE);
  });

  it("BUG-0295: conditional edge with crafted target should not inject directives", () => {
    const descriptor = makeDescriptor(
      [{ id: "router" }, { id: CRAFTED_NODE_ID }],
      [
        {
          type: "conditional",
          from: "router",
          to: CRAFTED_NODE_ID,
          label: "go",
        },
      ],
    );

    const mermaid = toMermaidDetailed(descriptor);

    expect(mermaid).not.toContain(INJECTED_DIRECTIVE);
  });

  it("BUG-0295: normal descriptors render correctly", () => {
    const descriptor = makeDescriptor(
      [{ id: "__start__" }, { id: "step" }, { id: "__end__" }],
      [
        { type: "static", from: "__start__", to: "step" },
        { type: "static", from: "step", to: "__end__" },
      ],
    );

    const mermaid = toMermaidDetailed(descriptor);

    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain("step");
  });
});
