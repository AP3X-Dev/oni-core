// ============================================================
// @oni.bot/core — Example: Time-travel & Fork
// ============================================================

import {
  StateGraph, START, END,
  MemoryCheckpointer, lastValue, appendList,
} from "../src/index.js";

type PipelineState = {
  stage:    string;
  history:  string[];
  output:   string;
};

const graph = new StateGraph<PipelineState>({
  channels: {
    stage:   lastValue(() => ""),
    history: appendList(() => []),
    output:  lastValue(() => ""),
  },
});

graph.addNode("ingest",    async () => ({ stage: "ingest",    history: ["ingest done"]    }));
graph.addNode("transform", async () => ({ stage: "transform", history: ["transform done"] }));
graph.addNode("load",      async () => ({ stage: "load",      history: ["load done"]      }));
graph.addNode("finalize",  async (state) => ({
  output: `DONE: ${state.history.join(" → ")}`,
  stage:  "final",
  history: ["finalized"],
}));

graph.addEdge(START,       "ingest");
graph.addEdge("ingest",    "transform");
graph.addEdge("transform", "load");
graph.addEdge("load",      "finalize");
graph.addEdge("finalize",  END);

const checkpointer = new MemoryCheckpointer<PipelineState>();
const app = graph.compile({ checkpointer });

async function main() {
  console.log("@oni.bot/core — Time-travel Example");
  console.log("=".repeat(50));

  const threadId = "pipeline-1";
  const result = await app.invoke({}, { threadId });
  console.log("\n✅ Final:", result.output);

  // Inspect full checkpoint history
  const history = await app.getHistory({ threadId });
  console.log(`\n📜 Checkpoint history (${history.length} steps):`);
  for (const cp of history) {
    console.log(`  step=${cp.step} stage="${cp.state.stage}" history=[${cp.state.history.join(", ")}]`);
  }

  // Time-travel: what was the state at step 2?
  const stateAt2 = await app.getStateAt({ threadId, step: 2 });
  console.log(`\n⏪ State at step 2: stage="${stateAt2?.stage}" history=[${stateAt2?.history.join(", ")}]`);

  // Fork: branch off from step 2, re-run from "transform"
  const forkedThreadId = "pipeline-1-fork";
  await app.forkFrom({ threadId, step: 2, newThreadId: forkedThreadId });
  console.log(`\n🍴 Forked thread "${forkedThreadId}" from step 2`);

  // Patch the forked state to simulate a different transform
  await app.updateState({ threadId: forkedThreadId }, {
    history: ["transform PATCHED"],
    stage:   "transform",
  });

  // Resume from the fork
  const forkedResult = await app.invoke({}, { threadId: forkedThreadId });
  console.log("✅ Forked result:", forkedResult.output);
}

main().catch(console.error);
