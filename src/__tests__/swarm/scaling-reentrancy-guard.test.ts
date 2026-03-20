import { describe, it, expect } from "vitest";
import { SwarmTracer } from "../../swarm/tracer.js";
import { DynamicScalingMonitor, type ScalingDecision } from "../../swarm/scaling.js";

describe("DynamicScalingMonitor reactive re-entrancy guard", () => {
  it("BUG-0249: re-entrant tracer.record() inside a callback does not produce duplicate scale decisions", () => {
    let t = 0;
    const clockFn = () => t;

    const tracer = new SwarmTracer();
    const monitor = new DynamicScalingMonitor(tracer, {
      minAgents: 1,
      maxAgents: 10,
      scaleUpErrorRate: 0.1, // low threshold so errors trigger scale-up easily
      cooldownMs: 0, // no cooldown so each evaluate() can fire
      clockFn,
    });

    monitor.setCurrentAgentCount(4);

    const decisions: ScalingDecision[] = [];

    // Register a callback that re-entrantly records another error event
    // via tracer.record(), which would call all tracer subscribers synchronously.
    // Without the re-entrancy guard this would cause a second evaluate() to run
    // before the first one's recordDecision() has updated lastDecisionTime,
    // resulting in two scale-up decisions for a single trigger event.
    monitor.onScaleDecision((decision) => {
      decisions.push(decision);
      // Re-entrant: fire another error event from inside the callback
      t += 1; // advance clock so cooldown wouldn't block on its own
      tracer.record({ type: "agent_error", agentId: "a1", timestamp: t });
    });

    monitor.enableReactive();

    // Record enough errors to breach the scale-up error rate threshold.
    // 3 errors out of 4 starts = 75% > 10% threshold.
    t = 1000;
    tracer.record({ type: "agent_start", agentId: "a1", timestamp: t });
    tracer.record({ type: "agent_start", agentId: "a2", timestamp: t });
    tracer.record({ type: "agent_start", agentId: "a3", timestamp: t });
    tracer.record({ type: "agent_start", agentId: "a4", timestamp: t });

    // Reset lastDecisionTime so the first error event triggers a decision
    t = 20000; // well past any cooldown window

    // This triggers the subscriber → evaluate() → scale_up → callback → re-entrant tracer.record()
    tracer.record({ type: "agent_error", agentId: "a1", timestamp: t });

    // The re-entrancy guard must ensure only ONE decision was produced.
    // Without the fix, the re-entrant record() call would bypass the cooldown
    // and produce a second scale_up decision.
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.action).toBe("scale_up");
  });
});
