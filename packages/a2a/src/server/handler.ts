import type { A2ATask } from "../types.js";

export type TaskHandler = (message: string, taskId: string) => Promise<string> | AsyncGenerator<string>;

export async function handleJsonRPC(
  body: unknown,
  handler: TaskHandler,
  agentCard: import("../types.js").AgentCard,
): Promise<{ response?: unknown; stream?: AsyncGenerator<string>; taskId?: string }> {
  const req = body as { jsonrpc: string; id: unknown; method: string; params?: { id?: string; message?: { parts?: Array<{ type: string; text?: string }> } } };

  if (req.jsonrpc !== "2.0") {
    return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32600, message: "Invalid Request" } } };
  }

  const taskId = req.params?.id ?? crypto.randomUUID();
  const messageText = req.params?.message?.parts?.find(p => p.type === "text")?.text ?? "";

  if (req.method === "tasks/send") {
    try {
      const result = handler(messageText, taskId);
      let output: string;
      if (typeof (result as AsyncGenerator<string>)[Symbol.asyncIterator] === "function") {
        const chunks: string[] = [];
        for await (const chunk of result as AsyncGenerator<string>) chunks.push(chunk);
        output = chunks.join("");
      } else {
        output = await (result as Promise<string>);
      }
      const task: A2ATask = {
        id: taskId,
        status: { state: "completed" },
        artifacts: [{ parts: [{ type: "text", text: output }] }],
      };
      return { response: { jsonrpc: "2.0", id: req.id, result: task } };
    } catch (err) {
      return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32603, message: String(err) } } };
    }
  }

  if (req.method === "tasks/sendSubscribe") {
    try {
      const result = handler(messageText, taskId);
      async function* safeStream(gen: AsyncGenerator<string>): AsyncGenerator<string> {
        yield* gen;
      }
      if (typeof (result as AsyncGenerator<string>)[Symbol.asyncIterator] === "function") {
        return { stream: safeStream(result as AsyncGenerator<string>), taskId };
      }
      // Wrap promise as single-item stream
      async function* single(): AsyncGenerator<string> { yield await (result as Promise<string>); }
      return { stream: safeStream(single()), taskId };
    } catch (err) {
      return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32603, message: String(err) } } };
    }
  }

  if (req.method === "tasks/get") {
    // Basic: return empty completed task (no persistence in this server)
    const task: A2ATask = { id: taskId, status: { state: "completed" } };
    return { response: { jsonrpc: "2.0", id: req.id, result: task } };
  }

  // Suppress unused parameter warning — agentCard reserved for future method dispatch
  void agentCard;

  return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "Method not found" } } };
}
