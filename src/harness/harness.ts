// ============================================================
// @oni.bot/core/harness — ONIHarness Integration Class
// Wires all harness modules together and bridges to ONI-Core
// ============================================================

import { agentLoop, wrapWithAgentLoop } from "./agent-loop.js";
import { TodoModule } from "./todo-module.js";
import { HooksEngine } from "./hooks-engine.js";
import type { HooksConfig } from "./hooks-engine.js";
import { ContextCompactor } from "./context-compactor.js";
import { SafetyGate } from "./safety-gate.js";
import { SkillLoader } from "./skill-loader.js";
import type { SkillDefinition } from "./skill-loader.js";
import type {
  HarnessConfig,
  AgentNodeConfig,
  AgentLoopConfig,
  LoopMessage,
} from "./types.js";
import type { ToolDefinition } from "../tools/types.js";

// ─── SwarmAgentCompat ─────────────────────────────────────────────────────

export interface SwarmAgentCompat {
  name: string;
  description: string;
  capabilities: string[];
  handler: (state: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// ─── ONIHarness ───────────────────────────────────────────────────────────

export class ONIHarness {
  private readonly config: HarnessConfig;
  private readonly todoModule: TodoModule;
  private readonly hooksEngine: HooksEngine;
  private readonly compactor: ContextCompactor;
  private readonly safetyGate: SafetyGate;
  private readonly skillLoader: SkillLoader;

  private constructor(config: HarnessConfig) {
    this.config = config;

    // Create TodoModule
    this.todoModule = new TodoModule();

    // Create HooksEngine — compose user hooks with security guardrails
    const userEngine = new HooksEngine();
    if (config.hooks) {
      userEngine.configure(config.hooks);
    }
    this.hooksEngine = HooksEngine.compose(
      HooksEngine.withSecurityGuardrails(),
      userEngine,
    );

    // Create ContextCompactor with fastModel (or model if no fastModel)
    const summaryModel = config.fastModel ?? config.model;
    this.compactor = new ContextCompactor({
      summaryModel,
      threshold: config.compaction?.threshold,
      maxTokens: config.compaction?.maxTokens,
      charsPerToken: config.compaction?.charsPerToken,
      compactInstructions: config.compaction?.compactInstructions,
    });

    // Create SafetyGate with fastModel (or model)
    const safetyModel = config.fastModel ?? config.model;
    this.safetyGate = new SafetyGate({
      safetyModel,
      protectedTools: config.safety?.protectedTools,
      safetySystemPrompt: config.safety?.safetySystemPrompt,
      timeout: config.safety?.timeout,
    });

    // Create SkillLoader — from directories or empty
    if (config.skillPaths && config.skillPaths.length > 0) {
      this.skillLoader = SkillLoader.fromDirectories(config.skillPaths);
    } else {
      this.skillLoader = new SkillLoader();
    }
  }

  // ── Static Factory ──────────────────────────────────────────────────

  static create(config: HarnessConfig): ONIHarness {
    return new ONIHarness(config);
  }

  // ── Private: Build Loop Config ──────────────────────────────────────

  private buildLoopConfig(agentConfig: AgentNodeConfig): AgentLoopConfig {
    // Create a per-agent TodoModule so concurrent asNode() agents don't share state
    const todoModule = new TodoModule();

    // Fork the skill loader — shares the catalog but isolates pendingInjection per agent
    const skillLoader = this.skillLoader.fork();

    // Build systemPrompt from soul fragments + skill descriptions
    const systemPrompt = [
      this.config.soul,
      agentConfig.soul,
      skillLoader.getDescriptionsForContext(),
    ]
      .filter(Boolean)
      .join("\n\n");

    // Build tools array
    const tools: ToolDefinition[] = [
      ...todoModule.getTools(),
      skillLoader.getSkillTool(),
      ...(this.config.sharedTools ?? []),
      ...(agentConfig.tools ?? []),
    ];

    return {
      model: this.config.model,
      tools,
      agentName: agentConfig.name,
      systemPrompt,
      maxTurns: agentConfig.maxTurns ?? this.config.maxTurns,
      todoModule,
      hooksEngine: this.hooksEngine,
      compactor: this.compactor,
      safetyGate: this.safetyGate,
      skillLoader,
      // ── Memory config forwarded to loop ──
      memoryRoot: this.config.memoryRoot,
      memoryBudgets: this.config.memoryBudgets,
      memoryDebug: this.config.memoryDebug,
    };
  }

  // ── Public: run ─────────────────────────────────────────────────────

  async *run(
    prompt: string,
    agentConfig: AgentNodeConfig | string,
  ): AsyncGenerator<LoopMessage> {
    const config =
      typeof agentConfig === "string"
        ? { name: agentConfig }
        : agentConfig;

    const loopConfig = this.buildLoopConfig(config);
    yield* agentLoop(prompt, loopConfig);
  }

  // ── Public: runToResult ─────────────────────────────────────────────

  async runToResult(
    prompt: string,
    agentConfig: AgentNodeConfig | string,
  ): Promise<string> {
    let finalResult = "";
    let errorMsg: string | undefined;

    for await (const msg of this.run(prompt, agentConfig)) {
      if (msg.type === "result") {
        finalResult = msg.content ?? "";
      } else if (msg.type === "error") {
        errorMsg = msg.content ?? "Agent loop error";
      }
    }

    if (errorMsg !== undefined && finalResult === "") {
      throw new Error(errorMsg);
    }

    return finalResult;
  }

  // ── Public: asNode ──────────────────────────────────────────────────

  asNode<
    S extends Record<string, unknown> & {
      task?: string;
      context?: string;
      agentResults?: Record<string, string>;
    },
  >(agentConfig: AgentNodeConfig): (state: S) => Promise<Partial<S>> {
    const loopConfig = this.buildLoopConfig(agentConfig);
    return wrapWithAgentLoop<S>(loopConfig);
  }

  // ── Public: asSwarmAgent ────────────────────────────────────────────

  asSwarmAgent(
    name: string,
    soul: string,
    tools?: ToolDefinition[],
    opts?: { description?: string; capabilities?: string[] },
  ): SwarmAgentCompat {
    const agentConfig: AgentNodeConfig = { name, soul, tools };
    const loopConfig = this.buildLoopConfig(agentConfig);

    return {
      name,
      description: opts?.description ?? soul,
      capabilities: opts?.capabilities ?? [],
      handler: wrapWithAgentLoop(loopConfig),
    };
  }

  // ── Public: Module Access ───────────────────────────────────────────

  getTodoModule(): TodoModule {
    return this.todoModule;
  }

  getHooksEngine(): HooksEngine {
    return this.hooksEngine;
  }

  getSkillLoader(): SkillLoader {
    return this.skillLoader;
  }

  /**
   * Returns tools assembled by this harness instance.
   * Does NOT include agentConfig.tools (per-run) or memory_query (loop-created).
   * Used for test assertions and introspection.
   */
  getHarnessTools(): import("../tools/types.js").ToolDefinition[] {
    return [
      ...this.todoModule.getTools(),
      this.skillLoader.getSkillTool(),
      ...(this.config.sharedTools ?? []),
    ];
  }

  // ── Public: Runtime Registration ────────────────────────────────────

  registerSkill(skill: SkillDefinition): void {
    this.skillLoader.register(skill);
  }

  addHooks(config: HooksConfig): void {
    this.hooksEngine.configure(config);
  }
}
