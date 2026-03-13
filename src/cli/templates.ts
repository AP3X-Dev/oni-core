// ============================================================
// @oni.bot/core CLI — Project templates
// ============================================================

export const templates = {
  packageJson(name: string): string {
    const pkg = {
      name,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "tsx watch src/index.ts",
        build: "tsc",
        start: "node dist/index.js",
        test: "vitest run",
      },
      dependencies: {
        "@oni.bot/core": "^0.8.0",
      },
      devDependencies: {
        tsx: "^4.0.0",
        typescript: "^5.4.0",
        vitest: "^4.0.0",
        "@types/node": "^20.0.0",
      },
    };
    return JSON.stringify(pkg, null, 2) + "\n";
  },

  tsconfig(): string {
    const config = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        outDir: "./dist",
        rootDir: "./src",
        declaration: true,
        strict: true,
        skipLibCheck: true,
      },
      include: ["src/**/*"],
    };
    return JSON.stringify(config, null, 2) + "\n";
  },

  entrypoint(): string {
    return `import { StateGraph, START, END, lastValue, appendList } from "@oni.bot/core";
import { MemoryCheckpointer } from "@oni.bot/core";
import type { Message } from "@oni.bot/core";

// Define your state
type AgentState = {
  messages: Message[];
  result: string;
};

// Build the graph
const graph = new StateGraph<AgentState>({
  channels: {
    messages: appendList<Message>(),
    result: lastValue(() => ""),
  },
});

// Add nodes
graph.addNode("process", async (state) => {
  const lastMessage = state.messages[state.messages.length - 1];
  return {
    result: \`Processed: \${lastMessage?.content ?? "no input"}\`,
  };
});

// Wire edges
graph.addEdge(START, "process");
graph.addEdge("process", END);

// Compile with checkpointing
const app = graph.compile({
  checkpointer: new MemoryCheckpointer(),
});

// Run it
const result = await app.invoke(
  { messages: [{ id: "1", role: "user", content: "Hello, ONI!" }] },
  { threadId: "demo-1" },
);

console.log("Result:", result.result);
`;
  },

  test(): string {
    return `import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "@oni.bot/core";
import { createTestHarness } from "@oni.bot/core/testing";

describe("my agent", () => {
  it("processes input", async () => {
    type S = { value: string };
    const graph = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    graph.addNode("echo", async (s) => ({ value: s.value + "!" }));
    graph.addEdge(START, "echo");
    graph.addEdge("echo", END);

    const harness = createTestHarness(graph);
    const result = await harness.invoke({ value: "test" });
    expect(result.value).toBe("test!");
  });
});
`;
  },

  harnessAgent(): string {
    return `import { ONIHarness } from "@oni.bot/core/harness";
import { anthropic } from "@oni.bot/core/models";
import { defineTool } from "@oni.bot/core/tools";

const model = anthropic("claude-sonnet-4-20250514");
const fastModel = anthropic("claude-haiku-4-5-20251001");

const greetTool = defineTool({
  name: "greet",
  description: "Generate a greeting for a person",
  schema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  execute: async (input: { name: string }) => \`Hello, \${input.name}!\`,
});

const harness = ONIHarness.create({
  model,
  fastModel,
  soul: "You are a helpful assistant. Use tools when needed.",
  sharedTools: [greetTool],
  maxTurns: 5,
});

async function main() {
  const prompt = process.argv[2] ?? "Greet the user with a warm welcome";
  console.log("Running agent...");

  for await (const msg of harness.run(prompt, { name: "assistant" })) {
    if (msg.type === "assistant") console.log("[assistant]", msg.content);
    if (msg.type === "result") console.log("\\nResult:", msg.content);
  }
}

main().catch(console.error);
`;
  },

  gitignore(): string {
    return `node_modules/
dist/
*.js.map
.env
`;
  },
};
