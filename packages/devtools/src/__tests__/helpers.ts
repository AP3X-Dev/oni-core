import type { CompiledGraphLike, ToolRegistryLike } from "../types.js";

export function createMockGraph(opts?: {
  nodes?: Array<{ id: string; type: string }>;
  edges?: Array<{ from: string; to: string; type: "static" | "conditional"; label?: string }>;
}): CompiledGraphLike {
  return {
    getGraph: () => ({
      nodes: opts?.nodes ?? [
        { id: "__start__", type: "start" },
        { id: "llm_call", type: "node" },
        { id: "tool_executor", type: "node" },
        { id: "__end__", type: "end" },
      ],
      edges: opts?.edges ?? [
        { from: "__start__", to: "llm_call", type: "static" as const },
        { from: "llm_call", to: "tool_executor", type: "conditional" as const, label: "has_tools" },
        { from: "llm_call", to: "__end__", type: "conditional" as const, label: "done" },
        { from: "tool_executor", to: "llm_call", type: "static" as const },
      ],
    }),
  };
}

export function createMockRegistry(): ToolRegistryLike & {
  register(name: string, desc: string): void;
  unregister(name: string): void;
} {
  const tools = new Map<string, { description: string }>();

  return {
    register(name: string, desc: string) {
      tools.set(name, { description: desc });
    },
    unregister(name: string) {
      tools.delete(name);
    },
    list() {
      return [...tools.keys()];
    },
    asSchema() {
      return [...tools.entries()].map(([name, t]) => ({
        type: "function" as const,
        function: {
          name,
          description: t.description,
          parameters: { type: "object", properties: {} },
        },
      }));
    },
  };
}

/** Simple HTTP GET that returns parsed JSON. */
export async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url);
  return res.json();
}

/** Collect SSE events for a given duration. */
export function collectSSE(
  url: string,
  durationMs: number
): Promise<Array<{ event: string; data: unknown }>> {
  return new Promise((resolve) => {
    const events: Array<{ event: string; data: unknown }> = [];
    const controller = new AbortController();

    // Use raw fetch for SSE since EventSource isn't available in Node
    fetch(url, { signal: controller.signal }).then(async (res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE frames
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                events.push({ event: currentEvent, data: JSON.parse(line.slice(6)) });
              } catch { /* skip malformed */ }
              currentEvent = "";
            }
          }
        }
      } catch {
        // AbortError expected
      }
    }).catch(() => { /* AbortError */ });

    setTimeout(() => {
      controller.abort();
      // Give a tick for cleanup
      setTimeout(() => resolve(events), 50);
    }, durationMs);
  });
}
