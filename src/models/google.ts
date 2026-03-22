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
import { ModelAPIError } from "../errors.js";

/* ------------------------------------------------------------------ */
/*  Gemini API types (minimal, internal)                              */
/* ------------------------------------------------------------------ */

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: unknown } };
}

interface GeminiContent {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
}

interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface GeminiToolConfig {
  functionCallingConfig: {
    mode: "AUTO" | "NONE" | "ANY";
    allowedFunctionNames?: string[];
  };
}

interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: GeminiGenerationConfig;
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
  toolConfig?: GeminiToolConfig;
}

interface GeminiCandidate {
  content: { parts: GeminiPart[]; role: string };
  finishReason?: string;
}

interface GeminiResponseBody {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
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

/** Check if content parts contain any non-text (image) parts */
function hasMultimodal(content: string | ContentPart[]): boolean {
  if (typeof content === "string") return false;
  return content.some((p) => p.type !== "text");
}

/** Parse a data URL into mimeType and base64 data */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1]!, data: match[2]! };
  return { mimeType: "application/octet-stream", data: dataUrl };
}

/** Convert content parts to Gemini multimodal parts */
function contentToGeminiParts(content: ContentPart[]): GeminiPart[] {
  return content.map((p) => {
    if (p.type === "text") return { text: p.text ?? "" };
    if (p.type === "image") {
      const { mimeType, data } = parseDataUrl(p.imageUrl ?? "");
      return { inlineData: { mimeType, data } };
    }
    return { text: "" };
  });
}

function convertMessages(messages: ONIModelMessage[]): {
  systemInstruction: { parts: GeminiPart[] } | undefined;
  contents: GeminiContent[];
} {
  let systemInstruction: { parts: GeminiPart[] } | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = contentToString(msg.content);
      if (systemInstruction) {
        systemInstruction.parts.push({ text });
      } else {
        systemInstruction = { parts: [{ text }] };
      }
      continue;
    }

    if (msg.role === "tool") {
      // Tool results → function role with functionResponse
      contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: msg.name ?? "",
              response: {
                result:
                  typeof msg.content === "string"
                    ? msg.content
                    : JSON.stringify(msg.content),
              },
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant with tool calls → model role with functionCall parts
      const parts: GeminiPart[] = [];
      const text = contentToString(msg.content);
      if (text) {
        parts.push({ text });
      }
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: { name: tc.name, args: tc.args },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // Regular user or assistant message
    const role = msg.role === "assistant" ? "model" : "user";
    if (role === "user" && hasMultimodal(msg.content)) {
      contents.push({
        role,
        parts: contentToGeminiParts(msg.content as ContentPart[]),
      });
    } else {
      contents.push({
        role,
        parts: [{ text: contentToString(msg.content) }],
      });
    }
  }

  return { systemInstruction, contents };
}

function convertTools(tools: LLMToolDef[]): Array<{ functionDeclarations: GeminiFunctionDeclaration[] }> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

function mapFinishReason(
  reason: string | undefined,
  hasFunctionCalls: boolean,
): ChatResponse["stopReason"] {
  if (reason === "MAX_TOKENS") return "max_tokens";
  if (hasFunctionCalls) return "tool_use";
  return "end";
}

/* ------------------------------------------------------------------ */
/*  SSE line parser (shared)                                          */
/* ------------------------------------------------------------------ */

import { parseSSEData as parseSSE } from "./sse.js";

/* ------------------------------------------------------------------ */
/*  Model ID validation                                               */
/* ------------------------------------------------------------------ */

/**
 * Validates a Google model ID to prevent path-traversal and SSRF attacks.
 * Allows alphanumeric characters, dots, hyphens, and underscores.
 * Rejects path traversal sequences and any characters that could alter
 * the URL structure (slashes, colons with scheme-like patterns, etc.).
 */
const VALID_MODEL_ID_RE = /^[a-zA-Z0-9._\-]+$/;

function validateModelId(modelId: string): void {
  if (!modelId) {
    throw new Error("Google modelId must not be empty");
  }
  if (!VALID_MODEL_ID_RE.test(modelId)) {
    throw new Error(
      `Invalid Google modelId: "${modelId}" — must contain only alphanumeric characters, dots, hyphens, and underscores`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export function google(
  modelId: string,
  opts?: ModelOptions,
): ONIModel {
  validateModelId(modelId);

  const apiKey = opts?.apiKey ?? process.env["GOOGLE_API_KEY"] ?? "";
  if (!apiKey) {
    throw new Error('Google API key not configured. Set GOOGLE_API_KEY environment variable or pass apiKey in options.');
  }
  const rawBaseUrl = (
    opts?.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/$/, "");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error(`Invalid Google baseUrl: "${rawBaseUrl}" is not a valid URL`);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(`Invalid Google baseUrl scheme: "${parsedUrl.protocol}" — only "https:" and "http:" are allowed`);
  }
  const baseUrl = rawBaseUrl;
  const defaultMaxTokens = opts?.defaultMaxTokens;
  const defaultTemperature = opts?.defaultTemperature;

  function buildBody(params: ChatParams): GeminiRequestBody {
    const { systemInstruction: msgSystem, contents } = convertMessages(params.messages);

    const body: GeminiRequestBody = { contents };

    // Merge systemPrompt param with system messages from the conversation
    const systemParts: GeminiPart[] = [];
    if (params.systemPrompt) {
      systemParts.push({ text: params.systemPrompt });
    }
    if (msgSystem) {
      systemParts.push(...msgSystem.parts);
    }
    if (systemParts.length > 0) {
      body.systemInstruction = { parts: systemParts };
    }

    // Generation config
    const maxTokens = params.maxTokens ?? defaultMaxTokens;
    const temperature = params.temperature ?? defaultTemperature;
    if (
      maxTokens !== undefined ||
      temperature !== undefined ||
      (params.stopSequences && params.stopSequences.length > 0)
    ) {
      body.generationConfig = {};
      if (maxTokens !== undefined) {
        body.generationConfig.maxOutputTokens = maxTokens;
      }
      if (temperature !== undefined) {
        body.generationConfig.temperature = temperature;
      }
      if (params.stopSequences && params.stopSequences.length > 0) {
        body.generationConfig.stopSequences = params.stopSequences;
      }
    }

    // Tools
    if (params.tools && params.tools.length > 0) {
      body.tools = convertTools(params.tools);

      // Tool choice
      if (params.toolChoice) {
        if (typeof params.toolChoice === "string") {
          const modeMap: Record<string, "AUTO" | "NONE" | "ANY"> = {
            auto: "AUTO",
            none: "NONE",
            required: "ANY",
          };
          body.toolConfig = {
            functionCallingConfig: { mode: modeMap[params.toolChoice] ?? "AUTO" },
          };
        } else {
          body.toolConfig = {
            functionCallingConfig: {
              mode: "ANY",
              allowedFunctionNames: [params.toolChoice.name],
            },
          };
        }
      }
    }

    // Structured output (responseFormat)
    if (params.responseFormat && params.responseFormat.type === "json_schema") {
      if (!body.generationConfig) body.generationConfig = {};
      body.generationConfig.responseMimeType = "application/json";
      body.generationConfig.responseSchema = params.responseFormat.schema;
    }

    return body;
  }

  /* ---- chat -------------------------------------------------------- */

  async function chat(params: ChatParams): Promise<ChatResponse> {
    const body = buildBody(params);

    const res = await fetch(
      `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("Google Gemini", res.status, text, res.headers);
    }

    const json = (await res.json()) as GeminiResponseBody;
    const candidate = json.candidates?.[0];
    if (!candidate) {
      // Empty candidates = safety filter / blocked response — return gracefully
      return {
        content: "",
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
        stopReason: "end",
        raw: json,
      };
    }
    if (!candidate.content) {
      // candidate.content is omitted when finishReason is SAFETY or RECITATION
      return {
        content: "",
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
        stopReason: "end",
        raw: json,
      };
    }
    const parts = candidate.content.parts;

    // Extract text
    const textParts = parts.filter((p) => p.text !== undefined).map((p) => p.text ?? "");
    const content = textParts.join("");

    // Extract function calls → tool calls
    const functionCalls = parts.filter((p) => p.functionCall !== undefined);
    const toolCalls: ONIModelToolCall[] = functionCalls.map((p, i) => ({
      id: `call_${Date.now()}_${i}`,
      name: p.functionCall!.name,
      args: p.functionCall!.args,
    }));

    const hasFunctionCalls = toolCalls.length > 0;

    const result: ChatResponse = {
      content,
      toolCalls: hasFunctionCalls ? toolCalls : undefined,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      },
      stopReason: mapFinishReason(candidate.finishReason, hasFunctionCalls),
      raw: json,
    };

    // Parse structured output when responseFormat was requested
    if (params.responseFormat && content) {
      try {
        result.parsed = JSON.parse(content);
      } catch {
        console.warn(
          `[oni-core/google] responseFormat requested structured JSON output, but the model returned non-JSON content that could not be parsed. Content length: ${content?.length ?? 0}`,
        );
      }
    }

    return result;
  }

  /* ---- stream ------------------------------------------------------ */

  async function* stream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const body = buildBody(params);

    const res = await fetch(
      `${baseUrl}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: params.signal,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throwModelHttpError("Google Gemini", res.status, text, res.headers);
    }

    if (!res.body) {
      throw new ModelAPIError("Google Gemini", res.status, "No response body for stream");
    }

    let streamCallIndex = 0;
    for await (const data of parseSSE(res.body)) {
      let parsed: GeminiResponseBody;
      try {
        parsed = JSON.parse(data) as GeminiResponseBody;
      } catch (err) {
        console.warn("[oni-core] Google SSE: failed to parse JSON chunk:", err, "| data length:", data?.length ?? 0);
        continue;
      }

      const candidate = parsed.candidates?.[0];
      if (!candidate || !candidate.content) continue;

      for (const part of candidate.content.parts) {
        if (part.text !== undefined) {
          yield { type: "text", text: part.text };
        }
        if (part.functionCall) {
          const callId = `call_stream_${Date.now()}_${streamCallIndex++}`;
          yield {
            type: "tool_call_start",
            toolCall: {
              id: callId,
              name: part.functionCall.name,
              args: part.functionCall.args,
            },
          };
          yield {
            type: "tool_call_end",
            toolCall: {
              id: callId,
              name: part.functionCall.name,
              args: part.functionCall.args,
            },
          };
        }
      }

      // Usage metadata
      if (parsed.usageMetadata) {
        yield {
          type: "usage",
          usage: {
            inputTokens: parsed.usageMetadata.promptTokenCount ?? 0,
            outputTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
          },
        };
      }
    }
  }

  /* ---- embed ------------------------------------------------------- */

  async function embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const res = await fetch(
        `${baseUrl}/models/${encodeURIComponent(modelId)}:embedContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            content: { parts: [{ text }] },
          }),
        },
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throwModelHttpError("Google Gemini", res.status, errText, res.headers);
      }

      const json = (await res.json()) as { embedding?: { values?: number[] } };
      const values = json.embedding?.values;
      if (!values) {
        throw new Error("Google Gemini embed: unexpected response shape — missing embedding.values");
      }
      results.push(values);
    }

    return results;
  }

  /* ---- model object ------------------------------------------------ */

  return {
    chat,
    stream,
    embed,
    provider: "google",
    modelId,
    capabilities: {
      tools: true,
      vision: true,
      streaming: true,
      embeddings: true,
    },
  };
}
