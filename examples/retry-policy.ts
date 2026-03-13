// ============================================================
// @oni.bot/core — Example: Retry Policies
// ============================================================

import {
  StateGraph, START, END,
  lastValue, appendList, NodeExecutionError,
} from "../src/index.js";

type RetryState = {
  result: string;
  logs:   string[];
};

let callCount = 0;

const graph = new StateGraph<RetryState>({
  channels: {
    result: lastValue(() => ""),
    logs:   appendList(() => []),
  },
});

graph.addNode(
  "flaky_service",
  async (state) => {
    callCount++;
    console.log(`[flaky_service] attempt #${callCount}`);

    if (callCount < 3) {
      throw new Error(`Service unavailable (attempt ${callCount})`);
    }

    return { result: "Success!", logs: [`completed on attempt ${callCount}`] };
  },
  {
    retry: {
      maxAttempts:       5,
      initialDelay:      100,
      backoffMultiplier: 2,
      maxDelay:          2000,
      // Only retry on network/service errors, not logic errors
      retryOn: (err) => err.message.includes("unavailable"),
    },
  }
);

graph.addEdge(START,           "flaky_service");
graph.addEdge("flaky_service", END);

const app = graph.compile();

async function main() {
  console.log("@oni.bot/core — Retry Policy Example");
  console.log("=".repeat(50));

  try {
    const result = await app.invoke({});
    console.log("\n✅ Result:", result.result);
    console.log("   Logs:  ", result.logs);
  } catch (e) {
    if (e instanceof NodeExecutionError) {
      console.error(`❌ Node failed after all retries: ${e.message}`);
    } else {
      throw e;
    }
  }
}

main().catch(console.error);
