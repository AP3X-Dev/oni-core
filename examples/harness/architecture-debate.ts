// ============================================================
// @oni.bot/core — Architecture Debate
// Two agents debate, LLM judge arbitrates consensus
// Demonstrates: debate topology, real LLM judge, harness integration
// ============================================================
// Run: ANTHROPIC_API_KEY=sk-... npx tsx examples/harness/architecture-debate.ts

import { ONIHarness } from "../../src/harness/index.js";
import { anthropic } from "../../src/models/anthropic.js";
import { SwarmGraph, baseSwarmChannels } from "../../src/swarm/index.js";
import { StateGraph, START, END } from "../../src/index.js";
import type { BaseSwarmState, SwarmAgentDef } from "../../src/swarm/index.js";

// ── Models ───────────────────────────────────────────────────
const model = anthropic("claude-sonnet-4-20250514");
const fastModel = anthropic("claude-haiku-4-5-20251001");

// ── Create Harness ───────────────────────────────────────────
const harness = ONIHarness.create({
  model,
  fastModel,
  maxTurns: 3,
});

// ── Build debater agents ─────────────────────────────────────

function buildDebater(
  id: string,
  soul: string,
): SwarmAgentDef<BaseSwarmState> {
  const node = harness.asNode<BaseSwarmState>({
    name: id,
    soul,
    maxTurns: 2,
  });

  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", node);
  g.addEdge(START, "work");
  g.addEdge("work", END);

  return {
    id,
    role: id,
    capabilities: [{ name: "debate", description: soul }],
    skeleton: g.compile() as any,
  };
}

const microservicesAdvocate = buildDebater(
  "microservices-advocate",
  `You advocate for microservices architecture. Argue persuasively for microservices.
Be specific — cite scalability, team autonomy, independent deployability, polyglot flexibility.
Acknowledge trade-offs honestly but argue the benefits outweigh them for large-scale systems.
Keep arguments to 2-3 paragraphs per round.`,
);

const monolithAdvocate = buildDebater(
  "monolith-advocate",
  `You advocate for modular monolith architecture. Argue persuasively for monoliths.
Be specific — cite simplicity, debugging ease, lower operational cost, no distributed system pitfalls.
Acknowledge trade-offs honestly but argue the benefits outweigh them for most teams.
Keep arguments to 2-3 paragraphs per round.`,
);

// ── Build Debate Swarm ───────────────────────────────────────
const swarm = SwarmGraph.debate<BaseSwarmState>({
  debaters: [microservicesAdvocate, monolithAdvocate],
  judge: {
    model,  // Real LLM judge
    maxRounds: 3,
    consensusKeyword: "CONSENSUS",
    systemPrompt: `You are a senior software architect judging an architecture debate.
After each round, evaluate the arguments. If both sides have made their best points
and a clear recommendation can be synthesized, respond with CONSENSUS followed by your verdict.
Otherwise respond with CONTINUE and brief feedback on what each side should address next.`,
  },
  topic: "task",
});

const app = swarm.compile();

// ── Run ──────────────────────────────────────────────────────
async function main() {
  console.log("ONI Architecture Debate");
  console.log("=".repeat(50));

  const topic = process.argv[2] ?? "Should a Series A startup (20 engineers, B2B SaaS) use microservices or a modular monolith?";
  console.log(`\nTopic: ${topic}\n`);

  const result = await app.invoke({ task: topic });

  console.log("\n" + "─".repeat(50));
  console.log("Debate complete!");
  console.log(`  Rounds: ${result.supervisorRound}`);
  console.log(`  Consensus: ${result.done}`);
  console.log(`\nMessages:`);
  for (const msg of result.messages) {
    const preview = typeof msg.content === "string" ? msg.content.slice(0, 150) : "";
    console.log(`  [${msg.role}] ${preview}...`);
  }
}

main().catch(console.error);
