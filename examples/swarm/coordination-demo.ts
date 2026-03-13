// ============================================================
// @oni.bot/core/swarm — Example: Coordination via Mailbox Messaging
// ============================================================
// Uses SwarmGraph.pipeline() with agents that communicate via
// the mailbox system. Each agent reads its inbox, processes
// messages, and sends results to the next agent.
// ============================================================

import {
  StateGraph, START, END,
  lastValue,
} from "../../src/index.js";
import {
  SwarmGraph, baseSwarmChannels,
  createMessage, getInbox, formatInbox,
  type SwarmAgentDef, type BaseSwarmState, type SwarmMessage,
} from "../../src/swarm/index.js";

// ----------------------------------------------------------------
// Extended state with a final report
// ----------------------------------------------------------------

type CoordState = BaseSwarmState & {
  finalReport: string;
};

const coordChannels = {
  ...baseSwarmChannels,
  finalReport: lastValue(() => ""),
};

// ----------------------------------------------------------------
// Build agent with mailbox awareness
// ----------------------------------------------------------------

function buildAgent(
  id: string,
  handler: (state: CoordState) => Partial<CoordState>,
): SwarmAgentDef<CoordState> {
  const g = new StateGraph<CoordState>({ channels: coordChannels });
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
  console.log("@oni.bot/core/swarm — Coordination Demo (Mailbox Messaging)");
  console.log("=".repeat(55));

  const swarm = SwarmGraph.pipeline<CoordState>({
    stages: [
      // Stage 1: Coordinator broadcasts the task
      buildAgent("coordinator", (state) => {
        console.log(`  [coordinator] Broadcasting task: "${state.task}"`);
        const broadcast = createMessage(
          "coordinator",
          "analyzer",
          `Please analyze: "${state.task}"`,
          { metadata: { priority: "high" } },
        );
        return {
          swarmMessages: [broadcast],
          messages: [{ role: "assistant", content: "Task broadcasted to analyzer." }],
        };
      }),

      // Stage 2: Analyzer reads inbox and produces analysis
      buildAgent("analyzer", (state) => {
        const inbox = getInbox(state.swarmMessages, "analyzer");
        console.log(`  [analyzer] Inbox: ${inbox.length} message(s)`);
        console.log(`  [analyzer] Messages:\n${formatInbox(inbox)}`);

        const reply = createMessage(
          "analyzer",
          "reporter",
          `Analysis complete for "${state.task}": 3 key findings identified`,
          { metadata: { confidence: 0.92 } },
        );
        return {
          swarmMessages: [reply],
          messages: [{ role: "assistant", content: "Analysis done, forwarding to reporter." }],
        };
      }),

      // Stage 3: Reporter reads inbox and produces final report
      buildAgent("reporter", (state) => {
        const inbox = getInbox(state.swarmMessages, "reporter");
        console.log(`  [reporter] Inbox: ${inbox.length} message(s)`);
        console.log(`  [reporter] Messages:\n${formatInbox(inbox)}`);

        return {
          finalReport: `Final report on "${state.task}": Analysis validated, 3 findings documented`,
          done: true,
          messages: [{ role: "assistant", content: "Report generated." }],
        };
      }),
    ],
    channels: coordChannels as any,
  });

  const app = swarm.compile();

  const result = await app.invoke({
    task: "Market trends in AI infrastructure",
  });

  console.log("\nCoordination complete!");
  console.log("  Final report:", result.finalReport);
  console.log("  Messages exchanged:", result.swarmMessages.length);
  console.log("  Pipeline messages:");
  for (const msg of result.messages) {
    console.log(`    [${msg.role}] ${msg.content}`);
  }
}

main().catch(console.error);
