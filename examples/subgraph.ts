// ============================================================
// @oni.bot/core — Example: Subgraph (nested skeleton as a node)
// ============================================================

import {
  StateGraph, START, END,
  lastValue, appendList,
} from "../src/index.js";

// ---- Inner subgraph: enrichment pipeline ----

type EnrichState = {
  text:     string;
  enriched: string[];
  tags:     string[];
};

const enrichGraph = new StateGraph<EnrichState>({
  channels: {
    text:     lastValue(() => ""),
    enriched: appendList(() => []),
    tags:     appendList(() => []),
  },
});

enrichGraph.addNode("extract_entities", async (state) => {
  console.log(`  [enrich:entities] "${state.text}"`);
  return { enriched: [`entity:${state.text.split(" ")[0]}`] };
});

enrichGraph.addNode("tag", async (state) => {
  console.log(`  [enrich:tag]`);
  return { tags: ["auto-tagged"] };
});

enrichGraph.addEdge(START, "extract_entities");
enrichGraph.addEdge("extract_entities", "tag");
enrichGraph.addEdge("tag", END);

const enrichSkeleton = enrichGraph.compile();

// ---- Outer graph: mounts enrich as a node ----

type PipelineState = {
  text:     string;
  enriched: string[];
  tags:     string[];
  output:   string;
};

const pipeline = new StateGraph<PipelineState>({
  channels: {
    text:     lastValue(() => ""),
    enriched: appendList(() => []),
    tags:     appendList(() => []),
    output:   lastValue(() => ""),
  },
});

pipeline.addNode("ingest", async (state) => {
  console.log(`[pipeline:ingest] "${state.text}"`);
  return { text: state.text.trim() };
});

// Mount the enrich subgraph as a single node
pipeline.addSubgraph("enrich", enrichSkeleton as any);

pipeline.addNode("finalize", async (state) => {
  console.log(`[pipeline:finalize] enriched=${state.enriched.length} tags=${state.tags.length}`);
  return {
    output: `Processed: "${state.text}" | enriched: [${state.enriched.join(", ")}] | tags: [${state.tags.join(", ")}]`,
  };
});

pipeline.addEdge(START,    "ingest");
pipeline.addEdge("ingest", "enrich");
pipeline.addEdge("enrich", "finalize");
pipeline.addEdge("finalize", END);

const app = pipeline.compile();

async function main() {
  console.log("@oni.bot/core — Subgraph Example");
  console.log("=".repeat(50));

  const result = await app.invoke({ text: "ONI platform launch" });
  console.log("\n✅ Output:", result.output);
}

main().catch(console.error);
