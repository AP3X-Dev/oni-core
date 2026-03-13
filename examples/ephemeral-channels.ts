// ============================================================
// @oni.bot/core — Example: Ephemeral Channels
// ============================================================
// Ephemeral channels reset to their default at the start of
// each superstep. Perfect for per-step scratch data, flags,
// or "working memory" that shouldn't accumulate.
// ============================================================

import {
  StateGraph, START, END,
  lastValue, appendList, ephemeralValue,
} from "../src/index.js";

type AgentState = {
  messages:     string[];
  // Persists across steps
  totalTokens:  number;
  // Resets every superstep — per-step scratch
  currentInput: string;
  stepFlags:    Record<string, boolean>;
};

const graph = new StateGraph<AgentState>({
  channels: {
    messages:     appendList(() => []),
    totalTokens:  lastValue(() => 0),
    // These reset every superstep:
    currentInput: ephemeralValue(() => ""),
    stepFlags:    ephemeralValue(() => ({})),
  },
});

graph.addNode("step_a", async (state) => {
  console.log(`[step_a] currentInput="${state.currentInput}" (should be empty at start)`);
  return {
    messages:     ["step_a ran"],
    totalTokens:  state.totalTokens + 10,
    currentInput: "data from step_a",
    stepFlags:    { step_a: true },
  };
});

graph.addNode("step_b", async (state) => {
  // step_b runs in the NEXT superstep — currentInput is reset to ""
  console.log(`[step_b] currentInput="${state.currentInput}" (reset from step_a)`);
  console.log(`[step_b] stepFlags=${JSON.stringify(state.stepFlags)} (reset)`);
  return {
    messages:    ["step_b ran"],
    totalTokens: state.totalTokens + 20,
    stepFlags:   { step_b: true },
  };
});

graph.addEdge(START,    "step_a");
graph.addEdge("step_a", "step_b");
graph.addEdge("step_b", END);

const app = graph.compile();

async function main() {
  console.log("@oni.bot/core — Ephemeral Channels Example");
  console.log("=".repeat(50));

  const result = await app.invoke({});
  console.log("\n✅ Messages:    ", result.messages);
  console.log("   totalTokens:", result.totalTokens, "(accumulated correctly)");
  console.log("   currentInput:", JSON.stringify(result.currentInput), "(ephemeral — empty at end)");
}

main().catch(console.error);
