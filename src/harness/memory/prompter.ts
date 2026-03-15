// ============================================================
// @oni.bot/core/harness/memory — prompter
//
// System prompt assembly from loaded memory units.
// ============================================================

import type { MemoryTier, MemoryUnit } from "./types.js";

/**
 * buildSystemPrompt — Assemble loaded units into a system prompt string.
 * Default tiers: [0, 1, 2]
 */
export function buildSystemPrompt(
  units: Map<string, MemoryUnit>,
  loaded: Set<string>,
  tiers: MemoryTier[] = [0, 1, 2],
): string {
  const sections: string[] = [];
  for (const [key, unit] of units) {
    if (!loaded.has(key)) continue;
    if (!tiers.includes(unit.tier)) continue;
    if (!unit.content) continue;
    const header = `\n\n<!-- MEMORY: ${unit.type.toUpperCase()} | ${unit.key} | T${unit.tier} -->\n`;
    sections.push(header + unit.content);
  }
  return sections.join("");
}
