// ============================================================
// @oni.bot/core/harness/loop — Tools
// Tool schema → adapter conversion + parallel/serial execution.
// ============================================================

import type { LLMToolDef, ONIModelToolCall } from "../../models/types.js";
import type { ToolDefinition } from "../../tools/types.js";
import type {
  LoopToolResult,
  HarnessToolContext,
  LoopMessage,
  AgentLoopConfig,
} from "../types.js";
import { validateToolArgs } from "../validate-args.js";
import { makeMessage } from "./types.js";
import { checkSafety } from "./safety.js";

// ─── stripProtoKeys ─────────────────────────────────────────────────────────

/** Keys that can trigger prototype pollution when spread / assigned. */
const PROTO_POLLUTING_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Recursively strip prototype-polluting keys from an object.
 * Returns a shallow-or-deep-cloned object when pollution keys are found;
 * returns the original reference when no stripping is needed (zero-alloc
 * fast-path for clean inputs).
 */
function stripProtoKeys(obj: Record<string, unknown>): Record<string, unknown> {
  let dirty = false;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    if (PROTO_POLLUTING_KEYS.has(key)) {
      dirty = true;
      continue;
    }
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const cleaned = stripProtoKeys(val as Record<string, unknown>);
      if (cleaned !== val) dirty = true;
      out[key] = cleaned;
    } else {
      out[key] = val;
    }
  }
  return dirty ? out : obj;
}

// ─── buildLLMTools ──────────────────────────────────────────────────────────

/** Convert ToolDefinition[] to LLMToolDef[] for the model adapter. */
export function buildLLMTools(tools: ToolDefinition[]): LLMToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.schema,
  }));
}

/** Build a name → ToolDefinition lookup map. */
export function buildToolMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
  const toolMap = new Map<string, ToolDefinition>();
  for (const t of tools) {
    toolMap.set(t.name, t);
  }
  return toolMap;
}

// ─── executeTools ───────────────────────────────────────────────────────────

export interface ToolExecutionContext {
  sessionId: string;
  threadId: string;
  turn: number;
  config: AgentLoopConfig;
  toolMap: Map<string, ToolDefinition>;
  hasMemoryLoader: boolean;
}

/**
 * Execute all tool calls for a turn.
 * Returns tool results and any yield-able events (tool_start, tool_metadata).
 *
 * When all tools in the batch have `parallelSafe !== false` (the default),
 * pre-flight checks run serially but the actual `execute()` calls are
 * dispatched concurrently via `Promise.allSettled()`.  When any tool has
 * `parallelSafe === false`, the entire batch falls back to fully serial
 * execution to avoid data races.
 */
export async function executeTools(
  toolCalls: ONIModelToolCall[],
  ctx: ToolExecutionContext,
): Promise<{ toolResults: LoopToolResult[]; events: LoopMessage[] }> {
  const { toolMap } = ctx;

  // Check if any tool in the batch explicitly opts out of parallel execution.
  // `parallelSafe` defaults to true (undefined → safe), only an explicit
  // `false` triggers the serial path.
  const hasSafetyConstraint = toolCalls.some(
    (call) => toolMap.get(call.name)?.parallelSafe === false,
  );

  if (hasSafetyConstraint) {
    return executeToolsSerial(toolCalls, ctx);
  }

  return executeToolsParallel(toolCalls, ctx);
}

// ─── Serial execution (existing behavior) ──────────────────────────────────

/**
 * Run every tool call strictly in sequence.  Used when any tool in the
 * batch has `parallelSafe === false`.
 */
async function executeToolsSerial(
  toolCalls: ONIModelToolCall[],
  ctx: ToolExecutionContext,
): Promise<{ toolResults: LoopToolResult[]; events: LoopMessage[] }> {
  const { sessionId, threadId, turn, config, toolMap, hasMemoryLoader } = ctx;
  const toolResults: LoopToolResult[] = [];
  const events: LoopMessage[] = [];

  for (const toolCall of toolCalls) {
    // Strip prototype-polluting keys from LLM-supplied args before any
    // processing — hooks, safety gates, and execute() all receive clean input.
    toolCall.args = stripProtoKeys(toolCall.args);

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

      // Apply modifiedInput if hook returned one (uses module-level stripProtoKeys)
      if (preResult?.modifiedInput) {
        toolCall.args = stripProtoKeys(preResult.modifiedInput as Record<string, unknown>);
      }
    }

    // Safety gate check
    const safetyResult = await checkSafety(config.safetyGate, toolCall.id, toolCall.name, toolCall.args);
    if (safetyResult !== null && !safetyResult.approved) {
      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: `Tool blocked by safety gate: ${safetyResult.reason ?? "unsafe operation"}`,
        isError: true,
      });
      continue;
    }

    // Find tool
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
    events.push(makeMessage("tool_start", sessionId, turn, {
      metadata: {
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        toolCallId: toolCall.id,
      },
    }));

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
      askUser: config.onQuestion
        ? (question: string) =>
            new Promise<string>((resolve) => {
              config.onQuestion!(question, (answer) => {
                resolve(answer ?? "");
              });
            })
        : undefined,
      metadata: (update: { title?: string; metadata?: Record<string, unknown> }) => {
        metadataUpdates.push(update);
      },
    };

    // Notify onToolMetadata that this tool is now running
    config.onToolMetadata?.(toolCall.id, toolCall.name, { status: "running" });

    try {
      const startTime = Date.now();
      const rawResult = await toolDef.execute(toolCall.args, toolCtx);
      const durationMs = Date.now() - startTime;
      const content = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);

      // Notify onToolMetadata that this tool completed successfully
      config.onToolMetadata?.(toolCall.id, toolCall.name, { status: "complete", result: content });

      // Push the successful result first — before the hook — so a hook
      // throw cannot retroactively mark this tool call as failed.
      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content,
        durationMs,
      });

      // Yield collected metadata updates from ctx.metadata() calls
      for (const mu of metadataUpdates) {
        events.push(makeMessage("tool_metadata", sessionId, turn, {
          metadata: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            title: mu.title,
            data: mu.metadata,
          },
        }));
      }

      // Fire PostToolUse — in its own try/catch so a hook error does not
      // corrupt the conversation history by triggering PostToolUseFailure
      // for a tool that actually succeeded.
      if (config.hooksEngine) {
        try {
          await config.hooksEngine.fire("PostToolUse", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            output: rawResult,
            durationMs,
          });
        } catch {
          // Hook errors are non-fatal — the tool result is already recorded.
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Notify onToolMetadata that this tool errored
      config.onToolMetadata?.(toolCall.id, toolCall.name, { status: "error", error: errorMsg });

      // Fire PostToolUseFailure — in its own try/catch so a hook error does not
      // drop the error result from toolResults or corrupt conversation history.
      if (config.hooksEngine) {
        try {
          await config.hooksEngine.fire("PostToolUseFailure", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            error: err instanceof Error ? err : errorMsg,
          });
        } catch {
          // Hook errors are non-fatal — the tool error result is still recorded.
        }
      }

      toolResults.push({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: hasMemoryLoader
          ? `Tool error: ${errorMsg}\n\nMemory query may help — call memory_query with a specific topic if this failure suggests a knowledge gap.`
          : `Tool error: ${errorMsg}`,
        isError: true,
      });
    }
  }

  return { toolResults, events };
}

// ─── Parallel execution ────────────────────────────────────────────────────

/** Per-tool state collected during the serial pre-flight phase. */
interface ApprovedCall {
  toolCall: ONIModelToolCall;
  toolDef: ToolDefinition;
  toolCtx: HarnessToolContext;
  metadataUpdates: Array<{ title?: string; metadata?: Record<string, unknown> }>;
  /** Index in the original toolCalls array — used to place the result. */
  index: number;
}

/**
 * Run pre-flight checks serially, then dispatch approved `execute()` calls
 * concurrently via `Promise.allSettled()`, then fire post-hooks serially.
 *
 * Results are always returned in the original call order regardless of
 * which tool finishes first (`Promise.allSettled` preserves order).
 */
async function executeToolsParallel(
  toolCalls: ONIModelToolCall[],
  ctx: ToolExecutionContext,
): Promise<{ toolResults: LoopToolResult[]; events: LoopMessage[] }> {
  const { sessionId, threadId, turn, config, toolMap, hasMemoryLoader } = ctx;
  // Pre-size results array so denied/approved results land at their original index.
  const toolResults: (LoopToolResult | undefined)[] = new Array(toolCalls.length).fill(undefined);
  const events: LoopMessage[] = [];

  // ── Phase 1: Serial pre-flight ────────────────────────────────────────
  // Each tool goes through proto-stripping, PreToolUse hook, safety gate,
  // lookup, validation, and tool_start event emission.  Denied or invalid
  // tools are placed directly into toolResults[i]; approved tools are
  // collected for concurrent execution.
  const approved: ApprovedCall[] = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i];

    // Strip prototype-polluting keys
    toolCall.args = stripProtoKeys(toolCall.args);

    // Fire PreToolUse hook
    if (config.hooksEngine) {
      const preResult = await config.hooksEngine.fire("PreToolUse", {
        sessionId,
        toolName: toolCall.name,
        input: toolCall.args,
      });

      if (preResult?.decision === "deny") {
        toolResults[i] = {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: `Tool use denied: ${preResult.reason ?? "blocked by hook"}`,
          isError: true,
        };
        continue;
      }

      if (preResult?.modifiedInput) {
        toolCall.args = stripProtoKeys(preResult.modifiedInput as Record<string, unknown>);
      }
    }

    // Safety gate check
    const safetyResult = await checkSafety(config.safetyGate, toolCall.id, toolCall.name, toolCall.args);
    if (safetyResult !== null && !safetyResult.approved) {
      toolResults[i] = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: `Tool blocked by safety gate: ${safetyResult.reason ?? "unsafe operation"}`,
        isError: true,
      };
      continue;
    }

    // Find tool
    const toolDef = toolMap.get(toolCall.name);
    if (!toolDef) {
      toolResults[i] = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
      continue;
    }

    // Validate tool arguments
    if (toolDef.schema) {
      const validationError = validateToolArgs(toolCall.args, toolDef.schema, toolCall.name);
      if (validationError) {
        toolResults[i] = {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: `${validationError}. Please retry with correct arguments.`,
          isError: true,
        };
        continue;
      }
    }

    // Yield tool_start
    events.push(makeMessage("tool_start", sessionId, turn, {
      metadata: {
        toolName: toolCall.name,
        toolArgs: toolCall.args,
        toolCallId: toolCall.id,
      },
    }));

    // Build per-tool context
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
      // NOTE: Tools that call askUser should declare parallelSafe: false.
      // Concurrent askUser calls from parallel tools would overlap prompts.
      askUser: config.onQuestion
        ? (question: string) =>
            new Promise<string>((resolve) => {
              config.onQuestion!(question, (answer) => {
                resolve(answer ?? "");
              });
            })
        : undefined,
      metadata: (update: { title?: string; metadata?: Record<string, unknown> }) => {
        metadataUpdates.push(update);
      },
    };

    // Notify onToolMetadata that this tool is now running
    config.onToolMetadata?.(toolCall.id, toolCall.name, { status: "running" });

    approved.push({ toolCall, toolDef, toolCtx, metadataUpdates, index: i });
  }

  // ── Phase 2: Concurrent execution ────────────────────────────────────
  // `Promise.allSettled` preserves the order of the input array, so
  // results[k] corresponds to approved[k] regardless of completion order.
  const settled = await Promise.allSettled(
    approved.map(({ toolCall, toolDef, toolCtx }) => {
      const startTime = Date.now();
      return Promise.resolve(toolDef.execute(toolCall.args, toolCtx)).then(
        (rawResult) => ({ rawResult, durationMs: Date.now() - startTime }),
      );
    }),
  );

  // ── Phase 3: Serial post-processing ──────────────────────────────────
  // Place each result at its original index so ordering matches the
  // serial path even when pre-flight rejected some tools earlier.
  for (let k = 0; k < approved.length; k++) {
    const { toolCall, metadataUpdates, index } = approved[k];
    const outcome = settled[k];

    if (outcome.status === "fulfilled") {
      const { rawResult, durationMs } = outcome.value;
      const content = typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult);

      // Notify onToolMetadata that this tool completed successfully
      config.onToolMetadata?.(toolCall.id, toolCall.name, { status: "complete", result: content });

      toolResults[index] = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content,
        durationMs,
      };

      // Yield collected metadata updates
      for (const mu of metadataUpdates) {
        events.push(makeMessage("tool_metadata", sessionId, turn, {
          metadata: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            title: mu.title,
            data: mu.metadata,
          },
        }));
      }

      // Fire PostToolUse hook
      if (config.hooksEngine) {
        try {
          await config.hooksEngine.fire("PostToolUse", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            output: rawResult,
            durationMs,
          });
        } catch {
          // Hook errors are non-fatal.
        }
      }
    } else {
      // outcome.status === "rejected"
      const err = outcome.reason;
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Notify onToolMetadata that this tool errored
      config.onToolMetadata?.(toolCall.id, toolCall.name, { status: "error", error: errorMsg });

      // Fire PostToolUseFailure hook
      if (config.hooksEngine) {
        try {
          await config.hooksEngine.fire("PostToolUseFailure", {
            sessionId,
            toolName: toolCall.name,
            input: toolCall.args,
            error: err instanceof Error ? err : errorMsg,
          });
        } catch {
          // Hook errors are non-fatal.
        }
      }

      toolResults[index] = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: hasMemoryLoader
          ? `Tool error: ${errorMsg}\n\nMemory query may help — call memory_query with a specific topic if this failure suggests a knowledge gap.`
          : `Tool error: ${errorMsg}`,
        isError: true,
      };
    }
  }

  // Filter out any undefined slots (should not happen if all calls are processed).
  return { toolResults: toolResults.filter((r): r is LoopToolResult => r !== undefined), events };
}
