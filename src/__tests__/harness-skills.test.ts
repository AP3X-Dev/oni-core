import { describe, it, expect } from "vitest";
import { SkillLoader } from "../harness/skill-loader.js";
import type { SkillDefinition } from "../harness/skill-loader.js";
import type { ToolContext } from "../tools/types.js";

const mockCtx: ToolContext = {
  config: {},
  store: null,
  state: {},
  emit: () => {},
};

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "test-skill",
    description: "A test skill",
    content: "Do the test thing",
    sourcePath: "programmatic",
    ...overrides,
  };
}

describe("SkillLoader", () => {
  // ── 1. register() adds a skill programmatically ─────────────────────

  it("register() adds a skill programmatically", () => {
    const loader = new SkillLoader();
    const skill = makeSkill({ name: "my-skill", description: "My custom skill" });

    loader.register(skill);

    expect(loader.get("my-skill")).toBeDefined();
    expect(loader.get("my-skill")!.description).toBe("My custom skill");
    expect(loader.getAll()).toHaveLength(1);
  });

  // ── 2. getDescriptionsForContext() returns lean skill list ──────────

  it("getDescriptionsForContext() returns lean skill list", () => {
    const loader = new SkillLoader();
    loader.register(makeSkill({ name: "commit", description: "Create a git commit" }));
    loader.register(makeSkill({ name: "review-pr", description: "Review a pull request" }));

    const ctx = loader.getDescriptionsForContext();

    expect(ctx).toContain("<available-skills>");
    expect(ctx).toContain("</available-skills>");
    expect(ctx).toContain("commit");
    expect(ctx).toContain("Create a git commit");
    expect(ctx).toContain("review-pr");
    expect(ctx).toContain("Review a pull request");
  });

  // ── 3. getDescriptionsForContext() returns empty string with no skills

  it("getDescriptionsForContext() returns empty string with no skills", () => {
    const loader = new SkillLoader();

    const ctx = loader.getDescriptionsForContext();

    expect(ctx).toBe("");
  });

  // ── 4. invoke() queues pending injection ────────────────────────────

  it("invoke() queues pending injection", () => {
    const loader = new SkillLoader();
    loader.register(makeSkill({ name: "commit", content: "Steps to commit..." }));

    const result = loader.invoke("commit");

    expect(result).toBe(true);

    const pending = loader.getPendingInjection();
    expect(pending).not.toBeNull();
    expect(pending).toContain('<skill-instructions name="commit">');
    expect(pending).toContain("Steps to commit...");
    expect(pending).toContain("</skill-instructions>");
  });

  // ── 5. invoke() returns false for unknown skill ─────────────────────

  it("invoke() returns false for unknown skill", () => {
    const loader = new SkillLoader();

    const result = loader.invoke("nonexistent");

    expect(result).toBe(false);
    expect(loader.getPendingInjection()).toBeNull();
  });

  // ── 6. clearPendingInjection() clears the queue ─────────────────────

  it("clearPendingInjection() clears the queue", () => {
    const loader = new SkillLoader();
    loader.register(makeSkill({ name: "commit", content: "Steps..." }));
    loader.invoke("commit");

    expect(loader.getPendingInjection()).not.toBeNull();

    loader.clearPendingInjection();

    expect(loader.getPendingInjection()).toBeNull();
  });

  // ── 7. getSkillTool() returns a valid ToolDefinition ────────────────

  it("getSkillTool() returns a valid ToolDefinition", () => {
    const loader = new SkillLoader();
    loader.register(makeSkill({ name: "commit" }));

    const tool = loader.getSkillTool();

    expect(tool.name).toBe("Skill");
    expect(tool.description).toBeTruthy();
    expect(tool.schema).toBeDefined();
    expect(tool.schema.type).toBe("object");
    expect(typeof tool.execute).toBe("function");
  });

  // ── 8. getSkillTool() execute returns success for known skill ───────

  it("getSkillTool() execute invokes known skill successfully", async () => {
    const loader = new SkillLoader();
    loader.register(makeSkill({ name: "commit", content: "Do commit things" }));

    const tool = loader.getSkillTool();
    const result = await tool.execute({ name: "commit" }, mockCtx);
    const parsed = JSON.parse(result as string);

    expect(parsed.success).toBe(true);
    expect(parsed.skill).toBe("commit");

    // Should have queued injection
    expect(loader.getPendingInjection()).toContain("Do commit things");
  });

  // ── 9. getSkillTool() execute returns error for unknown skill ───────

  it("getSkillTool() execute returns error for unknown skill", async () => {
    const loader = new SkillLoader();

    const tool = loader.getSkillTool();
    const result = await tool.execute({ name: "nonexistent" }, mockCtx);
    const parsed = JSON.parse(result as string);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toContain("nonexistent");
  });
});
