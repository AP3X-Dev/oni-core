import { describe, it, expect } from 'vitest';
import { StateGraph, MemoryCheckpointer, HITLInterruptException, START, END } from '../../index.js';
import { interrupt } from '../../hitl/index.js';

describe('core invariant: HITL resume', () => {
  it('interrupt() in a node suspends and resume delivers value', async () => {
    // HITLInterruptException is thrown when interrupt() is called inside a node.
    // interruptBefore throws the lower-level ONIInterrupt; use interrupt() for HITL flow.
    type S = { result: string };
    const g = new StateGraph<S>({
      channels: {
        result: { reducer: (_, b) => b, default: () => '' },
      },
    });
    g.addNode('gate', async () => {
      const answer = await interrupt<string>({ question: 'Approve?' });
      return { result: answer === 'yes' ? 'done' : 'rejected' };
    });
    g.addEdge(START, 'gate');
    g.addEdge('gate', END);

    const cp = new MemoryCheckpointer();
    const graph = g.compile({ checkpointer: cp });
    const threadId = 'hitl-1';

    let resumeId = '';
    try {
      await graph.invoke({ result: '' }, { threadId });
      throw new Error('expected HITLInterruptException');
    } catch (e) {
      expect((e as HITLInterruptException<S>).isHITLInterrupt).toBe(true);
      resumeId = (e as HITLInterruptException<S>).interrupt.resumeId;
    }
    expect(resumeId).toBeTruthy();

    const pending = graph.getPendingInterrupts({ threadId });
    expect(pending.length).toBe(1);
    expect(pending[0].resumeId).toBe(resumeId);

    const result = await graph.resume({ threadId, resumeId }, 'yes');
    expect(result.result).toBe('done');
  });

  it('resume() throws a descriptive error for unknown resumeId', async () => {
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('pass', async (s) => s);
    g.addEdge(START, 'pass');
    g.addEdge('pass', END);
    const graph = g.compile({ checkpointer: new MemoryCheckpointer() });

    await expect(
      graph.resume({ threadId: 'none', resumeId: 'fake-id' }, true)
    ).rejects.toThrow(/not found/i);
  });

  it('two threads do not share HITL sessions', async () => {
    // Use interrupt() so HITLSessionStore is populated and getPendingInterrupts works
    type S = { n: number };
    const g = new StateGraph<S>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    g.addNode('pause', async (s) => {
      await interrupt({ ask: 'proceed?' });
      return s;
    });
    g.addEdge(START, 'pause');
    g.addEdge('pause', END);
    const cp = new MemoryCheckpointer();
    const graph = g.compile({ checkpointer: cp });

    try { await graph.invoke({ n: 1 }, { threadId: 'tA' }); } catch { /* expected HITLInterruptException */ }
    try { await graph.invoke({ n: 2 }, { threadId: 'tB' }); } catch { /* expected HITLInterruptException */ }

    const pendingA = graph.getPendingInterrupts({ threadId: 'tA' });
    const pendingB = graph.getPendingInterrupts({ threadId: 'tB' });
    expect(pendingA.length).toBe(1);
    expect(pendingB.length).toBe(1);
    expect(pendingA.every(s => s.threadId === 'tA')).toBe(true);
    expect(pendingB.every(s => s.threadId === 'tB')).toBe(true);
  });
});
