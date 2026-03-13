/**
 * Shared SSE (Server-Sent Events) data line parser for OpenAI-compatible APIs.
 * Used by: openai, google, openrouter adapters.
 *
 * Yields raw `data:` field values. Stops on `[DONE]` sentinel.
 * Reader lock is always released via finally block.
 */
export async function* parseSSEData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop()!; // keep incomplete last line

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          if (data) yield data;
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data && data !== "[DONE]") yield data;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
