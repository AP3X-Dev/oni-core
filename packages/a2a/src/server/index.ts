import type { AgentCard } from "../types.js";
import { handleJsonRPC, type TaskHandler } from "./handler.js";
import { createSSEResponse } from "./sse.js";

export class A2AServer {
  constructor(
    private readonly agentCard: AgentCard,
    private readonly handler: TaskHandler,
  ) {}

  requestHandler(): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
        return new Response(JSON.stringify(this.agentCard), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      let body: unknown;
      try { body = await req.json(); }
      catch { return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: { "Content-Type": "application/json" } }); }

      const acceptsSSE = req.headers.get("Accept")?.includes("text/event-stream");
      const result = await handleJsonRPC(body, this.handler, this.agentCard);

      if (result.stream && acceptsSSE) {
        return createSSEResponse(result.stream, result.taskId ?? "");
      }

      if (result.stream) {
        // Client does not accept SSE but the handler returned a stream.
        // Close the AsyncGenerator to prevent a resource leak, then return
        // a 406 so the client knows it must use Accept: text/event-stream.
        await result.stream.return(undefined);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: (body as Record<string, unknown>)?.id ?? null,
            error: { code: -32600, message: "This method requires Accept: text/event-stream" },
          }),
          { status: 406, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify(result.response), {
        headers: { "Content-Type": "application/json" },
      });
    };
  }

  async listen(port = 3000): Promise<void> {
    const { createServer } = await import("node:http");
    const handler = this.requestHandler();
    const server = createServer(async (req, res) => {
      const url = `http://localhost:${port}${req.url}`;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
      const body = req.method !== "GET" && req.method !== "HEAD"
        ? await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", (c: Buffer) => chunks.push(c));
            req.on("end", () => resolve(Buffer.concat(chunks)));
            req.on("error", reject);
          })
        : undefined;

      const fetchReq = new Request(url, { method: req.method, headers, body });
      const fetchRes = await handler(fetchReq);

      res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers.entries()));
      const buf = await fetchRes.arrayBuffer();
      res.end(Buffer.from(buf));
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(port, () => resolve());
      server.once("error", reject);
    });
    console.log(`A2AServer listening on port ${port}`);
  }
}
