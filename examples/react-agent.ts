// ============================================================
// @oni.bot/core — Example: ReAct Agent Skeleton
// ============================================================

import {
  StateGraph,
  START,
  END,
  MemoryCheckpointer,
  lastValue,
  appendList,
  ONIInterrupt,
} from "../src/index.js";

type AgentState = {
  messages: Array<{ role: string; content: string }>;
  toolCalls: string[];
  finalAnswer: string;
  iteration: number;
};

const skeleton = new StateGraph<AgentState>({
  channels: {
    messages:    appendList(() => []),
    toolCalls:   appendList(() => []),
    finalAnswer: lastValue(() => ""),
    iteration:   lastValue(() => 0),
  },
});

skeleton.addNode("agent", async (state) => {
  console.log(`\n[agent] iteration=${state.iteration}`);

  if (state.iteration < 2) {
    const toolCall = `search("oni-core iteration ${state.iteration}")`;
    console.log(`[agent] → tool: ${toolCall}`);
    return {
      toolCalls: [toolCall],
      messages: [{ role: "assistant", content: `Calling: ${toolCall}` }],
      iteration: state.iteration + 1,
    };
  }

  const answer = `Final answer after ${state.iteration} steps.`;
  console.log(`[agent] → answer: ${answer}`);
  return { finalAnswer: answer, messages: [{ role: "assistant", content: answer }] };
});

skeleton.addNode("tools", async (state) => {
  const lastCall = state.toolCalls[state.toolCalls.length - 1];
  console.log(`[tools] executing: ${lastCall}`);
  return { messages: [{ role: "tool", content: `Result for: ${lastCall}` }] };
});

skeleton.addEdge(START, "agent");
skeleton.addConditionalEdges("agent", (state) =>
  state.toolCalls.length > 0 && !state.finalAnswer ? "tools" : END
);
skeleton.addEdge("tools", "agent");

const checkpointer = new MemoryCheckpointer<AgentState>();
const app = skeleton.compile({ checkpointer, interruptAfter: ["agent"] });

async function main() {
  console.log("@oni.bot/core — ReAct Agent Skeleton");
  console.log("=".repeat(50));

  const threadId = "oni-thread-1";

  try {
    for await (const event of app.stream(
      { messages: [{ role: "user", content: "Tell me about ONI" }] },
      { threadId, streamMode: "updates", agentId: "react-agent" }
    )) {
      if (event.event === "node_end") {
        console.log(`[stream] node="${event.node}" step=${event.step}`);
      }
    }
  } catch (e) {
    if (e instanceof ONIInterrupt) {
      console.log(`\n⏸  ONI Interrupt ${e.timing} "${e.node}"`);
      console.log("▶  Resuming...");
      const result = await app.invoke({}, { threadId, agentId: "react-agent" });
      console.log("\n✅ Final state:", JSON.stringify(result, null, 2));
    } else {
      throw e;
    }
  }
}

main().catch(console.error);
