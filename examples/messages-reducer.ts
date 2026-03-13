// ============================================================
// @oni.bot/core — Example: addMessages + RemoveMessage
// ============================================================

import {
  StateGraph, START, END,
  messagesChannel, messagesStateChannels,
  humanMessage, aiMessage, toolMessage,
  RemoveMessage, UpdateMessage,
  filterByRole, trimMessages,
} from "../src/index.js";
import type { Message, MessagesState } from "../src/index.js";

const graph = new StateGraph<MessagesState>({
  channels: messagesStateChannels,
});

graph.addNode("agent", async (state) => {
  const last = state.messages.at(-1);
  console.log(`[agent] ${state.messages.length} messages, last="${last?.content.slice(0, 40)}"`);

  // Simulate LLM response with tool call
  return {
    messages: [aiMessage("I'll search for that.", {
      tool_calls: [{ id: "call-1", name: "search", args: { query: last?.content ?? "" } }]
    })]
  };
});

graph.addNode("tools", async (state) => {
  const lastAI = filterByRole(state.messages, "assistant").at(-1);
  const toolCall = lastAI?.tool_calls?.[0];

  console.log(`[tools] executing: ${toolCall?.name}(${JSON.stringify(toolCall?.args)})`);

  return {
    messages: [toolMessage(`Results for: ${toolCall?.args?.["query"]}`, toolCall?.id ?? "")]
  };
});

graph.addNode("finalize", async (state) => {
  console.log(`[finalize] total messages: ${state.messages.length}`);

  // Demonstrate RemoveMessage — remove the intermediate tool call message
  const toolCallMsg = filterByRole(state.messages, "assistant")
    .find(m => m.tool_calls?.length);

  const updates: (Message | RemoveMessage | UpdateMessage)[] = [
    aiMessage("Here's what I found based on the search results."),
  ];

  // Optionally prune intermediate messages
  if (toolCallMsg) {
    updates.push(new RemoveMessage(toolCallMsg.id));
  }

  return { messages: updates };
});

graph.addEdge(START,    "agent");
graph.addEdge("agent",  "tools");
graph.addEdge("tools",  "finalize");
graph.addEdge("finalize", END);

const app = graph.compile();

async function main() {
  console.log("@oni.bot/core — addMessages Reducer Example");
  console.log("=".repeat(55));

  const result = await app.invoke({
    messages: [humanMessage("What is ONI-Core?")]
  });

  console.log(`\n✅ Final messages (${result.messages.length}):`);
  for (const m of result.messages) {
    console.log(`   [${m.role}] ${m.content} ${m.tool_calls ? "(had tool_calls — removed)" : ""}`);
  }

  // Demonstrate trimMessages
  const trimmed = trimMessages(result.messages, 2);
  console.log(`\n   After trim(2): ${trimmed.length} messages`);
}

main().catch(console.error);
