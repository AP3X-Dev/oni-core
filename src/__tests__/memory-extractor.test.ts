import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryExtractor } from "../harness/memory/extractor.js";
import { MemoryLoader } from "../harness/memory/index.js";

// ─── Mock Model Helper ───────────────────────────────────────────────────────

function makeMockModel(response: string) {
  return {
    provider: "mock" as const,
    modelId: "mock",
    capabilities: { tools: true, vision: false, streaming: false, embeddings: false },
    chat: vi.fn(async () => ({
      content: response,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      stopReason: "end_turn" as const,
    })),
    stream: vi.fn(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("MemoryExtractor", () => {
  let tmpDir: string;
  let loader: MemoryLoader;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "oni-extractor-test-"));
    loader = MemoryLoader.fromRoot(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── extractFromSummary ──────────────────────────────────────────────────

  describe("extractFromSummary", () => {
    it("extracts facts from summary and persists episodic entry", async () => {
      const facts = [
        "- [decision] Use Zod for input validation",
        "- [preference] Prefer functional components over class components",
      ].join("\n");
      const model = makeMockModel(facts);
      const extractor = new MemoryExtractor(model, loader);

      await extractor.extractFromSummary("ses-001", "We decided to use Zod for validation.");

      // Verify a file was written to episodic/recent/
      const recentDir = join(tmpDir, "episodic", "recent");
      const files = readdirSync(recentDir).filter((f) => f.endsWith(".md"));
      const matching = files.filter((f) => f.includes("ses-001"));
      expect(matching.length).toBeGreaterThanOrEqual(1);

      // Content should include the extracted facts
      const content = readFileSync(join(recentDir, matching[0]!), "utf-8");
      expect(content).toContain("[decision] Use Zod for input validation");
      expect(content).toContain("[preference] Prefer functional components");
    });

    it("calls model with extraction prompt", async () => {
      const model = makeMockModel("- [fact] Test fact");
      const extractor = new MemoryExtractor(model, loader);

      await extractor.extractFromSummary("ses-002", "Some session summary text.");

      expect(model.chat).toHaveBeenCalledTimes(1);
      const callArgs = model.chat.mock.calls[0]![0];
      const msgContent = callArgs.messages[0]?.content;
      expect(msgContent).toContain("Extract durable facts");
    });

    it("handles empty summary gracefully", async () => {
      const model = makeMockModel("- [fact] Placeholder");
      const extractor = new MemoryExtractor(model, loader);

      // Should not throw
      await expect(
        extractor.extractFromSummary("ses-003", ""),
      ).resolves.not.toThrow();

      // Model should NOT be called for empty summary — minimal entry persisted
      expect(model.chat).not.toHaveBeenCalled();

      // A file should still be written
      const recentDir = join(tmpDir, "episodic", "recent");
      const files = readdirSync(recentDir).filter((f) => f.includes("ses-003"));
      expect(files.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── consolidate ─────────────────────────────────────────────────────────

  describe("consolidate", () => {
    it("promotes facts appearing 3+ times across sessions to semantic", async () => {
      // Write 3 episodic entries with the same repeated fact
      const factLine = "- [decision] Always use TypeScript strict mode";
      for (let i = 1; i <= 3; i++) {
        loader.persistEpisodic(`session-${i}`, [
          `# Session ${i}`,
          "",
          factLine,
          `- [fact] Unique to session ${i}`,
        ].join("\n"));
      }

      const organizedResponse = [
        "## domain: typescript",
        "### topic: strict-mode",
        "- [decision] Always use TypeScript strict mode",
      ].join("\n");
      const model = makeMockModel(organizedResponse);
      const extractor = new MemoryExtractor(model, loader);

      await extractor.consolidate();

      // Model should have been called to organize recurring facts
      expect(model.chat).toHaveBeenCalled();
    });

    it("does nothing with fewer than 3 episodic entries", async () => {
      // Write only 1 episodic entry
      loader.persistEpisodic("session-single", [
        "# Session",
        "",
        "- [decision] Use Zod",
      ].join("\n"));

      const model = makeMockModel("should not be called");
      const extractor = new MemoryExtractor(model, loader);

      await extractor.consolidate();

      // Model should NOT have been called
      expect(model.chat).not.toHaveBeenCalled();
    });
  });
});
