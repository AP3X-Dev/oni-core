import type {
  ONIModel,
  ONIModelMessage,
  ONIModelToolCall,
  ChatParams,
  ChatResponse,
  ChatChunk,
  ModelOptions,
  LLMToolDef,
  ContentPart,
} from "./types.js";
import { throwModelHttpError } from "./http-error.js";

/* ------------------------------------------------------------------ */
/*  OpenAI API types (minimal, internal)                              */
/* ------------------------------------------------------------------ */

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: string | { type: "function"; function: { name: string } };
  response_format?: { type: "json_schema"; json_schema: { name: string; schema: Record<string, unknown>; strict: boolean } };
  stream?: boolean;
  stream_options?: { include_usage: boolean };
}

interface OpenAIChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string | null;
}

interface OpenAIResponseBody {
  id: string;
  object: string;
  choices: OpenAIChoice[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{ object: string; index: number; embedding: number[] }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

/* ------------------------------------------------------------------ */
/*  Message conversion                                                */
/* ------------------------------------------------------------------ */

function contentToString(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function convertMessages(
  messages: ONIModelMessage[],
  systemPrompt?: string,
): OpenAIMessage[] {
  const converted: OpenAIMessage[] = [];

  // Prepend systemPrompt as first system message if provided
  if (systemPrompt) {
    converted.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      converted.push({ role: "system", content: contentToString(msg.content) });
      continue;
    }

    if (msg.role === "tool") {
      converted.push({
        role: "tool",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        tool_call_id: msg.toolCallId,
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const text = contentToString(msg.content);
      const toolCalls: OpenAIToolCall[] = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      }));
      converted.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls,
      });
      continue;
    }

    // Regular user or assistant message
    converted.push({
      role: msg.role as "user" | "assistant",
      content: contentToString(msg.content),
    });
  }

  return converted;
}

function convertTools(tools: LLMToolDef[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

function mapFinishReason(
  reason: string | null,
): ChatResponse["stopReason"] {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "end";
  return "end";
}

/* ------------------------------------------------------------------ */
/*  SSE line parser (shared)                                          */
/* ------------------------------------------------------------------ */

import { parseSSEData as parseSSE } from "./sse.js";

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function openai(
  modelId: string,
  opts?: ModelOptions,
): ONIModel {
  const apiKey = opts?.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
  const baseUrl = (opts?.baseUrl ?? "https://api.openai.com").replace(
    /\/$/,
    "",
  );
  const defaultMaxTokens = opts?.defaultMaxTokens;
  const defaultTemperature = opts?.defaultTemperature;

  function headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
  }

  function buildBody(params: ChatParams, stream: boolean): OpenAIRequestBody {
    const messages = convertMessages(params.messages, params.systemPrompt);

    const body: OpenAIRequestBody = {
      model: modelId,
      messages,
    };

    const maxTokens = params.maxTokens ?? defaultMaxTokens;
    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

    if (params.temperature !== undefined || defaultTemperature !== undefined) {
      body.temperature = params.temperature ?? defaultTemperature;
    }
    if (params.stopSequences && params.stopSequences.length > 0) {
      body.stop = params.stopSequences;
    }
    if (params.tools && params.tools.length > 0) {
      body.tools = convertTools(params.tools);
    }
    if (params.toolChoice !== undefined) {
      if (typeof params.toolChoice === "string") {
        body.tool_choice = params.toolChoice;
      } else {
        body.tool_choice = { type: "function", function: { name: params.toolChoice.name } };
      }
    }
    if (params.responseFormat && params.responseFormat.type === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: params.responseFormat.name,
          schema: params.responseFormat.schema,
          strict: params.responseFormat.strict ?? true,
        },
      };
    }
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    return body;
  }

  /* ---- chat -------------------------------------------------------- */

  async function chat(params: ChatParams): Promise<ChatResponse> {
    const body = buildBody(params, false);

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("OpenAI", res.status, text, res.headers);
    }

    const json = (await res.json()) as OpenAIResponseBody;
    const choice = json.choices[0]!;
    const message = choice.message;

    // Extract text
    const content = message.content ?? "";

    // Extract tool calls
    let toolCalls: ONIModelToolCall[] | undefined;
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })() as Record<string, unknown>,
      }));
    }

    // Attempt structured output parsing if responseFormat was requested
    let parsed: unknown;
    if (params.responseFormat?.type === "json_schema" && content) {
      try {
        parsed = JSON.parse(content);
      } catch {
        // leave parsed undefined if content isn't valid JSON
      }
    }

    return {
      content,
      toolCalls,
      parsed,
      usage: {
        inputTokens: json.usage.prompt_tokens,
        outputTokens: json.usage.completion_tokens,
      },
      stopReason: mapFinishReason(choice.finish_reason),
      raw: json,
    };
  }

  /* ---- stream ------------------------------------------------------ */

  async function* stream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const body = buildBody(params, true);

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("OpenAI", res.status, text, res.headers);
    }

    if (!res.body) {
      throw new Error("OpenAI API returned no body for stream");
    }

    // Track active tool calls by index for accumulation
    const activeToolCalls = new Map<number, { id: string; name: string; args: string }>();

    for await (const data of parseSSE(res.body)) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) continue;

      const choice = choices[0]!;
      const delta = choice["delta"] as Record<string, unknown> | undefined;
      if (!delta) continue;

      // Text content
      if (delta["content"] && typeof delta["content"] === "string") {
        yield { type: "text", text: delta["content"] };
      }

      // Tool calls
      const toolCalls = delta["tool_calls"] as Array<Record<string, unknown>> | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const index = tc["index"] as number;
          const fn = tc["function"] as Record<string, unknown> | undefined;

          if (tc["id"]) {
            // New tool call starting
            activeToolCalls.set(index, {
              id: tc["id"] as string,
              name: fn?.["name"] as string ?? "",
              args: (fn?.["arguments"] as string) ?? "",
            });
            yield {
              type: "tool_call_start",
              toolCall: {
                id: tc["id"] as string,
                name: fn?.["name"] as string ?? "",
                args: {},
              },
            };
          } else if (fn?.["arguments"]) {
            // Delta for existing tool call
            const active = activeToolCalls.get(index);
            if (active) {
              active.args += fn["arguments"] as string;
            }
            yield {
              type: "tool_call_delta",
              toolCall: {
                args: { __partial: fn["arguments"] as string } as unknown as Record<string, unknown>,
              },
            };
          }
        }
      }

      // Check for finish_reason to emit tool_call_end
      const finishReason = choice["finish_reason"] as string | null;
      if (finishReason === "tool_calls") {
        for (const [, active] of activeToolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(active.args) as Record<string, unknown>;
          } catch {
            // partial args
          }
          yield {
            type: "tool_call_end",
            toolCall: { id: active.id, name: active.name, args },
          };
        }
        activeToolCalls.clear();
      }

      // Usage (OpenAI sends usage in the final chunk when stream_options.include_usage is set)
      const usage = parsed["usage"] as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (usage) {
        yield {
          type: "usage",
          usage: {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
          },
        };
      }
    }
  }

  /* ---- embed ------------------------------------------------------- */

  async function embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: modelId,
        input: texts,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("OpenAI", res.status, text, res.headers);
    }

    const json = (await res.json()) as OpenAIEmbeddingResponse;
    // Sort by index to ensure correct ordering
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  /* ---- model object ------------------------------------------------ */

  return {
    chat,
    stream,
    embed,
    provider: "openai",
    modelId,
    capabilities: {
      tools: true,
      vision: true,
      streaming: true,
      embeddings: true,
    },
  };
}
