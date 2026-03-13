// ============================================================
// @oni.bot/core — OpenTelemetry Adapter
// ============================================================

/** Minimal subset of OTel Span interface */
export interface SpanLike {
  setAttribute(key: string, value: unknown): this;
  setStatus(status: { code: number; message?: string }): this;
  recordException(err: Error): void;
  end(): void;
}

/** Minimal subset of OTel Tracer interface */
export interface TracerLike {
  startSpan(name: string, options?: unknown): SpanLike;
}

const NOOP_SPAN: SpanLike = {
  setAttribute() { return this; },
  setStatus() { return this; },
  recordException() {},
  end() {},
};

export class ONITracer {
  constructor(private readonly tracer: TracerLike | null) {}

  startGraphSpan(operation: string, opts: { threadId: string; agentId?: string }): SpanLike {
    if (!this.tracer) return NOOP_SPAN;
    const span = this.tracer.startSpan(`oni.graph.${operation}`);
    span.setAttribute("oni.thread_id", opts.threadId);
    if (opts.agentId) span.setAttribute("oni.agent_id", opts.agentId);
    return span;
  }

  startNodeSpan(nodeName: string, opts: { threadId: string; step: number; agentId?: string }): SpanLike {
    if (!this.tracer) return NOOP_SPAN;
    const span = this.tracer.startSpan(`oni.node.${nodeName}`);
    span.setAttribute("oni.thread_id", opts.threadId);
    span.setAttribute("oni.node_name", nodeName);
    span.setAttribute("oni.step", opts.step);
    if (opts.agentId) span.setAttribute("oni.agent_id", opts.agentId);
    return span;
  }

  startToolSpan(toolName: string, opts: { threadId: string; step: number }): SpanLike {
    if (!this.tracer) return NOOP_SPAN;
    const span = this.tracer.startSpan(`oni.tool.${toolName}`);
    span.setAttribute("oni.thread_id", opts.threadId);
    span.setAttribute("oni.tool_name", toolName);
    span.setAttribute("oni.step", opts.step);
    return span;
  }

  startCheckpointSpan(operation: string, opts: { threadId: string }): SpanLike {
    if (!this.tracer) return NOOP_SPAN;
    const span = this.tracer.startSpan(`oni.checkpoint.${operation}`);
    span.setAttribute("oni.thread_id", opts.threadId);
    return span;
  }

  startModelSpan(provider: string, modelId: string, opts: { threadId: string; step: number }): SpanLike {
    if (!this.tracer) return NOOP_SPAN;
    const span = this.tracer.startSpan(`oni.model.chat`);
    span.setAttribute("oni.model.provider", provider);
    span.setAttribute("oni.model.id", modelId);
    span.setAttribute("oni.thread_id", opts.threadId);
    span.setAttribute("oni.step", opts.step);
    return span;
  }

  recordError(span: SpanLike, error: Error): void {
    span.recordException(error);
    span.setStatus({ code: 2, message: error.message });
  }

  endSpan(span: SpanLike): void {
    span.end();
  }
}
