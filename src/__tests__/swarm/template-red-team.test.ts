import { describe, it, expect } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";
import type { Vulnerability, Patch } from "../../swarm/types.js";

function makeChannels() {
  return {
    task: lastValue(() => ""),
    context: mergeObject(() => ({})),
    agentResults: mergeObject(() => ({})),
    messages: appendList(() => [] as Array<{ role: string; content: string }>),
    swarmMessages: appendList(() => []),
    supervisorRound: lastValue(() => 0),
    currentAgent: lastValue(() => null as string | null),
    done: lastValue(() => false),
    handoffHistory: appendList(() => []),
  };
}

function makeAttacker(
  id: string,
  getVulns: (round: number) => Vulnerability[],
) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const round = (state.context?.currentRound as number) ?? 1;
    return {
      context: {
        ...(state.context ?? {}),
        newVulnerabilities: getVulns(round),
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

function makeBuilder(id: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const newVulns = (state.context?.newVulnerabilities as Vulnerability[] | undefined) ?? [];
    const newPatches: Patch[] = newVulns.map((v) => ({
      vulnerabilityId: v.id,
      round: (state.context?.currentRound as number) ?? 1,
      description: `patch for ${v.id}`,
      filesChanged: [],
    }));
    return {
      context: {
        ...(state.context ?? {}),
        newPatches,
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

describe("SwarmGraph.redTeam()", () => {
  it("attacker finds vulnerabilities, builder patches", async () => {
    // Round 1 and 2: find vulns; round 3: no new vulns → stop
    let attackRound = 0;
    const attacker = makeAttacker("attacker", (round) => {
      attackRound = round;
      if (round <= 2) {
        return [
          {
            id: `vuln-r${round}`,
            round,
            category: "injection",
            severity: "high" as const,
            description: `SQL injection round ${round}`,
            reproSteps: "send malformed input",
            status: "open" as const,
          },
        ];
      }
      return [];
    });
    const builder = makeBuilder("builder");

    const swarm = SwarmGraph.redTeam<BaseSwarmState>({
      attacker,
      builder,
      maxRounds: 5,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "security audit" });

    expect(result.done).toBe(true);
    const vulns = result.context.vulnerabilities as Vulnerability[];
    const patches = result.context.patches as Patch[];
    expect(vulns).toHaveLength(2);
    expect(patches).toHaveLength(2);
    expect(attackRound).toBe(3);
  });

  it("terminates at maxRounds", async () => {
    const attacker = makeAttacker("attacker", (round) => [
      {
        id: `vuln-r${round}`,
        round,
        category: "xss",
        severity: "medium" as const,
        description: "XSS vulnerability",
        reproSteps: "inject script tag",
        status: "open" as const,
      },
    ]);
    const builder = makeBuilder("builder");

    const swarm = SwarmGraph.redTeam<BaseSwarmState>({
      attacker,
      builder,
      maxRounds: 2,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "security audit" });

    expect(result.done).toBe(true);
    const vulns = result.context.vulnerabilities as Vulnerability[];
    expect(vulns).toHaveLength(2);
    expect(result.context.currentRound).toBe(2);
  });

  it("severityThreshold filters low-severity findings", async () => {
    let roundsRun = 0;
    const attacker = makeAttacker("attacker", (round) => {
      roundsRun = round;
      // Always returns only "low" severity
      return [
        {
          id: `vuln-low-r${round}`,
          round,
          category: "info",
          severity: "low" as const,
          description: "Low severity info disclosure",
          reproSteps: "observe response headers",
          status: "open" as const,
        },
      ];
    });
    const builder = makeBuilder("builder");

    const swarm = SwarmGraph.redTeam<BaseSwarmState>({
      attacker,
      builder,
      maxRounds: 5,
      severityThreshold: "medium",
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "security audit" });

    expect(result.done).toBe(true);
    // All findings are below threshold → loop breaks after round 1
    expect(roundsRun).toBe(1);
    const vulns = result.context.vulnerabilities as Vulnerability[];
    // No vulns accumulated (all filtered)
    expect(vulns).toHaveLength(0);
  });
});
