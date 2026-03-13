// ============================================================
// @oni.bot/core — Research Pipeline (Fan-Out / Map-Reduce)
// ============================================================
// An automated research pipeline that breaks a question into
// sub-tasks, fans out to parallel researchers, validates the
// findings, and synthesizes a final report.
//
// Flow:
//   Question → Planner → [Researcher x N] → Fact Checker → Synthesizer
//
// Features demonstrated:
//   - Send API for dynamic fan-out (planner decides how many researchers)
//   - InMemoryStore for cross-thread knowledge base
//   - getStore() / getStreamWriter() from runtime context
//   - Circuit breaker on researcher nodes (resilient to failures)
//   - Dead letter queue for failed research tasks
//   - Custom stream events for real-time progress tracking
//   - Node timeouts
//
// Usage:
//   npx tsx examples/research-pipeline.ts
// ============================================================

import {
  StateGraph, START, END,
  Send,
  lastValue, appendList,
  MemoryCheckpointer,
  InMemoryStore,
} from "../src/index.js";
import { getStore, getStreamWriter } from "../src/context.js";

// -- State definition --

type Finding = { topic: string; content: string; verified: boolean };

type PipelineState = {
  question:  string;       // the original research question
  subtasks:  string[];     // planner output: list of sub-topics to research
  findings:  Finding[];    // collected from all researchers (appendList)
  verified:  Finding[];    // fact-checked subset (appendList)
  report:    string;       // final synthesized report
  logs:      string[];     // execution trace (appendList)
};

// -- Mock research data (simulates LLM + web search) --

const KNOWLEDGE_BASE: Record<string, string> = {
  "quantum computing hardware": "Superconducting qubits (IBM, Google) and trapped-ion "
    + "systems (IonQ, Quantinuum) lead the field. IBM's 1,121-qubit Condor processor "
    + "launched in 2023. Error correction remains the primary bottleneck.",
  "quantum algorithms": "Shor's algorithm threatens RSA encryption. Grover's algorithm "
    + "provides quadratic speedup for search. Variational Quantum Eigensolver (VQE) shows "
    + "promise for chemistry simulations. Quantum advantage demonstrated for specific tasks.",
  "post-quantum cryptography": "NIST standardized CRYSTALS-Kyber (key encapsulation) and "
    + "CRYSTALS-Dilithium (digital signatures) in 2024. Migration to PQC is underway in "
    + "banking and government. Lattice-based schemes are the frontrunners.",
  "quantum networking": "Quantum Key Distribution (QKD) networks operational in China "
    + "(2,000km backbone) and Europe. Quantum repeaters still experimental. Quantum internet "
    + "could enable unhackable communication within the next decade.",
  "default": "Recent developments show rapid progress across multiple fronts. Industry "
    + "investment exceeded $35B globally. Key challenges include error rates, coherence "
    + "times, and scaling beyond NISQ-era devices.",
};

function mockResearch(topic: string): string {
  const key = Object.keys(KNOWLEDGE_BASE).find((k) =>
    topic.toLowerCase().includes(k)
  );
  return KNOWLEDGE_BASE[key ?? "default"] ?? KNOWLEDGE_BASE["default"];
}

// -- Build the graph --

const graph = new StateGraph<PipelineState>({
  channels: {
    question: lastValue(() => ""),
    subtasks: lastValue(() => []),
    findings: appendList(() => []),
    verified: appendList(() => []),
    report:   lastValue(() => ""),
    logs:     appendList(() => []),
  },
});

// 1. Planner — decomposes the question into parallel research tasks
graph.addNode("planner", async (state) => {
  const writer = getStreamWriter();
  writer?.emit("progress", { phase: "planning", question: state.question });
  console.log(`[planner] Breaking down: "${state.question}"`);

  // In production, an LLM would generate these sub-tasks dynamically
  const subtasks = [
    "quantum computing hardware",
    "quantum algorithms",
    "post-quantum cryptography",
    "quantum networking",
  ];

  console.log(`[planner] Created ${subtasks.length} research tasks`);
  writer?.emit("progress", { phase: "plan_ready", subtasks });

  return { subtasks, logs: [`Planner created ${subtasks.length} sub-tasks`] };
}, { timeout: 30_000 });

// 2. Researcher — one instance per sub-task (fan-out via Send)
//    Circuit breaker protects against repeated failures
graph.addNode("researcher", async (state) => {
  const store = getStore()!;
  const writer = getStreamWriter();

  // Each researcher works on exactly one sub-task (the last one sent to it)
  const topic = state.subtasks[state.subtasks.length - 1] ?? state.question;
  writer?.emit("research_start", { topic });
  console.log(`  [researcher] Investigating: "${topic}"`);

  // Simulate occasional failures (10% chance) to exercise circuit breaker
  if (Math.random() < 0.1) {
    throw new Error(`Research source unavailable for "${topic}"`);
  }

  const content = mockResearch(topic);

  // Persist to cross-thread knowledge base so future runs benefit
  await store.put(["research", "findings"], topic, {
    content,
    source: "researcher",
    timestamp: Date.now(),
  });

  writer?.emit("research_complete", { topic, length: content.length });
  console.log(`  [researcher] Done: "${topic}" (${content.length} chars)`);

  return {
    findings: [{ topic, content, verified: false }],
    logs: [`Researcher completed: ${topic}`],
  };
}, {
  timeout: 30_000,
  // Circuit breaker: open after 3 consecutive failures, reset after 60s
  circuitBreaker: { threshold: 3, resetAfter: 60_000 },
});

// 3. Fact Checker — validates all collected findings
graph.addNode("fact_checker", async (state) => {
  const writer = getStreamWriter();
  writer?.emit("progress", { phase: "fact_checking", count: state.findings.length });
  console.log(`[fact_checker] Validating ${state.findings.length} findings...`);

  const verified: Finding[] = state.findings.map((f) => {
    // Mock validation: check if content has enough substance (> 50 chars)
    const isValid = f.content.length > 50;
    console.log(`  [fact_checker] ${f.topic}: ${isValid ? "VERIFIED" : "INSUFFICIENT"}`);
    return { ...f, verified: isValid };
  });

  const passCount = verified.filter((f) => f.verified).length;
  writer?.emit("progress", {
    phase: "fact_check_complete",
    verified: passCount,
    total: verified.length,
  });

  return {
    verified,
    logs: [`Fact checker: ${passCount}/${verified.length} findings verified`],
  };
}, { timeout: 30_000 });

// 4. Synthesizer — combines verified findings into a cohesive report
graph.addNode("synthesizer", async (state) => {
  const store = getStore()!;
  const writer = getStreamWriter();
  writer?.emit("progress", { phase: "synthesizing" });

  const validFindings = state.verified.filter((f) => f.verified);
  console.log(`[synthesizer] Merging ${validFindings.length} verified findings`);

  // Build the report from verified findings
  const sections = validFindings.map((f) =>
    `## ${f.topic.charAt(0).toUpperCase() + f.topic.slice(1)}\n${f.content}`
  );

  const report = [
    `# Research Report: ${state.question}`,
    `_Generated by ONI Research Pipeline | ${new Date().toISOString()}_\n`,
    `## Executive Summary`,
    `This report covers ${validFindings.length} research areas based on the question: "${state.question}".\n`,
    ...sections,
    `\n## Methodology`,
    `- ${state.subtasks.length} sub-tasks planned`,
    `- ${state.findings.length} raw findings collected`,
    `- ${validFindings.length} findings verified by fact-checker`,
  ].join("\n\n");

  // Store the final report for cross-thread access
  await store.put(["research", "reports"], state.question, {
    report,
    question: state.question,
    findingCount: validFindings.length,
    timestamp: Date.now(),
  });

  writer?.emit("progress", { phase: "complete", reportLength: report.length });
  console.log(`[synthesizer] Report ready (${report.length} chars)`);

  return {
    report,
    logs: [`Synthesizer produced report (${report.length} chars)`],
  };
}, { timeout: 30_000 });

// -- Wiring --

graph.addEdge(START, "planner");

// Planner fans out to N researchers via Send (dynamic fan-out)
graph.addConditionalEdges("planner", (state) =>
  state.subtasks.map((topic) => new Send("researcher", { subtasks: [topic] })) as any
);

// All researchers converge on the fact checker
graph.addEdge("researcher", "fact_checker");

// Fact checker feeds into synthesizer, then done
graph.addEdge("fact_checker", "synthesizer");
graph.addEdge("synthesizer", END);

// -- Compile with store + DLQ + checkpointer --

const store = new InMemoryStore();
const checkpointer = new MemoryCheckpointer<PipelineState>();

const app = graph.compile({
  checkpointer,
  store,
  deadLetterQueue: true, // capture failed researcher tasks
});

// ============================================================
// Run the pipeline
// ============================================================

async function main() {
  console.log("=".repeat(60));
  console.log("  @oni.bot/core — Research Pipeline");
  console.log("=".repeat(60));

  const question = process.argv[2]
    ?? "What is the current state of quantum computing and its impact on cryptography?";
  console.log(`\nQuestion: "${question}"\n`);

  // Stream execution to capture custom events in real time
  const customEvents: Array<{ name: string; data: unknown }> = [];
  let finalState: PipelineState | undefined;

  for await (const evt of app.stream(
    { question },
    { threadId: "research-001", streamMode: ["updates", "custom"] },
  )) {
    if ((evt as any).event === "custom") {
      const e = evt as any;
      customEvents.push({ name: e.name, data: e.data });
    }
    // Capture last state update
    if ((evt as any).event === "state_update" || (evt as any).event === "node_end") {
      finalState = (evt as any).data as PipelineState;
    }
  }

  // Fallback: read from checkpointer
  if (!finalState) {
    finalState = (await app.getState({ threadId: "research-001" })) ?? undefined;
  }

  // -- Display the report --
  if (finalState) {
    console.log("\n" + "=".repeat(60));
    console.log("  FINAL REPORT");
    console.log("=".repeat(60));
    console.log(finalState.report);

    console.log("\n" + "=".repeat(60));
    console.log("  EXECUTION SUMMARY");
    console.log("=".repeat(60));
    console.log("\nExecution log:");
    finalState.logs.forEach((l) => console.log(`  - ${l}`));
  }

  // -- Stream events captured --
  console.log(`\n--- Stream Events (${customEvents.length} captured) ---`);
  customEvents.forEach((e) =>
    console.log(`  [${e.name}] ${JSON.stringify(e.data)}`)
  );

  // -- Knowledge base contents --
  console.log("\n--- Knowledge Base (InMemoryStore) ---");
  const stored = await store.list(["research", "findings"]);
  stored.forEach((item) => {
    const content = (item.value as any).content as string;
    console.log(`  [${item.key}] ${content.slice(0, 80)}...`);
  });
  console.log(`  Total items: ${store.size()}`);

  // -- Dead letter queue --
  const deadLetters = app.getDeadLetters?.({ threadId: "research-001" }) ?? [];
  if (deadLetters.length > 0) {
    console.log(`\n--- Dead Letter Queue (${deadLetters.length} failed tasks) ---`);
    deadLetters.forEach((dl) =>
      console.log(`  [${dl.node}] ${dl.error.message} (attempts: ${dl.attempts})`)
    );
  } else {
    console.log("\n--- Dead Letter Queue: empty (all tasks succeeded) ---");
  }

  // -- Second run: knowledge base persists --
  console.log("\n--- Second run (different thread, same knowledge base) ---");
  const state2 = await app.invoke(
    { question: "Explain post-quantum cryptography standards" },
    { threadId: "research-002" },
  );
  console.log(`  Report length: ${state2.report.length} chars`);
  console.log(`  Store now has: ${store.size()} items`);

  console.log("\n" + "=".repeat(60));
  console.log("  Pipeline complete.");
  console.log("=".repeat(60));
}

main().catch(console.error);
