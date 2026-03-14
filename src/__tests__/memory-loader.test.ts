import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fsSync from "fs";
import * as pathSync from "path";
import * as os from "os";
import { MemoryLoader } from "../harness/memory-loader.js";
import type { MemoryUnit } from "../harness/memory-loader.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fsSync.mkdtempSync(pathSync.join(os.tmpdir(), "oni-memory-test-"));
});

afterEach(() => {
  fsSync.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(relPath: string, content: string): void {
  const abs = pathSync.join(tmpDir, relPath);
  fsSync.mkdirSync(pathSync.dirname(abs), { recursive: true });
  fsSync.writeFileSync(abs, content, "utf-8");
}

function soul(): string {
  return [
    "---",
    "type: identity",
    "tier: 0",
    "tags: soul, identity",
    "summary: Agent soul",
    "---",
    "",
    "# Soul",
    "I am a test agent.",
  ].join("\n");
}

function working(): string {
  return [
    "---",
    "type: working",
    "tier: 1",
    "tags: context, working",
    "summary: Working context",
    "---",
    "",
    "# Working Context",
    "Current task: test.",
  ].join("\n");
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("MemoryLoader", () => {
  // ── Construction ──────────────────────────────────────────────────────────

  describe("fromRoot()", () => {
    it("creates directory structure when root does not exist", () => {
      const root = pathSync.join(tmpDir, "nonexistent");
      const loader = MemoryLoader.fromRoot(root);
      expect(fsSync.existsSync(pathSync.join(root, "identity"))).toBe(true);
      expect(fsSync.existsSync(pathSync.join(root, "working"))).toBe(true);
      expect(fsSync.existsSync(pathSync.join(root, "episodic", "recent"))).toBe(true);
      expect(loader.stats().totalUnits).toBe(0);
    });

    it("scans existing files on construction", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("working/CONTEXT.md", working());
      const loader = MemoryLoader.fromRoot(tmpDir);
      expect(loader.stats().totalUnits).toBe(2);
    });

    it("skips INDEX.md files during scan", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("identity/INDEX.md", "---\ntype: index\n---\n");
      const loader = MemoryLoader.fromRoot(tmpDir);
      // Only SOUL.md should be registered
      expect(loader.stats().totalUnits).toBe(1);
    });
  });

  // ── Progressive Disclosure ────────────────────────────────────────────────

  describe("wake()", () => {
    it("loads only Tier 0 units", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("working/CONTEXT.md", working()); // T1 — should not be loaded
      const loader = MemoryLoader.fromRoot(tmpDir);
      const result = loader.wake();
      expect(result.units.every((u) => u.tier === 0)).toBe(true);
      expect(result.units.length).toBe(1);
    });

    it("populates content on loaded units", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      const result = loader.wake();
      expect(result.units[0]?.content).toBeDefined();
      expect(result.units[0]?.content).toContain("I am a test agent");
    });

    it("does not double-load units on second wake()", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      const r1 = loader.wake();
      const r2 = loader.wake();
      expect(r1.units.length).toBe(1);
      expect(r2.units.length).toBe(0); // already loaded
    });
  });

  describe("orient()", () => {
    it("loads Tier 1 units", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("working/CONTEXT.md", working());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      const result = loader.orient();
      expect(result.units.every((u) => u.tier === 1)).toBe(true);
      expect(result.units.length).toBeGreaterThanOrEqual(1);
    });

    it("is additive — wake units remain in loaded set", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("working/CONTEXT.md", working());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      loader.orient();
      expect(loader.stats().currentlyLoaded).toBe(2);
    });
  });

  describe("match(task)", () => {
    it("is additive — prior loaded units are not evicted", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("working/CONTEXT.md", working());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      loader.orient();
      loader.match("test task");
      // At minimum, T0+T1 units should still be loaded
      expect(loader.stats().currentlyLoaded).toBeGreaterThanOrEqual(2);
    });

    it("returns empty LoadResult for empty task string", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      const result = loader.match("");
      expect(result.units.length).toBe(0);
    });

    it("returns empty LoadResult for numeric-only task string", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      const result = loader.match("1234 5678");
      expect(result.units.length).toBe(0);
    });

    it("loads Tier 2 units that match task tags", () => {
      writeFile("procedural/typescript/notes.md", [
        "---",
        "type: procedural",
        "tier: 2",
        "tags: typescript, types, narrowing",
        "summary: TypeScript narrowing patterns",
        "---",
        "",
        "## TypeScript union narrowing",
        "Use discriminated unions for type safety.",
      ].join("\n"));
      const loader = MemoryLoader.fromRoot(tmpDir);
      const result = loader.match("typescript union type narrowing");
      expect(result.units.length).toBeGreaterThanOrEqual(1);
      expect(result.units[0]?.type).toBe("procedural");
    });

    it("drops units that score below matchThreshold", () => {
      writeFile("procedural/cooking/notes.md", [
        "---",
        "type: procedural",
        "tier: 2",
        "tags: cooking, recipes, food",
        "summary: Cooking tips",
        "---",
        "",
        "# Cooking",
        "How to make pasta.",
      ].join("\n"));
      const loader = MemoryLoader.fromRoot(tmpDir);
      // "typescript code" should not match "cooking recipes food"
      const result = loader.match("typescript code review");
      expect(result.units.length).toBe(0);
    });

    it("puts over-budget units in dropped", () => {
      // Create enough procedural units to exceed T2 budget (4000t default)
      for (let i = 0; i < 5; i++) {
        const content = "x".repeat(4000); // ~1000 tokens each
        writeFile(`procedural/item${i}/notes.md`, [
          "---",
          "type: procedural",
          "tier: 2",
          `tags: typescript, code, item${i}`,
          "summary: A large procedural unit",
          "---",
          "",
          content,
        ].join("\n"));
      }
      const loader = MemoryLoader.fromRoot(tmpDir);
      const result = loader.match("typescript code");
      // Some should be dropped due to budget
      expect(result.dropped.length).toBeGreaterThan(0);
    });
  });

  describe("resetSession()", () => {
    it("clears the loaded set", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      expect(loader.stats().currentlyLoaded).toBe(1);
      loader.resetSession();
      expect(loader.stats().currentlyLoaded).toBe(0);
    });

    it("allows re-loading after reset (additive contract resets)", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      loader.resetSession();
      const result = loader.wake();
      expect(result.units.length).toBe(1);
    });
  });

  // ── Context Assembly ──────────────────────────────────────────────────────

  describe("buildSystemPrompt()", () => {
    it("includes content from loaded units", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      const prompt = loader.buildSystemPrompt([0]);
      expect(prompt).toContain("I am a test agent");
    });

    it("returns empty string when nothing is loaded", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      expect(loader.buildSystemPrompt([0, 1, 2])).toBe("");
    });
  });

  describe("getLoadedManifest()", () => {
    it("returns one line per loaded unit in correct format", () => {
      writeFile("identity/SOUL.md", soul());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      const manifest = loader.getLoadedManifest();
      const lines = manifest.split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      // Format: "- <key> (T<tier>, <cost>t)"
      expect(lines[0]).toMatch(/^- .+ \(T\d, \d+t\)$/);
    });
  });

  // ── Write API ─────────────────────────────────────────────────────────────

  describe("persist()", () => {
    it("writes file to disk", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.persist("working", "CONTEXT.md", "# Context\nSome notes.");
      const absPath = pathSync.join(tmpDir, "working", "CONTEXT.md");
      expect(fsSync.existsSync(absPath)).toBe(true);
    });

    it("returns MemoryUnit with content populated", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      const unit = loader.persist("working", "CONTEXT.md", "# Context\nSome notes.");
      expect(unit.content).toBeDefined();
      expect(unit.content).toContain("Some notes");
    });

    it("registers the unit so subsequent load() works", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.persist("working", "NOTES.md", "# Notes\nImportant stuff.");
      const unit = loader.load(pathSync.join("working", "NOTES.md"));
      expect(unit).not.toBeNull();
    });

    it("rebuilds INDEX.md when autoIndex is true (default)", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.persist("working", "CONTEXT.md", "# Context\nSome notes.");
      const indexPath = pathSync.join(tmpDir, "working", "INDEX.md");
      expect(fsSync.existsSync(indexPath)).toBe(true);
      const indexContent = fsSync.readFileSync(indexPath, "utf-8");
      expect(indexContent).toContain("CONTEXT.md");
    });
  });

  describe("persistEpisodic()", () => {
    it("creates date-stamped file in episodic/recent/", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.persistEpisodic("ses_abc", "# Session\nDid some work.");
      const recentDir = pathSync.join(tmpDir, "episodic", "recent");
      const files = fsSync.readdirSync(recentDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}_ses_abc\.md$/);
    });
  });

  describe("persistSemantic()", () => {
    it("writes to semantic/<domain>/<topic>.md", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.persistSemantic("typescript", "discriminated-unions", [
        "---",
        "type: semantic",
        "tier: 3",
        "tags: typescript, discriminated, unions",
        "summary: Discriminated union patterns",
        "---",
        "",
        "# Discriminated Unions",
        "Use a shared literal field to narrow union members.",
      ].join("\n"));
      const expectedPath = pathSync.join(tmpDir, "semantic", "typescript", "discriminated-unions.md");
      expect(fsSync.existsSync(expectedPath)).toBe(true);
    });

    it("rebuilds root semantic INDEX.md", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.persistSemantic("typescript", "discriminated-unions", "# DU\nContent.");
      const indexPath = pathSync.join(tmpDir, "semantic", "INDEX.md");
      expect(fsSync.existsSync(indexPath)).toBe(true);
    });

    it("returns MemoryUnit with content populated", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      const unit = loader.persistSemantic("typescript", "narrowing", "# Narrowing\nContent here.");
      expect(unit.content).toBeDefined();
      expect(unit.content).toContain("Narrowing");
    });
  });

  describe("rebuildIndex()", () => {
    it("writes valid INDEX.md with frontmatter and table", () => {
      writeFile("working/CONTEXT.md", working());
      const loader = MemoryLoader.fromRoot(tmpDir);
      const workingDir = pathSync.join(tmpDir, "working");
      loader.rebuildIndex(workingDir);
      const indexPath = pathSync.join(workingDir, "INDEX.md");
      const content = fsSync.readFileSync(indexPath, "utf-8");
      expect(content).toContain("type: index");
      expect(content).toContain("CONTEXT.md");
      expect(content).toContain("## Routing Hints");
    });
  });

  // ── Diagnostic ────────────────────────────────────────────────────────────

  describe("stats()", () => {
    it("returns correct unit counts by type and tier", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("working/CONTEXT.md", working());
      const loader = MemoryLoader.fromRoot(tmpDir);
      loader.wake();
      const s = loader.stats();
      expect(s.totalUnits).toBe(2);
      expect(s.currentlyLoaded).toBe(1); // only wake() was called
      expect((s.byType as Record<string, number>)["identity"]).toBe(1);
      expect((s.byType as Record<string, number>)["working"]).toBe(1);
    });
  });

  // ── Tool ─────────────────────────────────────────────────────────────────

  describe("getQueryTool()", () => {
    it("returns a ToolDefinition named memory_query", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      const tool = loader.getQueryTool();
      expect(tool.name).toBe("memory_query");
      expect(tool.schema.required).toContain("topic");
      expect(tool.schema.required).toContain("reason");
    });

    it("execute() returns found:false when no units match", () => {
      const loader = MemoryLoader.fromRoot(tmpDir);
      const tool = loader.getQueryTool();
      const result = tool.execute(
        { topic: "completely unrelated nonsense xyz", reason: "testing" },
        {} as any,
      );
      expect((result as any).found).toBe(false);
    });

    it("execute() returns found:true with units when match exists", () => {
      writeFile("semantic/ts/discriminated-unions.md", [
        "---",
        "type: semantic",
        "tier: 3",
        "tags: typescript, discriminated, unions",
        "triggers: discriminated union, union type",
        "summary: TypeScript discriminated unions",
        "---",
        "",
        "# Discriminated Unions",
        "Use a shared literal field to discriminate union members.",
      ].join("\n"));
      const loader = MemoryLoader.fromRoot(tmpDir);
      const tool = loader.getQueryTool();
      const result = tool.execute(
        { topic: "typescript discriminated union", reason: "need to implement union type" },
        {} as any,
      );
      expect((result as any).found).toBe(true);
      expect((result as any).units.length).toBeGreaterThanOrEqual(1);
      expect(typeof (result as any).droppedCount).toBe("number");
    });

    it("execute() does not use the reason field (prompting-only)", () => {
      // Providing a reason that conflicts with topic should not affect results
      const loader = MemoryLoader.fromRoot(tmpDir);
      const tool = loader.getQueryTool();
      const withReason = tool.execute(
        { topic: "nothing exists here", reason: "typescript union type" }, // reason has better tags
        {} as any,
      );
      expect((withReason as any).found).toBe(false); // only topic matters
    });
  });

  describe("loadType()", () => {
    it("loads all units of the given type regardless of tier", () => {
      writeFile("identity/SOUL.md", soul());
      writeFile("identity/CONSTRAINTS.md", [
        "---\ntype: identity\ntier: 0\ntags: constraints\nsummary: Hard rules\n---\n",
        "# Constraints\nDo not harm.",
      ].join(""));
      const loader = MemoryLoader.fromRoot(tmpDir);
      const result = loader.loadType("identity");
      expect(result.units.length).toBe(2);
    });
  });
});
