export function createSSEResponse(
  stream: AsyncGenerator<string>,
  taskId: string,
): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const event = JSON.stringify({
            result: {
              id: taskId,
              status: { state: "working", message: { role: "agent", parts: [{ type: "text", text: chunk }] } },
            },
          });
          controller.enqueue(encoder.encode(`data: ${event}\n\n`));
        }
        const doneEvent = JSON.stringify({
          result: { id: taskId, status: { state: "completed" } },
        });
        controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const errEvent = JSON.stringify({ error: { code: -32603, message: String(err) } });
        try {
          controller.enqueue(encoder.encode(`data: ${errEvent}\n\n`));
        } catch (_) { /* stream may already be cancelled */ }
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
