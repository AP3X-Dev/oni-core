import type {
  ONIModel,
  ONIModelMessage,
  ONIModelToolCall,
  ChatParams,
  ChatResponse,
  ChatChunk,
  ModelOptions,
  LLMToolDef,
} from "./types.js";
import { throwModelHttpError } from "./http-error.js";

export interface AnthropicOptions extends ModelOptions {
  anthropicVersion?: string;
}

/* ------------------------------------------------------------------ */
/*  Anthropic API types (minimal, internal)                           */
/* ------------------------------------------------------------------ */

interface AnthropicContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: { type: string; name?: string };
  stream?: boolean;
}

interface AnthropicResponseBody {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

/* ------------------------------------------------------------------ */
/*  Message conversion                                                */
/* ------------------------------------------------------------------ */

function convertMessages(messages: ONIModelMessage[]): {
  system: string | undefined;
  converted: AnthropicMessage[];
} {
  let system: string | undefined;
  const converted: AnthropicMessage[] = [];
  // Buffer for consecutive tool results — Anthropic requires all tool results
  // for one assistant turn to be in a single user message as a list of
  // tool_result blocks. Flushed before any non-tool message is emitted.
  const pendingToolResults: AnthropicContentBlock[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Concatenate multiple system messages
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((p) => p.type === "text")
              .map((p) => p.text ?? "")
              .join("");
      system = system ? `${system}\n${text}` : text;
      continue;
    }

    if (msg.role === "tool") {
      if (!msg.toolCallId) {
        throw new Error(
          "Tool result message is missing required toolCallId. " +
          "Anthropic's API requires a valid tool_use_id for every tool_result block."
        );
      }
      // Accumulate — will be emitted as a single user message when the next
      // non-tool message is encountered or when the loop ends.
      pendingToolResults.push({
        type: "tool_result" as unknown as "text",
        tool_use_id: msg.toolCallId,
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
      } as unknown as AnthropicContentBlock);
      continue;
    }

    // Flush accumulated tool results as one user message before any non-tool message.
    if (pendingToolResults.length > 0) {
      converted.push({ role: "user", content: [...pendingToolResults] });
      pendingToolResults.length = 0;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant with tool calls → mixed content blocks
      const blocks: AnthropicContentBlock[] = [];
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((p) => p.type === "text")
              .map((p) => p.text ?? "")
              .join("");
      if (text) {
        blocks.push({ type: "text", text });
      }
      for (const tc of msg.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args,
        });
      }
      converted.push({ role: "assistant", content: blocks });
      continue;
    }

    // Regular user or assistant message
    const content =
      typeof msg.content === "string"
        ? msg.content
        : msg.content
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join("");

    converted.push({
      role: msg.role as "user" | "assistant",
      content,
    });
  }

  // Flush any trailing tool results (conversation ending on tool messages).
  if (pendingToolResults.length > 0) {
    converted.push({ role: "user", content: [...pendingToolResults] });
  }

  return { system, converted };
}

function convertTools(tools: LLMToolDef[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function mapStopReason(
  reason: string | null,
): ChatResponse["stopReason"] {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "stop_sequence") return "stop_sequence";
  return "end";
}

/* ------------------------------------------------------------------ */
/*  SSE line parser                                                   */
/* ------------------------------------------------------------------ */

function* drainSSELines(
  lines: string[],
  state: { event: string; data: string },
  flush?: boolean,
): Generator<{ event: string; data: string }> {
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      state.event = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      state.data = line.slice(6);
    } else if (line.trim() === "" || flush) {
      if (state.data) {
        yield { event: state.event, data: state.data };
      }
      state.event = "message";
      state.data = "";
    }
  }
  // On flush, emit any trailing data without a blank-line delimiter
  if (flush && state.data) {
    yield { event: state.event, data: state.data };
    state.data = "";
  }
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state = { event: "message", data: "" };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete last line

      yield* drainSSELines(lines, state);
    }

    // Flush remaining buffer — also flush when buffer is empty but state.data
    // still holds an event (stream closed without a trailing blank-line delimiter).
    if (buffer.trim() || state.data) {
      yield* drainSSELines(buffer.split("\n"), state, true);
    }
  } finally {
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function anthropic(
  modelId: string,
  opts?: AnthropicOptions,
): ONIModel {
  const apiKey = opts?.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
  if (!apiKey) {
    throw new Error(
      "Anthropic API key not configured. Set ANTHROPIC_API_KEY environment variable or pass apiKey in options.",
    );
  }
  const rawBaseUrl = (opts?.baseUrl ?? "https://api.anthropic.com").replace(
    /\/$/,
    "",
  );

  // Validate baseUrl scheme to prevent API key exfiltration via config injection
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error(
      `Invalid Anthropic baseUrl: "${rawBaseUrl}" is not a valid URL`,
    );
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(
      `Invalid Anthropic baseUrl scheme: "${parsedUrl.protocol}" — only "https:" and "http:" are allowed`,
    );
  }
  const baseUrl = rawBaseUrl;
  const anthropicVersion = opts?.anthropicVersion ?? "2023-06-01";
  const defaultMaxTokens = opts?.defaultMaxTokens ?? 4096;
  const defaultTemperature = opts?.defaultTemperature;

  function headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": anthropicVersion,
    };
  }

  function buildBody(params: ChatParams, stream: boolean): AnthropicRequestBody {
    const { system, converted } = convertMessages(params.messages);
    const combinedSystem = [params.systemPrompt, system]
      .filter(Boolean)
      .join("\n");

    const body: AnthropicRequestBody = {
      model: modelId,
      messages: converted,
      max_tokens: params.maxTokens ?? defaultMaxTokens,
    };

    if (combinedSystem) {
      body.system = combinedSystem;
    }
    if (params.temperature !== undefined || defaultTemperature !== undefined) {
      body.temperature = params.temperature ?? defaultTemperature;
    }
    if (params.stopSequences) {
      body.stop_sequences = params.stopSequences;
    }
    // --- responseFormat (structured output via tool-use pattern) ---
    if (params.responseFormat && params.responseFormat.type === "json_schema") {
      const rf = params.responseFormat;
      body.tools = [
        {
          name: rf.name,
          description: "Structured output",
          input_schema: rf.schema,
        },
      ];
      body.tool_choice = { type: "tool", name: rf.name };
    } else {
      // Normal tools + toolChoice handling
      const toolChoiceIsNone =
        typeof params.toolChoice === "string" && params.toolChoice === "none";

      if (!toolChoiceIsNone && params.tools && params.tools.length > 0) {
        body.tools = convertTools(params.tools);
      }

      if (params.toolChoice && !toolChoiceIsNone) {
        if (typeof params.toolChoice === "string") {
          if (params.toolChoice === "auto") {
            body.tool_choice = { type: "auto" };
          } else if (params.toolChoice === "required") {
            body.tool_choice = { type: "any" };
          }
        } else {
          body.tool_choice = { type: "tool", name: params.toolChoice.name };
        }
      }
      // "none" → omit tools entirely and don't set tool_choice (already handled)
    }

    if (stream) {
      body.stream = true;
    }

    return body;
  }

  /* ---- chat -------------------------------------------------------- */

  async function chat(params: ChatParams): Promise<ChatResponse> {
    const body = buildBody(params, false);

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("Anthropic", res.status, text, res.headers);
    }

    const json = (await res.json()) as AnthropicResponseBody;

    // Extract text
    const textParts = json.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "");
    const content = textParts.join("");

    // Check for structured output (responseFormat)
    const rfName = params.responseFormat?.type === "json_schema"
      ? params.responseFormat.name
      : undefined;

    // Extract tool calls, filtering out the responseFormat synthetic tool
    const toolCalls: ONIModelToolCall[] = json.content
      .filter((b) => b.type === "tool_use" && b.name !== rfName)
      .map((b) => ({
        id: b.id!,
        name: b.name!,
        args: b.input ?? {},
      }));

    // Extract structured output parsed data
    let parsed: Record<string, unknown> | undefined;
    if (rfName) {
      const rfBlock = json.content.find(
        (b) => b.type === "tool_use" && b.name === rfName,
      );
      if (rfBlock?.input) {
        parsed = rfBlock.input;
      }
    }

    const stopReason = mapStopReason(json.stop_reason);

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      parsed,
      usage: {
        inputTokens: json.usage.input_tokens,
        outputTokens: json.usage.output_tokens,
      },
      stopReason,
      raw: json,
    };
  }

  /* ---- stream ------------------------------------------------------ */

  async function* stream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const rfName = params.responseFormat?.type === "json_schema"
      ? params.responseFormat.name
      : undefined;
    const body = buildBody(params, true);

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("Anthropic", res.status, text, res.headers);
    }

    if (!res.body) {
      throw new Error("Anthropic API returned no body for stream");
    }

    // Track tool_use blocks by content_block index for tool_call_end emission
    const activeToolBlocks = new Map<number, { id: string; name: string; argsJson: string }>();

    for await (const { event, data } of parseSSE(res.body)) {
      if (data === "[DONE]") break;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch (err) {
        console.warn("[oni-core] Anthropic SSE: failed to parse JSON chunk", { error: err, dataLength: data?.length ?? 0 });
        continue;
      }

      if (
        event === "content_block_start" ||
        parsed["type"] === "content_block_start"
      ) {
        const block = parsed["content_block"] as
          | AnthropicContentBlock
          | undefined;
        if (block?.type === "tool_use" && block.id && block.name) {
          const blockIndex = parsed["index"] as number;
          if (rfName && block.name === rfName) {
            // Synthetic structured-output tool — track index to suppress deltas/end but don't emit
            activeToolBlocks.set(blockIndex, { id: block.id, name: block.name, argsJson: "" });
          } else {
            activeToolBlocks.set(blockIndex, { id: block.id, name: block.name, argsJson: "" });
            yield {
              type: "tool_call_start",
              toolCall: { id: block.id, name: block.name, args: {} },
            };
          }
        }
      } else if (
        event === "content_block_delta" ||
        parsed["type"] === "content_block_delta"
      ) {
        const delta = parsed["delta"] as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (delta["type"] === "text_delta") {
          yield { type: "text", text: delta["text"] as string };
        } else if (delta["type"] === "input_json_delta") {
          const blockIndex = parsed["index"] as number;
          const active = activeToolBlocks.get(blockIndex);
          if (active) {
            active.argsJson += delta["partial_json"] as string;
            if (!(rfName && active.name === rfName)) {
              yield {
                type: "tool_call_delta",
                toolCall: {
                  args: { __partial: delta["partial_json"] as string } as unknown as Record<string, unknown>,
                },
              };
            }
          }
        }
      } else if (
        event === "content_block_stop" ||
        parsed["type"] === "content_block_stop"
      ) {
        const blockIndex = parsed["index"] as number;
        const active = activeToolBlocks.get(blockIndex);
        if (active) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(active.argsJson || "{}") as Record<string, unknown>;
          } catch {
            // partial args — pass empty object
          }
          if (!(rfName && active.name === rfName)) {
            yield {
              type: "tool_call_end",
              toolCall: { id: active.id, name: active.name, args },
            };
          }
          activeToolBlocks.delete(blockIndex);
        }
      } else if (
        event === "message_delta" ||
        parsed["type"] === "message_delta"
      ) {
        const delta = parsed["delta"] as Record<string, unknown> | undefined;
        const usage = parsed["usage"] as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        if (usage) {
          yield {
            type: "usage",
            usage: {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
            },
          };
        }
        // message_delta may also carry stop_reason — we don't emit a chunk for it
        void delta;
      }
    }
  }

  /* ---- model object ------------------------------------------------ */

  return {
    chat,
    stream,
    provider: "anthropic",
    modelId,
    capabilities: {
      tools: true,
      vision: true,
      streaming: true,
      embeddings: false,
    },
  };
}
