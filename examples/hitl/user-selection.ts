// ============================================================
// @oni.bot/core — Example: getUserSelection + multi-step HITL
// ============================================================

import {
  StateGraph, START, END,
  MemoryCheckpointer, lastValue, appendList,
  getUserSelection, getUserInput,
  HITLInterruptException,
} from "../../src/index.js";

type ResearchState = {
  topic:    string;
  depth:    string;
  format:   string;
  results:  string;
  logs:     string[];
};

const graph = new StateGraph<ResearchState>({
  channels: {
    topic:   lastValue(() => ""),
    depth:   lastValue(() => ""),
    format:  lastValue(() => ""),
    results: lastValue(() => ""),
    logs:    appendList(() => []),
  },
});

graph.addNode("configure", async (state) => {
  // Ask user to choose research depth
  const depth = await getUserSelection(
    "How deep should the research go?",
    ["quick (5 min)", "standard (20 min)", "deep-dive (2 hours)"]
  );

  // Ask user to choose output format
  const format = await getUserSelection(
    "What output format do you want?",
    ["bullet points", "executive summary", "full report", "raw data"]
  );

  return {
    depth,
    format,
    logs: [`Config: depth="${depth}" format="${format}"`],
  };
});

graph.addNode("research", async (state) => {
  console.log(`[research] topic="${state.topic}" depth="${state.depth}"`);
  return {
    results: `Research on "${state.topic}" [${state.depth}] → formatted as ${state.format}`,
    logs:    ["Research complete."],
  };
});

graph.addEdge(START,       "configure");
graph.addEdge("configure", "research");
graph.addEdge("research",  END);

const checkpointer = new MemoryCheckpointer<ResearchState>();
const app = graph.compile({ checkpointer });

async function simulateHuman(
  threadId: string,
  input: Partial<ResearchState>,
  responses: unknown[]
): Promise<ResearchState> {
  let responseIdx = 0;

  async function attempt(inp: Partial<ResearchState>): Promise<ResearchState> {
    try {
      return await app.invoke(inp, { threadId });
    } catch (e) {
      if (!(e instanceof HITLInterruptException)) throw e;
      const response = responses[responseIdx++];
      console.log(`⏸  "${e.interrupt.prompt}"`);
      if (e.interrupt.choices) console.log(`   Choices: ${e.interrupt.choices.join(" | ")}`);
      console.log(`   → Human selects: "${response}"\n`);
      return app.resume({ threadId, resumeId: e.interrupt.resumeId }, response).catch(
        (e2): Promise<ResearchState> => {
          if (!(e2 instanceof HITLInterruptException)) throw e2;
          const r2 = responses[responseIdx++];
          console.log(`⏸  "${e2.interrupt.prompt}"`);
          if (e2.interrupt.choices) console.log(`   Choices: ${e2.interrupt.choices.join(" | ")}`);
          console.log(`   → Human selects: "${r2}"\n`);
          return app.resume({ threadId: e2.threadId, resumeId: e2.interrupt.resumeId }, r2);
        }
      );
    }
  }

  return attempt(input);
}

async function main() {
  console.log("@oni.bot/core — getUserSelection HITL Example");
  console.log("=".repeat(55));
  console.log();

  const result = await simulateHuman(
    "research-1",
    { topic: "Multi-agent AI architectures" },
    ["deep-dive (2 hours)", "full report"]
  );

  console.log("✅ Done!");
  console.log("   Depth:  ", result.depth);
  console.log("   Format: ", result.format);
  console.log("   Results:", result.results);
}

main().catch(console.error);
