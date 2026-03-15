import { describe, it, expect } from 'vitest';
import { AuditLog } from '../../guardrails/audit.js';
import type { AuditEntry } from '../../guardrails/types.js';

describe('core invariant: guardrails', () => {
  it('AuditLog records entries and retrieves them by thread', () => {
    const log = new AuditLog();
    const entry: AuditEntry = {
      timestamp: Date.now(),
      agent: 'test-agent',
      action: 'tool.call',
      data: { tool: 'search' },
    };
    log.record('thread-1', entry);
    const entries = log.getLog('thread-1');
    expect(entries).toHaveLength(1);
    expect(entries[0].agent).toBe('test-agent');
    expect(entries[0].action).toBe('tool.call');
  });

  it('AuditLog does not return entries from a different thread', () => {
    const log = new AuditLog();
    const entry: AuditEntry = {
      timestamp: Date.now(), agent: 'a', action: 'tool.call', data: {},
    };
    log.record('t1', entry);
    expect(log.getLog('t2')).toHaveLength(0);
  });

  it('AuditLog evicts oldest thread when maxThreadIds exceeded', () => {
    const log = new AuditLog(2);
    const e: AuditEntry = { timestamp: 0, agent: 'a', action: 'tool.call', data: {} };
    log.record('t1', e);
    log.record('t2', e);
    log.record('t3', e);
    expect(log.getLog('t1')).toHaveLength(0);
    expect(log.getLog('t2')).toHaveLength(1);
    expect(log.getLog('t3')).toHaveLength(1);
  });

  it('BudgetTracker can be constructed and record is callable', async () => {
    const { BudgetTracker } = await import('../../guardrails/budget.js');
    const tracker = new BudgetTracker({ maxTokensPerRun: 100 });
    const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };
    expect(() => tracker.record('agent', 'claude-sonnet-4-6', usage)).not.toThrow();
  });

  it('BudgetTracker throws BudgetExceededError when token limit is exceeded', async () => {
    const { BudgetTracker, BudgetExceededError } = await import('../../guardrails/budget.js');
    // maxTokensPerRun: 5 — a single call with 20 total tokens will exceed it
    // Default onBudgetExceeded is "error", so record() must throw
    const tracker = new BudgetTracker({ maxTokensPerRun: 5 });
    const bigUsage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };
    expect(() => tracker.record('agent', 'claude-sonnet-4-6', bigUsage)).toThrow(BudgetExceededError);
  });

  it('BudgetTracker returns budget.exceeded entries when onBudgetExceeded is "warn"', async () => {
    const { BudgetTracker } = await import('../../guardrails/budget.js');
    // With mode "warn", record() should NOT throw but return audit entries
    const tracker = new BudgetTracker({ maxTokensPerRun: 5, onBudgetExceeded: 'warn' });
    const bigUsage = { inputTokens: 10, outputTokens: 10, totalTokens: 20 };
    const entries = tracker.record('agent', 'claude-sonnet-4-6', bigUsage);
    const exceeded = entries.filter((e) => e.action === 'budget.exceeded');
    expect(exceeded.length).toBeGreaterThan(0);
    expect(exceeded[0].data).toMatchObject({ kind: 'run' });
  });
});
