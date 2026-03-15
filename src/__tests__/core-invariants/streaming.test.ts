import { describe, it, expect } from 'vitest';
import { StateGraph, START, END } from '../../index.js';

describe('core invariant: streaming and invoke', () => {
  it('invoke() returns final merged state with all keys', async () => {
    type S = { x: number; y: number };
    const g = new StateGraph<S>({
      channels: {
        x: { reducer: (_, b) => b, default: () => 0 },
        y: { reducer: (_, b) => b, default: () => 0 },
      },
    });
    g.addNode('setx', async () => ({ x: 42 }));
    g.addNode('sety', async () => ({ y: 99 }));
    g.addEdge(START, 'setx');
    g.addEdge('setx', 'sety');
    g.addEdge('sety', END);

    const result = await g.compile().invoke({ x: 0, y: 0 });
    expect(result.x).toBe(42);
    expect(result.y).toBe(99);
  });

  it('stream() with "values" mode yields state_update events containing final state', async () => {
    // stream() yields ONIStreamEvent objects: { event, data, node, step, timestamp }
    // streamMode "values" emits state_update events with the full accumulated state.
    // streamMode "updates" (the default) emits node_end events with per-node deltas.
    type S = { step: number };
    const g = new StateGraph<S>({
      channels: { step: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('a', async (s) => ({ step: s.step + 1 }));
    g.addNode('b', async (s) => ({ step: s.step + 10 }));
    g.addEdge(START, 'a');
    g.addEdge('a', 'b');
    g.addEdge('b', END);

    const chunks: unknown[] = [];
    for await (const chunk of g.compile().stream({ step: 0 }, { streamMode: 'values' })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    // Every chunk is an ONIStreamEvent with an event field
    const allHaveEventField = chunks.every(
      (c) => typeof c === 'object' && c !== null && 'event' in (c as object)
    );
    expect(allHaveEventField).toBe(true);
    // At least one state_update event should be present
    const stateEvents = chunks.filter(
      (c) => typeof c === 'object' && c !== null && (c as Record<string, unknown>).event === 'state_update'
    ) as Array<{ event: string; data: Partial<S>; step: number }>;
    expect(stateEvents.length).toBeGreaterThan(0);
    // The last state_update chunk reflects the fully accumulated state: a adds 1, b adds 10 → step === 11
    const lastStateEvent = stateEvents[stateEvents.length - 1];
    expect(lastStateEvent.data.step).toBe(11);
  });

  it('node timeout throws an error', async () => {
    type S = { done: boolean };
    const g = new StateGraph<S>({
      channels: { done: { reducer: (_, b) => b, default: () => false } },
    });
    g.addNode(
      'slow',
      async () => {
        await new Promise((r) => setTimeout(r, 500));
        return { done: true };
      },
      { timeout: 50 }
    );
    g.addEdge(START, 'slow');
    g.addEdge('slow', END);

    const { NodeTimeoutError } = await import('../../index.js');
    await expect(g.compile().invoke({ done: false })).rejects.toThrow(NodeTimeoutError);
  });
});
