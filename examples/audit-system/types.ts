// ── Finding types ────────────────────────────────────────

export type Severity = "critical" | "warning" | "info";

export type Category =
  | "security"
  | "error-handling"
  | "types"
  | "performance"
  | "code-smell"
  | "architecture"
  | "testing"
  | "documentation";

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  file: string;
  line?: number;
  issue: string;
  suggestion?: string;
  source: "ast" | "llm";
  verified?: boolean;
  confidence?: number;
  verifyReason?: string;
}

// ── Diff types ───────────────────────────────────────────

export interface DiffResult {
  files: string[];
  mode: "diff" | "full";
  baseBranch?: string;
}

// ── Suppression types ────────────────────────────────────

export interface SuppressionRule {
  filePattern: string;
  category: Category | "*";
  line?: number;
}

// ── Report types ─────────────────────────────────────────

export type ReportFormat = "console" | "json" | "sarif";

export interface AuditReport {
  target: string;
  mode: "diff" | "full";
  duration: number;
  filesAnalyzed: string[];
  findings: Finding[];
  suppressed: number;
  rejected: number;
  timestamp: string;
}

// ── Config ───────────────────────────────────────────────

export interface AuditConfig {
  targetDir: string;
  mode: "diff" | "full";
  format: ReportFormat;
  baseBranch: string;
  verify: boolean;
  ignoreFile: string;
  model: string;
}

// ── Helpers ──────────────────────────────────────────────

let _counter = 0;
export function findingId(): string {
  return `f_${Date.now().toString(36)}_${(++_counter).toString(36)}`;
}
