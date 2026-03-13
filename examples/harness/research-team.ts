// ============================================================
// @oni.bot/core — Research Team Swarm
// 3-agent pipeline: Researcher → Analyst → Writer
// Demonstrates: ONIHarness, pipeline topology, hooks, todo tracking
// ============================================================
// Run: ANTHROPIC_API_KEY=sk-... npx tsx examples/harness/research-team.ts

import { ONIHarness } from "../../src/harness/index.js";
import { anthropic } from "../../src/models/anthropic.js";
import { defineTool } from "../../src/tools/define.js";
import { SwarmGraph, baseSwarmChannels } from "../../src/swarm/index.js";
import { StateGraph, START, END } from "../../src/index.js";
import type { BaseSwarmState, SwarmAgentDef } from "../../src/swarm/index.js";

// ── Models ───────────────────────────────────────────────────
const model = anthropic("claude-sonnet-4-20250514");
const fastModel = anthropic("claude-haiku-4-5-20251001");

// ── Shared Tools ─────────────────────────────────────────────
const webSearchTool = defineTool({
  name: "web_search",
  description: "Search the web for information on a topic. Returns search results.",
  schema: {
    type: "object",
    properties: { query: { type: "string", description: "Search query" } },
    required: ["query"],
  },
  execute: async (input: { query: string }) => {
    // Real implementation would call a search API
    // For demo purposes, we simulate search results
    return {
      query: input.query,
      results: [
        { title: `Latest findings on: ${input.query}`, snippet: `Key research shows significant developments in ${input.query}. Multiple studies confirm emerging trends.` },
        { title: `${input.query} - Industry Analysis`, snippet: `Market analysis reveals growing adoption. Enterprise use cases expanding rapidly.` },
        { title: `Expert opinions: ${input.query}`, snippet: `Leading researchers suggest this area will see major breakthroughs within 2-3 years.` },
      ],
    };
  },
});

const notepadTool = defineTool({
  name: "notepad",
  description: "Save a note to the shared notepad for other agents to read",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title" },
      content: { type: "string", description: "Note content" },
    },
    required: ["title", "content"],
  },
  execute: async (input: { title: string; content: string }) => {
    return { saved: true, title: input.title };
  },
});

// ── Create Harness ───────────────────────────────────────────
const harness = ONIHarness.create({
  model,
  fastModel,
  soul: "You are part of a research team. Work collaboratively. Be thorough but concise.",
  sharedTools: [webSearchTool, notepadTool],
  maxTurns: 6,
  hooks: {
    PostToolUse: [{
      handler: async (payload) => {
        const p = payload as { toolName: string; durationMs?: number };
        console.log(`    [hook] ${p.toolName} completed in ${p.durationMs ?? 0}ms`);
        return { decision: "allow" };
      },
    }],
  },
});

// ── Build Pipeline Agents ────────────────────────────────────

function buildAgent(
  id: string,
  soul: string,
): SwarmAgentDef<BaseSwarmState> {
  const node = harness.asNode<BaseSwarmState>({
    name: id,
    soul,
    maxTurns: 4,
  });

  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", node);
  g.addEdge(START, "work");
  g.addEdge("work", END);

  return {
    id,
    role: id,
    capabilities: [{ name: id, description: soul }],
    skeleton: g.compile() as any,
  };
}

const researcher = buildAgent(
  "researcher",
  "You are a Research Specialist. Use web_search to find information about the topic. Search at least twice with different queries. Save your findings using the notepad tool.",
);

const analyst = buildAgent(
  "analyst",
  "You are a Data Analyst. Review the research findings from the previous agent. Identify key patterns, contradictions, and gaps. Save your analysis using the notepad tool.",
);

const writer = buildAgent(
  "writer",
  "You are a Technical Writer. Synthesize the research and analysis into a clear, well-structured report. Save the final report using the notepad tool.",
);

// ── Build Swarm ──────────────────────────────────────────────
const swarm = SwarmGraph.pipeline<BaseSwarmState>({
  stages: [researcher, analyst, writer],
});

const app = swarm.compile();

// ── Run ──────────────────────────────────────────────────────
async function main() {
  console.log("ONI Research Team Swarm");
  console.log("=".repeat(50));

  const topic = process.argv[2] ?? "The current state of multi-agent AI systems in production";
  console.log(`\nResearch topic: ${topic}\n`);

  const result = await app.invoke({ task: topic });

  console.log("\n" + "─".repeat(50));
  console.log("Pipeline complete!");
  console.log(`  Agents run: ${Object.keys(result.agentResults).length}`);
  console.log(`  Messages: ${result.messages.length}`);

  if (result.agentResults) {
    for (const [agent, output] of Object.entries(result.agentResults)) {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      console.log(`\n  [${agent}] ${text.slice(0, 200)}...`);
    }
  }
}

main().catch(console.error);
