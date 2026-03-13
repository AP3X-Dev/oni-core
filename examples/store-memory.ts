// ============================================================
// @oni.bot/core — Example: Cross-thread Store (long-term memory)
// ============================================================

import {
  StateGraph, START, END,
  lastValue, appendList,
  InMemoryStore, AgentMemoryStore,
} from "../src/index.js";

const store = new InMemoryStore();

type AgentState = { userId: string; query: string; answer: string; messages: string[] };

const graph = new StateGraph<AgentState>({
  channels: {
    userId:   lastValue(() => ""),
    query:    lastValue(() => ""),
    answer:   lastValue(() => ""),
    messages: appendList(() => []),
  },
});

graph.addNode("recall", async (state) => {
  const memory = new AgentMemoryStore(store, "assistant");
  const userPrefs = await memory.recall<Record<string,string>>(`user:${state.userId}:prefs`);
  const history   = await memory.recall<string[]>(`user:${state.userId}:history`) ?? [];

  console.log(`[recall] user=${state.userId} prefs=${JSON.stringify(userPrefs)} history=${history.length} items`);
  return { messages: [`Recalled ${history.length} previous interactions`] };
});

graph.addNode("answer", async (state) => {
  const answer = `Answer for "${state.query}" (personalized for ${state.userId})`;
  console.log(`[answer] ${answer}`);
  return { answer, messages: [answer] };
});

graph.addNode("remember", async (state) => {
  const memory = new AgentMemoryStore(store, "assistant");

  // Persist this interaction — survives across thread IDs
  const history = await memory.recall<string[]>(`user:${state.userId}:history`) ?? [];
  history.push(state.query);
  await memory.remember(`user:${state.userId}:history`, history);

  // Store user preferences detected this session
  await memory.remember(`user:${state.userId}:prefs`, { lastTopic: state.query });

  console.log(`[remember] saved interaction for user=${state.userId}`);
  return {};
});

graph.addEdge(START,     "recall");
graph.addEdge("recall",  "answer");
graph.addEdge("answer",  "remember");
graph.addEdge("remember", END);

const app = graph.compile();

async function main() {
  console.log("@oni.bot/core — Cross-thread Store Example");
  console.log("=".repeat(55));

  // First conversation — thread-1
  await app.invoke({ userId: "cj", query: "What is ONI-Core?" }, { threadId: "thread-1" });

  // Second conversation — different thread, but store persists
  await app.invoke({ userId: "cj", query: "How does swarm mode work?" }, { threadId: "thread-2" });

  // Third conversation — store now has history from both previous threads
  const result = await app.invoke({ userId: "cj", query: "What are agents?" }, { threadId: "thread-3" });

  console.log("\n✅ Store state after 3 conversations:");
  const memory = new AgentMemoryStore(store, "assistant");
  const history = await memory.recall<string[]>("user:cj:history");
  const prefs   = await memory.recall("user:cj:prefs");
  console.log("   History:", history);
  console.log("   Prefs:  ", prefs);
  console.log("   Store size:", store.size(), "items");
}

main().catch(console.error);
