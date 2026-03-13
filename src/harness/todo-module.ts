// ============================================================
// @oni.bot/core/harness — TodoModule (working memory)
// ============================================================
// Claude Code-inspired: inject TODO state as system-reminder
// after EVERY tool use to keep agents coherent across 50+ turns.
// ============================================================

import type { ToolDefinition, ToolContext } from "../tools/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type TodoStatus = "pending" | "in_progress" | "completed" | "blocked";
export type TodoPriority = "critical" | "high" | "medium" | "low";

export interface Todo {
  id: string;
  content: string;
  activeForm?: string;
  status: TodoStatus;
  priority: TodoPriority;
  subtasks?: Todo[];
  updatedAt: number;
  agentName?: string;
}

export interface TodoState {
  todos: Todo[];
  lastUpdated: number;
  sessionId?: string;
}

// ─── Status Icons ───────────────────────────────────────────────────────────

const STATUS_ICONS: Record<TodoStatus, string> = {
  completed: "✓",
  in_progress: "○",
  pending: "○",
  blocked: "✗",
};

// ─── TodoModule ─────────────────────────────────────────────────────────────

export class TodoModule {
  private state: TodoState;
  private listeners: Set<(state: TodoState) => void>;

  constructor(sessionId?: string) {
    this.state = {
      todos: [],
      lastUpdated: 0,
      sessionId,
    };
    this.listeners = new Set();
  }

  // ── Write (replace full list) ───────────────────────────────────────────

  write(todos: Todo[]): void {
    const now = Date.now();
    this.state = {
      ...this.state,
      todos: todos.map((t) => ({ ...t, updatedAt: now })),
      lastUpdated: now,
    };
    this.notify();
  }

  // ── Read ────────────────────────────────────────────────────────────────

  read(): TodoState {
    return this.state;
  }

  getState(): TodoState {
    return this.state;
  }

  // ── Update single todo status ───────────────────────────────────────────

  updateStatus(id: string, status: TodoStatus): boolean {
    const todo = this.state.todos.find((t) => t.id === id);
    if (!todo) return false;

    todo.status = status;
    todo.updatedAt = Date.now();
    this.state.lastUpdated = todo.updatedAt;
    this.notify();
    return true;
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getActive(): Todo[] {
    return this.state.todos.filter((t) => t.status !== "completed");
  }

  getCurrentFocus(): Todo | undefined {
    return this.state.todos.find((t) => t.status === "in_progress");
  }

  isComplete(): boolean {
    return (
      this.state.todos.length > 0 &&
      this.state.todos.every((t) => t.status === "completed")
    );
  }

  // ── Subscriptions ─────────────────────────────────────────────────────

  onChange(callback: (state: TodoState) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb(this.state);
    }
  }

  // ── Tools ──────────────────────────────────────────────────────────────

  getTools(): ToolDefinition[] {
    return [this.createWriteTool(), this.createReadTool()];
  }

  private createWriteTool(): ToolDefinition {
    return {
      name: "TodoWrite",
      description:
        "Replace the full TODO list. Each todo needs id, content, status, and priority.",
      schema: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                activeForm: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed", "blocked"],
                },
                priority: {
                  type: "string",
                  enum: ["critical", "high", "medium", "low"],
                },
                subtasks: { type: "array" },
                agentName: { type: "string" },
              },
              required: ["id", "content", "status", "priority"],
            },
          },
        },
        required: ["todos"],
      },
      execute: (input: { todos: Todo[] }, _ctx: ToolContext): string => {
        const todos: Todo[] = input.todos.map((t) => ({
          id: t.id,
          content: t.content,
          activeForm: t.activeForm,
          status: t.status || "pending",
          priority: t.priority || "medium",
          subtasks: t.subtasks,
          updatedAt: 0,
          agentName: t.agentName,
        }));

        this.write(todos);

        const completed = todos.filter(
          (t) => t.status === "completed"
        ).length;
        const inProgress = todos.filter(
          (t) => t.status === "in_progress"
        ).length;
        const pending = todos.filter(
          (t) => t.status === "pending"
        ).length;

        return JSON.stringify({
          success: true,
          total: todos.length,
          completed,
          inProgress,
          pending,
        });
      },
    };
  }

  private createReadTool(): ToolDefinition {
    return {
      name: "TodoRead",
      description: "Read the current TODO list state.",
      schema: {
        type: "object",
        properties: {},
      },
      execute: (_input: unknown, _ctx: ToolContext): string => {
        return JSON.stringify(this.state);
      },
    };
  }

  // ── Serialization ─────────────────────────────────────────────────────

  toJSON(): TodoState {
    return { ...this.state, todos: this.state.todos.map((t) => ({ ...t })) };
  }

  static fromJSON(json: TodoState): TodoModule {
    const mod = new TodoModule(json.sessionId);
    mod.state = {
      todos: json.todos.map((t) => ({ ...t })),
      lastUpdated: json.lastUpdated,
      sessionId: json.sessionId,
    };
    return mod;
  }

  // ── Context String ────────────────────────────────────────────────────

  toContextString(): string {
    if (this.state.todos.length === 0) {
      return "<todos>\nNo todos.\n</todos>";
    }

    const lines = this.state.todos.map((t) => {
      const icon = STATUS_ICONS[t.status];
      const priorityTag =
        t.priority === "critical" || t.priority === "high"
          ? ` [${t.priority}]`
          : "";
      return `  ${icon} ${t.content}${priorityTag} (${t.status})`;
    });

    return `<todos>\n${lines.join("\n")}\n</todos>`;
  }
}
