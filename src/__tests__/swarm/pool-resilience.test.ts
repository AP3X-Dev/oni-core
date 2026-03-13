import { describe, it, expect } from "vitest";
import { AgentPool } from "../../swarm/pool.js";
import { quickAgent, type BaseSwarmState } from "../../swarm/index.js";

describe("AgentPool resilience", () => {
  it("retries failed invocations using agent maxRetries", async () => {
    let calls = 0;

    const agent = quickAgent("flaky", async () => {
      calls++;
      if (calls <= 2) throw new Error(`fail #${calls}`);
      return { messages: [{ role: "assistant", content: "ok" }], done: true };
    }, { maxRetries: 2 });

    const pool = new AgentPool<BaseSwarmState>([agent]);
    const result = await pool.invoke({ task: "retry test" } as Partial<BaseSwarmState>);

    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(result.done).toBe(true);
  });

  it("respects agent timeout and rejects on expiry", async () => {
    const agent = quickAgent("slow", async () => {
      await new Promise((r) => setTimeout(r, 500));
      return { messages: [{ role: "assistant", content: "late" }], done: true };
    }, { timeout: 50, maxRetries: 0 });

    const pool = new AgentPool<BaseSwarmState>([agent]);

    await expect(
      pool.invoke({ task: "timeout test" } as Partial<BaseSwarmState>),
    ).rejects.toThrow(/timed out/);
  });

  it("fires lifecycle hooks (onStart, onComplete, onError)", async () => {
    const events: string[] = [];
    let calls = 0;

    const agent = quickAgent("hooked", async () => {
      calls++;
      if (calls === 1) throw new Error("first fail");
      return { messages: [{ role: "assistant", content: "ok" }], done: true };
    }, { maxRetries: 1 });

    // Attach hooks manually
    agent.hooks = {
      onStart:    (id) => { events.push(`start:${id}`); },
      onComplete: (id) => { events.push(`complete:${id}`); },
      onError:    (id) => { events.push(`error:${id}`); },
    };

    const pool = new AgentPool<BaseSwarmState>([agent]);
    await pool.invoke({ task: "hooks test" } as Partial<BaseSwarmState>);

    expect(events).toContain("start:hooked");
    expect(events).toContain("complete:hooked");
    // onError should NOT fire because the retry succeeded
    expect(events).not.toContain("error:hooked");
  });
});
