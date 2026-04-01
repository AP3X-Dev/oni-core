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
 * Builds an interviewer agent that:
 *  - reads context.coverageMap and context.coverageDimensions
 *  - finds the first uncovered dimension
 *  - returns currentQuestion for that dimension and marks the PREVIOUS question's dimension as covered
 *
 * On the first call (no prior question), it just asks about dims[0] with no coverage update.
 * On subsequent calls, it marks dims[questionCount - 1] as covered, then asks dims[questionCount].
 */
function makeInterviewer(id: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const ctx = (state.context ?? {}) as Record<string, unknown>;
    const dimensions = (ctx.coverageDimensions as string[] | undefined) ?? [];
    const coverageMap = { ...((ctx.coverageMap as Record<string, boolean> | undefined) ?? {}) };
    const questionCount = (ctx.questionCount as number | undefined) ?? 0;
    const synthesize = !!(ctx.synthesize);

    // Synthesizer mode
    if (synthesize) {
      const transcript = (ctx.transcript as Array<{ question: string; answer: string; questionIndex: number }> | undefined) ?? [];
      return {
        context: {
          ...ctx,
          synthesizedOutput: `Synthesis of ${transcript.length} exchanges`,
        },
      };
    }

    // Mark the dimension from the previous question as covered
    // (questionCount reflects how many have been asked so far)
    if (questionCount > 0 && questionCount - 1 < dimensions.length) {
      const prevDim = dimensions[questionCount - 1]!;
      coverageMap[prevDim] = true;
    }

    // Ask about the current dimension
    const currentDim = dimensions[questionCount] ?? dimensions[dimensions.length - 1] ?? "general";
    const currentQuestion = `Tell me about ${currentDim}?`;

    return {
      context: {
        ...ctx,
        coverageMap,
        currentQuestion,
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

function makeRespondent(id: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const ctx = (state.context ?? {}) as Record<string, unknown>;
    const question = (ctx.currentQuestion as string | undefined) ?? "";
    return {
      context: {
        ...ctx,
        currentAnswer: `Here is my answer to: "${question}"`,
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

/**
 * An interviewer that never marks any dimension as covered.
 */
function makeNonCoveringInterviewer(id: string) {
  const g = new StateGraph<BaseSwarmState>({ channels: makeChannels() });
  g.addNode("work", async (state) => {
    const ctx = (state.context ?? {}) as Record<string, unknown>;
    const synthesize = !!(ctx.synthesize);
    if (synthesize) {
      return {
        context: {
          ...ctx,
          synthesizedOutput: "No coverage achieved",
        },
      };
    }
    return {
      context: {
        ...ctx,
        currentQuestion: "What do you think?",
        // coverageMap intentionally not updated
      },
    };
  });
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return { id, role: id, capabilities: [], skeleton: g.compile() as any };
}

describe("SwarmGraph.socraticElicit()", () => {
  it("agent mode: completes when coverage threshold met", async () => {
    const dimensions = ["goals", "constraints", "users"];
    const interviewer = makeInterviewer("interviewer");
    const respondent = makeRespondent("respondent");

    const swarm = SwarmGraph.socraticElicit<BaseSwarmState>({
      interviewer,
      respondent,
      coverageDimensions: dimensions,
      completionThreshold: 1.0,
      maxQuestions: 10,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "elicit product requirements" });

    expect(result.done).toBe(true);

    const transcript = result.context.transcript as Array<{ question: string; answer: string; questionIndex: number }>;
    expect(transcript).toBeDefined();
    expect(transcript.length).toBeGreaterThan(0);

    expect(result.context.synthesizedOutput).toBeDefined();
    expect(typeof result.context.synthesizedOutput).toBe("string");

    const coverageMap = result.context.coverageMap as Record<string, boolean>;
    expect(coverageMap).toBeDefined();
  });

  it("terminates at maxQuestions", async () => {
    const dimensions = ["goals", "constraints", "users"];
    const interviewer = makeNonCoveringInterviewer("interviewer");
    const respondent = makeRespondent("respondent");

    const swarm = SwarmGraph.socraticElicit<BaseSwarmState>({
      interviewer,
      respondent,
      coverageDimensions: dimensions,
      completionThreshold: 1.0,
      maxQuestions: 2,
    });

    const app = swarm.compile();
    const result = await app.invoke({ task: "elicit product requirements" });

    expect(result.done).toBe(true);

    const transcript = result.context.transcript as Array<{ question: string; answer: string; questionIndex: number }>;
    expect(transcript.length).toBeLessThanOrEqual(2);
  });
});
