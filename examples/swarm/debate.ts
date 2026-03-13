// ============================================================
// @oni.bot/core/swarm — Example: Debate (Template API)
// ============================================================
// Uses SwarmGraph.debate() with an optimist vs pessimist and a
// mock judge that declares consensus after 2 rounds.
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
// Mock judge model — says CONTINUE on round 1, CONSENSUS on round 2
// ----------------------------------------------------------------

function createMockJudge(): ONIModel {
  let callCount = 0;
  return {
    provider: "mock",
    modelId: "mock-judge",
    capabilities: { tools: false, vision: false, streaming: false, embeddings: false } as ModelCapabilities,
    async chat(_params: ChatParams): Promise<ChatResponse> {
      callCount++;
      const isConsensus = callCount >= 2;
      return {
        content: isConsensus ? "CONSENSUS" : "CONTINUE",
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: "end",
      };
    },
    async *stream(_params: ChatParams): AsyncGenerator<ChatChunk> {
      yield { type: "text", text: "CONSENSUS" };
    },
  };
}

// ----------------------------------------------------------------
// Build mock debater agents
// ----------------------------------------------------------------

function buildDebater(
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
    capabilities: [{ name: "debate", description: `Argues as ${id}` }],
    skeleton: g.compile() as any,
  };
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  console.log("@oni.bot/core/swarm — Debate Template Example");
  console.log("=".repeat(55));

  const swarm = SwarmGraph.debate<BaseSwarmState>({
    debaters: [
      buildDebater("optimist", (state) => {
        const round = state.supervisorRound ?? 0;
        console.log(`  [optimist] Round ${round}: Arguing FOR "${state.task}"`);
        return {
          messages: [{
            role: "assistant",
            content: `Optimist round ${round}: AI agents will boost productivity 10x`,
          }],
        };
      }),
      buildDebater("pessimist", (state) => {
        const round = state.supervisorRound ?? 0;
        console.log(`  [pessimist] Round ${round}: Arguing AGAINST "${state.task}"`);
        return {
          messages: [{
            role: "assistant",
            content: `Pessimist round ${round}: AI agents introduce coordination overhead`,
          }],
        };
      }),
    ],
    judge: {
      model: createMockJudge(),
      maxRounds: 3,
      consensusKeyword: "CONSENSUS",
      systemPrompt: "You are a debate judge. Evaluate arguments and decide if consensus is reached.",
    },
    topic: "task",
  });

  const app = swarm.compile();

  const result = await app.invoke({
    task: "Are multi-agent systems the future of software?",
  });

  console.log("\nDebate complete!");
  console.log("  Rounds:", result.supervisorRound);
  console.log("  Done:  ", result.done);
  console.log("  Messages:");
  for (const msg of result.messages) {
    console.log(`    [${msg.role}] ${msg.content}`);
  }

  console.log("\nAgent stats:");
  for (const [id, stats] of Object.entries(app.agentStats())) {
    console.log(`  ${id}: runs=${stats.totalRuns}`);
  }
}

main().catch(console.error);
