import { describe, it, expect, vi } from "vitest";
import { ONITracer } from "../telemetry.js";
import type { SpanLike, TracerLike } from "../telemetry.js";

/** Mock span that records all calls for assertions */
function createMockSpan(): SpanLike & {
  attributes: Record<string, unknown>;
  status: { code: number; message?: string } | null;
  exceptions: Error[];
  ended: boolean;
} {
  const span = {
    attributes: {} as Record<string, unknown>,
    status: null as { code: number; message?: string } | null,
    exceptions: [] as Error[],
    ended: false,
    setAttribute(key: string, value: unknown) { span.attributes[key] = value; return span; },
    setStatus(s: { code: number; message?: string }) { span.status = s; return span; },
    recordException(err: Error) { span.exceptions.push(err); },
    end() { span.ended = true; },
  };
  return span;
}

/** Mock tracer that collects created spans */
function createMockTracer(): TracerLike & { spans: Array<{ name: string; span: ReturnType<typeof createMockSpan> }> } {
  const tracer = {
    spans: [] as Array<{ name: string; span: ReturnType<typeof createMockSpan> }>,
    startSpan(name: string) {
      const span = createMockSpan();
      tracer.spans.push({ name, span });
      return span;
    },
  };
  return tracer;
}

describe("ONITracer", () => {
  describe("startNodeSpan", () => {
    it("creates a span with correct name and attributes", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      const span = oni.startNodeSpan("summarize", { threadId: "t-1", step: 3 });

      expect(mockTracer.spans).toHaveLength(1);
      expect(mockTracer.spans[0].name).toBe("oni.node.summarize");

      const recorded = mockTracer.spans[0].span;
      expect(recorded.attributes["oni.thread_id"]).toBe("t-1");
      expect(recorded.attributes["oni.node_name"]).toBe("summarize");
      expect(recorded.attributes["oni.step"]).toBe(3);
    });

    it("sets agentId attribute when provided", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      oni.startNodeSpan("think", { threadId: "t-2", step: 0, agentId: "planner" });

      const recorded = mockTracer.spans[0].span;
      expect(recorded.attributes["oni.agent_id"]).toBe("planner");
    });

    it("omits agentId attribute when not provided", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      oni.startNodeSpan("think", { threadId: "t-2", step: 0 });

      const recorded = mockTracer.spans[0].span;
      expect(recorded.attributes).not.toHaveProperty("oni.agent_id");
    });
  });

  describe("endSpan", () => {
    it("calls end() on the span", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      const span = oni.startNodeSpan("n", { threadId: "t", step: 0 });
      expect(mockTracer.spans[0].span.ended).toBe(false);

      oni.endSpan(span);
      expect(mockTracer.spans[0].span.ended).toBe(true);
    });
  });

  describe("recordError", () => {
    it("records exception and sets error status on span", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      const span = oni.startNodeSpan("fail", { threadId: "t", step: 1 });
      const error = new Error("node blew up");

      oni.recordError(span, error);

      const recorded = mockTracer.spans[0].span;
      expect(recorded.exceptions).toHaveLength(1);
      expect(recorded.exceptions[0]).toBe(error);
      expect(recorded.status).toEqual({ code: 2, message: "node blew up" });
    });
  });

  describe("startGraphSpan", () => {
    it("creates a graph-level span with correct name and attributes", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      const span = oni.startGraphSpan("invoke", { threadId: "t-5", agentId: "root" });

      expect(mockTracer.spans).toHaveLength(1);
      expect(mockTracer.spans[0].name).toBe("oni.graph.invoke");

      const recorded = mockTracer.spans[0].span;
      expect(recorded.attributes["oni.thread_id"]).toBe("t-5");
      expect(recorded.attributes["oni.agent_id"]).toBe("root");
    });

    it("omits agentId when not provided", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      oni.startGraphSpan("stream", { threadId: "t-6" });

      const recorded = mockTracer.spans[0].span;
      expect(recorded.attributes).not.toHaveProperty("oni.agent_id");
    });
  });

  describe("startToolSpan", () => {
    it("creates a tool span with correct attributes", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      oni.startToolSpan("search", { threadId: "t-7", step: 2 });

      expect(mockTracer.spans[0].name).toBe("oni.tool.search");
      const recorded = mockTracer.spans[0].span;
      expect(recorded.attributes["oni.thread_id"]).toBe("t-7");
      expect(recorded.attributes["oni.tool_name"]).toBe("search");
      expect(recorded.attributes["oni.step"]).toBe(2);
    });
  });

  describe("startCheckpointSpan", () => {
    it("creates a checkpoint span", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      oni.startCheckpointSpan("save", { threadId: "t-8" });

      expect(mockTracer.spans[0].name).toBe("oni.checkpoint.save");
      expect(mockTracer.spans[0].span.attributes["oni.thread_id"]).toBe("t-8");
    });
  });

  describe("startModelSpan", () => {
    it("creates a model span with provider and model id", () => {
      const mockTracer = createMockTracer();
      const oni = new ONITracer(mockTracer);

      oni.startModelSpan("anthropic", "claude-3-opus", { threadId: "t-9", step: 1 });

      expect(mockTracer.spans[0].name).toBe("oni.model.chat");
      const recorded = mockTracer.spans[0].span;
      expect(recorded.attributes["oni.model.provider"]).toBe("anthropic");
      expect(recorded.attributes["oni.model.id"]).toBe("claude-3-opus");
      expect(recorded.attributes["oni.thread_id"]).toBe("t-9");
      expect(recorded.attributes["oni.step"]).toBe(1);
    });
  });

  describe("no-op when tracer is null", () => {
    it("does not throw on any method when tracer is null", () => {
      const oni = new ONITracer(null);

      // Every span method should return a no-op span, no throws
      const graphSpan = oni.startGraphSpan("invoke", { threadId: "t" });
      const nodeSpan = oni.startNodeSpan("n", { threadId: "t", step: 0 });
      const toolSpan = oni.startToolSpan("t", { threadId: "t", step: 0 });
      const cpSpan = oni.startCheckpointSpan("save", { threadId: "t" });
      const modelSpan = oni.startModelSpan("openai", "gpt-4", { threadId: "t", step: 0 });

      // No-op spans should support chaining and not throw
      graphSpan.setAttribute("x", 1).setStatus({ code: 0 });
      graphSpan.recordException(new Error("test"));
      graphSpan.end();

      // recordError + endSpan helpers should also work
      oni.recordError(nodeSpan, new Error("nope"));
      oni.endSpan(toolSpan);
      oni.endSpan(cpSpan);
      oni.endSpan(modelSpan);
    });

    it("returns a span that supports full chaining", () => {
      const oni = new ONITracer(null);
      const span = oni.startNodeSpan("x", { threadId: "t", step: 0 });

      // setAttribute and setStatus should return `this` for chaining
      const result = span.setAttribute("a", 1).setAttribute("b", 2).setStatus({ code: 1 });
      expect(result).toBe(span);
    });
  });
});
