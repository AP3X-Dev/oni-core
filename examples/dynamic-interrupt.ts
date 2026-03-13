// ============================================================
// @oni.bot/core — Example: Dynamic Interrupts
// ============================================================
// Unlike static interruptBefore/After, dynamic interrupts fire
// conditionally based on runtime state.
// ============================================================

import {
  StateGraph, START, END,
  MemoryCheckpointer, lastValue, appendList,
  ONIInterrupt,
} from "../src/index.js";

type ReviewState = {
  amount:   number;
  approved: boolean;
  notes:    string[];
};

const graph = new StateGraph<ReviewState>({
  channels: {
    amount:   lastValue(() => 0),
    approved: lastValue(() => false),
    notes:    appendList(() => []),
  },
});

graph.addNode("validate", async (state) => {
  console.log(`[validate] amount=$${state.amount}`);
  return { notes: [`Validated amount: $${state.amount}`] };
});

graph.addNode("process", async (state) => {
  console.log(`[process] approved=${state.approved}`);
  return { notes: ["Processed."] };
});

graph.addEdge(START,      "validate");
graph.addEdge("validate", "process");
graph.addEdge("process",  END);

const checkpointer = new MemoryCheckpointer<ReviewState>();
const app = graph.compile({ checkpointer });

async function run(amount: number, threadId: string) {
  console.log(`\n--- Running: amount=$${amount} thread="${threadId}" ---`);
  try {
    const result = await app.invoke(
      { amount },
      {
        threadId,
        // Dynamic interrupt: pause after validate if amount > 1000
        dynamicInterrupts: [
          {
            node:      "validate",
            timing:    "after",
            condition: (state: ReviewState) => state.amount > 1000,
          },
        ],
      }
    );
    console.log("✅ Completed. Notes:", result.notes);
  } catch (e) {
    if (e instanceof ONIInterrupt) {
      console.log(`⏸  Interrupted ${e.timing} "${e.node}" (high value transaction!)`);
      // Simulate human review
      await app.updateState({ threadId }, { approved: true, notes: ["Human approved."] });
      // Resume without the dynamic interrupt this time
      const result = await app.invoke({}, { threadId });
      console.log("✅ Resumed. Notes:", result.notes);
    } else {
      throw e;
    }
  }
}

async function main() {
  console.log("@oni.bot/core — Dynamic Interrupts Example");
  console.log("=".repeat(50));

  await run(500,   "thread-low");
  await run(50000, "thread-high");
}

main().catch(console.error);
