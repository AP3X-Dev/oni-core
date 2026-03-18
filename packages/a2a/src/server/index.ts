import type { AgentCard } from "../types.js";
import { handleJsonRPC, type TaskHandler } from "./handler.js";
import { createSSEResponse } from "./sse.js";

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

export interface A2AServerOptions {
  /** Optional API key. When set, every request (except CORS preflight) must
   *  include an `Authorization: Bearer <key>` header matching this value. */
  apiKey?: string;
}

export class A2AServer {
  private readonly apiKey?: string;

  constructor(
    private readonly agentCard: AgentCard,
    private readonly handler: TaskHandler,
    options?: A2AServerOptions,
  ) {
    this.apiKey = options?.apiKey;
  }

  requestHandler(): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // Handle CORS preflight — deny all cross-origin requests by returning
      // no Access-Control-Allow-Origin header, which causes the browser to
      // block the subsequent actual request.
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204 });
      }

      // Optional API key authentication — if configured, require a matching
      // Bearer token on every non-preflight request.
      if (this.apiKey) {
        const auth = req.headers.get("authorization") ?? "";
        if (auth !== `Bearer ${this.apiKey}`) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unauthorized" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
        return new Response(JSON.stringify(this.agentCard), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      // Require application/json Content-Type on POST requests. This is not a
      // CORS "simple" content type, so browsers must send a preflight OPTIONS
      // request first. Since we return no CORS allow headers, the preflight
      // fails and the cross-origin POST is never sent — preventing CSRF.
      const ct = req.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Content-Type must be application/json" } }),
          { status: 415, headers: { "Content-Type": "application/json" } },
        );
      }

      // Enforce body size limit for Fetch-API callers (mirrors listen() guard)
      const contentLength = parseInt(req.headers.get("content-length") ?? "", 10);
      if (contentLength > MAX_BODY_SIZE) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } }), { status: 413, headers: { "Content-Type": "application/json" } });
      }
      let body: unknown;
      try {
        const text = await req.text();
        if (text.length > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } }), { status: 413, headers: { "Content-Type": "application/json" } });
        }
        body = JSON.parse(text);
      }
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
      let body: Buffer | undefined;
      try {
        body = req.method !== "GET" && req.method !== "HEAD"
          ? await new Promise<Buffer>((resolve, reject) => {
              const chunks: Buffer[] = [];
              let totalBytes = 0;
              req.on("data", (c: Buffer) => {
                totalBytes += c.length;
                if (totalBytes > MAX_BODY_SIZE) {
                  req.destroy();
                  res.writeHead(413, { "Content-Type": "text/plain" });
                  res.end("Payload Too Large");
                  reject(new Error("Payload Too Large"));
                  return;
                }
                chunks.push(c);
              });
              req.on("end", () => resolve(Buffer.concat(chunks)));
              req.on("error", reject);
            })
          : undefined;
      } catch {
        return; // already responded with 413
      }

      const fetchReq = new Request(url, { method: req.method, headers, body });
      const fetchRes = await handler(fetchReq);

      res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers.entries()));
      const contentType = fetchRes.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && fetchRes.body) {
        const reader = fetchRes.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          res.end();
        }
      } else {
        const buf = await fetchRes.arrayBuffer();
        res.end(Buffer.from(buf));
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(port, () => resolve());
      server.once("error", reject);
    });
    console.log(`A2AServer listening on port ${port}`);
  }
}
