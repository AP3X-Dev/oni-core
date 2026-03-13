// ============================================================
// @oni.bot/core — Example: interrupt() + getUserInput HITL
// ============================================================

import {
  StateGraph, START, END,
  MemoryCheckpointer, lastValue, appendList,
  interrupt, getUserInput, getUserApproval,
  HITLInterruptException,
} from "../../src/index.js";

type DeployState = {
  version:    string;
  approved:   boolean;
  deployer:   string;
  logs:       string[];
};

const graph = new StateGraph<DeployState>({
  channels: {
    version:  lastValue(() => ""),
    approved: lastValue(() => false),
    deployer: lastValue(() => ""),
    logs:     appendList(() => []),
  },
});

graph.addNode("validate", async (state) => {
  console.log(`[validate] version=${state.version}`);
  return { logs: [`Validated ${state.version}`] };
});

graph.addNode("request_approval", async (state) => {
  console.log(`[request_approval] awaiting human...`);

  // ← This pauses execution mid-node and surfaces the value to the caller
  const approved = await getUserApproval(
    `Deploy ${state.version} to production? This will affect 10k users.`
  );

  console.log(`[request_approval] got decision: ${approved}`);
  return {
    approved,
    logs: [`Approval decision: ${approved ? "APPROVED" : "REJECTED"}`],
  };
});

graph.addNode("deploy", async (state) => {
  if (!state.approved) {
    console.log("[deploy] Skipped — not approved");
    return { logs: ["Deploy skipped."] };
  }
  console.log(`[deploy] Deploying ${state.version}...`);
  return { logs: [`Deployed ${state.version} successfully!`] };
});

graph.addNode("get_deployer", async (state) => {
  // Collect structured text input
  const name = await getUserInput<string>({
    prompt:    "Enter your name for the audit log:",
    inputType: "text",
    field:     "deployer",
  });
  return { deployer: name, logs: [`Deployer: ${name}`] };
});

graph.addEdge(START,              "get_deployer");
graph.addEdge("get_deployer",     "validate");
graph.addEdge("validate",         "request_approval");
graph.addEdge("request_approval", "deploy");
graph.addEdge("deploy",           END);

const checkpointer = new MemoryCheckpointer<DeployState>();
const app = graph.compile({ checkpointer });

async function main() {
  console.log("@oni.bot/core — interrupt() HITL Example");
  console.log("=".repeat(55));

  const threadId = "deploy-thread-1";

  // ---- First run: will pause at get_deployer ----
  let finalState: DeployState | undefined;

  try {
    finalState = await app.invoke({ version: "v2.4.1" }, { threadId });
  } catch (e) {
    if (!(e instanceof HITLInterruptException)) throw e;

    console.log(`\n⏸  INTERRUPTED at node "${e.interrupt.node}"`);
    console.log(`   Prompt: "${e.interrupt.prompt}"`);
    console.log(`   Type:   ${e.interrupt.inputType}`);
    console.log(`\n   [Simulating human providing name: "CJ"]`);

    // Resume with human's input
    try {
      finalState = await app.resume(
        { threadId, resumeId: e.interrupt.resumeId },
        "CJ"
      );
    } catch (e2) {
      if (!(e2 instanceof HITLInterruptException)) throw e2;

      console.log(`\n⏸  INTERRUPTED again at node "${e2.interrupt.node}"`);
      console.log(`   Prompt: "${e2.interrupt.prompt}"`);
      console.log(`\n   [Simulating human approving: true]`);

      finalState = await app.resume(
        { threadId, resumeId: e2.interrupt.resumeId },
        true
      );
    }
  }

  console.log("\n✅ Final state:");
  console.log("   Version: ", finalState!.version);
  console.log("   Deployer:", finalState!.deployer);
  console.log("   Approved:", finalState!.approved);
  console.log("   Logs:    ", finalState!.logs);
}

main().catch(console.error);
