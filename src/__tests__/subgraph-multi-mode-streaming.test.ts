import { describe, it, expect } from 'vitest';
import { StateGraph, START, END } from '../index.js';

// Regression test for BUG-4: subgraph events dropped secondary mode tags
// when modeDebug was active in multi-mode streaming.
//
// Root cause: the subgraph forwarding loop used if/else if/else if, so when
// modeDebug fired the else-if branches for "updates" and "values" were
// unreachable. Fix: parallel if statements (same pattern as main-node path).

describe('subgraph multi-mode streaming (BUG-4)', () => {
  function buildGraph() {
    type Inner = { n: number };
    const inner = new StateGraph<Inner>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    inner.addNode('add', async (s) => ({ n: s.n + 1 }));
    inner.addEdge(START, 'add');
    inner.addEdge('add', END);
    const innerGraph = inner.compile();

    type Outer = { n: number };
    const outer = new StateGraph<Outer>({
      channels: { n: { reducer: (_, b) => b, default: () => 0 } },
    });
    outer.addSubgraph('sub', innerGraph);
    outer.addEdge(START, 'sub');
    outer.addEdge('sub', END);
    return outer.compile();
  }

  it('["debug", "updates"] mode: subgraph node_end events are tagged "updates" as well as "debug"', async () => {
    const graph = buildGraph();
    type Evt = { event: string; mode?: string; node?: string };
    const events: Evt[] = [];
    for await (const e of graph.stream({ n: 0 }, { streamMode: ['debug', 'updates'] })) {
      events.push(e as Evt);
    }

    // Must have at least one event tagged "debug" from the subgraph
    const debugEvents = events.filter((e) => e.mode === 'debug' && e.event === 'node_end');
    expect(debugEvents.length).toBeGreaterThan(0);

    // Must also have at least one SUBGRAPH-FORWARDED node_end tagged "updates".
    // Scope to forwarded events (node namespaced "sub:<inner>") — the parent's own
    // "sub" node_end (emitted via the unaffected main-node path) would mask the bug,
    // so without this scoping the test passes against the buggy else-if chain too.
    const updatesEvents = events.filter(
      (e) => e.mode === 'updates' && e.event === 'node_end' && typeof e.node === 'string' && e.node.startsWith('sub:'),
    );
    expect(updatesEvents.length).toBeGreaterThan(0);
  });

  it('["debug", "values"] mode: subgraph state_update events are tagged "values" as well as "debug"', async () => {
    const graph = buildGraph();
    type Evt = { event: string; mode?: string; node?: string };
    const events: Evt[] = [];
    for await (const e of graph.stream({ n: 0 }, { streamMode: ['debug', 'values'] })) {
      events.push(e as Evt);
    }

    // Must have at least one debug state_update from the subgraph
    const debugStateEvents = events.filter((e) => e.mode === 'debug' && e.event === 'state_update');
    expect(debugStateEvents.length).toBeGreaterThan(0);

    // Must also have at least one SUBGRAPH-FORWARDED state_update tagged "values".
    // Scope to forwarded events (node namespaced under "sub") — the parent's own
    // top-level values events carry no node field, so this excludes the maskers and
    // the test fails against the buggy else-if chain.
    const valuesStateEvents = events.filter(
      (e) => e.mode === 'values' && e.event === 'state_update' && typeof e.node === 'string' && e.node.startsWith('sub'),
    );
    expect(valuesStateEvents.length).toBeGreaterThan(0);
  });

  it('["updates"] mode without debug: subgraph node_end events are still yielded', async () => {
    const graph = buildGraph();
    type Evt = { event: string; mode?: string; node?: string };
    const events: Evt[] = [];
    for await (const e of graph.stream({ n: 0 }, { streamMode: ['updates'] })) {
      events.push(e as Evt);
    }
    const updatesEvents = events.filter((e) => e.mode === 'updates' && e.event === 'node_end');
    expect(updatesEvents.length).toBeGreaterThan(0);
  });
});
