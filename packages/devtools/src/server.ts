// ============================================================
// @oni.bot/devtools — Dev Server
// ============================================================
// Lightweight HTTP server exposing graph topology, registry
// state, run history, and live SSE events.
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  DevtoolsOptions,
  DevtoolsServer,
  RunRecord,
  NodeEvent,
} from "./types.js";
import { HTML_UI } from "./ui.js";

export async function startDevtools(options: DevtoolsOptions): Promise<DevtoolsServer> {
  const {
    graph,
    registry,
    port = 7823,
    maxRuns = 50,
  } = options;

  const runs: RunRecord[] = [];
  const sseClients = new Set<ServerResponse>();

  // ---- helpers ----

  function json(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(data));
  }

  function sendSSE(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try { client.write(payload); } catch { sseClients.delete(client); }
    }
  }

  function getOrCreateRun(runId: string): RunRecord {
    let run = runs.find((r) => r.run_id === runId);
    if (!run) {
      run = { run_id: runId, started_at: Date.now(), events: [] };
      runs.push(run);
      // Evict oldest if over limit
      while (runs.length > maxRuns) runs.shift();
    }
    return run;
  }

  // ---- route handler ----

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "/";

    if (url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML_UI);
      return;
    }

    if (url === "/graph") {
      const descriptor = graph.getGraph();
      json(res, {
        nodes: descriptor.nodes.map((n) => ({ id: n.id, type: n.type })),
        edges: descriptor.edges.map((e) => ({
          from: e.from,
          to: e.to,
          ...(e.type === "conditional" && e.label ? { condition: e.label } : {}),
        })),
      });
      return;
    }

    if (url === "/registry") {
      const schemas = registry.asSchema();
      json(res, {
        tools: schemas.map((s) => ({
          name: s.function.name,
          description: s.function.description,
          schema: s.function.parameters,
        })),
      });
      return;
    }

    if (url === "/runs") {
      json(res, runs);
      return;
    }

    if (url === "/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(":\n\n"); // SSE comment to establish connection
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    json(res, { error: "Not found" }, 404);
  }

  // ---- start server ----

  const server = createServer(handleRequest);

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => resolve());
  });

  const serverUrl = `http://localhost:${port}`;

  return {
    url: serverUrl,
    stop: () => new Promise<void>((resolve) => {
      // Close all SSE connections
      for (const client of sseClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      sseClients.clear();
      server.close(() => resolve());
    }),
    emit: (event: NodeEvent) => {
      const run = getOrCreateRun(event.run_id);
      run.events.push(event);
      if (event.type === "node_end") {
        run.ended_at = event.ts;
      }
      sendSSE(event.type, event);
    },
    emitToolRegistered: (name: string, source?: string) => {
      sendSSE("tool_registered", { name, source });
    },
    emitToolUnregistered: (name: string) => {
      sendSSE("tool_unregistered", { name });
    },
  };
}
