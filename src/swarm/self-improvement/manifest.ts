// ============================================================
// @oni.bot/core/swarm/self-improvement — ObjectiveManifest
// Human-written strategy loaded at agent startup.
// Stored as memory/identity/MANIFEST.md — agents read at wake().
// ============================================================

export interface ManifestGoal {
  metric: string;
  target: number;
  direction: "minimize" | "maximize";
}

export interface ObjectiveManifest {
  goals: ManifestGoal[];
  constraints: string[];
  preferredPatterns: string[];
  forbiddenActions: string[];
  explorationBudget: number;
}

const DEFAULT_MANIFEST: ObjectiveManifest = {
  goals: [],
  constraints: [],
  preferredPatterns: [],
  forbiddenActions: [],
  explorationBudget: 0.1,
};

/**
 * Parse an ObjectiveManifest from a MANIFEST.md frontmatter block.
 * Falls back to defaults if parsing fails.
 */
export function parseManifest(content: string): ObjectiveManifest {
  try {
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
    if (!fmMatch) return DEFAULT_MANIFEST;
    const fm = fmMatch[1]!;
    const manifest: Partial<ObjectiveManifest> = {};

    // Parse goals: lines like "- metric: latency, target: 0.5, direction: minimize"
    const goalsMatch = /goals:([\s\S]*?)(?=\n[a-z]|$)/i.exec(fm);
    if (goalsMatch) {
      const goalLines = goalsMatch[1]!.split("\n").filter(l => l.trim().startsWith("-"));
      manifest.goals = goalLines.map(line => {
        const m = /metric:\s*(\S+).*?target:\s*([\d.]+).*?direction:\s*(\S+)/.exec(line);
        if (!m) return null;
        return {
          metric: m[1]!,
          target: parseFloat(m[2]!),
          direction: m[3] as "minimize" | "maximize",
        };
      }).filter(Boolean) as ManifestGoal[];
    }

    // Parse simple array fields
    for (const field of ["constraints", "preferredPatterns", "forbiddenActions"] as const) {
      const fieldMatch = new RegExp(`${field}:([\\s\\S]*?)(?=\\n[a-z]|$)`, "i").exec(fm);
      if (fieldMatch) {
        manifest[field] = fieldMatch[1]!
          .split("\n")
          .filter(l => l.trim().startsWith("-"))
          .map(l => l.replace(/^\s*-\s*/, "").replace(/^["']|["']$/g, "").trim());
      }
    }

    // Parse explorationBudget
    const budgetMatch = /explorationBudget:\s*([\d.]+)/.exec(fm);
    if (budgetMatch) manifest.explorationBudget = parseFloat(budgetMatch[1]!);

    return { ...DEFAULT_MANIFEST, ...manifest };
  } catch {
    return DEFAULT_MANIFEST;
  }
}

/**
 * Load manifest from a file path. Returns defaults if file doesn't exist.
 * Uses dynamic import of fs/promises to avoid bundler issues.
 */
export async function loadManifest(manifestPath: string): Promise<ObjectiveManifest> {
  try {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(manifestPath, "utf-8");
    return parseManifest(content);
  } catch {
    return DEFAULT_MANIFEST;
  }
}
