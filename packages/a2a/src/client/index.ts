import type { A2AClientConfig, A2ATask, AgentCard } from "../types.js";

export class A2AClient {
  constructor(private readonly config: A2AClientConfig) {
    // Validate baseUrl scheme to prevent SSRF via file://, ftp://, or other
    // non-HTTP schemes when baseUrl is derived from untrusted agent registry data.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(config.baseUrl);
    } catch {
      throw new Error(`Invalid A2A baseUrl: "${config.baseUrl}" is not a valid URL`);
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error(`Invalid A2A baseUrl scheme: "${parsedUrl.protocol}" — only "https:" and "http:" are allowed`);
    }
  }

  async getCard(): Promise<AgentCard> {
    const res = await fetch(`${this.config.baseUrl}/.well-known/agent.json`, {
      headers: this.config.headers,
    });
    if (!res.ok) throw new Error(`Failed to fetch agent card: ${res.status}`);
    return res.json() as Promise<AgentCard>;
  }

  async sendTask(message: string, opts?: { sessionId?: string }): Promise<string> {
    const taskId = opts?.sessionId ?? crypto.randomUUID();
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/send",
      params: {
        id: taskId,
        message: {
          role: "user",
          parts: [{ type: "text", text: message }],
        },
      },
    };

    const res = await fetch(this.config.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal: this.config.timeout
        ? AbortSignal.timeout(this.config.timeout)
        : undefined,
    });
    if (!res.ok) throw new Error(`A2A tasks/send failed: ${res.status}`);
    const result = (await res.json()) as { result?: A2ATask; error?: { message: string } };
    if (result.error) throw new Error(`A2A error: ${result.error.message}`);
    if (!result.result) {
      throw new Error(`Server returned invalid JSON-RPC response: missing "result" field`);
    }
    const task = result.result;
    return task.artifacts?.[0]?.parts[0]?.type === "text"
      ? task.artifacts[0].parts[0].text
      : task.status.message?.parts?.[0]?.type === "text"
        ? task.status.message.parts[0].text
        : JSON.stringify(task);
  }

  async *streamTask(message: string): AsyncGenerator<string> {
    const taskId = crypto.randomUUID();
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/sendSubscribe",
      params: {
        id: taskId,
        message: { role: "user", parts: [{ type: "text", text: message }] },
      },
    };

    const res = await fetch(this.config.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...this.config.headers },
      body: JSON.stringify(body),
      signal: this.config.timeout
        ? AbortSignal.timeout(this.config.timeout)
        : undefined,
    });

    if (!res.ok || !res.body) throw new Error(`A2A stream failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readTimeoutMs = this.config.timeout ?? 30_000;

    const readWithTimeout = async (
      r: ReturnType<ReadableStream<Uint8Array>["getReader"]>,
      timeoutMs: number,
    ) => {
      const timer = setTimeout(() => r.cancel(), timeoutMs);
      try {
        return await r.read();
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      while (true) {
        const { done, value } = await readWithTimeout(reader, readTimeoutMs);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") return;
            try {
              const event = JSON.parse(data) as { result?: A2ATask };
              const text = event.result?.status?.message?.parts?.[0];
              // BUG-0028: A2A TextPart declares `text` as optional, meaning
              // text.text may be undefined even when type === "text". The != null
              // check ensures we never yield undefined to stream consumers.
              if (text?.type === "text" && text.text != null) yield text.text;
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Convert this A2A client into an ONI ToolDefinition-compatible object */
  asToolDefinition(opts: { name: string; description: string }): {
    name: string;
    description: string;
    schema: { type: "object"; properties: { message: { type: "string"; description: string } }; required: string[] };
    parallelSafe: boolean;
    execute: (input: { message: string }) => Promise<string>;
  } {
    return {
      name: opts.name,
      description: opts.description,
      schema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to send to the remote agent" },
        },
        required: ["message"],
      },
      parallelSafe: true,
      execute: (input: { message: string }) => this.sendTask(input.message),
    };
  }
}
