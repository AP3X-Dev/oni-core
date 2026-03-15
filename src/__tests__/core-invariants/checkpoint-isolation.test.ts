import { describe, it, expect } from 'vitest';
import { StateGraph, MemoryCheckpointer, START, END } from '../../index.js';

describe('core invariant: checkpoint isolation', () => {
  it('getState returns only the state for the requested thread', async () => {
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('inc', async (s) => ({ n: s.n + 5 }));
    g.addEdge(START, 'inc');
    g.addEdge('inc', END);
    const cp = new MemoryCheckpointer();
    const graph = g.compile({ checkpointer: cp });

    await graph.invoke({ n: 0 }, { threadId: 'thread-A' });
    await graph.invoke({ n: 100 }, { threadId: 'thread-B' });

    const stateA = await graph.getState({ threadId: 'thread-A' });
    const stateB = await graph.getState({ threadId: 'thread-B' });
    expect(stateA?.n).toBe(5);
    expect(stateB?.n).toBe(105);
  });

  it('updateState overwrites without affecting other threads', async () => {
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('r', async (s) => ({ n: s.n }));
    g.addEdge(START, 'r');
    g.addEdge('r', END);
    const cp = new MemoryCheckpointer();
    const graph = g.compile({ checkpointer: cp });

    await graph.invoke({ n: 1 }, { threadId: 'upd-A' });
    await graph.invoke({ n: 2 }, { threadId: 'upd-B' });

    await graph.updateState({ threadId: 'upd-A' }, { n: 999 });

    const stateA = await graph.getState({ threadId: 'upd-A' });
    const stateB = await graph.getState({ threadId: 'upd-B' });
    expect(stateA?.n).toBe(999);
    expect(stateB?.n).toBe(2);
  });

  it('getHistory returns array of checkpoints for the requested thread only', async () => {
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('inc', async (s) => ({ n: s.n + 1 }));
    g.addEdge(START, 'inc');
    g.addEdge('inc', END);
    const cp = new MemoryCheckpointer();
    const graph = g.compile({ checkpointer: cp });

    await graph.invoke({ n: 0 }, { threadId: 'hist-x' });
    await graph.invoke({ n: 100 }, { threadId: 'hist-y' });

    const history = await graph.getHistory({ threadId: 'hist-x' });
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    for (const c of history) {
      expect(c.threadId).toBe('hist-x');
    }
  });
});
