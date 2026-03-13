// ============================================================
// @oni.bot/core/hitl — interrupt() function API
// ============================================================
// Allows calling interrupt(value) from INSIDE a node body to
// pause execution mid-node, surface a value to the caller,
// and resume with a response when the user provides one.
//
// This is fundamentally different from interruptBefore/After:
//   - interruptBefore/After: pauses at node BOUNDARIES (compile-time)
//   - interrupt(): pauses at ARBITRARY POINTS inside node logic (runtime)
//
// Implementation uses a context-local execution slot that the
// Pregel runner installs before calling each node, allowing the
// node to throw a structured interrupt that the runner catches,
// checkpoints, and re-raises to the caller.
// ============================================================

import { AsyncLocalStorage } from "node:async_hooks";
import type { ONIConfig } from "../types.js";

// ----------------------------------------------------------------
// The interrupt value surfaced to the caller
// ----------------------------------------------------------------

export interface InterruptValue {
  /** Value the node is surfacing to the human */
  value:    unknown;
  /** Which node triggered the interrupt */
  node:     string;
  /** Unique resume key for this interrupt point */
  resumeId: string;
  timestamp: number;
}

// ----------------------------------------------------------------
// Resume input provided by the human
// ----------------------------------------------------------------

export interface ResumeValue {
  resumeId: string;
  value:    unknown;
}

// ----------------------------------------------------------------
// Internal signal — thrown inside a node, caught by Pregel runner
// ----------------------------------------------------------------

export class NodeInterruptSignal {
  readonly isNodeInterrupt = true;
  constructor(
    public readonly value:    unknown,
    public readonly resumeId: string
  ) {}
}

// ----------------------------------------------------------------
// Execution context — installed per node invocation by Pregel
// ----------------------------------------------------------------

interface InterruptContext {
  nodeName:    string;
  resumeValue: unknown | undefined;
  hasResume:   boolean;
}

// AsyncLocalStorage slot — isolates concurrent executions
const interruptALS = new AsyncLocalStorage<InterruptContext>();

export function _installInterruptContext(ctx: InterruptContext): void {
  interruptALS.enterWith(ctx);
}

export function _clearInterruptContext(): void {
  interruptALS.enterWith(undefined as any);
}

export function _getInterruptContext(): InterruptContext | null {
  return interruptALS.getStore() ?? null;
}

// ----------------------------------------------------------------
// interrupt(value) — call this inside any node
// ----------------------------------------------------------------

/**
 * Pause execution and surface `value` to the human.
 * Returns the human's response when execution resumes.
 *
 * @example
 * addNode("review", async (state) => {
 *   const decision = await interrupt({
 *     message: "Approve this action?",
 *     data:    state.pendingAction,
 *   });
 *   if (decision === "approve") {
 *     return { approved: true };
 *   }
 *   return { approved: false, reason: decision };
 * });
 */
export async function interrupt<T = unknown>(value: unknown): Promise<T> {
  const ctx = interruptALS.getStore();

  if (!ctx) {
    throw new Error(
      "interrupt() called outside of an ONI node execution context. " +
      "Make sure you're calling interrupt() inside an addNode() function."
    );
  }

  // If we already have a resume value for this execution, return it
  if (ctx.hasResume) {
    return ctx.resumeValue as T;
  }

  // No resume yet — throw the interrupt signal to pause execution
  const resumeId = `${ctx.nodeName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  throw new NodeInterruptSignal(value, resumeId);
}

// ----------------------------------------------------------------
// getUserInput — semantic alias for collecting human input
// ----------------------------------------------------------------

export interface GetUserInputOptions {
  /** Prompt shown to the user */
  prompt:       string;
  /** Optional field name for structured input */
  field?:       string;
  /** Validation — if it returns false, the input is rejected */
  validate?:    (input: unknown) => boolean | string;
  /** Expected input type hint */
  inputType?:   "text" | "boolean" | "number" | "select" | "json";
  /** For "select" inputType — valid choices */
  choices?:     string[];
}

/**
 * Pause execution and collect structured input from the human.
 * A semantic alias for interrupt() with richer metadata.
 *
 * @example
 * addNode("get_approval", async (state) => {
 *   const approved = await getUserInput({
 *     prompt:    `Approve deployment of ${state.version}?`,
 *     inputType: "boolean",
 *   });
 *   return { approved: approved as boolean };
 * });
 */
export async function getUserInput<T = unknown>(
  opts: GetUserInputOptions
): Promise<T> {
  return interrupt<T>({
    __type:    "user_input_request",
    prompt:    opts.prompt,
    field:     opts.field,
    inputType: opts.inputType ?? "text",
    choices:   opts.choices,
    // Validator serialized as string for display purposes
    hasValidator: !!opts.validate,
  });
}

// ----------------------------------------------------------------
// getUserApproval — boolean HITL shorthand
// ----------------------------------------------------------------

/**
 * Ask the human for a yes/no decision.
 *
 * @example
 * const ok = await getUserApproval("Deploy to production?");
 * if (!ok) return { aborted: true };
 */
export async function getUserApproval(prompt: string): Promise<boolean> {
  return getUserInput<boolean>({ prompt, inputType: "boolean" });
}

// ----------------------------------------------------------------
// getUserSelection — pick from a list
// ----------------------------------------------------------------

export async function getUserSelection(
  prompt:  string,
  choices: string[]
): Promise<string> {
  return getUserInput<string>({ prompt, inputType: "select", choices });
}
