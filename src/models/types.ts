/** Canonical message format — adapters translate to/from provider formats */
export interface ONIModelMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ONIModelToolCall[];
}

export interface ContentPart {
  type: "text" | "image";
  text?: string;
  imageUrl?: string;
}

export interface ONIModelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  isError?: boolean;
}

export type JSONSchema = Record<string, unknown>;

export interface LLMToolDef {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ChatParams {
  messages: ONIModelMessage[];
  tools?: LLMToolDef[];
  toolChoice?: "none" | "required" | "auto" | { name: string };
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  responseFormat?: {
    type: "json_schema";
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface ChatResponse {
  content: string;
  toolCalls?: ONIModelToolCall[];
  parsed?: unknown;
  usage: TokenUsage;
  stopReason: "end" | "tool_use" | "max_tokens" | "stop_sequence";
  raw?: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatChunk {
  type: "text" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "usage";
  text?: string;
  toolCall?: Partial<ONIModelToolCall>;
  usage?: TokenUsage;
}

export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  streaming: boolean;
  embeddings: boolean;
}

export interface ONIModel {
  chat(params: ChatParams): Promise<ChatResponse>;
  stream(params: ChatParams): AsyncGenerator<ChatChunk>;
  embed?(texts: string[]): Promise<number[][]>;
  readonly provider: string;
  readonly modelId: string;
  readonly capabilities: ModelCapabilities;
}

export interface ModelOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
}
