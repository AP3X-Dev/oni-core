import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../../swarm/registry.js";
import { toSwarmMermaid } from "../../swarm/mermaid.js";
import type { SwarmAgentDef } from "../../swarm/types.js";

// ---------------------------------------------------------------------------
// Regression test for BUG-0392
//
// toSwarmMermaid() embeds agent role and capability names inside Mermaid HTML
// labels. Without escaping, a role containing `<`, `>`, `&`, newlines, or `|`
// could inject arbitrary HTML into the diagram or break Mermaid's parser,
// enabling XSS when the diagram is rendered in a web UI.
//
// Fix: sanitize() in mermaid.ts escapes all five characters before
// interpolation. This test verifies the escaping is applied correctly.
// ---------------------------------------------------------------------------

function makeRegistry(
  id: string,
  role: string,
  capabilities: Array<{ name: string; description: string }> = [],
): AgentRegistry {
  const registry = new AgentRegistry();
  const def = {
    id,
    role,
    capabilities,
    skeleton: { run: async () => ({ messages: [] }) } as any,
  } as SwarmAgentDef;
  registry.register(def);
  return registry;
}

describe("BUG-0392: toSwarmMermaid sanitizes role and capability names", () => {
  it("escapes < and > in role names to prevent HTML injection", () => {
    const registry = makeRegistry(
      "agent1",
      "</b><img src=x onerror=alert(1)>",
    );
    const mermaid = toSwarmMermaid(registry);
    // The raw < and > characters must be escaped so the tag cannot parse
    expect(mermaid).not.toContain("<img");
    expect(mermaid).not.toContain("</b><img");
    expect(mermaid).toContain("&lt;");
    expect(mermaid).toContain("&gt;");
    // The full escaped form should be present
    expect(mermaid).toContain("&lt;/b&gt;&lt;img");
  });

  it("escapes & in role names to prevent HTML entity injection", () => {
    const registry = makeRegistry("agent2", "Research & Development");
    const mermaid = toSwarmMermaid(registry);
    expect(mermaid).not.toMatch(/Research & Development/);
    expect(mermaid).toContain("Research &amp; Development");
  });

  it("replaces newlines in role names to prevent Mermaid directive injection", () => {
    const registry = makeRegistry("agent3", "Worker\nclick agent3 alert(1)");
    const mermaid = toSwarmMermaid(registry);
    // Newline replaced with space — injected directive is on the same line
    expect(mermaid).not.toContain("\nclick");
    expect(mermaid).toContain("Worker click agent3 alert(1)");
  });

  it("escapes | in role names to prevent Mermaid pipe injection", () => {
    const registry = makeRegistry("agent4", "A|B");
    const mermaid = toSwarmMermaid(registry);
    expect(mermaid).not.toMatch(/\bA\|B\b/);
    expect(mermaid).toContain("A\\|B");
  });

  it("escapes < and > in capability names", () => {
    const registry = makeRegistry("agent5", "Safe Role", [
      { name: "<script>alert(1)</script>", description: "dangerous cap" },
    ]);
    const mermaid = toSwarmMermaid(registry);
    expect(mermaid).not.toContain("<script>");
    expect(mermaid).toContain("&lt;script&gt;");
  });

  it("escapes & in capability names", () => {
    const registry = makeRegistry("agent6", "Safe Role", [
      { name: "read & write", description: "rw cap" },
    ]);
    const mermaid = toSwarmMermaid(registry);
    expect(mermaid).not.toMatch(/read & write/);
    expect(mermaid).toContain("read &amp; write");
  });

  it("replaces newlines in capability names", () => {
    const registry = makeRegistry("agent7", "Safe Role", [
      { name: "cap\nclick agent7 evil()", description: "multiline cap" },
    ]);
    const mermaid = toSwarmMermaid(registry);
    expect(mermaid).not.toContain("\nclick");
  });

  it("preserves normal role and capability names unchanged", () => {
    const registry = makeRegistry("agent8", "Data Analyst", [
      { name: "analyze", description: "Analyze data" },
      { name: "visualize", description: "Chart data" },
    ]);
    const mermaid = toSwarmMermaid(registry);
    expect(mermaid).toContain("Data Analyst");
    expect(mermaid).toContain("analyze");
    expect(mermaid).toContain("visualize");
  });
});
