import { describe, it, expect } from "vitest";
import { SwarmGraph, type BaseSwarmState } from "../../swarm/index.js";
import { StateGraph, START, END, lastValue, appendList, mergeObject } from "../../index.js";

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

/**
 * Builds a decomposer agent. On the first call (depth 0, no prior gaps) it
 * returns the provided subQuestions. On subsequent calls it returns the
 * current gaps as sub-questions so recursion works naturally.
 */
function makeDecomposer(id: string, initialSubQuestions: string[]) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const ctx = (state.context ?? {}) as Record<string, unknown>;
    const currentDepth = (ctx.currentDepth as number | undefined) ?? 0;
    const gaps = (ctx.gaps as string[] | undefined) ?? [];

    // On depth 0 or when no gaps, use the initial sub-questions
    const subQuestions = currentDepth === 0 || gaps.length === 0
      ? initialSubQuestions
      : gaps;

    return {
      context: {
        ...ctx,
        subQuestions,
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

/**
 * Builds a researcher agent that returns a finding for the current sub-question.
 */
function makeResearcher(id: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const ctx = (state.context ?? {}) as Record<string, unknown>;
    const subQuestion = (ctx.currentSubQuestion as string | undefined) ?? "unknown";
    return {
      context: {
        ...ctx,
        finding: {
          subQuestion,
          answer: `Answer for: ${subQuestion}`,
          sources: [`source-for-${subQuestion}`],
        },
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

/**
 * Builds a synthesizer that returns a fixed confidence and gap list.
 * callCount is mutated so callers can track invocations.
 */
function makeSynthesizer(
  id: string,
  opts: {
    confidence: number;
    gaps: string[];
    callCount?: { n: number };
  },
) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const ctx = (state.context ?? {}) as Record<string, unknown>;
    if (opts.callCount) opts.callCount.n++;
    return {
      context: {
        ...ctx,
        synthesis: "synthesized result",
        confidence: opts.confidence,
        gaps: opts.gaps,
        sources: ["synthesized-source"],
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

describe("SwarmGraph.autoResearch()", () => {
  it("decomposes, researches, synthesizes until confident", async () => {
    const decomposer = makeDecomposer("decomposer", ["sub-q-1", "sub-q-2"]);
    const researcher = makeResearcher("researcher");
    // Synthesizer returns confidence 0.9 on first call — above threshold 0.8
    const synthesizer = makeSynthesizer("synthesizer", {
      confidence: 0.9,
      gaps: [],
    });

    const swarm = SwarmGraph.autoResearch<BaseSwarmState>({
      decomposer,
      researcher,
      synthesizer,
      maxDepth: 5,
      confidenceThreshold: 0.8,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "research quantum computing" });

    expect(result.done).toBe(true);
    expect(result.context.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.context.synthesis).toBeDefined();
    expect(typeof result.context.synthesis).toBe("string");

    // Findings should have entries for both sub-questions
    const findings = result.context.findings as Record<string, unknown>;
    expect(findings).toBeDefined();
    expect(Object.keys(findings).length).toBeGreaterThanOrEqual(2);
  });

  it("terminates at maxDepth", async () => {
    // Synthesizer always returns low confidence with gaps — never terminates early
    const callCount = { n: 0 };
    const decomposer = makeDecomposer("decomposer", ["sub-q-a"]);
    const researcher = makeResearcher("researcher");
    const synthesizer = makeSynthesizer("synthesizer", {
      confidence: 0.3,
      gaps: ["gap-1", "gap-2"],
      callCount,
    });

    const maxDepth = 2;

    const swarm = SwarmGraph.autoResearch<BaseSwarmState>({
      decomposer,
      researcher,
      synthesizer,
      maxDepth,
      confidenceThreshold: 0.8,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "research never-ending topic" });

    expect(result.done).toBe(true);
    // currentDepth should equal maxDepth (loop exhausted)
    expect(result.context.currentDepth).toBe(maxDepth);
    // Synthesizer should have been called once per depth
    expect(callCount.n).toBe(maxDepth);
  });
});
