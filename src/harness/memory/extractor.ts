// ============================================================
// @oni.bot/core/harness/memory — MemoryExtractor
//
// Automatic fact extraction from session summaries and
// consolidation of recurring facts into semantic memory.
// ============================================================

import type { ONIModel } from "../../models/types.js";
import type { MemoryLoader } from "./index.js";

// ─── Category types ──────────────────────────────────────────────────────────

const FACT_CATEGORIES = ["decision", "preference", "fact", "pattern", "warning"] as const;
const FACT_LINE_RE = new RegExp(
  `^- \\[(${FACT_CATEGORIES.join("|")})\\]\\s+(.+)$`,
  "m",
);

// ─── MemoryExtractor ─────────────────────────────────────────────────────────

export class MemoryExtractor {
  private readonly model: ONIModel;
  private readonly loader: MemoryLoader;

  constructor(model: ONIModel, loader: MemoryLoader) {
    this.model = model;
    this.loader = loader;
  }

  // ── extractFromSummary ──────────────────────────────────────────────────

  /**
   * Extract durable facts from a session summary and persist as an episodic entry.
   *
   * If the summary is empty, persists a minimal entry without calling the model.
   * Otherwise, asks the model to extract facts in the format:
   *   - [category] Concise fact statement
   */
  async extractFromSummary(sessionId: string, summary: string): Promise<void> {
    if (!summary || summary.trim().length === 0) {
      this.loader.persistEpisodic(sessionId, [
        "# Extracted Facts",
        "",
        "No durable facts extracted.",
      ].join("\n"));
      return;
    }

    const response = await this.model.chat({
      messages: [
        {
          role: "user",
          content: [
            "Extract durable facts from this session summary.",
            "Return each fact on its own line in this exact format:",
            "- [category] Concise fact statement",
            "",
            `Valid categories: ${FACT_CATEGORIES.join(", ")}`,
            "",
            "Rules:",
            "- Only extract facts worth remembering across sessions.",
            "- Omit trivial observations and routine actions.",
            "- Be concise — one sentence per fact.",
            "",
            "Session summary:",
            summary,
          ].join("\n"),
        },
      ],
    });

    const facts = response.content.trim();

    this.loader.persistEpisodic(sessionId, [
      "# Extracted Facts",
      "",
      facts,
    ].join("\n"));
  }

  // ── consolidate ─────────────────────────────────────────────────────────

  /**
   * Scan episodic entries for recurring facts and promote them to semantic memory.
   *
   * Only calls the model if 3+ episodic entries exist and at least one fact
   * appears across 3+ distinct sessions.
   */
  async consolidate(): Promise<void> {
    const result = this.loader.loadType("episodic");

    if (result.units.length < 3) {
      return;
    }

    // Extract fact lines from each entry, keyed by session
    const factsBySession = new Map<string, string[]>();

    for (const unit of result.units) {
      const content = unit.content ?? "";
      const sessionMatch = content.match(/session:\s*(\S+)/);
      const sessionKey = sessionMatch?.[1] ?? unit.key;

      const lines = content.split("\n");
      const facts: string[] = [];

      for (const line of lines) {
        if (FACT_LINE_RE.test(line.trim())) {
          facts.push(line.trim());
        }
      }

      if (facts.length > 0) {
        factsBySession.set(sessionKey, facts);
      }
    }

    // Group by normalized content (lowercase, strip category tag)
    const factCounts = new Map<string, { original: string; sessions: Set<string> }>();

    for (const [session, facts] of factsBySession) {
      for (const fact of facts) {
        const normalized = fact
          .replace(/^- \[(decision|preference|fact|pattern|warning)\]\s+/i, "")
          .toLowerCase()
          .trim();

        const existing = factCounts.get(normalized);
        if (existing) {
          existing.sessions.add(session);
        } else {
          factCounts.set(normalized, { original: fact, sessions: new Set([session]) });
        }
      }
    }

    // Filter to facts appearing in 3+ distinct sessions
    const recurring = [...factCounts.values()].filter(
      (entry) => entry.sessions.size >= 3,
    );

    if (recurring.length === 0) {
      return;
    }

    // Ask model to organize recurring facts into semantic entries
    const factList = recurring.map((r) => r.original).join("\n");

    const response = await this.model.chat({
      messages: [
        {
          role: "user",
          content: [
            "Organize these recurring facts into semantic knowledge entries.",
            "Group related facts under domain/topic headings using this format:",
            "",
            "## domain: <domain-name>",
            "### topic: <topic-name>",
            "- [category] Fact statement",
            "",
            "Facts to organize:",
            factList,
          ].join("\n"),
        },
      ],
    });

    // Parse response and persist semantic entries
    const text = response.content;
    const domainBlocks = text.split(/^## domain:\s*/m).filter(Boolean);

    for (const block of domainBlocks) {
      const lines = block.split("\n");
      const domain = lines[0]?.trim() ?? "general";

      const topicBlocks = block.split(/^### topic:\s*/m).filter(Boolean);

      // Skip the first split result if it's the domain line itself
      for (const topicBlock of topicBlocks) {
        const topicLines = topicBlock.split("\n");
        const topic = topicLines[0]?.trim() ?? "general";

        // Skip if this is just the domain line
        if (topic === domain && !topicBlock.includes("- [")) continue;

        const factLines = topicLines
          .filter((l) => FACT_LINE_RE.test(l.trim()))
          .map((l) => l.trim());

        if (factLines.length > 0) {
          const content = [
            `# ${topic}`,
            "",
            ...factLines,
          ].join("\n");

          this.loader.persistSemantic(domain, topic, content);
        }
      }
    }
  }
}
