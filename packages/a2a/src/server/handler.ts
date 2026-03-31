import type { A2ATask } from "../types.js";

export type TaskHandler = (
  message: string,
  taskId: string,
) => string | Promise<string> | AsyncGenerator<string>;

/** Extract a safe error message from an unknown throw value (BUG-0029). */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator<string> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

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
      const result = await handler(messageText, taskId);
      let output: string;
      if (isAsyncGenerator(result)) {
        const chunks: string[] = [];
        for await (const chunk of result) chunks.push(chunk);
        output = chunks.join("");
      } else {
        output = result;
      }
      const task: A2ATask = {
        id: taskId,
        status: { state: "completed" },
        artifacts: [{ parts: [{ type: "text", text: output }] }],
      };
      return { response: { jsonrpc: "2.0", id: req.id, result: task } };
    } catch (e: unknown) {
      console.error("[a2a] tasks/send error:", errorMessage(e));
      return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32603, message: "Internal server error" } } };
    }
  }

  if (req.method === "tasks/sendSubscribe") {
    // If agentCard is provided and streaming is not enabled, reject with method-not-found
    if (agentCard && !agentCard.capabilities?.streaming) {
      return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "Method not found: streaming not supported" } } };
    }
    try {
      const result = await handler(messageText, taskId);
      async function* safeStream(gen: AsyncGenerator<string>): AsyncGenerator<string> {
        yield* gen;
      }
      if (isAsyncGenerator(result)) {
        return { stream: safeStream(result), taskId };
      }
      const output: string = result;
      // Wrap promise as single-item stream
      async function* single(): AsyncGenerator<string> {
        yield output;
      }
      return { stream: safeStream(single()), taskId };
    } catch (e: unknown) {
      console.error("[a2a] tasks/sendSubscribe error:", errorMessage(e));
      return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32603, message: errorMessage(e) } } };
    }
  }

  if (req.method === "tasks/get") {
    // Basic: return empty completed task (no persistence in this server)
    const task: A2ATask = { id: taskId, status: { state: "completed" } };
    return { response: { jsonrpc: "2.0", id: req.id, result: task } };
  }

  return { response: { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "Method not found" } } };
}
