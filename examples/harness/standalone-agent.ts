// ============================================================
// @oni.bot/core — Standalone Harness Agent
// Minimal example: agentic loop with real LLM + tool use
// ============================================================
// Run: ANTHROPIC_API_KEY=sk-... npx tsx examples/harness/standalone-agent.ts

import { ONIHarness } from "../../src/harness/index.js";
import { anthropic } from "../../src/models/anthropic.js";
import { defineTool } from "../../src/tools/define.js";

// ── Define a tool ────────────────────────────────────────────
const currentTimeTool = defineTool({
  name: "get_current_time",
  description: "Returns the current date and time",
  schema: { type: "object", properties: {}, required: [] },
  execute: async () => {
    return { time: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  },
});

const calculateTool = defineTool({
  name: "calculate",
  description: "Evaluate a math expression and return the result",
  schema: {
    type: "object",
    properties: { expression: { type: "string", description: "Math expression to evaluate (e.g. '2 + 2')" } },
    required: ["expression"],
  },
  execute: async (input: { expression: string }) => {
    // Simple safe math evaluator (no eval)
    const expr = input.expression.replace(/[^0-9+\-*/.() ]/g, "");
    try {
      const result = Function(`"use strict"; return (${expr})`)();
      return { expression: input.expression, result: String(result) };
    } catch {
      return { expression: input.expression, error: "Invalid expression" };
    }
  },
});

// ── Create harness ───────────────────────────────────────────
const model = anthropic("claude-sonnet-4-20250514");
const fastModel = anthropic("claude-haiku-4-5-20251001");

const harness = ONIHarness.create({
  model,
  fastModel,
  soul: "You are a helpful assistant. Use your tools when needed. Be concise.",
  sharedTools: [currentTimeTool, calculateTool],
  maxTurns: 5,
});

// ── Run it ───────────────────────────────────────────────────
async function main() {
  console.log("ONI Standalone Agent Demo");
  console.log("=".repeat(40));

  const prompt = process.argv[2] ?? "What time is it right now? Also, what is 1337 * 42?";
  console.log(`\nPrompt: ${prompt}\n`);

  for await (const msg of harness.run(prompt, { name: "assistant" })) {
    switch (msg.type) {
      case "system":
        console.log(`  [system] ${msg.content}`);
        break;
      case "assistant":
        console.log(`  [assistant] ${msg.content}`);
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            console.log(`    → calling ${tc.name}(${JSON.stringify(tc.args)})`);
          }
        }
        break;
      case "tool_result":
        if (msg.toolResults) {
          for (const tr of msg.toolResults) {
            console.log(`  [${tr.toolName}] ${tr.content}`);
          }
        }
        break;
      case "result":
        console.log(`\n${"─".repeat(40)}`);
        console.log(`Final: ${msg.content}`);
        console.log(`Turns: ${msg.metadata?.totalTurns}`);
        break;
      case "error":
        console.error(`  [error] ${msg.content}`);
        break;
    }
  }
}

main().catch(console.error);
