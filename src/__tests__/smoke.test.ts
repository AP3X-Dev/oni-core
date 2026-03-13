import { describe, it, expect } from "vitest";
import { StateGraph, START, END, lastValue } from "../index.js";

describe("smoke", () => {
  it("builds and invokes a minimal graph", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });
    g.addNode("echo", async (state) => ({ value: state.value + "!" }));
    g.addEdge(START, "echo");
    g.addEdge("echo", END);
    const app = g.compile();
    const result = await app.invoke({ value: "hi" });
    expect(result.value).toBe("hi!");
  });
});
