// ============================================================
// @oni.bot/core/swarm — Example: Hierarchical Mesh (Template API)
// ============================================================
// Uses SwarmGraph.hierarchicalMesh() with a coordinator routing
// to 2 teams: a research pipeline and an engineering pipeline.
// Each team is a mini-pipeline compiled as a sub-skeleton.
// ============================================================

import {
  StateGraph, START, END,
} from "../../src/index.js";
import {
  SwarmGraph, baseSwarmChannels,
  type SwarmAgentDef, type BaseSwarmState,
} from "../../src/swarm/index.js";
import type { ONIModel, ChatParams, ChatResponse, ChatChunk, ModelCapabilities } from "../../src/models/types.js";

// ----------------------------------------------------------------
// Mock coordinator model — routes to "research" then "engineering"
// ----------------------------------------------------------------

function createMockCoordinator(): ONIModel {
  const teamOrder = ["research", "engineering", "DONE"];
  let callCount = 0;
  return {
    provider: "mock",
    modelId: "mock-coordinator",
    capabilities: { tools: false, vision: false, streaming: false, embeddings: false } as ModelCapabilities,
    async chat(_params: ChatParams): Promise<ChatResponse> {
      const pick = teamOrder[Math.min(callCount, teamOrder.length - 1)]!;
      callCount++;
      return {
        content: pick,
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: "end",
      };
    },
    async *stream(_params: ChatParams): AsyncGenerator<ChatChunk> {
      yield { type: "text", text: "research" };
    },
  };
}

// ----------------------------------------------------------------
// Build mock agent helper
// ----------------------------------------------------------------

function buildAgent(
  id: string,
  handler: (state: BaseSwarmState) => Partial<BaseSwarmState>,
): SwarmAgentDef<BaseSwarmState> {
  const g = new StateGraph<BaseSwarmState>({ channels: baseSwarmChannels });
  g.addNode("work", handler);
  g.addEdge(START, "work");
  g.addEdge("work", END);
  return {
    id,
    role: id,
    capabilities: [{ name: id, description: `Handles ${id} tasks` }],
    skeleton: g.compile() as any,
  };
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  console.log("@oni.bot/core/swarm — Hierarchical Mesh Template Example");
  console.log("=".repeat(55));

  const swarm = SwarmGraph.hierarchicalMesh<BaseSwarmState>({
    coordinator: {
      model: createMockCoordinator(),
      strategy: "llm",
      maxRounds: 4,
      systemPrompt: "Route tasks to the appropriate team.",
    },
    teams: {
      research: {
        topology: "pipeline",
        agents: [
          buildAgent("literature-review", (state) => {
            console.log(`  [literature-review] Reviewing literature for: "${state.task}"`);
            return {
              messages: [{ role: "assistant", content: "Literature review complete: 12 papers found" }],
            };
          }),
          buildAgent("data-analysis", (_state) => {
            console.log("  [data-analysis] Analyzing collected data");
            return {
              messages: [{ role: "assistant", content: "Data analysis: key trends identified" }],
            };
          }),
        ],
      },
      engineering: {
        topology: "pipeline",
        agents: [
          buildAgent("architect", (state) => {
            console.log(`  [architect] Designing architecture for: "${state.task}"`);
            return {
              messages: [{ role: "assistant", content: "Architecture designed: microservices approach" }],
            };
          }),
          buildAgent("implementer", (_state) => {
            console.log("  [implementer] Implementing design");
            return {
              messages: [{ role: "assistant", content: "Implementation complete: 3 services deployed" }],
            };
          }),
        ],
      },
    },
  });

  const app = swarm.compile();

  const result = await app.invoke({
    task: "Build an AI-powered search engine",
  });

  console.log("\nHierarchical mesh complete!");
  console.log("  Rounds:", result.supervisorRound);
  console.log("  Done:  ", result.done);
  console.log("  Team results:", Object.keys(result.agentResults));
  console.log("  Messages:");
  for (const msg of result.messages) {
    console.log(`    [${msg.role}] ${msg.content}`);
  }
}

main().catch(console.error);
