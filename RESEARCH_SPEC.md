# Research Module — Refined Specification

> Autonomous experiment loop for `@oni.bot/core`.
> Agents mutate code, measure fitness, and keep or discard — in parallel via git worktrees.

---

## 1. Module Structure

```
src/research/
├── errors.ts              — extends ONIHarnessError
├── utils.ts               — shared utilities (ESM imports, cross-platform spawn)
├── ExperimentLedger.ts    — persistent experiment tracking + pattern analysis
├── MutationScope.ts       — runtime file/command enforcement
├── MetricObjective.ts     — pluggable fitness function (4 extractors + LLM judge)
├── ResearchProgram.ts     — versioned strategy document
├── ExperimentLoop.ts      — core mutate→eval→keep/discard loop
├── ResearchOrg.ts         — multi-agent parallel experimentation via git worktrees
├── index.ts               — barrel exports
└── __tests__/
    └── (one test file per module)
```

### Error Hierarchy

All errors extend `ONIHarnessError` from `src/harness/errors.ts`. Same `code` field pattern — no new base class.

```typescript
// src/research/errors.ts

import { ONIHarnessError } from "../harness/errors.js";

export class MutationScopeViolationError extends ONIHarnessError {
  constructor(path: string, allowedGlobs: string[]) {
    super(
      `Mutation blocked: "${path}" is outside allowed scope [${allowedGlobs.join(", ")}].`,
      "MUTATION_SCOPE_VIOLATION",
    );
    this.name = "MutationScopeViolationError";
  }
}

export class MetricExtractionError extends ONIHarnessError {
  constructor(extractorType: string, detail: string) {
    super(
      `Metric extraction failed (${extractorType}): ${detail}`,
      "METRIC_EXTRACTION_FAILED",
    );
    this.name = "MetricExtractionError";
  }
}

export class ExperimentTimeoutError extends ONIHarnessError {
  constructor(experimentId: string, timeoutMs: number) {
    super(
      `Experiment "${experimentId}" exceeded timeout of ${timeoutMs}ms.`,
      "EXPERIMENT_TIMEOUT",
    );
    this.name = "ExperimentTimeoutError";
  }
}

export class ExperimentLoopAlreadyRunningError extends ONIHarnessError {
  constructor() {
    super(
      "ExperimentLoop.run() called while already running. Call stop() first.",
      "EXPERIMENT_LOOP_ALREADY_RUNNING",
    );
    this.name = "ExperimentLoopAlreadyRunningError";
  }
}

export class ResearchProgramNotFoundError extends ONIHarnessError {
  constructor(path: string) {
    super(
      `Research program file not found: "${path}".`,
      "RESEARCH_PROGRAM_NOT_FOUND",
    );
    this.name = "ResearchProgramNotFoundError";
  }
}

export class LedgerCorruptError extends ONIHarnessError {
  constructor(path: string, detail: string) {
    super(
      `Ledger file corrupt at "${path}": ${detail}`,
      "LEDGER_CORRUPT",
    );
    this.name = "LedgerCorruptError";
  }
}
```

### Harness Re-export

`src/harness/index.ts` gets one line — research owns the implementation:

```typescript
// ── Research (convenience re-export) ────────────────────────
export { ExperimentLedger } from "../research/ExperimentLedger.js";
```

---

## 2. ExperimentLedger

Persistent experiment tracking with dual storage and pattern analysis (absorbs PatternLearner).

### Types

```typescript
export type ExperimentStatus = "keep" | "discard" | "crash" | "timeout";
export type TrendDirection = "improving" | "plateauing" | "regressing" | "insufficient-data";

export interface ExperimentResult {
  id: string;
  experimentIndex: number;
  description: string;
  status: ExperimentStatus;
  metricBefore: number;
  metricAfter: number | null;
  delta: number | null;
  direction: "maximize" | "minimize";
  timestamp: string;           // ISO 8601
  durationMs: number;
  error?: string;
}

export interface LedgerSummary {
  total: number;
  kept: number;
  discarded: number;
  crashed: number;
  timedOut: number;
  bestMetric: number | null;
  trend: TrendDirection;
}

export interface Pattern {
  description: string;         // first 3 words of experiment description
  successRate: number;
  sampleSize: number;
  metricGain: number;          // average improvement for successful experiments
}
```

### API

```typescript
export class ExperimentLedger {
  // ── Lifecycle ──
  static initialize(dir: string, runId: string): ExperimentLedger;

  // ── Core CRUD ──
  append(result: ExperimentResult): void;
  getAll(): ExperimentResult[];
  getBest(direction: "maximize" | "minimize"): ExperimentResult | null;
  getRecent(n: number): ExperimentResult[];
  getNearMisses(direction: "maximize" | "minimize", threshold: number): ExperimentResult[];

  // ── Analysis ──
  getTrend(windowSize?: number): TrendDirection;
  getSummary(): LedgerSummary;
  toMarkdownSummary(): string;

  // ── Pattern analysis (absorbed from PatternLearner) ──
  identifyPatterns(metric: string): Pattern[];
  suggestNext(metric: string): string[];
}
```

### Storage

- **JSON** (`ledger-{runId}.json`): Array of `ExperimentResult`. Written atomically via `atomicWriteJSON` (write `.tmp`, rename). Protected by `withFileLock` for concurrent access.
- **TSV** (`results-{runId}.tsv`): Human-readable append log. Written via `appendFileSync` — not atomic (the JSON side handles durability).

### Pattern Analysis

Ported from `src/swarm/self-improvement/pattern-learner.ts`:

- `identifyPatterns(metric)` — Groups experiments by first 3 words of `description`. Calculates success rate per group (where success = status `"keep"`). Returns `Pattern[]` sorted by success rate descending. Requires minimum 2 samples per group.
- `suggestNext(metric)` — Filters patterns to those with `successRate >= 0.6` and `sampleSize >= 2`, returns top 3 as formatted suggestion strings.

These feed into `AgentExperimentContext.patternSuggestions` each loop iteration.

---

## 3. MutationScope

Runtime enforcement of what files agents can touch and what commands they can run.

### Types

```typescript
export interface MutationScopeConfig {
  allowedFileGlobs: string[];   // e.g. ["src/components/**/*.tsx", "tests/**"]
  allowedCommands: string[];    // e.g. ["npm test", "npm run build"]
  mode: "strict" | "permissive";
}
```

### API

```typescript
export class MutationScope {
  constructor(config: MutationScopeConfig);

  /** Throws MutationScopeViolationError if path is outside allowed globs. */
  assertCanMutate(filePath: string): void;

  /** Throws MutationScopeViolationError if command is not in allowed list. */
  assertCanRun(command: string): void;

  /** Returns { valid: boolean; violations: string[] } without throwing. */
  validate(filePath: string): { valid: boolean; violations: string[] };

  /** Human-readable description of the scope for agent context. */
  describe(): string;
}
```

### Behavior

- **Strict mode**: Unlisted files/commands throw immediately.
- **Permissive mode**: Unlisted files/commands log a warning but proceed. Useful during early exploration.
- Glob matching uses `minimatch` or equivalent — same semantics as `.gitignore`.

---

## 4. MetricObjective

Pluggable fitness function with 4 extractor types.

### Types

```typescript
export type MetricDirection = "maximize" | "minimize";

export type MetricExtractorType =
  | "command-exit-code"
  | "command-stdout-number"
  | "file-json-path"
  | "llm-judge";

export interface MetricExtractorConfig {
  type: MetricExtractorType;

  // command-exit-code / command-stdout-number
  command?: string;
  regex?: string;              // for stdout-number: capture group 1 = the number

  // file-json-path
  filePath?: string;
  jsonPath?: string;           // e.g. "coverage.lines.pct"

  // llm-judge
  judgePrompt?: string;
  criteria?: string[];         // evaluation dimensions
  maxScore?: number;           // default 10
}

export interface MetricObjectiveConfig {
  name: string;
  direction: MetricDirection;
  extractor: MetricExtractorConfig;
  baselineValue?: number;
}

export interface MetricReading {
  value: number;
  raw: string;                 // raw output before parsing
  timestamp: string;
}
```

### API

```typescript
export class MetricObjective {
  constructor(config: MetricObjectiveConfig);

  /** Run the extractor and return the current metric value. */
  async measure(workspaceDir: string): Promise<MetricReading>;

  /** True if candidateValue is better than baselineValue per direction. */
  isBetter(candidateValue: number, baselineValue: number): boolean;

  /** Human-readable description for agent context. */
  describe(): string;
}
```

### Extractors

| Type | Behavior |
|------|----------|
| `command-exit-code` | Runs command via `execFileSync`. Metric = exit code (0 = success). |
| `command-stdout-number` | Runs command, applies regex to stdout, parses capture group 1 as float. |
| `file-json-path` | Reads JSON file, traverses dot-path, returns number. |
| `llm-judge` | Calls `anthropic()` from `@oni.bot/core/models` with judge prompt + criteria. Returns normalized score. Gets auth, retries, rate limiting for free. |

The `llm-judge` extractor references the `EvaluationCriterion` type from `src/swarm/self-improvement/` for type compatibility but does not import it directly. A `// TODO: wire ganLoop evaluator when ready` marks the integration point.

Commands are validated against `MutationScope.assertCanRun()` when a scope is provided.

---

## 5. ResearchProgram

Versioned strategy document — a markdown file that the loop reads and the agent follows.

### Program File Format

```markdown
# Research Program: <name>

## Goal
<what we're optimizing and why>

## Metric
<metric name, direction, extraction method>

## Constraints
<what must not break, time/resource limits>

## Research Directions
- <approach 1>
- <approach 2>

## Known Dead Ends
- <approach that was tried and failed, with reason>

## Rules
- <simplicity rule, scope rule, etc.>
```

### Types

```typescript
export interface ResearchProgramMetadata {
  name: string;
  goal: string;
  metric: string;
  constraints: string[];
  researchDirections: string[];
  knownDeadEnds: string[];
  simplicityRule?: string;
}
```

### API

```typescript
export class ResearchProgram {
  /** Read and parse a research program markdown file. */
  static read(filePath: string): ResearchProgram;

  /** Initialize a new program file from metadata. */
  static initialize(filePath: string, metadata: ResearchProgramMetadata): ResearchProgram;

  /** Get the full parsed metadata. */
  getMetadata(): ResearchProgramMetadata;

  /** One-paragraph summary for agent context injection. */
  summarize(): string;

  /** Extract a specific section by heading name. */
  getSection(heading: string): string | null;

  /** Git commit hash of last modification (via execGit). */
  lastModifiedCommit(workspaceDir: string): string | null;
}
```

Section extraction uses regex matching on markdown headings — no AST parser needed.

---

## 6. ExperimentLoop

Core mutate→eval→keep/discard loop.

### Event Types

New research events added to the `LifecycleEvent` union in `src/events/types.ts`:

```typescript
// ── Research events ────────────────────────────────────────

export interface ResearchExperimentStartEvent {
  type: "research.experiment.start";
  experimentId: string;
  experimentIndex: number;
  description: string;
  timestamp: number;
}

export interface ResearchExperimentImprovementEvent {
  type: "research.experiment.improvement";
  experimentId: string;
  metricBefore: number;
  metricAfter: number;
  delta: number;
  timestamp: number;
}

export interface ResearchExperimentRegressionEvent {
  type: "research.experiment.regression";
  experimentId: string;
  metricBefore: number;
  metricAfter: number;
  delta: number;
  timestamp: number;
}

export interface ResearchExperimentCrashEvent {
  type: "research.experiment.crash";
  experimentId: string;
  error: string;
  timestamp: number;
}

export interface ResearchExperimentPlateauEvent {
  type: "research.experiment.plateau";
  windowSize: number;
  trend: TrendDirection;
  timestamp: number;
}

export interface ResearchLoopCompleteEvent {
  type: "research.loop.complete";
  totalExperiments: number;
  kept: number;
  bestMetric: number | null;
  timestamp: number;
}

export interface ResearchLoopStopEvent {
  type: "research.loop.stop";
  reason: "manual" | "max-iterations" | "plateau" | "timeout";
  timestamp: number;
}
```

These get added to the `LifecycleEvent` union and are visible to the global `EventBus` from `src/events/bus.ts`.

### WorkspaceCheckpointerLike

Interface matching the actual `WorkspaceCheckpointer` API:

```typescript
export interface WorkspaceCheckpointerLike<S> {
  put(checkpoint: ONICheckpoint<S>): Promise<void>;
  get(threadId: string): Promise<ONICheckpoint<S> | null>;
  rollbackTo(checkpointId: string): Promise<ONICheckpoint<S> | null>;
  setNextMetadata?(metadata: { description?: string; featureId?: string }): void;
}
```

### AgentExperimentContext

What the mutation agent receives each iteration:

```typescript
export interface AgentExperimentContext {
  experimentIndex: number;
  currentMetric: number;
  bestMetric: number;
  recentResults: ExperimentResult[];   // last 5
  trend: TrendDirection;
  programSummary: string;              // from ResearchProgram.summarize()
  scopeDescription: string;            // from MutationScope.describe()
  patternSuggestions: string[];        // from ExperimentLedger.suggestNext()
}
```

### ExperimentLoop Config

```typescript
export interface ExperimentLoopConfig {
  /** The mutation agent — receives context, returns a description of what it changed. */
  mutationAgent: (context: AgentExperimentContext) => Promise<string>;

  /** Fitness function. */
  metric: MetricObjective;

  /** File/command enforcement. */
  scope: MutationScope;

  /** Strategy document. */
  program: ResearchProgram;

  /** Persistent tracking. */
  ledger: ExperimentLedger;

  /** Optional — git checkpoint integration. */
  checkpointer?: WorkspaceCheckpointerLike<unknown>;

  /** EventBus instance for research event emission. */
  eventBus?: EventBus<LifecycleEvent>;

  /** Working directory for the experiment (default: process.cwd()). */
  workspaceDir?: string;

  /** Max iterations before auto-stop. */
  maxIterations?: number;

  /** Per-experiment timeout in ms. */
  experimentTimeoutMs?: number;

  /** Stop if trend is "plateauing" for this many consecutive checks. */
  plateauThreshold?: number;
}
```

### API

```typescript
export class ExperimentLoop {
  constructor(config: ExperimentLoopConfig);

  /** Start the loop. Throws ExperimentLoopAlreadyRunningError if already running. */
  async run(): Promise<void>;

  /** Signal the loop to stop after the current iteration completes. */
  stop(): void;

  /** Whether the loop is currently running. */
  isRunning(): boolean;
}
```

### Loop Pseudocode

```
run():
  if running → throw ExperimentLoopAlreadyRunningError
  running = true
  baseline = await metric.measure(workspaceDir)

  for i = 0..maxIterations:
    if stopRequested → emit research.loop.stop("manual"), break

    context = buildAgentContext(i, baseline)
    emit research.experiment.start

    try:
      description = await withTimeout(mutationAgent(context), experimentTimeoutMs)
      afterMetric = await metric.measure(workspaceDir)

      if metric.isBetter(afterMetric, baseline):
        status = "keep"
        baseline = afterMetric
        checkpointer?.put(...)
        emit research.experiment.improvement
      else:
        status = "discard"
        gitReset(workspaceDir)
        emit research.experiment.regression

    catch timeout:
      status = "timeout"
      gitReset(workspaceDir)
      emit research.experiment.crash

    catch error:
      status = "crash"
      gitReset(workspaceDir)
      emit research.experiment.crash

    ledger.append({ id, experimentIndex: i, description, status, ... })

    trend = ledger.getTrend()
    if trend === "plateauing" for plateauThreshold consecutive:
      emit research.experiment.plateau
      emit research.loop.stop("plateau")
      break

  emit research.loop.complete
  running = false
```

### Git Reset

Uses static ESM import — no `require()`:

```typescript
import { execFileSync } from "node:child_process";

function gitReset(workspaceDir: string): void {
  execFileSync("git", ["checkout", "."], { cwd: workspaceDir, stdio: "pipe" });
  execFileSync("git", ["clean", "-fd"], { cwd: workspaceDir, stdio: "pipe" });
}
```

---

## 7. ResearchOrg

Multi-agent parallel experimentation using git worktrees for true filesystem isolation.

### Directory Layout

```
.oni-research/
├── worktrees/
│   ├── agent-alpha/          ← git worktree (its own working directory)
│   └── agent-beta/           ← git worktree (its own working directory)
├── ledger-run-agent-alpha.json
├── ledger-run-agent-beta.json
└── results-run-*.tsv
```

### Types

```typescript
export interface ResearchAgentConfig {
  name: string;
  mutationAgent: (context: AgentExperimentContext) => Promise<string>;
  metric: MetricObjectiveConfig;
  scope: MutationScopeConfig;
  program: string;             // path to research program markdown
  maxIterations?: number;
  experimentTimeoutMs?: number;
}

export interface ResearchOrgConfig {
  agents: ResearchAgentConfig[];
  workspaceDir: string;
  researchDir?: string;        // default: ".oni-research"
  crossPollinate?: boolean;    // share winning patterns across agents
  onAnyImprovement?: (agentName: string, result: ExperimentResult) => void;
  eventBus?: EventBus<LifecycleEvent>;
}

export type AgentRunStatus = "running" | "completed" | "stopped" | "crashed";

export interface OrgStatus {
  agents: Array<{
    name: string;
    status: AgentRunStatus;
    experimentsRun: number;
    bestMetric: number | null;
    isBestOverall: boolean;    // direction-aware comparison
    trend: TrendDirection;
  }>;
  globalBest: {
    agentName: string;
    metric: number;
  } | null;
}
```

### API

```typescript
export class ResearchOrg {
  constructor(config: ResearchOrgConfig);

  /** Create worktrees and initialize ledgers for each agent. */
  async initialize(): Promise<void>;

  /** Run all agents in parallel via Promise.allSettled(). */
  async runAll(): Promise<OrgStatus>;

  /** Signal all loops to stop after their current iteration. */
  stopAll(): void;

  /** Get current status of all agents. Direction-aware metric comparison. */
  getStatus(): OrgStatus;

  /** Remove worktrees and clean up. */
  async cleanup(): Promise<void>;
}
```

### Worktree Lifecycle

```
initialize():
  mkdir .oni-research/worktrees/
  for each agent:
    git worktree add .oni-research/worktrees/{agent.name} -b research/{agent.name} HEAD
    create ExperimentLedger in .oni-research/ (shared dir, agent-scoped filename)
    create ExperimentLoop with worktreeDir as workspaceDir

runAll():
  Promise.allSettled(agents.map(a => a.loop.run()))
  // True parallel — each agent has its own filesystem via worktree

cleanup():
  for each agent:
    git worktree remove .oni-research/worktrees/{agent.name}
  rmdir .oni-research/worktrees/ (if empty)
```

### Direction-Aware Status

`getStatus()` reads each agent's `MetricObjective.config.direction` to determine which agent has the best overall metric. No hardcoded `<` comparison.

### Cross-Pollination (Optional)

When `crossPollinate: true`, after each improvement event:
1. The improving agent's winning description is added to other agents' pattern suggestions.
2. Pattern data flows through `ExperimentLedger.identifyPatterns()` — agents don't share ledgers directly.

---

## 8. Integration

### Barrel Exports (`src/research/index.ts`)

```typescript
// Errors
export {
  MutationScopeViolationError,
  MetricExtractionError,
  ExperimentTimeoutError,
  ExperimentLoopAlreadyRunningError,
  ResearchProgramNotFoundError,
  LedgerCorruptError,
} from "./errors.js";

// Core modules
export { ExperimentLedger } from "./ExperimentLedger.js";
export { MutationScope } from "./MutationScope.js";
export { MetricObjective } from "./MetricObjective.js";
export { ResearchProgram } from "./ResearchProgram.js";
export { ExperimentLoop } from "./ExperimentLoop.js";
export { ResearchOrg } from "./ResearchOrg.js";

// Types
export type {
  ExperimentResult, ExperimentStatus, TrendDirection,
  LedgerSummary, Pattern,
} from "./ExperimentLedger.js";
export type { MutationScopeConfig } from "./MutationScope.js";
export type {
  MetricObjectiveConfig, MetricExtractorConfig,
  MetricExtractorType, MetricDirection, MetricReading,
} from "./MetricObjective.js";
export type { ResearchProgramMetadata } from "./ResearchProgram.js";
export type {
  ExperimentLoopConfig, AgentExperimentContext,
  WorkspaceCheckpointerLike,
} from "./ExperimentLoop.js";
export type {
  ResearchOrgConfig, ResearchAgentConfig,
  OrgStatus, AgentRunStatus,
} from "./ResearchOrg.js";
```

### EventBus Integration

Research event interfaces are added to `src/events/types.ts`. The `LifecycleEvent` union is extended with the 7 new research event types. No new event infrastructure — plugs into the existing `EventBus` from `src/events/bus.ts`.

### ONIModel Integration

`MetricObjective`'s LLM judge calls `anthropic()` from `src/models/anthropic.ts`. No direct API calls, no new auth handling.

### Swarm Compatibility

- `EvaluationCriterion` type referenced for future GAN loop integration — not imported.
- Pattern analysis replaces `PatternLearner` — same algorithm, cleaner integration via `ExperimentLedger`.
- `// TODO: wire ganLoop evaluator when ready` marks the future wiring point.

### Utilities

Research modules import from `src/harness/utils.ts`:
- `atomicWriteJSON` — ledger persistence
- `readJSON` — ledger loading
- `withFileLock` — concurrent ledger access
- `execGit` — worktree management, git reset
- `isGitAvailable` — graceful degradation
- `randomId` — experiment IDs
- `sanitizeForPrompt` — agent context injection safety

New utilities in `src/research/utils.ts` (module-specific):
- Cross-platform spawn wrapper for metric command execution
- Timeout wrapper using `AbortController`

---

## 9. Testing Strategy

One test file per module under `src/research/__tests__/`.

| Module | Key Test Cases |
|--------|---------------|
| **ExperimentLedger** | Atomic JSON writes survive crash simulation; TSV append matches JSON; `getTrend()` returns correct direction for improving/plateauing/regressing sequences; `identifyPatterns()` groups correctly with minimum sample enforcement; `suggestNext()` filters by success rate threshold |
| **MutationScope** | Allowed paths pass; disallowed paths throw `MutationScopeViolationError`; allowed commands pass; disallowed commands throw; strict vs permissive mode behavior; glob edge cases (nested, negated) |
| **MetricObjective** | Each extractor type returns correct value; `isBetter()` respects direction; `command-stdout-number` regex parsing; `file-json-path` traversal; LLM judge mock (mock `anthropic()` response) |
| **ExperimentLoop** | Mock agent + mock metric → improvement path keeps changes; regression path resets; timeout triggers `ExperimentTimeoutError`; plateau detection stops loop; `ExperimentLoopAlreadyRunningError` on double-run; events emitted in correct order |
| **ResearchProgram** | Parse all sections from well-formed markdown; missing section returns null; `summarize()` produces non-empty string; `initialize()` creates valid file; typo in heading still extracts via flexible matching |
| **ResearchOrg** | Worktree creation and cleanup; parallel execution via `Promise.allSettled`; direction-aware `getStatus()`; `onAnyImprovement` callback fires; cleanup removes worktrees |

Tests use the project's existing test infrastructure. Filesystem tests use `tmp` directories. Git tests use `git init` in temp dirs.
