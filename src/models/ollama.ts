import type {
  ONIModel,
  ONIModelMessage,
  ChatParams,
  ChatResponse,
  ChatChunk,
  ModelOptions,
  ContentPart,
} from "./types.js";
import { throwModelHttpError } from "./http-error.js";

/* ------------------------------------------------------------------ */
/*  Ollama API types (minimal, internal)                              */
/* ------------------------------------------------------------------ */

export interface OllamaOptions extends ModelOptions {
  /** Defaults to "http://localhost:11434" */
  baseUrl?: string;
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatRequestBody {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaChatResponseBody {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbeddingsRequestBody {
  model: string;
  prompt: string;
}

interface OllamaEmbeddingsResponseBody {
  embedding?: number[];
  /** Newer Ollama versions use plural "embeddings" */
  embeddings?: number[][];
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
): OllamaChatMessage[] {
  const converted: OllamaChatMessage[] = [];

  if (systemPrompt) {
    converted.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === "system") {
      converted.push({ role: "system", content: contentToString(msg.content) });
      continue;
    }

    if (msg.role === "tool") {
      // Ollama doesn't support tool messages — include as user context
      converted.push({
        role: "user",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
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

/* ------------------------------------------------------------------ */
/*  NDJSON line parser                                                */
/* ------------------------------------------------------------------ */

async function* parseNDJSON(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as Record<string, unknown>;
        } catch (err) {
          console.warn("[oni-core] Ollama NDJSON: failed to parse line:", err, "| raw line:", trimmed);
          continue;
        }
      }
    }

    // Flush remaining
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim()) as Record<string, unknown>;
      } catch (err) {
        console.warn("[oni-core] Ollama NDJSON: failed to parse remaining buffer:", err, "| raw data:", buffer.trim());
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function ollama(
  modelId: string,
  opts?: OllamaOptions,
): ONIModel {
  const baseUrl = (opts?.baseUrl ?? "http://localhost:11434").replace(
    /\/$/,
    "",
  );
  const defaultMaxTokens = opts?.defaultMaxTokens;
  const defaultTemperature = opts?.defaultTemperature;

  function buildBody(params: ChatParams, stream: boolean): OllamaChatRequestBody {
    const messages = convertMessages(params.messages, params.systemPrompt);

    const body: OllamaChatRequestBody = {
      model: modelId,
      messages,
      stream,
    };

    const temperature = params.temperature ?? defaultTemperature;
    const numPredict = params.maxTokens ?? defaultMaxTokens;

    if (temperature !== undefined || numPredict !== undefined) {
      body.options = {};
      if (temperature !== undefined) {
        body.options.temperature = temperature;
      }
      if (numPredict !== undefined) {
        body.options.num_predict = numPredict;
      }
    }

    return body;
  }

  /* ---- chat -------------------------------------------------------- */

  async function chat(params: ChatParams): Promise<ChatResponse> {
    const body = buildBody(params, false);

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("Ollama", res.status, text, res.headers);
    }

    const json = (await res.json()) as OllamaChatResponseBody;
    if (!json.message) {
      // Ollama returns {"error":"...","done":true} with no message field on errors
      const errMsg = (json as unknown as Record<string, unknown>)["error"];
      throw new Error(
        `Ollama error: ${typeof errMsg === "string" ? errMsg : "no message in response"}`
      );
    }

    return {
      content: json.message.content,
      usage: {
        inputTokens: json.prompt_eval_count ?? 0,
        outputTokens: json.eval_count ?? 0,
      },
      stopReason: "end",
      raw: json,
    };
  }

  /* ---- stream ------------------------------------------------------ */

  async function* stream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const body = buildBody(params, true);

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("Ollama", res.status, text, res.headers);
    }

    if (!res.body) {
      throw new Error("Ollama API returned no body for stream");
    }

    for await (const parsed of parseNDJSON(res.body)) {
      const message = parsed["message"] as { content?: string } | undefined;
      const done = parsed["done"] as boolean | undefined;

      if (message?.content) {
        yield { type: "text", text: message.content };
      }

      if (done) {
        // Final line includes usage counts
        const promptEvalCount = parsed["prompt_eval_count"] as number | undefined;
        const evalCount = parsed["eval_count"] as number | undefined;
        if (promptEvalCount !== undefined || evalCount !== undefined) {
          yield {
            type: "usage",
            usage: {
              inputTokens: promptEvalCount ?? 0,
              outputTokens: evalCount ?? 0,
            },
          };
        }
      }
    }
  }

  /* ---- embed ------------------------------------------------------- */

  async function embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const body: OllamaEmbeddingsRequestBody = {
        model: modelId,
        prompt: text,
      };

      const res = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throwModelHttpError("Ollama", res.status, errText, res.headers);
      }

      const json = (await res.json()) as OllamaEmbeddingsResponseBody;
      // Support both legacy "embedding" (single vector) and newer "embeddings" (array)
      const vec = json.embedding ?? json.embeddings?.[0];
      if (!vec) {
        throw new Error("Ollama embed: unexpected response shape — missing embedding field");
      }
      results.push(vec);
    }

    return results;
  }

  /* ---- model object ------------------------------------------------ */

  return {
    chat,
    stream,
    embed,
    provider: "ollama",
    modelId,
    capabilities: {
      tools: false,
      vision: false,
      streaming: true,
      embeddings: true,
    },
  };
}
