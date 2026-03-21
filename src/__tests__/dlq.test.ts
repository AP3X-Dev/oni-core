import { describe, it, expect } from "vitest";
import { DeadLetterQueue } from "../dlq.js";

describe("DeadLetterQueue", () => {
  it("starts empty", () => {
    const dlq = new DeadLetterQueue();
    expect(dlq.size()).toBe(0);
    expect(dlq.getAll("t1")).toEqual([]);
  });

  it("records a dead letter with correct fields", () => {
    const dlq = new DeadLetterQueue();
    const error = new Error("boom");
    const input = { messages: ["hello"] };

    const dl = dlq.record("t1", "agent", input, error, 3);

    expect(dl.id).toMatch(/^dlq-\d+-[a-z0-9]+$/);
    expect(dl.node).toBe("agent");
    expect(dl.input).toBe(input);
    expect(dl.error).toBe(error);
    expect(dl.attempts).toBe(3);
    expect(dl.timestamp).toBeGreaterThan(0);
    expect(dlq.size()).toBe(1);
  });

  it("separates by threadId", () => {
    const dlq = new DeadLetterQueue();
    const err = new Error("fail");

    dlq.record("t1", "a", {}, err, 1);
    dlq.record("t2", "b", {}, err, 2);
    dlq.record("t1", "c", {}, err, 1);

    expect(dlq.getAll("t1")).toHaveLength(2);
    expect(dlq.getAll("t2")).toHaveLength(1);
    expect(dlq.getAll("t3")).toEqual([]);
    expect(dlq.size()).toBe(3);
  });

  it("clears letters for a thread", () => {
    const dlq = new DeadLetterQueue();
    const err = new Error("fail");

    dlq.record("t1", "a", {}, err, 1);
    dlq.record("t1", "b", {}, err, 1);
    dlq.record("t2", "c", {}, err, 1);

    dlq.clear("t1");

    expect(dlq.getAll("t1")).toEqual([]);
    expect(dlq.getAll("t2")).toHaveLength(1);
    expect(dlq.size()).toBe(1);
  });

  it("removes a specific letter by id", () => {
    const dlq = new DeadLetterQueue();
    const err = new Error("fail");

    const dl1 = dlq.record("t1", "a", {}, err, 1);
    const dl2 = dlq.record("t1", "b", {}, err, 1);

    expect(dlq.remove("t1", dl1.id)).toBe(true);
    expect(dlq.getAll("t1")).toHaveLength(1);
    expect(dlq.getAll("t1")[0].id).toBe(dl2.id);
  });

  it("remove returns false for unknown thread or id", () => {
    const dlq = new DeadLetterQueue();
    expect(dlq.remove("no-thread", "dlq-999")).toBe(false);

    const err = new Error("fail");
    dlq.record("t1", "a", {}, err, 1);
    expect(dlq.remove("t1", "dlq-999999")).toBe(false);
  });

  it("size() returns total across all threads", () => {
    const dlq = new DeadLetterQueue();
    const err = new Error("fail");

    dlq.record("t1", "a", {}, err, 1);
    dlq.record("t2", "b", {}, err, 1);
    dlq.record("t3", "c", {}, err, 1);
    dlq.record("t1", "d", {}, err, 1);

    expect(dlq.size()).toBe(4);
  });
});
