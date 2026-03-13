// ============================================================
// Tests for tool argument validation
// ============================================================

import { describe, it, expect } from "vitest";
import { validateToolArgs } from "../harness/validate-args.js";

describe("validateToolArgs", () => {
  // ── Basic validation ─────────────────────────────────────────

  it("returns null for valid args matching schema", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    };
    const result = validateToolArgs({ path: "foo.ts", content: "bar" }, schema, "write_file");
    expect(result).toBeNull();
  });

  it("returns null for empty schema", () => {
    expect(validateToolArgs({}, {}, "noop")).toBeNull();
    expect(validateToolArgs({ anything: true }, {}, "noop")).toBeNull();
  });

  it("returns null for undefined schema properties", () => {
    const schema = { type: "object" };
    expect(validateToolArgs({ foo: "bar" }, schema, "test")).toBeNull();
  });

  // ── Null/undefined args ──────────────────────────────────────

  it("rejects null args", () => {
    const schema = { type: "object", required: ["path"] };
    const result = validateToolArgs(null, schema, "write_file");
    expect(result).toContain("write_file");
    expect(result).toContain("null");
  });

  it("rejects undefined args", () => {
    const schema = { type: "object", required: ["path"] };
    const result = validateToolArgs(undefined, schema, "write_file");
    expect(result).toContain("write_file");
    expect(result).toContain("undefined");
  });

  it("rejects array args", () => {
    const schema = { type: "object" };
    const result = validateToolArgs(["foo"], schema, "test");
    expect(result).toContain("array");
  });

  it("rejects primitive args", () => {
    const schema = { type: "object" };
    expect(validateToolArgs("hello", schema, "test")).toContain("string");
    expect(validateToolArgs(42, schema, "test")).toContain("number");
  });

  // ── Required properties ──────────────────────────────────────

  it("detects missing required property", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    };
    const result = validateToolArgs({ path: "foo.ts" }, schema, "write_file");
    expect(result).toContain("content");
    expect(result).toContain("missing required");
  });

  it("detects null as missing for required property", () => {
    const schema = {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    };
    const result = validateToolArgs({ path: null }, schema, "write_file");
    expect(result).toContain("path");
    expect(result).toContain("missing required");
  });

  it("reports multiple missing required properties", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    };
    const result = validateToolArgs({}, schema, "edit_file");
    expect(result).toContain("path");
    expect(result).toContain("old_string");
    expect(result).toContain("new_string");
  });

  // ── Type validation ──────────────────────────────────────────

  it("detects wrong type for string property", () => {
    const schema = {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    };
    const result = validateToolArgs({ path: 42 }, schema, "read_file");
    expect(result).toContain("path");
    expect(result).toContain("string");
    expect(result).toContain("number");
  });

  it("detects wrong type for number property", () => {
    const schema = {
      type: "object",
      properties: { timeout: { type: "number" } },
    };
    const result = validateToolArgs({ timeout: "fast" }, schema, "bash");
    expect(result).toContain("timeout");
    expect(result).toContain("number");
  });

  it("detects wrong type for boolean property", () => {
    const schema = {
      type: "object",
      properties: { replace_all: { type: "boolean" } },
    };
    const result = validateToolArgs({ replace_all: "yes" }, schema, "edit_file");
    expect(result).toContain("replace_all");
    expect(result).toContain("boolean");
  });

  it("validates integer type", () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
    };
    expect(validateToolArgs({ count: 5 }, schema, "test")).toBeNull();
    const result = validateToolArgs({ count: 5.5 }, schema, "test");
    expect(result).toContain("integer");
  });

  it("skips type check for optional missing properties", () => {
    const schema = {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number" },
      },
      required: ["path"],
    };
    // offset is missing but not required — should be valid
    expect(validateToolArgs({ path: "foo.ts" }, schema, "read_file")).toBeNull();
  });

  // ── Enum validation ──────────────────────────────────────────

  it("accepts valid enum value", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["read", "write", "append"] },
      },
    };
    expect(validateToolArgs({ mode: "read" }, schema, "test")).toBeNull();
  });

  it("rejects invalid enum value", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["read", "write"] },
      },
    };
    const result = validateToolArgs({ mode: "delete" }, schema, "test");
    expect(result).toContain("mode");
    expect(result).toContain("read");
    expect(result).toContain("write");
  });

  // ── Number bounds ────────────────────────────────────────────

  it("validates minimum", () => {
    const schema = {
      type: "object",
      properties: { offset: { type: "number", minimum: 1 } },
    };
    expect(validateToolArgs({ offset: 1 }, schema, "test")).toBeNull();
    const result = validateToolArgs({ offset: 0 }, schema, "test");
    expect(result).toContain("offset");
    expect(result).toContain(">= 1");
  });

  it("validates maximum", () => {
    const schema = {
      type: "object",
      properties: { depth: { type: "number", maximum: 5 } },
    };
    expect(validateToolArgs({ depth: 5 }, schema, "test")).toBeNull();
    const result = validateToolArgs({ depth: 10 }, schema, "test");
    expect(result).toContain("depth");
    expect(result).toContain("<= 5");
  });

  // ── String bounds ────────────────────────────────────────────

  it("validates minLength", () => {
    const schema = {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
    };
    const result = validateToolArgs({ query: "" }, schema, "test");
    expect(result).toContain("query");
    expect(result).toContain("length >= 1");
  });

  // ── Array items ──────────────────────────────────────────────

  it("validates array item types", () => {
    const schema = {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" } },
      },
    };
    expect(validateToolArgs({ files: ["a.ts", "b.ts"] }, schema, "test")).toBeNull();
    const result = validateToolArgs({ files: ["a.ts", 42] }, schema, "test");
    expect(result).toContain("files[1]");
    expect(result).toContain("string");
  });

  // ── Real tool schemas ────────────────────────────────────────

  describe("real tool schemas", () => {
    const writeFileSchema = {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    };

    const editFileSchema = {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    };

    const grepSchema = {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        maxResults: { type: "number" },
      },
      required: ["pattern"],
    };

    const bashSchema = {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number" },
        description: { type: "string" },
      },
      required: ["command"],
    };

    it("catches write_file with undefined path (production bug)", () => {
      const result = validateToolArgs({ content: "hello" }, writeFileSchema, "write_file");
      expect(result).toContain("write_file");
      expect(result).toContain("path");
    });

    it("catches write_file with missing content", () => {
      const result = validateToolArgs({ path: "foo.ts" }, writeFileSchema, "write_file");
      expect(result).toContain("content");
    });

    it("catches edit_file with wrong types", () => {
      const result = validateToolArgs(
        { path: 123, old_string: "foo", new_string: "bar" },
        editFileSchema,
        "edit_file",
      );
      expect(result).toContain("path");
      expect(result).toContain("string");
    });

    it("catches grep with missing pattern", () => {
      const result = validateToolArgs({}, grepSchema, "grep");
      expect(result).toContain("pattern");
    });

    it("catches bash with empty args", () => {
      const result = validateToolArgs({}, bashSchema, "bash");
      expect(result).toContain("command");
    });

    it("accepts valid grep call", () => {
      expect(validateToolArgs({ pattern: "TODO" }, grepSchema, "grep")).toBeNull();
    });

    it("accepts valid edit_file call", () => {
      expect(validateToolArgs(
        { path: "foo.ts", old_string: "a", new_string: "b" },
        editFileSchema,
        "edit_file",
      )).toBeNull();
    });
  });
});

// ── Agent Loop Integration Tests ──────────────────────────────

describe("agent loop — argument validation integration", () => {
  // Import dynamically to avoid circular deps in test file
  it("returns validation error as tool result (not crash)", async () => {
    const { agentLoop } = await import("../harness/agent-loop.js");

    let callCount = 0;
    const mockModel = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          // Model sends malformed tool call — missing required "path"
          return {
            content: "I'll write the file",
            toolCalls: [
              {
                id: "tc_1",
                name: "write_file",
                args: { content: "hello world" }, // missing path!
              },
            ],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: "tool_use",
          };
        }
        // After getting validation error feedback, model responds normally
        return {
          content: "I see the error, let me stop.",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: "end_turn",
        };
      },
    };

    const writeFileTool = {
      name: "write_file",
      description: "Write a file",
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: () => {
        throw new Error("Should not be called with invalid args");
      },
    };

    const messages: any[] = [];
    for await (const msg of agentLoop("Write foo.ts", {
      model: mockModel as any,
      tools: [writeFileTool],
      agentName: "test",
      systemPrompt: "You are a test agent",
      maxTurns: 5,
      inferenceMaxRetries: 0,
    })) {
      messages.push(msg);
    }

    // Find the tool_result message
    const toolResultMsg = messages.find(m => m.type === "tool_result");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.toolResults).toHaveLength(1);
    expect(toolResultMsg.toolResults[0].isError).toBe(true);
    expect(toolResultMsg.toolResults[0].content).toContain("path");
    expect(toolResultMsg.toolResults[0].content).toContain("missing required");
    expect(toolResultMsg.toolResults[0].content).toContain("Please retry");

    // The tool's execute should NOT have been called
    // (if it was, it would have thrown and the test would fail)
  });

  it("passes valid args through to tool execution", async () => {
    const { agentLoop } = await import("../harness/agent-loop.js");

    let executed = false;
    const mockModel = {
      chat: async () => {
        if (!executed) {
          return {
            content: "Reading file",
            toolCalls: [
              { id: "tc_1", name: "test_tool", args: { path: "foo.ts" } },
            ],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: "tool_use",
          };
        }
        return {
          content: "Done",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: "end_turn",
        };
      },
    };

    const tool = {
      name: "test_tool",
      description: "Test tool",
      schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: (input: any) => {
        executed = true;
        return { success: true, path: input.path };
      },
    };

    const messages: any[] = [];
    for await (const msg of agentLoop("Test", {
      model: mockModel as any,
      tools: [tool],
      agentName: "test",
      systemPrompt: "You are a test agent",
      maxTurns: 5,
      inferenceMaxRetries: 0,
    })) {
      messages.push(msg);
    }

    expect(executed).toBe(true);
  });

  it("validation error includes tool name and descriptive message", async () => {
    const { agentLoop } = await import("../harness/agent-loop.js");

    let callCount = 0;
    const mockModel = {
      chat: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: "grep for TODO",
            toolCalls: [
              { id: "tc_1", name: "grep", args: {} }, // missing required pattern
            ],
            usage: { inputTokens: 10, outputTokens: 10 },
            stopReason: "tool_use",
          };
        }
        return {
          content: "Done",
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 10 },
          stopReason: "end_turn",
        };
      },
    };

    const grepTool = {
      name: "grep",
      description: "Search files",
      schema: {
        type: "object",
        properties: { pattern: { type: "string" } },
        required: ["pattern"],
      },
      execute: () => {
        throw new Error("Should not be called");
      },
    };

    const messages: any[] = [];
    for await (const msg of agentLoop("Find TODOs", {
      model: mockModel as any,
      tools: [grepTool],
      agentName: "test",
      systemPrompt: "test",
      maxTurns: 5,
      inferenceMaxRetries: 0,
    })) {
      messages.push(msg);
    }

    const toolResult = messages.find(m => m.type === "tool_result");
    expect(toolResult.toolResults[0].content).toContain("grep");
    expect(toolResult.toolResults[0].content).toContain("pattern");
    expect(toolResult.toolResults[0].content).toContain("invalid arguments");
    // The error should guide the model to retry with correct args
    expect(toolResult.toolResults[0].content).toContain("Please retry");
  });
});
