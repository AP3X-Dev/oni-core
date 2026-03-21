import crypto from "node:crypto";
import type { AgentCard } from "../types.js";
import { handleJsonRPC, type TaskHandler } from "./handler.js";
import { createSSEResponse } from "./sse.js";

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'",
};

export interface A2AServerOptions {
  /** API key for Bearer token authentication. When set, every request (except
   *  CORS preflight) must include an `Authorization: Bearer <key>` header.
   *
   *  BUG-0256: In production (NODE_ENV=production), apiKey is required unless
   *  `allowUnauthenticated` is explicitly set to true. */
  apiKey?: string;
  /** Explicitly opt out of authentication. Required in production when no
   *  apiKey is provided. Defaults to false. */
  allowUnauthenticated?: boolean;
}

export class A2AServer {
  private readonly apiKey?: string;

  constructor(
    private readonly agentCard: AgentCard,
    private readonly handler: TaskHandler,
    options?: A2AServerOptions,
  ) {
    this.apiKey = options?.apiKey;
    if (!this.apiKey) {
      if (process.env.NODE_ENV === "production" && !options?.allowUnauthenticated) {
        throw new Error(
          "[A2AServer] apiKey is required in production. " +
          "Set options.apiKey or pass allowUnauthenticated: true to explicitly opt out.",
        );
      }
      console.warn("[A2AServer] WARNING: No apiKey configured — all endpoints are unauthenticated");
    }
  }

  requestHandler(): (req: Request) => Promise<Response> {
    return async (req: Request): Promise<Response> => {
      const url = new URL(req.url);

      // Handle CORS preflight — deny all cross-origin requests by returning
      // no Access-Control-Allow-Origin header, which causes the browser to
      // block the subsequent actual request.
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { ...SECURITY_HEADERS } });
      }

      // Optional API key authentication — if configured, require a matching
      // Bearer token on every non-preflight request.
      if (this.apiKey) {
        const token = req.headers.get("authorization") ?? "";
        const expected = `Bearer ${this.apiKey}`;
        const tokenBuf = Buffer.from(token);
        const expectedBuf = Buffer.from(expected);
        if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Unauthorized" } }),
            { status: 401, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } },
          );
        }
      }

      if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
        return new Response(JSON.stringify(this.agentCard), {
          headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
        });
      }

      if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { ...SECURITY_HEADERS } });
      }

      // Require application/json Content-Type on POST requests. This is not a
      // CORS "simple" content type, so browsers must send a preflight OPTIONS
      // request first. Since we return no CORS allow headers, the preflight
      // fails and the cross-origin POST is never sent — preventing CSRF.
      const ct = req.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Content-Type must be application/json" } }),
          { status: 415, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } },
        );
      }

      // Enforce body size limit for Fetch-API callers (mirrors listen() guard)
      const contentLength = parseInt(req.headers.get("content-length") ?? "", 10);
      if (contentLength > MAX_BODY_SIZE) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } }), { status: 413, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } });
      }
      let body: unknown;
      try {
        const text = await req.text();
        if (text.length > MAX_BODY_SIZE) {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request body too large" } }), { status: 413, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } });
        }
        body = JSON.parse(text);
      }
      catch { return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } }); }

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
          { status: 406, headers: { "Content-Type": "application/json", ...SECURITY_HEADERS } },
        );
      }

      return new Response(JSON.stringify(result.response), {
        headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
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
                  res.writeHead(413, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
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

      try {
        const fetchReq = new Request(url, { method: req.method, headers, body });
        const fetchRes = await handler(fetchReq);

        res.writeHead(fetchRes.status, { ...Object.fromEntries(fetchRes.headers.entries()), ...SECURITY_HEADERS });
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
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain", ...SECURITY_HEADERS });
        }
        if (!res.writableEnded) {
          res.end("Internal Server Error");
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(port, () => resolve());
      server.once("error", reject);
    });
    console.log(`A2AServer listening on port ${port}`);
  }
}
