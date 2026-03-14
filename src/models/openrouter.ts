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
/*  OpenRouter API types (OpenAI-compatible)                           */
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

interface OpenRouterRequestBody {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: string | { type: string; function: { name: string } };
  parallel_tool_calls?: boolean;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  /** OpenRouter provider routing preferences */
  provider?: Record<string, unknown>;
  /** OpenRouter transforms (e.g. middle-out) */
  transforms?: string[];
  /** Reasoning effort */
  reasoning?: { effort: string };
  /** Structured output response format */
  response_format?: {
    type: string;
    json_schema?: { name: string; schema: Record<string, unknown>; strict: boolean };
  };
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

/* ------------------------------------------------------------------ */
/*  OpenRouter-specific options                                        */
/* ------------------------------------------------------------------ */

export interface OpenRouterOptions extends ModelOptions {
  /** HTTP-Referer header — identifies your app to OpenRouter */
  referer?: string;
  /** X-Title header — your app name shown on openrouter.ai rankings */
  appTitle?: string;
  /** OpenRouter provider routing preferences */
  provider?: Record<string, unknown>;
  /** OpenRouter transforms (e.g. ["middle-out"]) */
  transforms?: string[];
  /** Reasoning effort hint (e.g. "low", "medium", "high") */
  reasoningEffort?: string;
  /** Tool choice: "auto", "none", "required", or { name: string } for named function */
  toolChoice?: string | { name: string };
  /** Whether to allow parallel tool calls */
  parallelToolCalls?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Message conversion                                                 */
/* ------------------------------------------------------------------ */

function contentToString(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

/** Check if content parts contain any non-text (image) parts */
function hasMultimodal(content: string | ContentPart[]): boolean {
  if (typeof content === "string") return false;
  return content.some((p) => p.type !== "text");
}

/** Convert content parts to OpenAI multimodal format */
function contentToMultimodal(content: ContentPart[]): unknown[] {
  return content.map((p) => {
    if (p.type === "text") return { type: "text", text: p.text ?? "" };
    if (p.type === "image") return { type: "image_url", image_url: { url: p.imageUrl ?? "" } };
    return { type: "text", text: "" };
  });
}

function convertMessages(
  messages: ONIModelMessage[],
  systemPrompt?: string,
): OpenAIMessage[] {
  const converted: OpenAIMessage[] = [];

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

    // For user messages with images, send multimodal content
    if (msg.role === "user" && hasMultimodal(msg.content)) {
      converted.push({
        role: "user",
        content: contentToMultimodal(msg.content as ContentPart[]) as unknown as string,
      });
    } else {
      converted.push({
        role: msg.role as "user" | "assistant",
        content: contentToString(msg.content),
      });
    }
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
/*  SSE line parser (shared)                                           */
/* ------------------------------------------------------------------ */

import { parseSSEData as parseSSE } from "./sse.js";

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function openrouter(
  modelId: string,
  opts?: OpenRouterOptions,
): ONIModel {
  const apiKey = opts?.apiKey ?? process.env["OPENROUTER_API_KEY"] ?? "";
  const baseUrl = (opts?.baseUrl ?? "https://openrouter.ai/api").replace(
    /\/$/,
    "",
  );
  const defaultMaxTokens = opts?.defaultMaxTokens;
  const defaultTemperature = opts?.defaultTemperature;
  const referer = opts?.referer ?? process.env["OPENROUTER_REFERER"] ?? "";
  const appTitle = opts?.appTitle ?? process.env["OPENROUTER_APP_TITLE"] ?? "";
  const providerPrefs = opts?.provider;
  const transforms = opts?.transforms;
  const reasoningEffort = opts?.reasoningEffort;
  const toolChoice = opts?.toolChoice;
  const parallelToolCalls = opts?.parallelToolCalls;

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    if (referer) h["HTTP-Referer"] = referer;
    if (appTitle) h["X-Title"] = appTitle;
    return h;
  }

  function buildBody(params: ChatParams, stream: boolean): OpenRouterRequestBody {
    const messages = convertMessages(params.messages, params.systemPrompt);

    const body: OpenRouterRequestBody = {
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
      // Tool choice — per-call takes priority over constructor default
      const effectiveToolChoice = params.toolChoice ?? toolChoice;
      if (effectiveToolChoice) {
        if (typeof effectiveToolChoice === "string") {
          body.tool_choice = effectiveToolChoice;
        } else {
          body.tool_choice = { type: "function", function: { name: effectiveToolChoice.name } };
        }
      } else {
        body.tool_choice = "auto";
      }
      if (parallelToolCalls !== undefined) {
        body.parallel_tool_calls = parallelToolCalls;
      }
    }
    // Structured output (response_format)
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
    if (providerPrefs) {
      body.provider = providerPrefs;
    }
    if (transforms) {
      body.transforms = transforms;
    }
    if (reasoningEffort) {
      body.reasoning = { effort: reasoningEffort };
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
      throwModelHttpError("openrouter", res.status, text, res.headers);
    }

    const json = (await res.json()) as OpenAIResponseBody;
    const choice = json.choices?.[0];
    if (!choice) {
      return {
        content: "",
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? 0,
          outputTokens: json.usage?.completion_tokens ?? 0,
        },
        stopReason: "end",
        raw: json,
      };
    }
    const message = choice.message;

    const content = message.content ?? "";

    let toolCalls: ONIModelToolCall[] | undefined;
    if (message.tool_calls && message.tool_calls.length > 0) {
      toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: (() => { try { return JSON.parse(tc.function.arguments); } catch { return {}; } })() as Record<string, unknown>,
      }));
    }

    const result: ChatResponse = {
      content,
      toolCalls,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      stopReason: mapFinishReason(choice.finish_reason),
      raw: json,
    };

    // Parse structured output when responseFormat was requested
    if (params.responseFormat && content) {
      try {
        result.parsed = JSON.parse(content);
      } catch {
        // content is not valid JSON — leave parsed undefined
      }
    }

    return result;
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
      throwModelHttpError("openrouter", res.status, text, res.headers);
    }

    if (!res.body) {
      throw new Error("OpenRouter API returned no body for stream");
    }

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

      // Finish reason → emit tool_call_end
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

      // Usage
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

  /* ---- model object ------------------------------------------------ */

  return {
    chat,
    stream,
    provider: "openrouter",
    modelId,
    capabilities: {
      tools: true,
      vision: true,
      streaming: true,
      embeddings: false,
    },
  };
}

/**
 * Convenience factory for Inception models via OpenRouter.
 * Defaults to "inception/mercury-2" if no model ID is provided.
 */
export function inception(
  modelId?: string,
  opts?: OpenRouterOptions,
): ONIModel {
  return openrouter(modelId ?? "inception/mercury-2", opts);
}
