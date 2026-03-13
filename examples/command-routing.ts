// ============================================================
// @oni.bot/core — Example: Command routing
// ============================================================
// Nodes can return a Command to control both state AND routing
// in a single return value — cleaner than separate edge logic.
// ============================================================

import {
  StateGraph, START, END,
  Command, Send, lastValue, appendList,
} from "../src/index.js";

type WorkflowState = {
  input:    string;
  status:   "pending" | "approved" | "rejected" | "escalated";
  messages: string[];
  attempts: number;
};

const graph = new StateGraph<WorkflowState>({
  channels: {
    input:    lastValue(() => ""),
    status:   lastValue(() => "pending" as const),
    messages: appendList(() => []),
    attempts: lastValue(() => 0),
  },
});

graph.addNode("classify", async (state) => {
  console.log(`[classify] input="${state.input}"`);
  const isHighRisk = state.input.toLowerCase().includes("large");

  // Return a Command: update status AND route to specific node
  return new Command<WorkflowState>({
    update: { status: "pending", messages: [`Classified: ${isHighRisk ? "high-risk" : "standard"}`] },
    goto:   isHighRisk ? "escalate" : "approve",
  });
});

graph.addNode("approve", async (state) => {
  console.log("[approve] auto-approving");
  return new Command<WorkflowState>({
    update: { status: "approved", messages: ["Auto-approved."] },
    goto:   END,
  });
});

graph.addNode("escalate", async (state) => {
  console.log("[escalate] escalating to human");

  if (state.attempts < 1) {
    // Fan-out: notify multiple channels
    return new Command<WorkflowState>({
      update: { status: "escalated", attempts: state.attempts + 1, messages: ["Escalated to human review."] },
      send: [
        new Send("notify", { channel: "slack",  message: state.input }),
        new Send("notify", { channel: "email",  message: state.input }),
      ],
      goto: "await_decision",
    });
  }

  return new Command<WorkflowState>({
    update: { status: "rejected", messages: ["Max escalations reached. Rejected."] },
    goto:   END,
  });
});

graph.addNode("notify", async (state) => {
  // Would fire Slack/email in real usage
  console.log(`[notify] sent notification`);
  return {};
});

graph.addNode("await_decision", async (state) => {
  console.log("[await_decision] simulating human approval");
  return new Command<WorkflowState>({
    update: { status: "approved", messages: ["Human approved."] },
    goto:   END,
  });
});

graph.addEdge(START, "classify");

const app = graph.compile();

async function main() {
  console.log("@oni.bot/core — Command Routing Example");
  console.log("=".repeat(50));

  console.log("\n--- Standard request ---");
  const r1 = await app.invoke({ input: "small purchase $50" });
  console.log("Status:", r1.status, "| Messages:", r1.messages);

  console.log("\n--- High-risk request ---");
  const r2 = await app.invoke({ input: "large transfer $500k" });
  console.log("Status:", r2.status, "| Messages:", r2.messages);
}

main().catch(console.error);
