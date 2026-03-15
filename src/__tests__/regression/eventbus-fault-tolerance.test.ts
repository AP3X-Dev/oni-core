// ============================================================
// regression: EventBus fault tolerance
//
// Verified from src/events/bus.ts and src/events/types.ts:
//   - dispose() exists — sets disposed=true, clears all handlers/timers
//   - removeAll() exists — clears handlers and timers (does not set disposed)
//   - emit() catches listener errors (fault isolation via try/catch)
//   - After dispose(), on() returns no-op and emit() is a no-op
//   - agent.end shape: { type, agent, timestamp, step, duration, usage? }
//   - tool.call shape: { type, agent, tool, timestamp, input }
// ============================================================

import { describe, it, expect } from 'vitest';
import { EventBus } from '../../events/index.js';

describe('regression: EventBus fault tolerance', () => {
  it('throwing listener does not prevent subsequent listeners from being called', () => {
    const bus = new EventBus();
    const received: number[] = [];

    bus.on('agent.start', () => { throw new Error('listener boom'); });
    bus.on('agent.start', () => { received.push(1); });
    bus.on('agent.start', () => { received.push(2); });

    // Should not throw even though the first listener throws
    expect(() => {
      bus.emit({ type: 'agent.start', agent: 'test', timestamp: Date.now(), step: 0 });
    }).not.toThrow();

    expect(received).toEqual([1, 2]);
  });

  it('onAll listener error does not prevent typed listeners from being called', () => {
    const bus = new EventBus();
    const typedCalls: number[] = [];
    bus.on('agent.start', () => { typedCalls.push(1); });
    bus.onAll(() => { throw new Error('onAll boom'); });
    bus.emit({ type: 'agent.start', agent: 'a', timestamp: Date.now(), step: 0 });
    // typed handlers run before onAll — if order ever inverts, this catches it
    expect(typedCalls).toEqual([1]);
  });

  it('throwing onAll listener does not prevent other onAll listeners from being called', () => {
    const bus = new EventBus();
    const seen: string[] = [];

    bus.onAll(() => { throw new Error('onAll boom'); });
    bus.onAll((e) => { seen.push(e.type); });

    expect(() => {
      bus.emit({ type: 'agent.start', agent: 'a', timestamp: Date.now(), step: 0 });
    }).not.toThrow();

    expect(seen).toContain('agent.start');
  });

  it('dispose() prevents new handlers from firing', () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.dispose();

    // After dispose, on() should return a no-op and never fire
    bus.on('agent.start', () => { received.push('fired'); });
    bus.emit({ type: 'agent.start', agent: 'test', timestamp: Date.now(), step: 0 });

    expect(received).toHaveLength(0);
  });

  it('dispose() clears existing handlers so they never fire again', () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('agent.start', () => { received.push('before-dispose'); });
    bus.dispose();
    bus.emit({ type: 'agent.start', agent: 'test', timestamp: Date.now(), step: 0 });

    expect(received).toHaveLength(0);
  });

  it('removeAll() clears handlers without marking bus as disposed', () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on('agent.start', () => { received.push('first'); });
    bus.removeAll();

    // After removeAll, adding new handlers and emitting should work
    bus.on('agent.start', () => { received.push('after-removeAll'); });
    bus.emit({ type: 'agent.start', agent: 'x', timestamp: Date.now(), step: 0 });

    expect(received).not.toContain('first');
    expect(received).toContain('after-removeAll');
  });

  it('unsubscribe function returned by on() deregisters the handler', () => {
    const bus = new EventBus();
    const received: number[] = [];

    const unsub = bus.on('agent.start', () => { received.push(1); });
    bus.emit({ type: 'agent.start', agent: 'a', timestamp: Date.now(), step: 0 });
    unsub();
    bus.emit({ type: 'agent.start', agent: 'b', timestamp: Date.now(), step: 1 });

    expect(received).toEqual([1]); // only the first emit reached the handler
  });

  it('agent.end event carries required fields (agent, timestamp, step, duration)', () => {
    const bus = new EventBus();
    const events: Array<{ agent: string; duration: number; step: number }> = [];

    bus.on('agent.end', (e) => {
      events.push({ agent: e.agent, duration: e.duration, step: e.step });
    });

    bus.emit({
      type: 'agent.end',
      agent: 'my-agent',
      timestamp: Date.now(),
      step: 3,
      duration: 42,
    });

    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe('my-agent');
    expect(events[0].duration).toBe(42);
    expect(events[0].step).toBe(3);
  });

  it('tool.call event carries required fields (agent, tool, timestamp, input)', () => {
    const bus = new EventBus();
    const events: Array<{ agent: string; tool: string; input: Record<string, unknown> }> = [];

    bus.on('tool.call', (e) => {
      events.push({ agent: e.agent, tool: e.tool, input: e.input });
    });

    bus.emit({
      type: 'tool.call',
      agent: 'coder',
      tool: 'read_file',
      timestamp: Date.now(),
      input: { path: '/foo/bar.ts' },
    });

    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe('coder');
    expect(events[0].tool).toBe('read_file');
    expect(events[0].input).toEqual({ path: '/foo/bar.ts' });
  });

  it('handlerCount returns correct count per event type', () => {
    const bus = new EventBus();

    expect(bus.handlerCount('agent.start')).toBe(0);

    const u1 = bus.on('agent.start', () => {});
    const u2 = bus.on('agent.start', () => {});
    bus.on('agent.end', () => {});

    expect(bus.handlerCount('agent.start')).toBe(2);
    expect(bus.handlerCount('agent.end')).toBe(1);

    u1();
    expect(bus.handlerCount('agent.start')).toBe(1);
    u2();
    expect(bus.handlerCount('agent.start')).toBe(0);
  });

  it('once() fires exactly one time then auto-unsubscribes', () => {
    const bus = new EventBus();
    const calls: number[] = [];

    bus.once('agent.start', () => { calls.push(1); });

    bus.emit({ type: 'agent.start', agent: 'a', timestamp: Date.now(), step: 0 });
    bus.emit({ type: 'agent.start', agent: 'b', timestamp: Date.now(), step: 1 });

    expect(calls).toEqual([1]); // fired exactly once
  });
});
