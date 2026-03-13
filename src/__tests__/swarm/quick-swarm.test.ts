import { describe, it, expect } from "vitest";
import {
  quickAgent, SwarmGraph, type BaseSwarmState,
} from "../../swarm/index.js";

describe("quickAgent() helper", () => {
  it("creates a working agent from just an id and function", async () => {
    const agent = quickAgent("greeter", async (state) => ({
      messages: [{ role: "assistant", content: `Hello: ${state.task}` }],
    }));

    expect(agent.id).toBe("greeter");
    expect(agent.role).toBe("greeter");
    expect(agent.capabilities).toEqual([]);
    expect(agent.skeleton).toBeDefined();

    // Should work in a pipeline
    const swarm = SwarmGraph.pipeline<BaseSwarmState>({ stages: [agent] });
    const app = swarm.compile();
    const result = await app.invoke({ task: "world" });

    expect(result.messages.some(
      (m: { content: string }) => m.content.includes("Hello: world"),
    )).toBe(true);
  });

  it("accepts optional role and capabilities overrides", async () => {
    const agent = quickAgent("researcher", async () => ({
      messages: [{ role: "assistant", content: "researched" }],
    }), {
      role: "Research Specialist",
      capabilities: [{ name: "web-search", description: "Search the web" }],
    });

    expect(agent.role).toBe("Research Specialist");
    expect(agent.capabilities.length).toBe(1);
    expect(agent.capabilities[0]!.name).toBe("web-search");
  });

  it("works in fanOut with multiple quick agents", async () => {
    const agents = [
      quickAgent("a", async () => ({
        messages: [{ role: "assistant", content: "A result" }],
      })),
      quickAgent("b", async () => ({
        messages: [{ role: "assistant", content: "B result" }],
      })),
    ];

    const swarm = SwarmGraph.fanOut<BaseSwarmState>({
      agents,
      reducer: (results) => ({
        done: true,
        messages: [{ role: "assistant", content: `Got ${Object.keys(results).length} results` }],
      }),
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "quick fanout" });

    expect(result.done).toBe(true);
    expect(Object.keys(result.agentResults).length).toBe(2);
  });
});
