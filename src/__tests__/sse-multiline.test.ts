import { describe, it, expect } from "vitest";
import { parseSSEData } from "../models/sse.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Create a ReadableStream from raw SSE text */
function sseStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("parseSSEData — multi-line data events", () => {
  it("concatenates multiple data: lines into one event payload", async () => {
    // Per the SSE spec, multiple data: lines before a blank line
    // should be joined with newlines into a single event.
    const raw = [
      'data: {"chunk":',
      'data: "hello"}',
      "",  // blank line = event terminator
      "",
    ].join("\n");

    const results: string[] = [];
    for await (const data of parseSSEData(sseStream(raw))) {
      results.push(data);
    }

    // Should yield ONE event with the two data lines joined by newline
    expect(results.length).toBe(1);
    expect(results[0]).toBe('{"chunk":\n"hello"}');
  });

  it("still works for single-line data events", async () => {
    const raw = [
      'data: {"text":"hi"}',
      "",
      'data: {"text":"bye"}',
      "",
      "",
    ].join("\n");

    const results: string[] = [];
    for await (const data of parseSSEData(sseStream(raw))) {
      results.push(data);
    }

    expect(results.length).toBe(2);
    expect(results[0]).toBe('{"text":"hi"}');
    expect(results[1]).toBe('{"text":"bye"}');
  });

  it("handles [DONE] sentinel after multi-line event", async () => {
    const raw = [
      'data: {"part":',
      'data: 1}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");

    const results: string[] = [];
    for await (const data of parseSSEData(sseStream(raw))) {
      results.push(data);
    }

    expect(results.length).toBe(1);
    expect(results[0]).toBe('{"part":\n1}');
  });

  it("flushes trailing multi-line event at end of stream", async () => {
    // Stream ends without a trailing blank line
    const raw = [
      'data: {"a":',
      'data: "b"}',
    ].join("\n");

    const results: string[] = [];
    for await (const data of parseSSEData(sseStream(raw))) {
      results.push(data);
    }

    expect(results.length).toBe(1);
    expect(results[0]).toBe('{"a":\n"b"}');
  });
});
