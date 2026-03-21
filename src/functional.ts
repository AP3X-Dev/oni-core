// ============================================================
// @oni.bot/core — Functional API
// ============================================================
// Alternative to the builder pattern. Compose agent skeletons
// using decorated functions instead of StateGraph.addNode().
//
// @example
// const search = task("search", async (query: string) => {
//   return { results: await searchWeb(query) };
// });
//
// const agent = entrypoint(
//   { channels: myChannels, checkpointer },
//   async (state: MyState) => {
//     const results = await search(state.query);
//     return { ...results };
//   }
// );
//
// const result = await agent.invoke({ query: "hello" });
// ============================================================

import { StateGraph } from "./graph.js";
import { START, END } from "./types.js";
import type { ChannelSchema, ONIConfig, ONICheckpointer } from "./types.js";
import type { ONISkeletonV3 } from "./graph.js";

// ----------------------------------------------------------------
// task() — wraps an async function as a named, reusable task unit
// Can be called from within entrypoint functions
// ----------------------------------------------------------------

export interface TaskOptions {
  /** Retry policy */
  maxAttempts?: number;
  initialDelay?: number;
}

export interface TaskDef<TInput, TOutput> {
  name:   string;
  invoke: (input: TInput, config?: ONIConfig) => Promise<TOutput>;
}

export function task<TInput, TOutput>(
  name:   string,
  fn:     (input: TInput, config?: ONIConfig) => Promise<TOutput> | TOutput,
  opts?:  TaskOptions
): TaskDef<TInput, TOutput> {
  return {
    name,
    async invoke(input: TInput, config?: ONIConfig): Promise<TOutput> {
      if (opts?.maxAttempts && opts.maxAttempts > 1) {
        let last: Error | undefined;
        let delay = opts.initialDelay ?? 500;
        for (let i = 0; i < opts.maxAttempts; i++) {
          try {
            return await fn(input, config);
          } catch (err) {
            last = err instanceof Error ? err : new Error(String(err));
            if (i < opts.maxAttempts - 1) {
              await new Promise((r) => setTimeout(r, delay));
              delay *= 2;
            }
          }
        }
        throw last ?? new Error("retry: no attempts made (maxAttempts=0)");
      }
      return fn(input, config);
    },
  };
}

// ----------------------------------------------------------------
// entrypoint() — wraps a function as a complete compiled skeleton
// ----------------------------------------------------------------

export interface EntrypointOptions<S extends Record<string, unknown>> {
  channels:      ChannelSchema<S>;
  checkpointer?: ONICheckpointer<S>;
  /** Node name (default: "entrypoint") */
  name?:         string;
}

/**
 * Create a compiled skeleton from a single async function.
 * The function receives full state and returns a partial update.
 *
 * @example
 * const app = entrypoint(
 *   { channels: { query: lastValue(() => ""), answer: lastValue(() => "") } },
 *   async (state) => {
 *     const answer = await myLLM(state.query);
 *     return { answer };
 *   }
 * );
 */
export function entrypoint<S extends Record<string, unknown>>(
  opts: EntrypointOptions<S>,
  fn:   (state: S, config?: ONIConfig) => Promise<Partial<S>> | Partial<S>
): ONISkeletonV3<S> {
  const nodeName = opts.name ?? "entrypoint";

  const graph = new StateGraph<S>({ channels: opts.channels });
  graph.addNode(nodeName, fn);
  graph.addEdge(START, nodeName);
  graph.addEdge(nodeName, END);

  return graph.compile({ checkpointer: opts.checkpointer });
}

// ----------------------------------------------------------------
// pipe() — compose multiple tasks into a linear pipeline
// ----------------------------------------------------------------

export function pipe<S extends Record<string, unknown>>(
  opts:  EntrypointOptions<S>,
  ...tasks: Array<(state: S, config?: ONIConfig) => Promise<Partial<S>> | Partial<S>>
): ONISkeletonV3<S> {
  if (tasks.length === 0) {
    throw new Error("pipe() requires at least one task function");
  }

  const graph = new StateGraph<S>({ channels: opts.channels });

  const names = tasks.map((_, i) => `step_${i}`);

  for (let i = 0; i < tasks.length; i++) {
    graph.addNode(names[i]!, tasks[i]!);
  }

  graph.addEdge(START, names[0]!);
  for (let i = 0; i < names.length - 1; i++) {
    graph.addEdge(names[i]!, names[i + 1]!);
  }
  graph.addEdge(names[names.length - 1]!, END);

  return graph.compile({ checkpointer: opts.checkpointer });
}

// ----------------------------------------------------------------
// branch() — conditional routing shorthand
// ----------------------------------------------------------------

export function branch<S extends Record<string, unknown>>(
  condition: (state: S) => string,
  branches:  Record<string, (state: S, config?: ONIConfig) => Promise<Partial<S>> | Partial<S>>,
  opts:      EntrypointOptions<S>
): ONISkeletonV3<S> {
  const graph = new StateGraph<S>({ channels: opts.channels });

  for (const [name, fn] of Object.entries(branches)) {
    graph.addNode(name, fn);
    graph.addEdge(name, END);
  }

  // Router node
  graph.addNode("__router__", async (state) => state);
  graph.addEdge(START, "__router__");
  graph.addConditionalEdges("__router__", condition);

  return graph.compile({ checkpointer: opts.checkpointer });
}

// Re-export interrupt for functional API users
export { interrupt, getUserInput, getUserApproval, getUserSelection } from "./hitl/interrupt.js";
