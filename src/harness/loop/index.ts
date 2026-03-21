// ============================================================
// @oni.bot/core/harness/loop — Index
// agentLoop() + wrapWithAgentLoop() assembling all sub-modules.
// ============================================================

import type {
  ONIModelMessage,
  ChatResponse,
  LLMToolDef,
} from "../../models/types.js";
import type {
  AgentLoopConfig,
  LoopMessage,
} from "../types.js";
import { generateId } from "../types.js";
import type { SessionOutcome } from "../types.js";
import type { ToolDefinition } from "../../tools/types.js";
import { makeMessage } from "./types.js";

// Sub-module imports
import { runInference } from "./inference.js";
import { buildLLMTools, buildToolMap, executeTools } from "./tools.js";
import { initMemory, finalizeMemory } from "./memory.js";
import {
  fireSessionStart,
  fireSessionEnd,
  fireStop,
  firePreCompact,
  firePostCompact,
} from "./hooks.js";

// ─── agentLoop ─────────────────────────────────────────────────────────────

export async function* agentLoop(
  prompt: string,
  config: AgentLoopConfig,
): AsyncGenerator<LoopMessage> {
  const sessionId = generateId("ses");
  const threadId = config.threadId ?? generateId("thr");
  const maxTurns = config.maxTurns ?? 10;
  const messages: ONIModelMessage[] = config.initialMessages ? [...config.initialMessages] : [];
  let turn = 0;

  // ── 0. Memory init ───────────────────────────────────────────────────────
  const { memoryLoader, memoryContext } = initMemory(prompt, config);

  const effectiveSystemPrompt = memoryContext
    ? [memoryContext, config.systemPrompt].filter(Boolean).join("\n\n")
    : config.systemPrompt;

  let sessionOutcome: SessionOutcome = "completed";

  // ── 1. Session Init ──────────────────────────────────────────────────
  if (config.hooksEngine) {
    try {
      const hookResult = await fireSessionStart(
        config.hooksEngine, sessionId, config.agentName, config.tools.map((t) => t.name),
      );
      if (hookResult?.additionalContext) {
        messages.push({ role: "user", content: hookResult.additionalContext });
        messages.push({ role: "assistant", content: "Context loaded." });
      }
    } catch (err) {
      yield makeMessage("error", sessionId, turn, {
        content: `Session start hook failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  }

  // ── 1b. Build allTools ───────────────────────────────────────────────
  const allTools: ToolDefinition[] = memoryLoader
    ? [...config.tools, memoryLoader.getQueryTool()]
    : config.tools;

  messages.push({ role: "user", content: prompt });

  yield makeMessage("system", sessionId, turn, {
    subtype: "init",
    content: `Session ${sessionId} started for agent "${config.agentName}"`,
  });

  // ── 2. Build LLMToolDef[] ────────────────────────────────────────────
  const llmTools: LLMToolDef[] = buildLLMTools(allTools);
  const toolMap = buildToolMap(allTools);

  // ── 3. Main Loop ─────────────────────────────────────────────────────
  try {
    while (turn < maxTurns) {
      // ── 3a. Check AbortSignal ──────────────────────────────────────
      if (config.signal?.aborted) {
        sessionOutcome = "interrupted";
        yield makeMessage("error", sessionId, turn, { content: "Agent loop aborted by signal" });
        return;
      }

      // ── 3b. Context Compaction ─────────────────────────────────────
      if (config.compactor) {
        const compactionCheck = config.compactor.checkCompaction(messages);
        if (compactionCheck.needed) {
          const beforeCount = messages.length;
          yield makeMessage("system", sessionId, turn, {
            subtype: "compact_start",
            content: "Context compaction starting",
            metadata: {
              beforeCount,
              estimatedTokens: compactionCheck.estimatedTokens,
              threshold: compactionCheck.threshold,
              maxTokens: compactionCheck.maxTokens,
              percentUsed: compactionCheck.percentUsed,
            },
          });
          try {
            if (config.hooksEngine) {
              await firePreCompact(config.hooksEngine, sessionId, beforeCount, compactionCheck.estimatedTokens);
            }
            const compacted = await config.compactor.compact(messages, { skipInitialCheck: true });
            const estimatedTokensAfter = config.compactor.estimateTokens(compacted);
            const percentUsedAfter = compactionCheck.maxTokens > 0
              ? estimatedTokensAfter / compactionCheck.maxTokens : 0;
            const afterCount = compacted.length;
            const summarized = afterCount <= 2 && beforeCount > 2;
            messages.length = 0;
            messages.push(...compacted);
            yield makeMessage("system", sessionId, turn, {
              subtype: "compact_boundary",
              content: "Context compacted",
              metadata: {
                beforeCount, afterCount, summarized,
                estimatedTokensBefore: compactionCheck.estimatedTokens, estimatedTokensAfter,
                threshold: compactionCheck.threshold, maxTokens: compactionCheck.maxTokens,
                percentUsedBefore: compactionCheck.percentUsed, percentUsedAfter,
              },
            });
            if (config.hooksEngine) {
              await firePostCompact(config.hooksEngine, sessionId, beforeCount, afterCount, estimatedTokensAfter, summarized);
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            yield makeMessage("system", sessionId, turn, {
              subtype: "compact_error",
              content: `Context compaction failed: ${errorMsg}`,
              metadata: {
                beforeCount, afterCount: beforeCount,
                estimatedTokensBefore: compactionCheck.estimatedTokens,
                threshold: compactionCheck.threshold, maxTokens: compactionCheck.maxTokens,
                percentUsedBefore: compactionCheck.percentUsed, error: errorMsg,
              },
            });
          }
        }
      }

      // ── 3c. Build system prompt ────────────────────────────────────
      let systemPrompt = effectiveSystemPrompt;
      const remaining = maxTurns - turn;
      systemPrompt += `\n\nYou have ${remaining} turns remaining. Each turn lets you call multiple tools. Do NOT stop early — use your tools and complete the task autonomously.`;
      if (config.env) {
        // Sanitize env values to prevent prompt injection via crafted
        // git branch names or other untrusted environment strings.
        // Strips control characters (including newlines) and XML-escapes
        // <, >, & so values cannot break out of the <env> XML block.
        const sanitizeEnvValue = (v: string): string =>
          v
            .replace(/[\x00-\x1f\x7f]/g, "") // strip control chars / newlines
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const envLines: string[] = [];
        if (config.env.cwd) envLines.push(`Working directory: ${sanitizeEnvValue(config.env.cwd)}`);
        if (config.env.platform) envLines.push(`Platform: ${sanitizeEnvValue(config.env.platform)}`);
        if (config.env.date) envLines.push(`Date: ${sanitizeEnvValue(config.env.date)}`);
        if (config.env.gitBranch) envLines.push(`Git branch: ${sanitizeEnvValue(config.env.gitBranch)}`);
        if (config.env.gitStatus) envLines.push(`Git status: ${sanitizeEnvValue(config.env.gitStatus)}`);
        if (envLines.length > 0) systemPrompt += `\n\n<env>\n${envLines.join("\n")}\n</env>`;
      }

      // ── 3d. Skill filtering & injection ─────────────────────────────
      if (config.skillLoader && config.allowedSkills && turn === 0) {
        config.skillLoader.filterByAllowlist(config.allowedSkills);
      }
      if (config.skillLoader) {
        const pending = config.skillLoader.getPendingInjection();
        if (pending) {
          messages.push({ role: "user", content: pending });
          messages.push({ role: "assistant", content: "Skill instructions loaded." });
          config.skillLoader.clearPendingInjection();
        }
      }

      // ── 3e. Yield step_start ───────────────────────────────────────
      const stepStartTime = Date.now();
      yield makeMessage("step_start", sessionId, turn, { metadata: { step: turn } });

      // ── 3f. Inference ──────────────────────────────────────────────
      const inferenceResult = await runInference(messages, llmTools, systemPrompt, config, sessionId, turn);
      for (const evt of inferenceResult.events) yield evt;

      if (!inferenceResult.succeeded) {
        sessionOutcome = "error";
        yield makeMessage("error", sessionId, turn, {
          content: `Inference error: ${inferenceResult.lastError instanceof Error ? inferenceResult.lastError.message : String(inferenceResult.lastError)}`,
          metadata: { finalMessages: messages },
        });
        return;
      }

      const response = inferenceResult.response as ChatResponse;

      // ── 3g. Yield assistant message ────────────────────────────────
      yield makeMessage("assistant", sessionId, turn, {
        content: response.content,
        toolCalls: response.toolCalls,
        metadata: { usage: response.usage, stopReason: response.stopReason },
      });

      // ── 3g2. Yield step_finish ─────────────────────────────────────
      yield makeMessage("step_finish", sessionId, turn, {
        metadata: {
          stepDurationMs: Date.now() - stepStartTime,
          usage: response.usage,
          stopReason: response.stopReason,
          toolCount: response.toolCalls?.length ?? 0,
        },
      });

      // ── 3h. Stop condition ─────────────────────────────────────────
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (config.hooksEngine) {
          const stopResult = await fireStop(config.hooksEngine, sessionId, response.content);
          if (stopResult?.decision === "block") {
            const feedback = stopResult.reason ?? "Please provide a more complete response.";
            messages.push({ role: "assistant", content: response.content });
            messages.push({ role: "user", content: feedback });
            turn++;
            continue;
          }
        }
        messages.push({ role: "assistant", content: response.content });
        yield makeMessage("result", sessionId, turn, {
          content: response.content,
          metadata: { totalTurns: turn + 1, finalMessages: messages },
        });
        return;
      }

      // ── 3i. Tool execution ─────────────────────────────────────────
      const { toolResults, events: toolEvents } = await executeTools(response.toolCalls, {
        sessionId,
        threadId,
        turn,
        config,
        toolMap,
        hasMemoryLoader: memoryLoader !== null,
      });

      // Yield events emitted during tool execution (tool_start, tool_metadata)
      for (const evt of toolEvents) yield evt;

      // ── 3j. Update messages ────────────────────────────────────────
      messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
      for (const tr of toolResults) {
        messages.push({ role: "tool", content: tr.content, toolCallId: tr.toolCallId, name: tr.toolName });
      }

      // ── 3j. TODO reminder ──────────────────────────────────────────
      if (config.todoModule) {
        const todoState = config.todoModule.getState();
        if (todoState.todos.length > 0) {
          const reminder = config.todoModule.toContextString();
          messages.push({ role: "user", content: `<system-reminder>\n${reminder}\n</system-reminder>` });
          messages.push({ role: "assistant", content: "Noted." });
          yield makeMessage("system", sessionId, turn, { subtype: "todo_reminder", content: reminder });
        }
      }

      // ── 3k. Yield tool_result, increment turn ──────────────────────
      yield makeMessage("tool_result", sessionId, turn, { toolResults });
      turn++;
    }

    // Post-loop: maxTurns exhausted
    sessionOutcome = "budget-exceeded";
    yield makeMessage("error", sessionId, turn, {
      content: `Agent loop exceeded maxTurns (${maxTurns})`,
      metadata: { finalMessages: messages },
    });
  } catch (err) {
    sessionOutcome = "error";
    yield makeMessage("error", sessionId, turn, {
      content: `Agent loop error: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { finalMessages: messages },
    });
  } finally {
    if (config.hooksEngine) {
      try {
        await fireSessionEnd(config.hooksEngine, sessionId, sessionOutcome, turn);
      } catch (e) {
        console.warn("[oni] fireSessionEnd hook failed:", e);
      }
    }
    try {
      finalizeMemory(memoryLoader, sessionId, prompt, turn, sessionOutcome, config);
    } catch (e) {
      console.warn("[oni] finalizeMemory failed:", e);
    }
  }
}

// ─── wrapWithAgentLoop ─────────────────────────────────────────────────────

export function wrapWithAgentLoop<
  S extends Record<string, unknown> & {
    task?: string;
    context?: string;
    agentResults?: Record<string, string>;
  },
>(config: AgentLoopConfig): (state: S) => Promise<Partial<S>> {
  return async (state: S): Promise<Partial<S>> => {
    const prompt =
      (state.task as string | undefined) ??
      (state.context as string | undefined) ??
      "";

    let finalResult = "";
    let hasResult = false;
    let lastError = "";
    for await (const msg of agentLoop(prompt, config)) {
      if (msg.type === "result") {
        finalResult = msg.content ?? "";
        hasResult = true;
      } else if (msg.type === "error") {
        lastError = msg.content ?? "Unknown agent loop error";
      }
    }

    if (!hasResult && lastError) {
      throw new Error(`Agent "${config.agentName}" failed: ${lastError}`);
    }

    return {
      agentResults: { ...(state.agentResults ?? {}), [config.agentName]: finalResult },
    } as Partial<S>;
  };
}
