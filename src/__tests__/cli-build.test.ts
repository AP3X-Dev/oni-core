import { describe, it, expect } from "vitest";
import { validateExports } from "../cli/build.js";

describe("oni build", () => {
  describe("validateExports", () => {
    it("returns no errors for valid exports", () => {
      const pkg = {
        exports: {
          ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
        },
      };
      const errors = validateExports(pkg);
      expect(errors).toEqual([]);
    });

    it("flags missing types", () => {
      const pkg = {
        exports: {
          ".": { import: "./dist/index.js" },
        },
      };
      const errors = validateExports(pkg);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("types");
    });

    it("flags missing import", () => {
      const pkg = {
        exports: {
          "./store": { types: "./dist/store/index.d.ts" },
        },
      };
      const errors = validateExports(pkg);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("import");
    });

    it("returns no errors when no exports", () => {
      const errors = validateExports({});
      expect(errors).toEqual([]);
    });

    it("skips string-valued exports", () => {
      const pkg = {
        exports: {
          ".": "./dist/index.js",
        },
      };
      const errors = validateExports(pkg);
      expect(errors).toEqual([]);
    });
  });
});
