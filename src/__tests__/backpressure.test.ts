import { describe, it, expect } from "vitest";
import { BoundedBuffer } from "../streaming.js";

describe("BoundedBuffer", () => {
  it("buffers items up to capacity", () => {
    const buf = new BoundedBuffer<number>(3, "drop-oldest");
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.size).toBe(3);
    expect(buf.drain()).toEqual([1, 2, 3]);
  });

  it("drop-oldest: drops oldest item when full", () => {
    const buf = new BoundedBuffer<string>(2, "drop-oldest");
    buf.push("a");
    buf.push("b");
    buf.push("c"); // should drop "a"
    expect(buf.size).toBe(2);
    expect(buf.drain()).toEqual(["b", "c"]);
  });

  it("error: throws when buffer is full", () => {
    const buf = new BoundedBuffer<number>(2, "error");
    buf.push(1);
    buf.push(2);
    expect(() => buf.push(3)).toThrowError("ONI_STREAM_BACKPRESSURE");
  });

  it("drain returns all items and clears the buffer", () => {
    const buf = new BoundedBuffer<number>(5, "drop-oldest");
    buf.push(10);
    buf.push(20);
    buf.push(30);

    const drained = buf.drain();
    expect(drained).toEqual([10, 20, 30]);
    expect(buf.size).toBe(0);
    expect(buf.drain()).toEqual([]);
  });
});
