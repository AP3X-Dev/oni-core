import { describe, it, expect } from "vitest";
import { parseArgs, getHelpText, getVersionText } from "../cli/router.js";

describe("CLI Router", () => {
  describe("parseArgs", () => {
    it("parses command with no args", () => {
      const result = parseArgs(["run"]);
      expect(result.command).toBe("run");
      expect(result.positional).toEqual([]);
      expect(result.flags).toEqual({});
    });

    it("parses command with positional args", () => {
      const result = parseArgs(["run", "agent.ts"]);
      expect(result.command).toBe("run");
      expect(result.positional).toEqual(["agent.ts"]);
    });

    it("parses --flag=value style", () => {
      const result = parseArgs(["run", "--port=3000", "file.ts"]);
      expect(result.flags.port).toBe("3000");
      expect(result.positional).toEqual(["file.ts"]);
    });

    it("parses --flag value style", () => {
      const result = parseArgs(["run", "--format", "mermaid"]);
      expect(result.flags.format).toBe("mermaid");
    });

    it("parses boolean flags", () => {
      const result = parseArgs(["build", "--no-check"]);
      expect(result.flags["no-check"]).toBe("true");
    });

    it("returns help command for --help", () => {
      const result = parseArgs(["--help"]);
      expect(result.command).toBe("help");
    });

    it("returns version command for --version", () => {
      const result = parseArgs(["--version"]);
      expect(result.command).toBe("version");
    });

    it("returns help when no args", () => {
      const result = parseArgs([]);
      expect(result.command).toBe("help");
    });
  });

  describe("getHelpText", () => {
    it("includes all commands", () => {
      const text = getHelpText();
      expect(text).toContain("init");
      expect(text).toContain("dev");
      expect(text).toContain("run");
      expect(text).toContain("inspect");
      expect(text).toContain("test");
      expect(text).toContain("build");
    });

    it("includes version", () => {
      const text = getHelpText();
      expect(text).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe("getVersionText", () => {
    it("returns formatted version string", () => {
      const text = getVersionText();
      expect(text).toContain("@oni.bot/core");
      expect(text).toMatch(/v\d+\.\d+\.\d+/);
    });
  });
});
