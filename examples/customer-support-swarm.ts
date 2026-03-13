// ============================================================
// @oni.bot/core — Customer Support Swarm
// ============================================================
// A production-style customer support system with specialized agents.
//
// Flow:
//   User message → Router → [Billing | Technical | General] → Escalation?
//
// Features demonstrated:
//   - StateGraph with lastValue + appendList channels
//   - addConditionalEdges for intent-based routing
//   - MemoryCheckpointer for conversation persistence
//   - interrupt() for human-in-the-loop escalation
//   - Node timeouts (30s per agent)
//   - Confidence-based escalation routing
//
// Usage:
//   npx tsx examples/customer-support-swarm.ts
// ============================================================

import {
  StateGraph, START, END,
  lastValue, appendList,
  MemoryCheckpointer,
  interrupt,
  HITLInterruptException,
} from "../src/index.js";

// -- State: tracks the full conversation lifecycle --

type TicketState = {
  messages:   string[];   // conversation history (appendList)
  category:   string;     // billing | technical | general
  status:     string;     // open | escalated | resolved
  resolution: string;     // final answer to the customer
  confidence: number;     // agent's confidence in their answer (0–1)
  logs:       string[];   // execution trace (appendList)
};

// -- Mock classifier — in production, this calls your LLM --

function classifyIntent(message: string): string {
  const lower = message.toLowerCase();
  if (lower.match(/bill|charge|payment|invoice|refund|subscription/)) return "billing";
  if (lower.match(/error|bug|crash|slow|install|broken|password|login/)) return "technical";
  return "general";
}

// -- Build the graph --

const graph = new StateGraph<TicketState>({
  channels: {
    messages:   appendList(() => []),
    category:   lastValue(() => "unknown"),
    status:     lastValue(() => "open"),
    resolution: lastValue(() => ""),
    confidence: lastValue(() => 0),
    logs:       appendList(() => []),
  },
});

// 1. Router — classifies intent and routes to the right specialist
graph.addNode("router", async (state) => {
  const latest = state.messages[state.messages.length - 1] ?? "";
  const category = classifyIntent(latest);
  console.log(`[router] Intent classified: "${category}"`);
  return { category, logs: [`Router → ${category}`] };
}, { timeout: 30_000 });

// 2. Billing Agent — handles payment/subscription issues
graph.addNode("billing", async (state) => {
  const msg = state.messages[state.messages.length - 1] ?? "";
  console.log(`  [billing] Processing: "${msg.slice(0, 60)}..."`);

  // Simulate looking up account data and generating a response
  const isRefund = msg.toLowerCase().includes("refund");
  const resolution = isRefund
    ? "I've initiated a refund for your last charge. It will appear in 3-5 business days."
    : "Your billing cycle renews on the 1st. I've sent a detailed invoice to your email.";

  return {
    resolution,
    confidence: isRefund ? 0.85 : 0.95,
    status: "resolved",
    messages: [`[Billing Agent] ${resolution}`],
    logs: ["Billing agent resolved ticket"],
  };
}, { timeout: 30_000 });

// 3. Technical Agent — handles bugs, errors, account access
graph.addNode("technical", async (state) => {
  const msg = state.messages[state.messages.length - 1] ?? "";
  console.log(`  [technical] Diagnosing: "${msg.slice(0, 60)}..."`);

  const isLogin = msg.toLowerCase().includes("login") || msg.toLowerCase().includes("password");
  const resolution = isLogin
    ? "I've sent a password reset link to your registered email. Check your spam folder."
    : "I've identified the issue. Please clear your browser cache and restart the app. "
    + "If it persists, I'll escalate to our engineering team.";

  const confidence = isLogin ? 0.9 : 0.6;
  return {
    resolution,
    confidence,
    status: confidence >= 0.8 ? "resolved" : "open",
    messages: [`[Technical Agent] ${resolution}`],
    logs: [`Technical agent responded (confidence: ${confidence})`],
  };
}, { timeout: 30_000 });

// 4. General Agent — handles everything else
graph.addNode("general", async (state) => {
  console.log(`  [general] Handling general inquiry`);
  const resolution = "Thanks for reaching out! I've forwarded your message to our team. "
    + "You'll hear back within 24 hours.";
  return {
    resolution,
    confidence: 0.7,
    status: "resolved",
    messages: [`[General Agent] ${resolution}`],
    logs: ["General agent responded"],
  };
}, { timeout: 30_000 });

// 5. Escalation Agent — triggered when confidence is too low
graph.addNode("escalation", async (state) => {
  console.log(`  [escalation] Low confidence (${state.confidence}). Requesting human review.`);

  // Pause execution and wait for a human supervisor
  const humanDecision = await interrupt<string>({
    type: "escalation",
    reason: `Agent confidence too low (${state.confidence})`,
    draft: state.resolution,
    prompt: "Please review and provide the final response to the customer:",
  });

  return {
    resolution: humanDecision,
    status: "resolved",
    confidence: 1.0,
    messages: [`[Human Supervisor] ${humanDecision}`],
    logs: ["Escalation: human supervisor resolved ticket"],
  };
});

// -- Wiring: START → router → specialist (conditional) --

graph.addEdge(START, "router");

graph.addConditionalEdges("router", (state) => {
  switch (state.category) {
    case "billing":   return "billing";
    case "technical": return "technical";
    default:          return "general";
  }
});

// -- After each specialist, decide: resolve or escalate --

function checkEscalation(state: TicketState) {
  return state.confidence < 0.8 ? "escalation" : END;
}

graph.addConditionalEdges("billing",   checkEscalation);
graph.addConditionalEdges("technical", checkEscalation);
graph.addConditionalEdges("general",   checkEscalation);
graph.addEdge("escalation", END);

// -- Compile with checkpointer for conversation persistence --

const checkpointer = new MemoryCheckpointer<TicketState>();
const app = graph.compile({ checkpointer });

// ============================================================
// Run the demo — three scenarios
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("  @oni.bot/core — Customer Support Swarm");
  console.log("=".repeat(60));

  // Scenario 1: Billing (high confidence → auto-resolved)
  console.log("\n--- Scenario 1: Billing inquiry ---");
  const result1 = await app.invoke(
    { messages: ["I was charged twice this month, can I get a refund?"] },
    { threadId: "ticket-001" },
  );
  console.log(`  Status: ${result1.status} | Confidence: ${result1.confidence}`);
  console.log(`  Resolution: ${result1.resolution}\n`);

  // Scenario 2: Technical (low confidence → escalation → HITL)
  console.log("--- Scenario 2: Technical issue (triggers escalation) ---");
  try {
    await app.invoke(
      { messages: ["The app keeps crashing whenever I open the dashboard"] },
      { threadId: "ticket-002" },
    );
  } catch (e) {
    if (e instanceof HITLInterruptException) {
      const payload = e.interrupt.value as Record<string, unknown>;
      console.log(`  HITL triggered: "${payload.prompt}"`);
      console.log(`  [Simulating supervisor response...]\n`);

      // Supervisor provides the final answer
      const resolved = await app.resume(
        { threadId: "ticket-002", resumeId: e.interrupt.resumeId },
        "We've identified a known bug in dashboard rendering. A fix is shipping tomorrow. "
        + "In the meantime, try accessing the dashboard in incognito mode.",
      );
      console.log(`  Status: ${resolved.status} | Confidence: ${resolved.confidence}`);
      console.log(`  Resolution: ${resolved.resolution}\n`);
    } else throw e;
  }

  // Scenario 3: General inquiry
  console.log("--- Scenario 3: General inquiry ---");
  const result3 = await app.invoke(
    { messages: ["Do you offer enterprise plans?"] },
    { threadId: "ticket-003" },
  );
  console.log(`  Status: ${result3.status} | Confidence: ${result3.confidence}`);
  console.log(`  Resolution: ${result3.resolution}\n`);

  // Show conversation history via checkpointer
  console.log("--- Checkpoint History (ticket-002) ---");
  const history = await app.getHistory({ threadId: "ticket-002" });
  history.forEach((cp) =>
    console.log(`  Step ${cp.step}: next=[${cp.nextNodes.join(",")}] messages=${cp.state.messages.length}`)
  );

  console.log("\n" + "=".repeat(60));
  console.log("  All tickets processed.");
  console.log("=".repeat(60));
}

main().catch(console.error);
