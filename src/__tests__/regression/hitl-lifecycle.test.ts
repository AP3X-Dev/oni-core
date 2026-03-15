// ============================================================
// regression: HITL lifecycle
//
// Key design facts (verified from source):
//   - interruptBefore throws ONIInterrupt (not HITLInterruptException)
//   - interrupt() inside a node throws HITLInterruptException (caught by Pregel, re-raised)
//   - HITLInterruptException is NOT an Error subclass — check .isHITLInterrupt
//   - resume() validates that resumeId belongs to the given threadId
//   - Unknown / cross-thread resumeId: throws Error matching /not found or does not belong/
//   - After resume(), getPendingInterrupts drops to 0 for that session
// ============================================================

import { describe, it, expect } from 'vitest';
import { StateGraph, START, END, MemoryCheckpointer } from '../../index.js';
import { interrupt } from '../../hitl/index.js';
import type { HITLInterruptException } from '../../index.js';

// Helper: create a minimal graph that will interrupt() inside a node
function makeInterruptGraph<S extends Record<string, unknown>>(
  channels: Record<string, { reducer: (a: unknown, b: unknown) => unknown; default: () => unknown }>,
  nodeName: string,
  nodeBody: (s: S) => Promise<Partial<S> | void>,
) {
  const g = new StateGraph<S>({ channels: channels as never });
  g.addNode(nodeName, nodeBody as never);
  g.addEdge(START, nodeName);
  g.addEdge(nodeName, END);
  return g;
}

describe('regression: HITL lifecycle', () => {
  it('unknown resumeId throws with matching error message', async () => {
    type S = { value: string };
    const g = makeInterruptGraph<S>(
      { value: { reducer: (_: unknown, b: unknown) => b, default: () => '' } },
      'ask',
      async () => { await interrupt('?'); return { value: 'done' }; },
    );
    const app = g.compile({ checkpointer: new MemoryCheckpointer<S>() });

    // Trigger first interrupt so the session store is warm
    try { await app.invoke({}, { threadId: 'unknown-rid-thread' }); } catch { /* expected */ }

    await expect(
      app.resume({ threadId: 'unknown-rid-thread', resumeId: 'does-not-exist' }, 'val')
    ).rejects.toThrow(/not found or does not belong to thread/i);
  });

  it('cross-thread resumeId isolation: thread-A resumeId cannot unlock thread-B', async () => {
    type S = { value: string };
    const channels = { value: { reducer: (_: unknown, b: unknown) => b, default: () => '' } };

    const makeApp = () => {
      const g = makeInterruptGraph<S>(
        channels,
        'ask',
        async () => { await interrupt('?'); return { value: 'done' }; },
      );
      return g.compile({ checkpointer: new MemoryCheckpointer<S>() });
    };

    const appA = makeApp();
    const appB = makeApp();

    let excA: HITLInterruptException<S> | null = null;
    let excB: HITLInterruptException<S> | null = null;

    try { await appA.invoke({}, { threadId: 'thread-A' }); } catch (e) {
      excA = e as HITLInterruptException<S>;
    }
    try { await appB.invoke({}, { threadId: 'thread-B' }); } catch (e) {
      excB = e as HITLInterruptException<S>;
    }

    expect(excA).not.toBeNull();
    expect(excB).not.toBeNull();

    // Try to use thread-B's resumeId against thread-A — must be rejected
    await expect(
      appA.resume({ threadId: 'thread-A', resumeId: excB!.interrupt.resumeId }, 'bad-value')
    ).rejects.toThrow(/not found or does not belong to thread/i);
  });

  it('after resume(), pending interrupts count drops to 0', async () => {
    type S = { answer: string };
    const g = makeInterruptGraph<S>(
      { answer: { reducer: (_: unknown, b: unknown) => b, default: () => '' } },
      'ask',
      async () => {
        const v = await interrupt<string>('question');
        return { answer: v as string };
      },
    );
    const app = g.compile({ checkpointer: new MemoryCheckpointer<S>() });

    let exc: HITLInterruptException<S> | null = null;
    try { await app.invoke({}, { threadId: 'resume-count-thread' }); } catch (e) {
      exc = e as HITLInterruptException<S>;
    }
    expect(exc).not.toBeNull();

    // Before resume: 1 pending
    const beforePending = app.getPendingInterrupts({ threadId: 'resume-count-thread' });
    expect(beforePending).toHaveLength(1);

    // Resume
    await app.resume(
      { threadId: 'resume-count-thread', resumeId: exc!.interrupt.resumeId },
      'my-answer',
    );

    // After resume: 0 pending
    const afterPending = app.getPendingInterrupts({ threadId: 'resume-count-thread' });
    expect(afterPending).toHaveLength(0);
  });

  it('HITLInterruptException carries the correct threadId and interrupt value', async () => {
    type S = { result: string };
    const g = makeInterruptGraph<S>(
      { result: { reducer: (_: unknown, b: unknown) => b, default: () => '' } },
      'collector',
      async () => {
        await interrupt({ prompt: 'Enter your name' });
        return { result: 'done' };
      },
    );
    const app = g.compile({ checkpointer: new MemoryCheckpointer<S>() });

    let exc: HITLInterruptException<S> | null = null;
    try { await app.invoke({}, { threadId: 'exc-meta-thread' }); } catch (e) {
      exc = e as HITLInterruptException<S>;
    }

    expect(exc).not.toBeNull();
    expect(exc!.isHITLInterrupt).toBe(true);
    expect(exc!.threadId).toBe('exc-meta-thread');
    expect((exc!.interrupt.value as Record<string, unknown>).prompt).toBe('Enter your name');
    expect(exc!.interrupt.node).toBe('collector');
    expect(typeof exc!.interrupt.resumeId).toBe('string');
  });
});
