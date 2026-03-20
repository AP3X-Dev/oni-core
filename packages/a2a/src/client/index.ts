import type { A2AClientConfig, A2ATask, AgentCard } from "../types.js";
import { A2AAuthExpiredError } from "../errors.js";

export class A2AClient {
  constructor(private readonly config: A2AClientConfig) {}

  /** Throw A2AAuthExpiredError on 401, otherwise return the response unchanged. */
  private assertNotUnauthorized(res: Response, url: string): void {
    if (res.status === 401) {
      throw new A2AAuthExpiredError(
        `A2A request unauthorized (401): credentials may be expired — ${url}`,
        url,
      );
    }
  }

  async getCard(): Promise<AgentCard> {
    const url = `${this.config.baseUrl}/.well-known/agent.json`;
    const res = await fetch(url, {
      headers: this.config.headers,
    });
    this.assertNotUnauthorized(res, url);
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
    this.assertNotUnauthorized(res, this.config.baseUrl);
    if (!res.ok) throw new Error(`A2A tasks/send failed: ${res.status}`);
    const result = (await res.json()) as { result?: A2ATask; error?: { message: string } };
    if (result.error) throw new Error(`A2A error: ${result.error.message}`);
    const task = result.result!;
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
    });

    this.assertNotUnauthorized(res, this.config.baseUrl);
    if (!res.ok || !res.body) throw new Error(`A2A stream failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
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
            if (text?.type === "text") yield text.text;
          } catch { /* ignore parse errors */ }
        }
      }
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
