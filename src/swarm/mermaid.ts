// ============================================================
// @oni.bot/core/swarm — Swarm Mermaid Diagram Generator
// ============================================================
// Generates Mermaid diagrams from an AgentRegistry, showing
// agent roles, capabilities, status, and live stats.
// ============================================================

import type { AgentRegistry } from "./registry.js";
import type { AgentStatus } from "./types.js";

// ----------------------------------------------------------------
// Status → style mapping
// ----------------------------------------------------------------
// Note: "terminated" is intentionally absent — AgentRegistry.manifest()
// filters terminated agents before returning entries, so this function
// never receives a terminated entry. The Partial type reflects that.

const STATUS_STYLES: Partial<Record<AgentStatus, string>> = {
  idle:  "fill:#10b981,color:#fff",   // green
  busy:  "fill:#3b82f6,color:#fff",   // blue
  error: "fill:#ef4444,color:#fff",   // red
};

// ----------------------------------------------------------------
// Sanitize user-supplied strings for safe embedding in Mermaid HTML labels
// ----------------------------------------------------------------

const sanitize = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\n\r]/g, " ")
    .replace(/\|/g, "\\|");

// ----------------------------------------------------------------
// toSwarmMermaid
// ----------------------------------------------------------------

/**
 * Generate a Mermaid graph diagram from an AgentRegistry.
 * Shows agent nodes with role labels, capabilities, status coloring,
 * and live stats (active tasks, errors).
 *
 * Terminated agents are excluded by {@link AgentRegistry.manifest} before
 * this function receives them.
 */
export function toSwarmMermaid(registry: AgentRegistry): string {
  const entries = registry.manifest();
  const lines: string[] = ["graph TD"];

  for (const entry of entries) {
    const nodeId = sanitizeId(entry.id);

    // Build label: role + capabilities + stats
    const parts: string[] = [
      `<b>${sanitize(entry.role)}</b>`,
    ];

    if (entry.capabilities.length > 0) {
      const caps = entry.capabilities.map((c) => sanitize(c.name)).join(", ");
      parts.push(`<i>${caps}</i>`);
    }

    const stats: string[] = [];
    if (entry.activeTasks > 0) stats.push(`${entry.activeTasks} active`);
    if (entry.errors > 0) stats.push(`${entry.errors} err`);
    if (stats.length > 0) {
      parts.push(stats.join(" | "));
    }

    const label = parts.join("<br/>").replace(/"/g, "#quot;").replace(/\[/g, "#lsqb;").replace(/\]/g, "#rsqb;");
    lines.push(`    ${nodeId}["${label}"]`);

    // Style by status
    const style = STATUS_STYLES[entry.status];
    if (style) {
      lines.push(`    style ${nodeId} ${style}`);
    }
  }

  return lines.join("\n");
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/** Sanitize an agent ID for use as a Mermaid node ID (no spaces/special chars). */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
