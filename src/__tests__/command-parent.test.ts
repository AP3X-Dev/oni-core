import { describe, it, expect } from "vitest";
import {
  StateGraph, START, END, lastValue, Command,
} from "../index.js";

describe("Command.PARENT", () => {
  it("PARENT sentinel exists", () => {
    expect(Command.PARENT).toBe("__parent__");
  });

  it("subgraph pushes state update to parent via Command.PARENT", async () => {
    // Inner subgraph
    type Inner = { text: string; summary: string };
    const inner = new StateGraph<Inner>({
      channels: {
        text:    lastValue(() => ""),
        summary: lastValue(() => ""),
      },
    });

    inner.addNode("analyze", async (state) => {
      return new Command<Inner>({
        update: { summary: `analyzed: ${state.text}` },
        graph:  Command.PARENT,
      });
    });
    inner.addEdge(START, "analyze");
    inner.addEdge("analyze", END);
    const innerApp = inner.compile();

    // Outer graph
    type Outer = { text: string; summary: string; final: string };
    const outer = new StateGraph<Outer>({
      channels: {
        text:    lastValue(() => ""),
        summary: lastValue(() => ""),
        final:   lastValue(() => ""),
      },
    });

    outer.addNode("prep", async (state) => ({ text: state.text.toUpperCase() }));
    outer.addSubgraph("analysis", innerApp as any);
    outer.addNode("finish", async (state) => ({
      final: `${state.summary} | done`,
    }));

    outer.addEdge(START, "prep");
    outer.addEdge("prep", "analysis");
    outer.addEdge("analysis", "finish");
    outer.addEdge("finish", END);

    const app = outer.compile();
    const result = await app.invoke({ text: "hello" });

    expect(result.summary).toBe("analyzed: HELLO");
    expect(result.final).toBe("analyzed: HELLO | done");
  });

  it("throws when Command.PARENT used at top level", async () => {
    type S = { value: string };
    const g = new StateGraph<S>({
      channels: { value: lastValue(() => "") },
    });

    g.addNode("bad", async () => {
      return new Command<S>({
        update: { value: "nope" },
        graph:  Command.PARENT,
      });
    });
    g.addEdge(START, "bad");
    g.addEdge("bad", END);

    const app = g.compile();
    await expect(app.invoke({ value: "" })).rejects.toThrow(
      "Command.PARENT used but graph is not running as a subgraph",
    );
  });
});
