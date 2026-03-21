import type { ToolPermissions } from "../tools/types.js";

export interface BudgetConfig {
  maxTokensPerAgent?: number;
  maxTokensPerRun?: number;
  maxCostPerRun?: number;
  onBudgetExceeded?: "interrupt" | "error" | "warn";
}

export interface ContentFilterResult {
  blocked: boolean;
  reason?: string;
  redacted?: string;
}

export interface ContentFilter {
  name: string;
  apply: "input" | "output" | "both";
  check: (content: string) => ContentFilterResult;
}

export interface GuardrailsConfig {
  toolPermissions?: ToolPermissions;
  budget?: BudgetConfig;
  filters?: ContentFilter[];
  audit?: boolean;
}

export interface AuditEntry {
  timestamp: number;
  agent: string;
  action: "llm.request" | "llm.response" | "tool.call" | "tool.result" | "filter.blocked" | "filter.redacted" | "budget.warning" | "budget.exceeded" | "budget.unknown_pricing";
  data: Record<string, unknown>;
}
