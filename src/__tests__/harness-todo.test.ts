import { describe, it, expect, vi } from "vitest";
import { TodoModule } from "../harness/todo-module.js";
import type { ToolContext } from "../tools/types.js";
import type { Todo } from "../harness/todo-module.js";

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "1",
    content: "Do something",
    status: "pending",
    priority: "medium",
    updatedAt: 0,
    ...overrides,
  };
}

const mockCtx: ToolContext = {
  config: {},
  store: null,
  state: {},
  emit: () => {},
};

describe("TodoModule", () => {
  it("write() replaces the full todo list", () => {
    const mod = new TodoModule();
    const todos: Todo[] = [
      makeTodo({ id: "1", content: "First" }),
      makeTodo({ id: "2", content: "Second" }),
    ];
    mod.write(todos);

    const state = mod.read();
    expect(state.todos).toHaveLength(2);
    expect(state.todos[0].content).toBe("First");
    expect(state.todos[1].content).toBe("Second");
    // updatedAt should be set
    expect(state.todos[0].updatedAt).toBeGreaterThan(0);
    expect(state.lastUpdated).toBeGreaterThan(0);
  });

  it("updateStatus() changes a single todo", () => {
    const mod = new TodoModule();
    mod.write([makeTodo({ id: "1", status: "pending" })]);

    const result = mod.updateStatus("1", "in_progress");
    expect(result).toBe(true);
    expect(mod.read().todos[0].status).toBe("in_progress");
  });

  it("updateStatus() returns false for unknown id", () => {
    const mod = new TodoModule();
    mod.write([makeTodo({ id: "1" })]);

    const result = mod.updateStatus("unknown", "completed");
    expect(result).toBe(false);
  });

  it("getActive() excludes completed todos", () => {
    const mod = new TodoModule();
    mod.write([
      makeTodo({ id: "1", status: "completed" }),
      makeTodo({ id: "2", status: "pending" }),
      makeTodo({ id: "3", status: "in_progress" }),
    ]);

    const active = mod.getActive();
    expect(active).toHaveLength(2);
    expect(active.map((t) => t.id)).toEqual(["2", "3"]);
  });

  it("getCurrentFocus() returns the in_progress todo", () => {
    const mod = new TodoModule();
    mod.write([
      makeTodo({ id: "1", status: "pending" }),
      makeTodo({ id: "2", status: "in_progress", content: "Working" }),
      makeTodo({ id: "3", status: "pending" }),
    ]);

    const focus = mod.getCurrentFocus();
    expect(focus).toBeDefined();
    expect(focus!.id).toBe("2");
    expect(focus!.content).toBe("Working");
  });

  it("getCurrentFocus() returns undefined when none in_progress", () => {
    const mod = new TodoModule();
    mod.write([makeTodo({ id: "1", status: "pending" })]);

    expect(mod.getCurrentFocus()).toBeUndefined();
  });

  it("isComplete() returns true when all done", () => {
    const mod = new TodoModule();
    mod.write([
      makeTodo({ id: "1", status: "completed" }),
      makeTodo({ id: "2", status: "completed" }),
    ]);

    expect(mod.isComplete()).toBe(true);
  });

  it("isComplete() returns false when empty", () => {
    const mod = new TodoModule();
    expect(mod.isComplete()).toBe(false);
  });

  it("isComplete() returns false when some pending", () => {
    const mod = new TodoModule();
    mod.write([
      makeTodo({ id: "1", status: "completed" }),
      makeTodo({ id: "2", status: "pending" }),
    ]);

    expect(mod.isComplete()).toBe(false);
  });

  it("onChange() fires on write", () => {
    const mod = new TodoModule();
    const cb = vi.fn();
    mod.onChange(cb);

    const todos = [makeTodo({ id: "1" })];
    mod.write(todos);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(mod.getState());
  });

  it("onChange() returns unsubscribe function", () => {
    const mod = new TodoModule();
    const cb = vi.fn();
    const unsub = mod.onChange(cb);

    mod.write([makeTodo({ id: "1" })]);
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    mod.write([makeTodo({ id: "2" })]);
    expect(cb).toHaveBeenCalledTimes(1); // not called again
  });

  it("getTools() returns TodoWrite and TodoRead tools", () => {
    const mod = new TodoModule();
    const tools = mod.getTools();

    expect(tools).toHaveLength(2);

    const names = tools.map((t) => t.name);
    expect(names).toContain("TodoWrite");
    expect(names).toContain("TodoRead");

    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("TodoWrite tool executes and updates state", async () => {
    const mod = new TodoModule();
    const tools = mod.getTools();
    const writeTool = tools.find((t) => t.name === "TodoWrite")!;

    const input = {
      todos: [
        { id: "1", content: "Build feature", status: "in_progress" as const, priority: "high" as const },
        { id: "2", content: "Write tests", status: "pending" as const, priority: "medium" as const },
      ],
    };

    const result = await writeTool.execute(input, mockCtx);
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBe(2);
    expect(parsed.inProgress).toBe(1);
    expect(parsed.pending).toBe(1);
    expect(parsed.completed).toBe(0);

    // State should be updated
    expect(mod.read().todos).toHaveLength(2);
  });

  it("TodoRead tool returns current state", async () => {
    const mod = new TodoModule();
    mod.write([
      makeTodo({ id: "1", content: "Task A", status: "completed" }),
      makeTodo({ id: "2", content: "Task B", status: "pending" }),
    ]);

    const tools = mod.getTools();
    const readTool = tools.find((t) => t.name === "TodoRead")!;

    const result = await readTool.execute({}, mockCtx);
    const parsed = JSON.parse(result as string);

    expect(parsed.todos).toHaveLength(2);
    expect(parsed.lastUpdated).toBeGreaterThan(0);
  });

  it("toJSON/fromJSON round-trips state", () => {
    const mod = new TodoModule();
    mod.write([
      makeTodo({ id: "1", content: "Alpha", status: "in_progress" }),
      makeTodo({ id: "2", content: "Beta", status: "blocked" }),
    ]);

    const json = mod.toJSON();
    const restored = TodoModule.fromJSON(json);

    expect(restored.read().todos).toHaveLength(2);
    expect(restored.read().todos[0].content).toBe("Alpha");
    expect(restored.read().todos[0].status).toBe("in_progress");
    expect(restored.read().todos[1].content).toBe("Beta");
    expect(restored.read().todos[1].status).toBe("blocked");
    expect(restored.read().lastUpdated).toBe(mod.read().lastUpdated);
  });

  it("toContextString() formats todos with status icons", () => {
    const mod = new TodoModule();
    mod.write([
      makeTodo({ id: "1", content: "Done task", status: "completed" }),
      makeTodo({ id: "2", content: "Active task", status: "in_progress" }),
      makeTodo({ id: "3", content: "Waiting task", status: "pending" }),
      makeTodo({ id: "4", content: "Stuck task", status: "blocked" }),
    ]);

    const ctx = mod.toContextString();

    // completed → ✓
    expect(ctx).toContain("✓");
    expect(ctx).toContain("Done task");
    // in_progress → ○
    expect(ctx).toContain("○");
    expect(ctx).toContain("Active task");
    // pending → ○  (same as in_progress per task spec — or different)
    // blocked → ✗
    expect(ctx).toContain("✗");
    expect(ctx).toContain("Stuck task");
    expect(ctx).toContain("Waiting task");
  });
});
