// ============================================================
// @oni.bot/core — Example: Graph Inspection API
// ============================================================

import {
  StateGraph, START, END,
  lastValue, appendList,
  buildGraphDescriptor, toMermaidDetailed,
} from "../src/index.js";

type State = { data: string; result: string; logs: string[] };

const graph = new StateGraph<State>({
  channels: {
    data:   lastValue(() => ""),
    result: lastValue(() => ""),
    logs:   appendList(() => []),
  },
});

graph.addNode("ingest",    async (s) => ({ data: s.data.trim() }));
graph.addNode("process_a", async (s) => ({ result: s.data + "_A", logs: ["A done"] }), { retry: { maxAttempts: 3 } });
graph.addNode("process_b", async (s) => ({ result: s.data + "_B", logs: ["B done"] }));
graph.addNode("merge",     async (s) => ({ result: s.result + "_merged", logs: ["merged"] }));

graph.addEdge(START, "ingest");
graph.addConditionalEdges("ingest", (s) => s.data.includes("a") ? "process_a" : "process_b");
graph.addEdge("process_a", "merge");
graph.addEdge("process_b", "merge");
graph.addEdge("merge", END);

async function main() {
  console.log("@oni.bot/core — Graph Inspection Example");
  console.log("=".repeat(55));

  const descriptor = graph.getGraph();

  console.log("\n📊 Nodes:");
  for (const n of descriptor.nodes) {
    console.log(`   ${n.id.padEnd(15)} type=${n.type} retry=${n.hasRetry} subgraph=${n.isSubgraph}`);
  }

  console.log("\n🔗 Edges:");
  for (const e of descriptor.edges) {
    console.log(`   ${e.from.padEnd(15)} --[${e.type}]--> ${e.to}`);
  }

  console.log("\n🔄 Cycles detected:", descriptor.cycles.length === 0 ? "none" : descriptor.cycles);
  console.log("📋 Topological order:", descriptor.topoOrder?.join(" → "));
  console.log("🏁 Terminal nodes:", descriptor.terminals);

  console.log("\n🗺  Mermaid:\n" + graph.toMermaidDetailed());
}

main().catch(console.error);
