// ============================================================
// @oni.bot/core — Core Types v2
// ============================================================

export const START = "__start__" as const;
export const END   = "__end__"   as const;

export type StartNode = typeof START;
export type EndNode   = typeof END;
export type NodeName  = string | StartNode | EndNode;

// ----------------------------------------------------------------
// Annotated — attach a reducer inline on a type
// Usage:  messages: Annotated<Message[], typeof appendReducer>
// ----------------------------------------------------------------
export type Annotated<T, _Reducer> = T;

// ----------------------------------------------------------------
// Channels
// ----------------------------------------------------------------

export interface Channel<T> {
  reducer: (current: T, update: T) => T;
  default: () => T;
  /** If true, resets to default() at the start of every superstep */
  ephemeral?: boolean;
}

export function lastValue<T>(defaultVal: () => T): Channel<T> {
  return { reducer: (_, b) => b, default: defaultVal };
}

export function appendList<T>(defaultVal?: () => T[]): Channel<T[]> {
  return { reducer: (a, b) => [...a, ...(Array.isArray(b) ? b : [b as unknown as T])], default: defaultVal ?? (() => []) };
}

export function mergeObject<T extends Record<string, unknown>>(
  defaultVal: () => T
): Channel<T> {
  return { reducer: (a, b) => ({ ...a, ...b }), default: defaultVal };
}

/** Resets to default at the start of every superstep — good for per-step scratch data */
export function ephemeralValue<T>(defaultVal: () => T): Channel<T> {
  return { reducer: (_, b) => b, default: defaultVal, ephemeral: true };
}

export type ChannelSchema<S> = { [K in keyof S]: Channel<S[K]> };

// ----------------------------------------------------------------
// Send — dynamic fan-out: route to a node with a custom state patch
// ----------------------------------------------------------------

export class Send {
  constructor(
    public readonly node: string,
    public readonly args: Record<string, unknown>
  ) {}
}

// ----------------------------------------------------------------
// Command — structured return from a node (replaces raw Partial<S>)
// Supports: state update + routing + dynamic sends in one return
// ----------------------------------------------------------------

export interface CommandOptions<S> {
  /** State update to apply */
  update?: Partial<S>;
  /** Go to a specific node (or END) */
  goto?: NodeName | NodeName[];
  /** Dynamic fan-out sends */
  send?: Send[];
  /** Emit a resume value for human-in-the-loop */
  resume?: unknown;
  /** Target graph for the update — use Command.PARENT to push to parent */
  graph?: typeof Command.PARENT;
}

export class Command<S> {
  static readonly PARENT = "__parent__" as const;

  readonly update?: Partial<S>;
  readonly goto?: NodeName | NodeName[];
  readonly send?: Send[];
  readonly resume?: unknown;
  readonly graph?: typeof Command.PARENT | undefined;

  constructor(opts: CommandOptions<S>) {
    this.update = opts.update;
    this.goto   = opts.goto;
    this.send   = opts.send;
    this.resume = opts.resume;
    this.graph  = opts.graph;
  }
}

// ----------------------------------------------------------------
// Nodes
// ----------------------------------------------------------------

export type NodeReturn<S> = Partial<S> | Command<S> | void;

export type NodeFn<S> = (
  state: S,
  config?: ONIConfig
) => Promise<NodeReturn<S>> | NodeReturn<S>;

export interface NodeDefinition<S> {
  name: string;
  fn: NodeFn<S>;
  retry?: RetryPolicy;
  /** If set, this node IS a compiled subgraph */
  subgraph?: ONISkeleton<S>;
  cache?: boolean | CachePolicy;
  /** Hard timeout in ms — node is aborted if it exceeds this */
  timeout?: number;
  circuitBreaker?: {
    threshold: number;
    resetAfter: number;
    fallback?: (state: S, error: Error) => NodeReturn<S>;
  };
}

// ----------------------------------------------------------------
// Retry Policy
// ----------------------------------------------------------------

export interface RetryPolicy {
  maxAttempts: number;
  /** Initial delay in ms */
  initialDelay?: number;
  /** Multiplier for exponential backoff (default 2) */
  backoffMultiplier?: number;
  /** Max delay cap in ms (default 30_000) */
  maxDelay?: number;
  /** Predicate: only retry if this returns true */
  retryOn?: (error: Error) => boolean;
  /** Whether to add random jitter to backoff delay (default true) */
  jitter?: boolean;
}

// ----------------------------------------------------------------
// Cache Policy
// ----------------------------------------------------------------

export interface CachePolicy {
  /** Cache key function — defaults to JSON.stringify(state) */
  key?: (state: unknown) => string;
  /** TTL in ms — cache entries expire after this. Default: Infinity (per-invocation) */
  ttl?: number;
}

// ----------------------------------------------------------------
// Edges
// ----------------------------------------------------------------

export interface StaticEdge {
  type: "static";
  from: NodeName;
  to: NodeName;
}

export interface ConditionalEdge<S> {
  type: "conditional";
  from: NodeName;
  condition: (state: S, config?: ONIConfig) => NodeName | NodeName[] | Send[];
  pathMap?: Record<string, NodeName>;
}

export type Edge<S> = StaticEdge | ConditionalEdge<S>;

// ----------------------------------------------------------------
// Dynamic Interrupt — runtime breakpoint condition
// ----------------------------------------------------------------

export interface DynamicInterrupt<S> {
  node: string;
  timing: "before" | "after";
  condition: (state: S) => boolean;
}

// ----------------------------------------------------------------
// Interrupt config
// ----------------------------------------------------------------

export interface InterruptConfig {
  interruptBefore?: string[];
  interruptAfter?:  string[];
}

// ----------------------------------------------------------------
// ONIConfig
// ----------------------------------------------------------------

export interface ONIConfig {
  threadId?:       string;
  recursionLimit?: number;
  metadata?:       Record<string, unknown>;
  tags?:           string[];
  agentId?:        string;
  parentRunId?:    string;
  /** Dynamic runtime interrupt conditions */
  dynamicInterrupts?: DynamicInterrupt<unknown>[];
}

// ----------------------------------------------------------------
// Checkpointing
// ----------------------------------------------------------------

export interface ONICheckpoint<S> {
  threadId:   string;
  step:       number;
  state:      S;
  nextNodes:  string[];
  timestamp:  number;
  agentId?:   string;
  /** Pending Send queue at time of checkpoint */
  pendingSends?: Array<{ node: string; args: Record<string, unknown> }>;
  /** Arbitrary metadata from config — useful for filtering and debugging */
  metadata?: Record<string, unknown>;
  /** Per-node channel writes from the last superstep */
  pendingWrites?: Array<{ nodeId: string; writes: Record<string, unknown> }>;
}

export interface CheckpointListOptions {
  limit?: number;
  before?: number;
  filter?: Record<string, unknown>;
}

export interface ONICheckpointer<S> {
  get(threadId: string):                                        Promise<ONICheckpoint<S> | null>;
  put(checkpoint: ONICheckpoint<S>):                            Promise<void>;
  list(threadId: string, opts?: CheckpointListOptions):         Promise<ONICheckpoint<S>[]>;
  delete(threadId: string):                                     Promise<void>;
}

// ----------------------------------------------------------------
// Stream
// ----------------------------------------------------------------

export type StreamMode = "values" | "updates" | "debug" | "messages" | "custom";

export interface ONIStreamEvent<S> {
  event:      "node_start" | "node_end" | "state_update" | "error" | "interrupt" | "send";
  node?:      string;
  data:       Partial<S> | S | Error | ONIInterruptEvent | Send;
  step:       number;
  timestamp:  number;
  agentId?:   string;
  /** Set when using multiple stream modes — indicates which mode produced this event */
  mode?:      StreamMode;
}

export interface ONIInterruptEvent {
  node:   string;
  timing: "before" | "after";
  state:  unknown;
}

// ----------------------------------------------------------------
// Custom stream events
// ----------------------------------------------------------------

export interface CustomStreamEvent {
  event:     "custom";
  node:      string;
  name:      string;
  data:      unknown;
  step:      number;
  timestamp: number;
  agentId?:  string;
  mode?:     StreamMode;
}

export interface MessageStreamEvent {
  event:     "messages" | "messages/complete" | "messages/metadata";
  node:      string;
  data: {
    chunk:   string;
    content: string;
    role:    "assistant";
    id:      string;
  };
  step:      number;
  timestamp: number;
  agentId?:  string;
  mode?:     StreamMode;
}

// ----------------------------------------------------------------
// ONISkeleton — compiled executable interface
// ----------------------------------------------------------------

export interface ONISkeleton<S> {
  invoke(input: Partial<S>, config?: ONIConfig): Promise<S>;
  stream(
    input: Partial<S>,
    config?: ONIConfig & { streamMode?: StreamMode | StreamMode[] }
  ): AsyncGenerator<ONIStreamEvent<S>>;
  batch(inputs: Partial<S>[], config?: ONIConfig): Promise<S[]>;
  getState(config: { threadId: string }):                              Promise<S | null>;
  updateState(config: { threadId: string }, update: Partial<S>):      Promise<void>;
  /** Time-travel: get state as it was at a specific superstep */
  getStateAt(config: { threadId: string; step: number }):             Promise<S | null>;
  /** Get full checkpoint history for a thread */
  getHistory(config: { threadId: string }):                           Promise<ONICheckpoint<S>[]>;
  /** Fork: replay execution from a historical checkpoint */
  forkFrom(config: { threadId: string; step: number; newThreadId: string }): Promise<void>;
}
