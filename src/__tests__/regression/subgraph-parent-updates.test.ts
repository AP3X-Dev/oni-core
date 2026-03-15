import { describe, it, expect } from 'vitest';
import { StateGraph, START, END } from '../../index.js';

describe('regression: subgraph parent state updates', () => {
  it('node returning only some keys does not set other keys to undefined', async () => {
    type S = { a: number; b: string; c: boolean };
    const g = new StateGraph<S>({
      channels: {
        a: { reducer: (_, b) => b, default: () => 0 },
        b: { reducer: (_, b) => b, default: () => 'original' },
        c: { reducer: (_, b) => b, default: () => true },
      },
    });
    g.addNode('update_a', async () => ({ a: 99 }));
    g.addEdge(START, 'update_a');
    g.addEdge('update_a', END);
    const result = await g.compile().invoke({ a: 0, b: 'original', c: true });
    expect(result.a).toBe(99);
    expect(result.b).toBe('original');
    expect(result.c).toBe(true);
  });

  it('two sequential nodes each returning partial state accumulate correctly', async () => {
    type S = { x: number; y: number; z: number };
    const g = new StateGraph<S>({
      channels: {
        x: { reducer: (_, b) => b, default: () => 0 },
        y: { reducer: (_, b) => b, default: () => 0 },
        z: { reducer: (_, b) => b, default: () => 0 },
      },
    });
    g.addNode('setx', async () => ({ x: 1 }));
    g.addNode('sety', async () => ({ y: 2 }));
    g.addEdge(START, 'setx');
    g.addEdge('setx', 'sety');
    g.addEdge('sety', END);
    const result = await g.compile().invoke({ x: 0, y: 0, z: 99 });
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
    expect(result.z).toBe(99);
  });

  it('subgraph invocation does not overwrite parent state with subgraph defaults', async () => {
    type Inner = { count: number };
    type Outer = { count: number; name: string };
    const inner = new StateGraph<Inner>({
      channels: { count: { reducer: (_, b) => b, default: () => 0 } },
    });
    inner.addNode('inc', async (s) => ({ count: s.count + 1 }));
    inner.addEdge(START, 'inc');
    inner.addEdge('inc', END);
    const innerGraph = inner.compile();

    const outer = new StateGraph<Outer>({
      channels: {
        count: { reducer: (_, b) => b, default: () => 0 },
        name: { reducer: (_, b) => b, default: () => 'default' },
      },
    });
    outer.addNode('run', async (s) => {
      const r = await innerGraph.invoke({ count: s.count });
      return { count: r.count };
    });
    outer.addEdge(START, 'run');
    outer.addEdge('run', END);
    const result = await outer.compile().invoke({ count: 5, name: 'Alice' });
    expect(result.count).toBe(6);
    expect(result.name).toBe('Alice');
  });
});
