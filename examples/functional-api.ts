// ============================================================
// @oni.bot/core — Example: Functional API (entrypoint + task + pipe)
// ============================================================

import {
  lastValue, appendList,
  entrypoint, task, pipe, branch,
  getUserApproval, HITLInterruptException,
  MemoryCheckpointer,
} from "../src/index.js";

// ---- tasks: reusable units ----

const fetchData = task("fetchData", async (url: string) => {
  console.log(`[fetchData] ${url}`);
  return { data: `data from ${url}` };
});

const processData = task("processData", async (data: string) => {
  console.log(`[processData] ${data}`);
  return data.toUpperCase();
});

// ---- entrypoint: single-function skeleton ----

const simplePipeline = entrypoint(
  {
    channels: {
      url:     lastValue(() => ""),
      result:  lastValue(() => ""),
    },
  },
  async (state) => {
    const { data } = await fetchData.invoke(state.url);
    const result   = await processData.invoke(data);
    return { result };
  }
);

// ---- pipe: multi-step linear pipeline ----

type PipeState = { input: string; step1: string; step2: string; output: string };

const linearPipeline = pipe(
  {
    channels: {
      input:  lastValue(() => ""),
      step1:  lastValue(() => ""),
      step2:  lastValue(() => ""),
      output: lastValue(() => ""),
    },
  },
  async (state) => ({ step1: `[A:${state.input}]` }),
  async (state) => ({ step2: `[B:${state.step1}]` }),
  async (state) => ({ output: `[C:${state.step2}]` })
);

// ---- entrypoint with HITL ----

const checkpointer = new MemoryCheckpointer<{ action: string; approved: boolean; log: string[] }>();

const approvalFlow = entrypoint(
  {
    channels: {
      action:   lastValue(() => ""),
      approved: lastValue(() => false),
      log:      appendList(() => []),
    },
    checkpointer,
  },
  async (state) => {
    console.log(`[approvalFlow] action="${state.action}"`);
    const ok = await getUserApproval(`Execute: "${state.action}"?`);
    return { approved: ok, log: [`Decision: ${ok}`] };
  }
);

async function main() {
  console.log("@oni.bot/core — Functional API Example");
  console.log("=".repeat(55));

  // entrypoint
  const r1 = await simplePipeline.invoke({ url: "https://api.example.com/data" });
  console.log("\n✅ entrypoint result:", r1.result);

  // pipe
  const r2 = await linearPipeline.invoke({ input: "hello" });
  console.log("✅ pipe result:       ", r2.output);

  // entrypoint with HITL
  const threadId = "approval-1";
  try {
    await approvalFlow.invoke({ action: "delete all records" }, { threadId });
  } catch (e) {
    if (!(e instanceof HITLInterruptException)) throw e;
    console.log(`\n⏸  "${e.interrupt.prompt}"`);
    console.log("   → Simulating: true");
    const r3 = await approvalFlow.resume({ threadId, resumeId: e.interrupt.resumeId }, true);
    console.log("✅ approval result:  approved =", r3.approved);
  }
}

main().catch(console.error);
