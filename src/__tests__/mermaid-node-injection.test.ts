import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";

/**
 * Regression test for BUG-0292:
 * StateGraph.toMermaid() embeds node IDs directly into Mermaid markup without
 * sanitization. A crafted node name containing newlines with embedded Mermaid
 * directives produces injection that could render as XSS in web UIs.
 *
 * Identical issue exists in buildSwarmExtensions().toMermaid() in
 * src/swarm/compile-ext.ts which uses the same raw string interpolation.
 */
describe("StateGraph.toMermaid() node ID injection (BUG-0292)", () => {
  it("BUG-0292: crafted node ID containing newline should not inject Mermaid directives", () => {
    type S = { value: string };
    const g = new StateGraph<S>({ value: lastValue });

    const injectedName = "safe_agent\nstyle safe_agent fill:#ff0000\ninjected_directive";

    g.addNode(injectedName, (s) => s);
    g.addEdge(START, injectedName);
    g.addEdge(injectedName, END);

    const diagram = g.toMermaid();

    // The raw injected newline must not appear in the diagram output,
    // or the injection must be escaped/sanitized so it cannot form a new line.
    // A bare newline in the node name allows arbitrary Mermaid statements to be
    // injected into the diagram.
    expect(
      diagram,
      "BUG-0292: toMermaid() must not embed literal newlines from node names",
    ).not.toContain("\nstyle safe_agent fill:#ff0000");

    expect(
      diagram,
      "BUG-0292: toMermaid() must not embed injected_directive as a separate Mermaid line",
    ).not.toContain("\ninjected_directive");
  });

  it("BUG-0292: crafted node ID containing Mermaid click directive should be escaped", () => {
    type S = { value: string };
    const g = new StateGraph<S>({ value: lastValue });

    // click directives in Mermaid can trigger JavaScript execution in some renderers
    const xssName = 'agent_a\nclick agent_a call alert("XSS")';

    g.addNode(xssName, (s) => s);
    g.addEdge(START, xssName);
    g.addEdge(xssName, END);

    const diagram = g.toMermaid();

    expect(
      diagram,
      'BUG-0292: toMermaid() must not embed raw "click" Mermaid directives from node names',
    ).not.toContain('\nclick agent_a call alert("XSS")');
  });
});
