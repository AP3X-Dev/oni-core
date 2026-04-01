/**
 * Shared SSE (Server-Sent Events) data line parser for OpenAI-compatible APIs.
 * Used by: openai, google, openrouter adapters.
 *
 * Per the SSE spec, multiple `data:` lines before a blank-line event terminator
 * are concatenated with newlines into a single event payload.
 * Yields raw `data:` field values. Stops on `[DONE]` sentinel.
 * Reader lock is always released via finally block.
 */
export async function* parseSSEData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

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
          if (data === "[DONE]") {
            if (dataLines.length > 0) {
              yield dataLines.join("\n");
              dataLines = [];
            }
            return;
          }
          dataLines.push(data);
        } else if (line.trim() === "") {
          // Blank line = event terminator — emit buffered data lines
          if (dataLines.length > 0) {
            yield dataLines.join("\n");
            dataLines = [];
          }
        }
      }
    }

    // Flush remaining buffer lines
    if (buffer.trim()) {
      for (const line of buffer.split("\n")) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            if (dataLines.length > 0) {
              yield dataLines.join("\n");
              dataLines = [];
            }
            return;
          }
          if (data && data !== "[DONE]") dataLines.push(data);
        } else if (line.trim() === "") {
          if (dataLines.length > 0) {
            yield dataLines.join("\n");
            dataLines = [];
          }
        }
      }
    }

    // Emit any remaining buffered data lines (stream ended without blank line)
    if (dataLines.length > 0) {
      yield dataLines.join("\n");
    }
  } finally {
    reader.releaseLock();
  }
}
