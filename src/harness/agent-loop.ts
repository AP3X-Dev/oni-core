// ============================================================
// @oni.bot/core/harness — AgentLoop
// Think → Act → Observe async generator driving each agent node
// ============================================================

import type {
  ONIModel,
  ONIModelMessage,
  ONIModelToolCall,
  ChatResponse,
  LLMToolDef,
} from "../models/types.js";
import type { ToolDefinition, ToolContext } from "../tools/types.js";
import type {
  AgentLoopConfig,
  LoopMessage,
  LoopMessageType,
  LoopToolResult,
  HarnessToolContext,
} from "./types.js";
import { generateId } from "./types.js";
import { validateToolArgs } from "./validate-args.js";

// ─── agentLoop ─────────────────────────────────────────────────────────────

export async function* agentLoop(
  prompt: string,
  config: AgentLoopConfig,
): AsyncGenerator<LoopMessage> {
  const sessionId = generateId("ses");
  const threadId = config.threadId ?? generateId("thr");
  const maxTurns = config.maxTurns ?? 10;
  const messages: ONIModelMessage[] = config.initialMessages
    ? [...config.initialMessages]
    : [];
  let turn = 0;

  // ── 1. Session Init ──────────────────────────────────────────────────

  if (config.hooksEngine) {
    const hookResult = await config.hooksEngine.fire("SessionStart", {
      sessionId,
      agentName: config.agentName,
      tools: config.tools.map((t) => t.name),
    });

    if (hookResult?.additionalContext) {
      messages.push({ role: "user", content: hookResult.additionalContext });
      messages.push({ role: "assistant", content: "Context loaded." });
    }
  }

  // Push user prompt
  messages.push({ role: "user", content: prompt });

  yield makeMessage("system", sessionId, turn, {
    subtype: "init",
    content: `Session ${sessionId} started for agent "${config.agentName}"`,
  });

  // ── 2. Build LLMToolDef[] ────────────────────────────────────────────

  const llmTools: LLMToolDef[] = config.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.schema,
  }));

  // Tool lookup map
  const toolMap = new Map<string, ToolDefinition>();
  for (const t of config.tools) {
    toolMap.set(t.name, t);
  }

  // ── 3. Main Loop ─────────────────────────────────────────────────────

  while (turn < maxTurns) {
    // ── 3a. Check AbortSignal ────────────────────────────────────────
    if (config.signal?.aborted) {
      yield makeMessage("error", sessionId, turn, {
        content: "Agent loop aborted by signal",
      });
      return;
    }

    // ── 3b. Context Compaction ───────────────────────────────────────
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
            await config.hooksEngine.fire("PreCompact", {
              sessionId,
              messageCount: beforeCount,
              estimatedTokens: compactionCheck.estimatedTokens,
            });
          }

          const compacted = await config.compactor.compact(messages, { skipInitialCheck: true });
          const estimatedTokensAfter = config.compactor.estimateTokens(compacted);
          const percentUsedAfter = compactionCheck.maxTokens > 0
            ? estimatedTokensAfter / compactionCheck.maxTokens
            : 0;
          const afterCount = compacted.length;
          const summarized = afterCount <= 2 && beforeCount > 2;

          messages.length = 0;
          messages.push(...compacted);

          yield makeMessage("system", sessionId, turn, {
            subtype: "compact_boundary",
            content: "Context compacted",
            metadata: {
              beforeCount,
              afterCount,
              summarized,
              estimatedTokensBefore: compactionCheck.estimatedTokens,
              estimatedTokensAfter,
              threshold: compactionCheck.threshold,
              maxTokens: compactionCheck.maxTokens,
              percentUsedBefore: compactionCheck.percentUsed,
              percentUsedAfter,
            },
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          yield makeMessage("system", sessionId, turn, {
            subtype: "compact_error",
            content: `Context compaction failed: ${errorMsg}`,
            metadata: {
              beforeCount,
              afterCount: beforeCount,
              estimatedTokensBefore: compactionCheck.estimatedTokens,
              threshold: compactionCheck.threshold,
              maxTokens: compactionCheck.maxTokens,
              percentUsedBefore: compactionCheck.percentUsed,
              error: errorMsg,
            },
          });
        }
      }
    }

    // ── 3c. Build system prompt ──────────────────────────────────────
    let systemPrompt = config.systemPrompt;

    // Inject remaining turns so the model knows its budget
    const remaining = maxTurns - turn;
    systemPrompt += `\n\nYou have ${remaining} turns remaining. Each turn lets you call multiple tools. Do NOT stop early — use your tools and complete the task autonomously.`;

    if (config.env) {
      const envLines: string[] = [];
      if (config.env.cwd) envLines.push(`Working directory: ${config.env.cwd}`);
      if (config.env.platform) envLines.push(`Platform: ${config.env.platform}`);
      if (config.env.date) envLines.push(`Date: ${config.env.date}`);
      if (config.env.gitBranch) envLines.push(`Git branch: ${config.env.gitBranch}`);
      if (config.env.gitStatus) envLines.push(`Git status: ${config.env.gitStatus}`);
      if (envLines.length > 0) {
        systemPrompt += `\n\n<env>\n${envLines.join("\n")}\n</env>`;
      }
    }

    // ── 3d. Skill injection ──────────────────────────────────────────
    if (config.skillLoader) {
      const pending = config.skillLoader.getPendingInjection();
      if (pending) {
        messages.push({ role: "user", content: pending });
        messages.push({ role: "assistant", content: "Skill instructions loaded." });
        config.skillLoader.clearPendingInjection();
      }
    }

    // ── 3e. Yield step_start ─────────────────────────────────────────
    const stepStartTime = Date.now();
    yield makeMessage("step_start", sessionId, turn, {
      metadata: { step: turn },
    });

    // ── 3f. Inference (with retry on transient errors) ───────────────
    let response!: ChatResponse;
    const maxRetries = 3;
    let lastInferenceError: unknown = null;
    let succeeded = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        response = await config.model.chat({
          messages,
          tools: llmTools.length > 0 ? llmTools : undefined,
          systemPrompt,
          maxTokens: config.maxTokens ?? 8192,
        });
        succeeded = true;
        break;
      } catch (err) {
        lastInferenceError = err;
        const isRetryable = isRetryableError(err);
        if (!isRetryable || attempt >= maxRetries) {
          break;
        }
        // Check abort signal before retrying
        if (config.signal?.aborted) {
          break;
        }
        // Yield inference_retry so the conductor can emit events and update the UI
        const delayMs = getRetryDelay(err, attempt);
        yield makeMessage("system", sessionId, turn, {
          subtype: "inference_retry",
          content: `Retrying inference (attempt ${attempt + 1}/${maxRetries}): ${err instanceof Error ? err.message : String(err)}`,
          metadata: {
            attempt: attempt + 1,
            maxRetries,
            delayMs,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        if (delayMs > 0) {
          // Abort-aware delay: resolve early if signal fires
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delayMs);
            if (config.signal) {
              const onAbort = () => { clearTimeout(timer); resolve(); };
              if (config.signal.aborted) { clearTimeout(timer); resolve(); return; }
              config.signal.addEventListener("abort", onAbort, { once: true });
            }
          });
        }
      }
    }

    if (!succeeded) {
      yield makeMessage("error", sessionId, turn, {
        content: `Inference error: ${lastInferenceError instanceof Error ? lastInferenceError.message : String(lastInferenceError)}`,
        metadata: { finalMessages: messages },
      });
      return;
    }

    // ── 3g. Yield assistant message ──────────────────────────────────
    yield makeMessage("assistant", sessionId, turn, {
      content: response!.content,
      toolCalls: response!.toolCalls,
      metadata: {
        usage: response!.usage,
        stopReason: response!.stopReason,
      },
    });

    // ── 3g2. Yield step_finish with usage (for parent stats merge) ──
    yield makeMessage("step_finish", sessionId, turn, {
      metadata: {
        stepDurationMs: Date.now() - stepStartTime,
        usage: response!.usage,
        stopReason: response!.stopReason,
        toolCount: response!.toolCalls?.length ?? 0,
      },
    });

    // ── 3h. Stop condition ───────────────────────────────────────────
    if (!response!.toolCalls || response!.toolCalls.length === 0) {
      if (config.hooksEngine) {
        const stopResult = await config.hooksEngine.fire("Stop", {
          sessionId,
          response: response.content,
        });

        if (stopResult?.decision === "block") {
          // Inject feedback as user message, increment turn, continue
          const feedback = stopResult.reason ?? "Please provide a more complete response.";
          messages.push({
            role: "assistant",
            content: response!.content,
          });
          messages.push({
            role: "user",
            content: feedback,
          });
          turn++;
          continue;
        }
      }

      // Fire SessionEnd and yield result
      if (config.hooksEngine) {
        await config.hooksEngine.fire("SessionEnd", {
          sessionId,
          reason: "completed",
          turns: turn + 1,
        });
      }

      // Include the assistant's final message in history before emitting
      messages.push({ role: "assistant", content: response!.content });

      yield makeMessage("result", sessionId, turn, {
        content: response!.content,
        metadata: { totalTurns: turn + 1, finalMessages: messages },
      });
      return;
    }

    // ── 3i. Tool execution ───────────────────────────────────────────
    const toolResults: LoopToolResult[] = [];

    for (const toolCall of response!.toolCalls) {
      // Fire PreToolUse hook
      if (config.hooksEngine) {
        const preResult = await config.hooksEngine.fire("PreToolUse", {
          sessionId,
          toolName: toolCall.name,
          input: toolCall.args,
        });

        if (preResult?.decision === "deny") {
          toolResults.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: `Tool use denied: ${preResult.reason ?? "blocked by hook"}`,
            isError: true,
          });
          continue;
        }

        // Apply modifiedInput if hook returned one
        if (preResult?.modifiedInput) {
          Object.assign(toolCall.args, preResult.modifiedInput);
        }
      }

      // Safety gate check
      if (config.safetyGate && config.safetyGate.requiresCheck(toolCall.name)) {
        const safetyResult = await config.safetyGate.check({
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args,
        });

        if (!safetyResult.approved) {
          toolResults.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: `Tool blocked by safety gate: ${safetyResult.reason ?? "unsafe operation"}`,
            isError: true,
          });
          continue;
        }
      }

      // Find and execute tool
      const toolDef = toolMap.get(toolCall.name);
      if (!toolDef) {
        toolResults.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: `Unknown tool: ${toolCall.name}`,
          isError: true,
        });
        continue;
      }

      // Validate tool arguments before execution
      if (toolDef.schema) {
        const validationError = validateToolArgs(toolCall.args, toolDef.schema, toolCall.name);
        if (validationError) {
          toolResults.push({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: `${validationError}. Please retry with correct arguments.`,
            isError: true,
          });
          continue;
        }
      }

      // Yield tool_start so the conductor can emit tool.call events
      yield makeMessage("tool_start", sessionId, turn, {
        metadata: {
          toolName: toolCall.name,
          toolArgs: toolCall.args,
          toolCallId: toolCall.id,
        },
      });

      const metadataUpdates: Array<{ title?: string; metadata?: Record<string, unknown> }> = [];
      const toolCtx: HarnessToolContext = {
        config: {},
        store: null,
        state: {},
        emit: () => {},
        sessionId,
        threadId,
        agentName: config.agentName,
        turn,
        signal: config.signal,
        metadata: (update: { title?: string; metadata?: Record<string, unknown> }) => {
          metadataUpdates.push(update);
        },
      };

      try {
        const startTime = Date.now();
        const rawResult = await toolDef.execute(toolCall.args, toolCtx);
        const durationMs = Date.now() - startTime;
        const content = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);

        // Fire PostToolUse
        if (config.hooksEngine) {
          await config.hooksEngine.fire("PostToolUse", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            output: rawResult,
            durationMs,
          });
        }

        toolResults.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content,
          durationMs,
        });

        // Yield collected metadata updates from ctx.metadata() calls
        for (const mu of metadataUpdates) {
          yield makeMessage("tool_metadata", sessionId, turn, {
            metadata: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              title: mu.title,
              data: mu.metadata,
            },
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Fire PostToolUseFailure
        if (config.hooksEngine) {
          await config.hooksEngine.fire("PostToolUseFailure", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            error: err instanceof Error ? err : errorMsg,
          });
        }

        toolResults.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: `Tool error: ${errorMsg}`,
          isError: true,
        });
      }
    }

    // ── 3j. Update messages ──────────────────────────────────────────
    messages.push({
      role: "assistant",
      content: response!.content,
      toolCalls: response!.toolCalls,
    });

    for (const tr of toolResults) {
      messages.push({
        role: "tool",
        content: tr.content,
        toolCallId: tr.toolCallId,
        name: tr.toolName,
      });
    }

    // ── 3j. TODO reminder ────────────────────────────────────────────
    if (config.todoModule) {
      const todoState = config.todoModule.getState();
      if (todoState.todos.length > 0) {
        const reminder = config.todoModule.toContextString();
        messages.push({ role: "user", content: `<system-reminder>\n${reminder}\n</system-reminder>` });
        messages.push({ role: "assistant", content: "Noted." });

        yield makeMessage("system", sessionId, turn, {
          subtype: "todo_reminder",
          content: reminder,
        });
      }
    }

    // ── 3k. Yield tool_result, increment turn ───────────────────────
    yield makeMessage("tool_result", sessionId, turn, {
      toolResults,
    });

    turn++;
  }

  // ── 4. maxTurns exceeded ─────────────────────────────────────────────
  yield makeMessage("error", sessionId, turn, {
    content: `Agent loop exceeded maxTurns (${maxTurns})`,
    metadata: { finalMessages: messages },
  });
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

    for await (const msg of agentLoop(prompt, config)) {
      if (msg.type === "result") {
        finalResult = msg.content ?? "";
      }
    }

    return {
      agentResults: {
        ...(state.agentResults ?? {}),
        [config.agentName]: finalResult,
      },
    } as Partial<S>;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeMessage(
  type: LoopMessageType,
  sessionId: string,
  turn: number,
  overrides: Partial<LoopMessage> = {},
): LoopMessage {
  return {
    type,
    sessionId,
    turn,
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Check if an error is retryable (rate limits, transient server errors). */
function isRetryableError(err: unknown): boolean {
  if (err && typeof err === "object" && "isRetryable" in err) {
    return !!(err as { isRetryable?: boolean }).isRetryable;
  }
  if (err && typeof err === "object") {
    const status = (err as { status?: number }).status;
    if (status === 429 || status === 503 || status === 502 || status === 500) {
      return true;
    }
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("503") || msg.includes("overloaded")) {
      return true;
    }
  }
  return false;
}

/** Get retry delay with exponential backoff. */
function getRetryDelay(err: unknown, attempt: number): number {
  if (err && typeof err === "object") {
    // Respect retryAfterMs if provided by the model adapter
    if ("retryAfterMs" in err) {
      const after = (err as { retryAfterMs?: number }).retryAfterMs;
      if (typeof after === "number" && after > 0) return after;
    }
    // Check headers for retry-after-ms (common in HTTP error responses)
    const headers = (err as { headers?: Record<string, string> }).headers;
    if (headers) {
      const headerMs = headers["retry-after-ms"];
      if (headerMs) {
        const parsed = parseInt(headerMs, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    }
  }
  return Math.min(1000 * Math.pow(2, attempt), 10_000);
}
