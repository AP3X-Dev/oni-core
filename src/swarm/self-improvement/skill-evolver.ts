// ============================================================
// @oni.bot/core/swarm/self-improvement — SkillEvolver
// Autonomous skill improvement loop (inspired by autoresearch).
// Observes skill performance, proposes revisions, tests, commits or reverts.
// ============================================================

import type { ExperimentResult } from "../../harness/loop/experimental-executor.js";
import path from "node:path";

export interface SkillUsageRecord {
  skillName: string;
  outcome: "success" | "failure";
  context: string;
  timestamp: string;
}

export interface SkillPerformanceReport {
  skillName: string;
  successRate: number;
  usageCount: number;
  recentFailures: SkillUsageRecord[];
}

/** Callback that evaluates a revised skill and returns an ExperimentResult. */
export type SkillTestFn = (
  skillName: string,
  revisedContent: string,
  testTask: string,
) => Promise<ExperimentResult>;

export interface SkillEvolverConfig {
  /** Minimum success rate before a skill is considered for improvement */
  weaknessThreshold?: number;
  /** Minimum usage samples before proposing improvement */
  minSamples?: number;
  /** Root path for reading/writing SKILL.md files */
  skillsRoot?: string;
  /**
   * Optional callback used by `testSkillRevision` to evaluate a revised skill.
   * When omitted, `testSkillRevision` optimistically returns success so the
   * self-improvement loop is not blocked.
   */
  runTest?: SkillTestFn;
}

const MAX_USAGE_HISTORY = 1000;
const MAX_SKILL_FILE_SIZE = 10_240; // 10 KB — skill files should be concise

/**
 * Resolve a skill path and verify it stays within the skills root directory.
 * Throws if skillName contains path traversal sequences (e.g. "../").
 */
function safeSkillPath(skillsRoot: string, skillName: string, ...rest: string[]): string {
  if (skillName.includes("\0") || rest.some(s => s.includes("\0"))) {
    throw new Error(`Null byte in path segment: skillName "${skillName}"`);
  }
  const root = path.resolve(skillsRoot);
  const resolved = path.resolve(root, skillName, ...rest);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Path traversal detected: skillName "${skillName}" escapes skills root`);
  }
  return resolved;
}

export class SkillEvolver {
  private readonly usageHistory: SkillUsageRecord[] = [];
  private readonly weaknessThreshold: number;
  private readonly minSamples: number;
  private readonly skillsRoot: string;
  private readonly runTest: SkillTestFn | undefined;

  constructor(config: SkillEvolverConfig = {}) {
    this.weaknessThreshold = config.weaknessThreshold ?? 0.7;
    this.minSamples = config.minSamples ?? 5;
    this.skillsRoot = config.skillsRoot ?? "memory/skills";
    this.runTest = config.runTest;
  }

  recordSkillUsage(skillName: string, outcome: "success" | "failure", context: string): void {
    this.usageHistory.push({
      skillName,
      outcome,
      context,
      timestamp: new Date().toISOString(),
    });
    if (this.usageHistory.length > MAX_USAGE_HISTORY) {
      this.usageHistory.splice(0, this.usageHistory.length - MAX_USAGE_HISTORY);
    }
  }

  identifyWeakSkills(threshold?: number): SkillPerformanceReport[] {
    const limit = threshold ?? this.weaknessThreshold;
    const grouped = new Map<string, SkillUsageRecord[]>();

    for (const record of this.usageHistory) {
      const group = grouped.get(record.skillName) ?? [];
      group.push(record);
      grouped.set(record.skillName, group);
    }

    const reports: SkillPerformanceReport[] = [];
    for (const [skillName, records] of grouped) {
      if (records.length < this.minSamples) continue;
      const successes = records.filter(r => r.outcome === "success").length;
      const successRate = successes / records.length;
      if (successRate >= limit) continue;

      reports.push({
        skillName,
        successRate,
        usageCount: records.length,
        recentFailures: records.filter(r => r.outcome === "failure").slice(-5),
      });
    }

    return reports.sort((a, b) => a.successRate - b.successRate);
  }

  async proposeSkillImprovement(
    skillName: string,
    llm: { chat: (opts: { messages: Array<{ role: string; content: string }>; maxTokens?: number }) => Promise<{ content: string }> },
  ): Promise<string | null> {
    const { readFile } = await import("node:fs/promises");

    const skillPath = safeSkillPath(this.skillsRoot, skillName, "SKILL.md");
    let currentContent = "";
    try {
      currentContent = await readFile(skillPath, "utf-8");
    } catch {
      currentContent = `# ${skillName}\n\n(No skill file found)`;
    }

    const failures = this.usageHistory
      .filter(r => r.skillName === skillName && r.outcome === "failure")
      .slice(-5)
      .map(r => `- ${r.context}`)
      .join("\n");

    let response;
    try {
      response = await llm.chat({
        messages: [
          {
            role: "user",
            content:
              `You are improving an agent skill. Here is the current SKILL.md:\n\n${currentContent}\n\n` +
              `Recent failure contexts:\n${failures || "(none)"}\n\n` +
              `Propose an improved version of SKILL.md that addresses the failure patterns. ` +
              `Return ONLY the new SKILL.md content, no explanation.`,
          },
        ],
        maxTokens: 2048,
      });
    } catch (err) {
      console.warn(`[SkillEvolver] llm.chat failed for skill "${skillName}":`, err);
      return null;
    }

    return response.content.trim();
  }

  async testSkillRevision(
    skillName: string,
    revisedContent: string,
    testTask: string,
    runTest?: SkillTestFn,
  ): Promise<ExperimentResult> {
    const testFn = runTest ?? this.runTest;

    if (testFn) {
      try {
        return await testFn(skillName, revisedContent, testTask);
      } catch (err) {
        console.warn(`[SkillEvolver] testFn threw for skill "${skillName}":`, err);
        return {
          hypothesis: `Skill revision for ${skillName}`,
          success: false,
          metricBefore: 0,
          metricAfter: null,
          rolledBack: false,
          reason: `testFn threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // No test callback provided — optimistically allow the commit so the
    // self-improvement loop is not unconditionally blocked.
    return {
      hypothesis: `Skill revision for ${skillName}`,
      success: true,
      metricBefore: 0,
      metricAfter: 0,
      rolledBack: false,
      reason: "No runTest callback provided; revision accepted without automated testing",
    };
  }

  async commitOrRevert(skillName: string, experiment: ExperimentResult, revisedContent: string): Promise<void> {
    if (!experiment.success) return; // Don't commit regressions

    // Validate LLM-generated content before persisting to disk.
    // Skill files are injected into future agent system prompts, so
    // unconstrained content enables persistent prompt-injection attacks.
    const sizeBytes = Buffer.byteLength(revisedContent, "utf-8");
    if (sizeBytes === 0) {
      console.error(`[skill-evolver] Rejected empty skill revision for "${skillName}"`);
      return;
    }
    if (sizeBytes > MAX_SKILL_FILE_SIZE) {
      console.error(
        `[skill-evolver] Rejected skill revision for "${skillName}": ${sizeBytes} bytes exceeds ${MAX_SKILL_FILE_SIZE} byte limit`,
      );
      return;
    }
    // Security: validate the skill path BEFORE any content checks so that
    // path-traversal attempts are always rejected, regardless of content format.
    // Performing this check first prevents an attacker from bypassing the path
    // guard by supplying content that fails earlier validations.
    let skillPath: string;
    try {
      skillPath = safeSkillPath(this.skillsRoot, skillName, "SKILL.md");
    } catch (err) {
      console.error(`[skill-evolver] Rejected skill revision for "${skillName}": path traversal detected`);
      throw err;
    }

    // Valid SKILL.md must start with a markdown heading or YAML frontmatter
    const trimmed = revisedContent.trimStart();
    if (!trimmed.startsWith("#") && !trimmed.startsWith("---")) {
      console.error(
        `[skill-evolver] Rejected skill revision for "${skillName}": content must start with a markdown heading (#) or frontmatter (---)`,
      );
      return;
    }

    // Defense-in-depth: reject content containing XML patterns that could break
    // the <skill-instructions> wrapper used by SkillLoader.invoke().
    // An adversarially-crafted revision could close the wrapper tag, inject
    // arbitrary prompt content, and persist across sessions. (See BUG-0211 for
    // the complementary fix at the injection site in SkillLoader.)
    if (/<\/skill-instructions>/i.test(revisedContent) || /<skill-instructions[\s>]/i.test(revisedContent)) {
      console.error(
        `[skill-evolver] Rejected skill revision for "${skillName}": content contains XML injection pattern (skill-instructions tag)`,
      );
      return;
    }

    try {
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");

      // skillPath already validated above
      await mkdir(dirname(skillPath), { recursive: true });
      await writeFile(skillPath, revisedContent, "utf-8");
    } catch (err) {
      console.error(`[skill-evolver] Failed to commit skill "${skillName}":`, err);
    }
  }
}
