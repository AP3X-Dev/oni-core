import { describe, it, expect } from "vitest";
import { AuditLog } from "../guardrails/audit.js";
import type { AuditEntry } from "../guardrails/types.js";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: Date.now(),
    agent: "agent-a",
    action: "llm.request",
    data: {},
    ...overrides,
  };
}

describe("guardrails — audit log", () => {
  it("records and retrieves entries", () => {
    const log = new AuditLog();

    const e1 = entry({ agent: "agent-a", action: "llm.request" });
    const e2 = entry({ agent: "agent-b", action: "tool.call", data: { tool: "search" } });

    log.record("thread-1", e1);
    log.record("thread-1", e2);

    const entries = log.getLog("thread-1");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toBe(e1);
    expect(entries[1]).toBe(e2);
  });

  it("returns empty array for unknown thread", () => {
    const log = new AuditLog();
    expect(log.getLog("nonexistent")).toEqual([]);
  });

  it("filters by agent", () => {
    const log = new AuditLog();

    log.record("t1", entry({ agent: "agent-a", action: "llm.request" }));
    log.record("t1", entry({ agent: "agent-b", action: "llm.request" }));
    log.record("t1", entry({ agent: "agent-a", action: "tool.call" }));

    const agentA = log.getByAgent("t1", "agent-a");
    expect(agentA).toHaveLength(2);
    expect(agentA.every(e => e.agent === "agent-a")).toBe(true);

    const agentB = log.getByAgent("t1", "agent-b");
    expect(agentB).toHaveLength(1);
  });

  it("filters by action", () => {
    const log = new AuditLog();

    log.record("t1", entry({ action: "llm.request" }));
    log.record("t1", entry({ action: "llm.response" }));
    log.record("t1", entry({ action: "tool.call" }));
    log.record("t1", entry({ action: "tool.call" }));

    const toolCalls = log.getByAction("t1", "tool.call");
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.every(e => e.action === "tool.call")).toBe(true);

    const responses = log.getByAction("t1", "llm.response");
    expect(responses).toHaveLength(1);
  });

  it("serializes and deserializes with toJSON/fromJSON", () => {
    const log = new AuditLog();

    const e1 = entry({ agent: "agent-a", action: "llm.request", data: { model: "gpt-4o" } });
    const e2 = entry({ agent: "agent-b", action: "tool.call", data: { tool: "search" } });

    log.record("t1", e1);
    log.record("t1", e2);

    const json = log.toJSON("t1");

    // Restore into a new log
    const log2 = new AuditLog();
    log2.fromJSON("t1", json);

    const restored = log2.getLog("t1");
    expect(restored).toHaveLength(2);
    expect(restored[0].agent).toBe("agent-a");
    expect(restored[0].data).toEqual({ model: "gpt-4o" });
    expect(restored[1].agent).toBe("agent-b");
    expect(restored[1].data).toEqual({ tool: "search" });
  });

  it("clears entries for a specific thread", () => {
    const log = new AuditLog();

    log.record("t1", entry());
    log.record("t2", entry());

    log.clear("t1");

    expect(log.getLog("t1")).toEqual([]);
    expect(log.getLog("t2")).toHaveLength(1);
  });

  it("clears all entries", () => {
    const log = new AuditLog();

    log.record("t1", entry());
    log.record("t2", entry());
    log.record("t3", entry());

    log.clearAll();

    expect(log.getLog("t1")).toEqual([]);
    expect(log.getLog("t2")).toEqual([]);
    expect(log.getLog("t3")).toEqual([]);
  });
});
