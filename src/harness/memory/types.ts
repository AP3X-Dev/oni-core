// ============================================================
// @oni.bot/core/harness/memory — types
//
// All public and internal types for the MemoryLoader system.
// ============================================================

export type MemoryTier = 0 | 1 | 2 | 3;

export type MemoryType =
  | "identity"
  | "working"
  | "procedural"
  | "episodic"
  | "semantic"
  | "user";

export interface MemoryUnit {
  /** Relative path from memory root, e.g. "procedural/pptx/notes.md" */
  key: string;
  /** Absolute path on disk */
  path: string;
  type: MemoryType;
  tier: MemoryTier;
  /** From frontmatter; fallback: h2 headings + first-line keywords (≤5) */
  tags: string[];
  /** From frontmatter; fallback: first non-heading paragraph (≤120 chars) */
  summary: string;
  /** Math.ceil(content.length / 4) */
  tokenCost: number;
  /** Natural language patterns that trigger this unit */
  triggers: string[];
  /** ISO mtime */
  updatedAt: string;
  /** Absent after scan(); populated after hydrate() or persist() */
  content?: string;
}

export interface LoadResult {
  units: MemoryUnit[];
  totalTokens: number;
  budget: number;
  /** Candidates that exceeded the budget (content NOT hydrated) */
  dropped: MemoryUnit[];
}

export interface MemoryLoaderConfig {
  root: string;
  /** Default: { 0: 800, 1: 2000, 2: 4000, 3: 8000 } */
  budgets?: Partial<Record<MemoryTier, number>>;
  /** Days to keep episodic sessions in recent/ before archiving. Default: 7 */
  episodicRecentDays?: number;
  /** Auto-rebuild INDEX.md after every persist(). Default: true */
  autoIndex?: boolean;
  /** Minimum relevance score (0–1) for match()/query(). Default: 0.2 */
  matchThreshold?: number;
  debug?: boolean;
}

/** Internal frontmatter type — NOT exported as MemoryFrontmatter */
export interface Frontmatter {
  type?: MemoryType;
  tier?: MemoryTier;
  tags?: string[];
  summary?: string;
  triggers?: string[];
}
