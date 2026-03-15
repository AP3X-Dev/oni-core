import { describe, it, expect } from 'vitest';
import { StateGraph, START, END } from '../../index.js';

describe('regression: execution pipeline', () => {
  it('per-node timeout fires before the node completes', async () => {
    type S = { done: boolean };
    const g = new StateGraph<S>({
      channels: { done: { reducer: (_, b) => b, default: () => false } },
    });
    g.addNode('slow', async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { done: true };
    }, { timeout: 50 });
    g.addEdge(START, 'slow');
    g.addEdge('slow', END);
    await expect(g.compile().invoke({ done: false })).rejects.toThrow();
  });

  it('circuit breaker does not call user fn when open', async () => {
    type S = { x: number };
    let calls = 0;
    const g = new StateGraph<S>({
      channels: { x: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('fail', async () => { calls++; throw new Error('always'); },
      { circuitBreaker: { threshold: 2, resetAfter: 30_000 } }
    );
    g.addEdge(START, 'fail');
    g.addEdge('fail', END);
    const graph = g.compile();
    await expect(graph.invoke({ x: 0 })).rejects.toThrow();
    await expect(graph.invoke({ x: 0 })).rejects.toThrow();
    const callsAtOpen = calls;
    await expect(graph.invoke({ x: 0 })).rejects.toThrow();
    expect(calls).toBe(callsAtOpen);
  });

  it('retry exhaustion surfaces the last error', async () => {
    type S = { r: string };
    const g = new StateGraph<S>({
      channels: { r: { reducer: (_, b) => b, default: () => '' } },
    });
    // RetryPolicy uses initialDelay (not delay)
    g.addNode('always-fail', async () => { throw new Error('permanent'); },
      { retry: { maxAttempts: 2, initialDelay: 0 } }
    );
    g.addEdge(START, 'always-fail');
    g.addEdge('always-fail', END);
    await expect(g.compile().invoke({ r: '' })).rejects.toThrow('permanent');
  });
});
