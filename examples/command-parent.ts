// ============================================================
// @oni.bot/core — Example: Command.PARENT (subgraph → parent updates)
// ============================================================

import {
  StateGraph, START, END, lastValue, Command,
} from "../src/index.js";

// ---- Inner: analysis subgraph ----

type Inner = { text: string; summary: string };

const inner = new StateGraph<Inner>({
  channels: {
    text:    lastValue(() => ""),
    summary: lastValue(() => ""),
  },
});

inner.addNode("analyze", async (state) => {
  console.log(`  [inner:analyze] text="${state.text}"`);
  return new Command<Inner>({
    update: { summary: `Analyzed: "${state.text}"` },
    graph:  Command.PARENT, // push to parent, not local state
  });
});

inner.addEdge(START, "analyze");
inner.addEdge("analyze", END);

// ---- Outer: pipeline ----

type Outer = { text: string; summary: string; done: boolean };

const outer = new StateGraph<Outer>({
  channels: {
    text:    lastValue(() => ""),
    summary: lastValue(() => ""),
    done:    lastValue(() => false),
  },
});

outer.addSubgraph("analysis", inner.compile() as any);
outer.addNode("finish", async (state) => {
  console.log(`[outer:finish] summary="${state.summary}"`);
  return { done: true };
});

outer.addEdge(START, "analysis");
outer.addEdge("analysis", "finish");
outer.addEdge("finish", END);

const app = outer.compile();

console.log("@oni.bot/core — Command.PARENT Example");
console.log("=".repeat(50));

const result = await app.invoke({ text: "ONI Core v0.5.0" });
console.log("\nFinal state:", result);
// summary was set by inner subgraph via Command.PARENT
