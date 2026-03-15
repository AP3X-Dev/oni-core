import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../events/index.js';
import type { LifecycleEvent } from '../../events/index.js';

describe('core invariant: EventBus routing', () => {
  it('typed listener receives only its event type', () => {
    const bus = new EventBus();
    const received: LifecycleEvent[] = [];
    bus.on('agent.start', (e) => received.push(e));

    bus.emit({ type: 'agent.start', agent: 'a', timestamp: 0, step: 0 });
    bus.emit({ type: 'agent.end', agent: 'a', timestamp: 0, step: 0, duration: 1 });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('agent.start');
  });

  it('onAll handler receives every emitted event', () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.onAll((e) => types.push(e.type));

    bus.emit({ type: 'agent.start', agent: 'a', timestamp: 0, step: 0 });
    bus.emit({ type: 'agent.end', agent: 'a', timestamp: 0, step: 0, duration: 1 });
    expect(types).toEqual(['agent.start', 'agent.end']);
  });

  it('unsubscribe via returned off() stops delivery', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.on('tool.call', spy);
    off();
    bus.emit({ type: 'tool.call', agent: 'a', tool: 'search', timestamp: 0, input: {} });
    expect(spy).not.toHaveBeenCalled();
  });

  it('throwing listener does not prevent subsequent listeners from firing', () => {
    const bus = new EventBus();
    const after = vi.fn();
    bus.on('agent.start', () => { throw new Error('bad listener'); });
    bus.on('agent.start', after);
    // EventBus catches listener errors internally — emit itself does not throw
    expect(() =>
      bus.emit({ type: 'agent.start', agent: 'a', timestamp: 0, step: 0 })
    ).not.toThrow();
    expect(after).toHaveBeenCalled();
  });

  it('removeAll() stops all subsequent emissions', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.on('agent.start', spy);
    bus.removeAll();
    bus.emit({ type: 'agent.start', agent: 'a', timestamp: 0, step: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});
