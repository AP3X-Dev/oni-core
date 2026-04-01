// ============================================================
// @oni.bot/core — Demo: Multi-Agent Content Pipeline (OpenAI)
// ============================================================
// A content production pipeline with REAL LLM calls via OpenAI.
// Three agents collaborate via peer-to-peer swarm edges:
//   Researcher → Writer → Editor → (Writer revision) → Editor → Done
//
// Features demonstrated:
//   - SwarmGraph with peer-to-peer handoffs
//   - Custom channels on BaseSwarmState
//   - MemoryCheckpointer + checkpoint history time-travel
//   - InMemoryStore (cross-thread persistence)
//   - Mailbox messaging (createMessage / getInbox)
//   - Conditional handoff (editor → writer revision loop)
//   - Streaming with streamMode: "updates"
//   - Agent stats + store contents
//
// Requires: OPENAI_API_KEY environment variable
//
// Run:  npx tsx examples/demo-content-pipeline.ts
//       pnpm run demo
// ============================================================

import OpenAI from "openai";
import {
  StateGraph, START, END,
  lastValue, appendList, mergeObject,
  MemoryCheckpointer,
  InMemoryStore,
} from "../src/index.js";
import {
  SwarmGraph, createMessage, getInbox,
  type BaseSwarmState, type SwarmMessage,
} from "../src/swarm/index.js";

// ----------------------------------------------------------------
// OpenAI client
// ----------------------------------------------------------------

const openai = new OpenAI(); // reads OPENAI_API_KEY from env
const MODEL = "gpt-4o-mini";

async function chat(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 1024,
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

// ----------------------------------------------------------------
// 1. Extended State
// ----------------------------------------------------------------

type PipelineState = BaseSwarmState & {
  research:    string;
  draft:       string;
  editorNotes: string;
  revision:    number;
  finalDraft:  string;
};

function makeChannels() {
  return {
    task:            lastValue(() => ""),
    context:         mergeObject(() => ({})),
    agentResults:    mergeObject(() => ({})),
    messages:        appendList<{ role: string; content: string }>(() => []),
    swarmMessages:   appendList<SwarmMessage>(() => []),
    supervisorRound: lastValue(() => 0),
    currentAgent:    lastValue(() => null),
    done:            lastValue(() => false),
    handoffHistory:  appendList(() => []),
    research:        lastValue(() => ""),
    draft:           lastValue(() => ""),
    editorNotes:     lastValue(() => ""),
    revision:        lastValue(() => 0),
    finalDraft:      lastValue(() => ""),
  };
}

// ----------------------------------------------------------------
// Shared store
// ----------------------------------------------------------------

const store = new InMemoryStore();

// ----------------------------------------------------------------
// 2. Agent Skeletons — each calls OpenAI
// ----------------------------------------------------------------

function buildResearcherSkeleton() {
  const g = new StateGraph<PipelineState>({ channels: makeChannels() });

  g.addNode("do-research", async (state) => {
    const topic = state.task;
    log("researcher", `Researching "${topic}"...`);

    const research = await chat(
      `You are a research specialist. Produce concise, factual research notes on a given topic. Include 3-5 key findings with brief supporting detail. Output plain text, no markdown headers.`,
      `Research the following topic thoroughly:\n\n${topic}`,
    );

    log("researcher", `Research complete (${research.length} chars)`);

    // Persist in cross-thread store
    await store.put(["research", "findings"], topic, {
      topic,
      research,
      timestamp: Date.now(),
    });
    log("researcher", `Stored findings in InMemoryStore`);

    // Mailbox → writer
    const msg = createMessage(
      "researcher",
      "writer",
      `Research complete for "${topic}". Findings stored — read from store.`,
    );

    return {
      research,
      swarmMessages: [msg],
      messages: [{ role: "assistant", content: `[researcher] Research complete` }],
    };
  });

  g.addEdge(START, "do-research");
  g.addEdge("do-research", END);
  return g.compile();
}

function buildWriterSkeleton() {
  const g = new StateGraph<PipelineState>({ channels: makeChannels() });

  g.addNode("write-draft", async (state) => {
    // Check mailbox
    const inbox = getInbox(state.swarmMessages, "writer");
    if (inbox.length > 0) {
      log("writer", `Mailbox: ${inbox.length} message(s)`);
    }

    // Read research from store
    const stored = await store.get<{ research: string }>(
      ["research", "findings"],
      state.task,
    );
    const researchText = stored?.value.research ?? state.research;

    const isRevision = state.revision > 0;

    if (isRevision) {
      log("writer", `Revising draft (revision #${state.revision})...`);

      const draft = await chat(
        `You are a professional content writer. Revise the draft below based on editor feedback. Maintain the same topic and incorporate the research. Output the full revised article as plain text.`,
        [
          `TOPIC: ${state.task}`,
          ``,
          `RESEARCH:\n${researchText}`,
          ``,
          `CURRENT DRAFT:\n${state.draft}`,
          ``,
          `EDITOR FEEDBACK:\n${state.editorNotes}`,
          ``,
          `Write the revised article:`,
        ].join("\n"),
      );

      log("writer", `Revision complete (${draft.length} chars)`);

      return {
        draft,
        messages: [{ role: "assistant", content: `[writer] Draft revised (v${state.revision + 1})` }],
      };
    }

    log("writer", `Writing first draft on "${state.task}"...`);

    const draft = await chat(
      `You are a professional content writer. Write a short article (3-4 paragraphs) based on the provided research. Write in a clear, engaging style. Output plain text, no markdown.`,
      [
        `TOPIC: ${state.task}`,
        ``,
        `RESEARCH:\n${researchText}`,
        ``,
        `Write the article:`,
      ].join("\n"),
    );

    log("writer", `First draft complete (${draft.length} chars)`);

    return {
      draft,
      messages: [{ role: "assistant", content: `[writer] First draft complete` }],
    };
  });

  g.addEdge(START, "write-draft");
  g.addEdge("write-draft", END);
  return g.compile();
}

function buildEditorSkeleton() {
  const g = new StateGraph<PipelineState>({ channels: makeChannels() });

  g.addNode("review-draft", async (state) => {
    log("editor", `Reviewing draft (revision #${state.revision})...`);

    const isFirstReview = state.revision === 0;

    if (isFirstReview) {
      // First review: ask LLM for constructive feedback
      const feedback = await chat(
        `You are a demanding editor. Review the draft below and provide specific, actionable feedback for improvement. Be critical but constructive. Focus on structure, evidence, and clarity. Keep feedback to 2-3 sentences.`,
        [
          `TOPIC: ${state.task}`,
          ``,
          `DRAFT:\n${state.draft}`,
          ``,
          `Provide your editorial feedback:`,
        ].join("\n"),
      );

      log("editor", `CHANGES REQUESTED`);

      const msg = createMessage("editor", "writer", feedback);

      return {
        editorNotes: feedback,
        revision:    state.revision + 1,
        swarmMessages: [msg],
        messages: [{ role: "assistant", content: `[editor] Changes requested` }],
      };
    }

    // Second+ review: ask LLM to evaluate if improved
    const verdict = await chat(
      `You are an editor doing a final review. The writer revised their draft based on your previous feedback. Evaluate if the revision is acceptable. Respond with EXACTLY "APPROVED" on the first line, followed by a brief comment. Always approve on a second revision.`,
      [
        `TOPIC: ${state.task}`,
        `PREVIOUS FEEDBACK: ${state.editorNotes}`,
        ``,
        `REVISED DRAFT:\n${state.draft}`,
        ``,
        `Your verdict:`,
      ].join("\n"),
    );

    log("editor", `APPROVED`);

    return {
      editorNotes: verdict,
      finalDraft:  state.draft,
      done:        true,
      messages: [{ role: "assistant", content: `[editor] Draft approved!` }],
    };
  });

  g.addEdge(START, "review-draft");
  g.addEdge("review-draft", END);
  return g.compile();
}

// ----------------------------------------------------------------
// 3. Assemble the Swarm
// ----------------------------------------------------------------

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required.");
    console.error("Set it with: export OPENAI_API_KEY=sk-...");
    process.exit(1);
  }

  console.log();
  console.log("=".repeat(60));
  console.log("  @oni.bot/core — Multi-Agent Content Pipeline Demo");
  console.log(`  Model: ${MODEL}`);
  console.log("=".repeat(60));
  console.log();

  const swarm = new SwarmGraph<PipelineState>({
    research:    lastValue(() => ""),
    draft:       lastValue(() => ""),
    editorNotes: lastValue(() => ""),
    revision:    lastValue(() => 0),
    finalDraft:  lastValue(() => ""),
  } as any);

  swarm.addAgent({
    id:           "researcher",
    role:         "Research Specialist",
    capabilities: [{ name: "research", description: "Researches topics and stores findings" }],
    skeleton:     buildResearcherSkeleton() as any,
  });

  swarm.addAgent({
    id:           "writer",
    role:         "Content Writer",
    capabilities: [{ name: "writing", description: "Writes and revises drafts" }],
    skeleton:     buildWriterSkeleton() as any,
  });

  swarm.addAgent({
    id:           "editor",
    role:         "Quality Editor",
    capabilities: [{ name: "editing", description: "Reviews drafts and requests revisions" }],
    skeleton:     buildEditorSkeleton() as any,
  });

  // Peer-to-peer pipeline with editor → writer revision loop
  swarm.addEdge(START,         "researcher");
  swarm.addEdge("researcher",  "writer");
  swarm.addEdge("writer",      "editor");
  swarm.addConditionalHandoff("editor", (state) => {
    return state.done ? END : "writer";
  });

  const checkpointer = new MemoryCheckpointer<PipelineState>();
  const app = swarm.compile({ checkpointer });

  const threadId = "content-pipeline-001";
  const topic = "The Rise of Multi-Agent AI Systems";

  console.log(`Topic: "${topic}"`);
  console.log(`Thread: ${threadId}`);
  console.log();
  console.log("-".repeat(60));
  console.log("  Execution Trace");
  console.log("-".repeat(60));

  let eventCount = 0;
  for await (const evt of app.stream(
    { task: topic, context: { round: 0 } },
    { threadId, streamMode: "updates" },
  )) {
    eventCount++;
    if (evt.event === "node_end") {
      const data = evt.data as Partial<PipelineState>;
      const keys = Object.keys(data).filter(
        (k) => !["agentResults", "handoffHistory", "context"].includes(k),
      );
      console.log(`  << [step ${evt.step}] ${evt.node} completed  (updated: ${keys.join(", ")})`);
    }
  }

  // ---- Results ----
  console.log();
  console.log("-".repeat(60));
  console.log("  Final Output");
  console.log("-".repeat(60));

  const finalState = await app.getState({ threadId });
  if (finalState) {
    console.log();
    console.log(finalState.finalDraft || "(no final draft)");
    console.log();
    console.log("-".repeat(60));
    console.log(`  Revisions:    ${finalState.revision}`);
    console.log(`  Editor Notes: ${finalState.editorNotes}`);
    console.log(`  Done:         ${finalState.done}`);
  }

  // Agent stats
  console.log();
  console.log("-".repeat(60));
  console.log("  Agent Stats");
  console.log("-".repeat(60));
  const stats = app.agentStats();
  for (const [id, s] of Object.entries(stats)) {
    console.log(`  ${id.padEnd(12)} runs=${s.totalRuns}  errors=${s.errors}  status=${s.status}`);
  }

  // Checkpoint history
  console.log();
  console.log("-".repeat(60));
  console.log("  Checkpoint History");
  console.log("-".repeat(60));
  const history = await checkpointer.list(threadId);
  for (const cp of history) {
    const agent = cp.agentId ?? cp.metadata?.node ?? "-";
    console.log(
      `  step ${String(cp.step).padStart(2)}  done=${String(cp.state.done).padEnd(5)}  revision=${cp.state.revision}`,
    );
  }

  // Store
  console.log();
  console.log("-".repeat(60));
  console.log("  InMemoryStore");
  console.log("-".repeat(60));
  const items = await store.list(["research", "findings"]);
  for (const item of items) {
    const val = item.value as { research: string };
    console.log(`  key="${item.key}"`);
    console.log(`  research=${val.research.slice(0, 120)}...`);
  }

  console.log();
  console.log(`  Stream events: ${eventCount}`);
  console.log();
  console.log("=".repeat(60));
  console.log("  Demo complete!");
  console.log("=".repeat(60));
  console.log();
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function log(agent: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`  [${ts}] [${agent}] ${msg}`);
}

// ----------------------------------------------------------------
// Run
// ----------------------------------------------------------------

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
