import { describe, it, expect } from "vitest";
import {
  SwarmGraph, quickAgent, type BaseSwarmState,
} from "../../swarm/index.js";

describe("Capability-based routing", () => {
  it("routes to the agent with the best capability match", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "capability",
        maxRounds: 2,
      },
      agents: [
        quickAgent("coder", async () => {
          invoked.push("coder");
          return { messages: [{ role: "assistant", content: "coded" }], done: true };
        }, {
          capabilities: [
            { name: "coding", description: "Write code" },
            { name: "debugging", description: "Debug code" },
          ],
        }),
        quickAgent("writer", async () => {
          invoked.push("writer");
          return { messages: [{ role: "assistant", content: "wrote" }], done: true };
        }, {
          capabilities: [
            { name: "writing", description: "Write prose" },
            { name: "editing", description: "Edit text" },
          ],
        }),
        quickAgent("researcher", async () => {
          invoked.push("researcher");
          return { messages: [{ role: "assistant", content: "researched" }], done: true };
        }, {
          capabilities: [
            { name: "research", description: "Research topics" },
            { name: "writing", description: "Write summaries" },
          ],
        }),
      ],
    });

    const app = swarm.compile();

    // Request coding capability — should route to "coder"
    const result = await app.invoke({
      task: "Fix the bug",
      context: { requiredCapabilities: ["coding"] },
    });

    expect(result.done).toBe(true);
    expect(invoked).toContain("coder");
    expect(invoked).not.toContain("writer");
  });

  it("picks agent with most overlapping capabilities when multiple match", async () => {
    const invoked: string[] = [];

    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "capability",
        maxRounds: 2,
      },
      agents: [
        quickAgent("generalist", async () => {
          invoked.push("generalist");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }, {
          capabilities: [
            { name: "writing", description: "Write" },
          ],
        }),
        quickAgent("specialist", async () => {
          invoked.push("specialist");
          return { messages: [{ role: "assistant", content: "done" }], done: true };
        }, {
          capabilities: [
            { name: "writing", description: "Write" },
            { name: "research", description: "Research" },
            { name: "analysis", description: "Analyze" },
          ],
        }),
      ],
    });

    const app = swarm.compile();

    // Request writing + research — specialist has both, generalist only has writing
    const result = await app.invoke({
      task: "Write a research paper",
      context: { requiredCapabilities: ["writing", "research"] },
    });

    expect(result.done).toBe(true);
    expect(invoked).toContain("specialist");
    expect(invoked).not.toContain("generalist");
  });

  it("returns END gracefully when no agent has matching capabilities", async () => {
    const swarm = SwarmGraph.hierarchical<BaseSwarmState>({
      supervisor: {
        strategy: "capability",
        maxRounds: 2,
      },
      agents: [
        quickAgent("painter", async () => ({
          messages: [{ role: "assistant", content: "painted" }],
          done: true,
        }), {
          capabilities: [
            { name: "painting", description: "Paint pictures" },
          ],
        }),
      ],
    });

    const app = swarm.compile();

    // Request "quantum-physics" — no agent has this capability
    const result = await app.invoke({
      task: "Explain quantum entanglement",
      context: { requiredCapabilities: ["quantum-physics"] },
    });

    // Should end gracefully without routing to painter
    // (supervisor goes to END when no match found)
    expect(result.done).toBeFalsy();
  });
});
