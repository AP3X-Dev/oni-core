import { describe, it, expect } from "vitest";
import { checkToolPermission, getPermittedTools, ToolPermissionError } from "../guardrails/permissions.js";
import type { ToolPermissions } from "../tools/types.js";

describe("guardrails — tool permissions", () => {
  const permissions: ToolPermissions = {
    researcher: ["web_search", "read_file"],
    writer: ["write_file"],
    admin: "*",
  };

  it("allows permitted tools", () => {
    expect(() => checkToolPermission(permissions, "researcher", "web_search")).not.toThrow();
    expect(() => checkToolPermission(permissions, "researcher", "read_file")).not.toThrow();
    expect(() => checkToolPermission(permissions, "writer", "write_file")).not.toThrow();
  });

  it("blocks unpermitted tools", () => {
    expect(() => checkToolPermission(permissions, "researcher", "write_file")).toThrow(ToolPermissionError);
    expect(() => checkToolPermission(permissions, "writer", "web_search")).toThrow(ToolPermissionError);

    try {
      checkToolPermission(permissions, "researcher", "delete_file");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolPermissionError);
      expect((e as ToolPermissionError).agent).toBe("researcher");
      expect((e as ToolPermissionError).tool).toBe("delete_file");
      expect((e as ToolPermissionError).message).toBe('Agent "researcher" is not permitted to use tool "delete_file"');
    }
  });

  it("wildcard allows all tools", () => {
    expect(() => checkToolPermission(permissions, "admin", "web_search")).not.toThrow();
    expect(() => checkToolPermission(permissions, "admin", "write_file")).not.toThrow();
    expect(() => checkToolPermission(permissions, "admin", "delete_file")).not.toThrow();
    expect(() => checkToolPermission(permissions, "admin", "anything_at_all")).not.toThrow();
  });

  it("undefined agent = allow all", () => {
    expect(() => checkToolPermission(permissions, "unknown_agent", "web_search")).not.toThrow();
    expect(() => checkToolPermission(permissions, "unknown_agent", "delete_file")).not.toThrow();
  });

  it("getPermittedTools returns filtered list", () => {
    const allTools = ["web_search", "read_file", "write_file", "delete_file"];

    // Researcher: only web_search and read_file
    const researcherTools = getPermittedTools(permissions, "researcher", allTools);
    expect(researcherTools).toEqual(["web_search", "read_file"]);

    // Writer: only write_file
    const writerTools = getPermittedTools(permissions, "writer", allTools);
    expect(writerTools).toEqual(["write_file"]);

    // Admin (wildcard): all tools
    const adminTools = getPermittedTools(permissions, "admin", allTools);
    expect(adminTools).toEqual(allTools);

    // Unknown agent: all tools
    const unknownTools = getPermittedTools(permissions, "unknown_agent", allTools);
    expect(unknownTools).toEqual(allTools);
  });
});
