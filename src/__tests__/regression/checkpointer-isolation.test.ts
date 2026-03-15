import { describe, it, expect } from 'vitest';
import { StateGraph, MemoryCheckpointer, START, END } from '../../index.js';

describe('regression: checkpointer isolation', () => {
  it('MemoryCheckpointer.list returns only checkpoints for the given threadId', async () => {
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('inc', async (s) => ({ n: s.n + 1 }));
    g.addEdge(START, 'inc');
    g.addEdge('inc', END);
    const cp = new MemoryCheckpointer();
    const graph = g.compile({ checkpointer: cp });

    await graph.invoke({ n: 0 }, { threadId: 'iso-A' });
    await graph.invoke({ n: 100 }, { threadId: 'iso-B' });

    const histA = await graph.getHistory({ threadId: 'iso-A' });
    for (const c of histA) {
      expect(c.threadId).toBe('iso-A');
    }
  });

  it('getState returns null for a threadId that has never been invoked', async () => {
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('n', async (s) => s);
    g.addEdge(START, 'n');
    g.addEdge('n', END);
    const graph = g.compile({ checkpointer: new MemoryCheckpointer() });
    const state = await graph.getState({ threadId: 'never-invoked' });
    expect(state).toBeNull();
  });

  it('two threads on the same graph are fully isolated — state does not bleed', async () => {
    type S = { counter: number };
    const g = new StateGraph<S>({
      channels: { counter: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('add', async (s) => ({ counter: s.counter }));
    g.addEdge(START, 'add');
    g.addEdge('add', END);

    const cp = new MemoryCheckpointer<S>();
    const graph = g.compile({ checkpointer: cp });

    await graph.invoke({ counter: 10 }, { threadId: 'bleed-A' });
    await graph.invoke({ counter: 99 }, { threadId: 'bleed-B' });

    const stateA = await graph.getState({ threadId: 'bleed-A' });
    const stateB = await graph.getState({ threadId: 'bleed-B' });

    // Each thread must have its own counter — if state bled, bleed-B would show 10+99=109
    expect(stateA?.counter).toBe(10);
    expect(stateB?.counter).toBe(99);
  });

  it('getHistory returns empty array for a thread with no checkpoints', async () => {
    type S = { v: number };
    const g = new StateGraph<S>({
      channels: { v: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('noop', async (s) => s);
    g.addEdge(START, 'noop');
    g.addEdge('noop', END);
    const graph = g.compile({ checkpointer: new MemoryCheckpointer() });
    const hist = await graph.getHistory({ threadId: 'no-such-thread-xyz' });
    expect(Array.isArray(hist)).toBe(true);
    expect(hist).toHaveLength(0);
  });
});
