import { describe, it, expect } from 'vitest';
import { StateGraph, MemoryCheckpointer, START, END } from '../../index.js';

describe('core invariant: subgraph execution', () => {
  it('subgraph updates parent state without clobbering peer keys', async () => {
    type Inner = { value: number };
    type Outer = { counter: number; label: string };

    const inner = new StateGraph<Inner>({
      channels: { value: { reducer: (_, b) => b, default: () => 0 } },
    });
    inner.addNode('double', async (s) => ({ value: s.value * 2 }));
    inner.addEdge(START, 'double');
    inner.addEdge('double', END);
    const innerGraph = inner.compile();

    const outer = new StateGraph<Outer>({
      channels: {
        counter: { reducer: (_, b) => b, default: () => 1 },
        label: { reducer: (_, b) => b, default: () => 'x' },
      },
    });
    outer.addNode('run_inner', async (s) => {
      const result = await innerGraph.invoke({ value: s.counter });
      return { counter: result.value };
    });
    outer.addEdge(START, 'run_inner');
    outer.addEdge('run_inner', END);
    const outerGraph = outer.compile({ checkpointer: new MemoryCheckpointer() });

    const result = await outerGraph.invoke(
      { counter: 3, label: 'hello' },
      { threadId: 'sub-1' }
    );
    expect(result.counter).toBe(6);
    expect(result.label).toBe('hello');
  });

  it('subgraph returning partial state does not null out unmentioned keys', async () => {
    type S = { a: number; b: string; c: boolean };
    const g = new StateGraph<S>({
      channels: {
        a: { reducer: (_, b) => b, default: () => 0 },
        b: { reducer: (_, b) => b, default: () => 'keep' },
        c: { reducer: (_, b) => b, default: () => true },
      },
    });
    g.addNode('only_a', async () => ({ a: 99 }));
    g.addEdge(START, 'only_a');
    g.addEdge('only_a', END);

    const result = await g.compile().invoke({ a: 0, b: 'keep', c: true });
    expect(result.a).toBe(99);
    expect(result.b).toBe('keep');
    expect(result.c).toBe(true);
  });

  it('concurrent threads with same checkpointer do not share state', async () => {
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('inc', async (s) => ({ n: s.n + 1 }));
    g.addEdge(START, 'inc');
    g.addEdge('inc', END);
    const cp = new MemoryCheckpointer();
    const graph = g.compile({ checkpointer: cp });

    await graph.invoke({ n: 10 }, { threadId: 'parent' });
    await graph.invoke({ n: 99 }, { threadId: 'other' });

    const parentState = await graph.getState({ threadId: 'parent' });
    expect(parentState?.n).toBe(11);
    const otherState = await graph.getState({ threadId: 'other' });
    expect(otherState?.n).toBe(100); // 99 + 1 = 100, not contaminated by parent
  });
});
