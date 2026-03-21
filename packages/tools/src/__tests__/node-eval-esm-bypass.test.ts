/**
 * Regression test for BUG-0205
 *
 * The node_eval subprocess applies --experimental-permission to block
 * filesystem writes, child_process, and worker_threads. However, ESM
 * import() used via string concatenation — e.g.
 *   eval("imp" + "ort('net')")
 * — bypasses the CJS-level require() patches AND the import() regex guard
 * because the concatenation is resolved at runtime, not at parse time.
 * ESM resolution does not go through Module._resolveFilename (a CJS hook),
 * so the network module loads successfully.
 *
 * A fully sandboxed implementation must also block this path, e.g. by:
 *   - Setting globalThis.eval = () => { throw new Error("eval disabled"); }
 *   - Using isolated-vm or container-level sandboxing
 *   - Adding an ESM loader hook that denies 'net' / 'http' / 'https'
 *
 * Fix: Any of the above approaches must prevent eval()-concatenated ESM
 * imports from loading network modules. After the fix, this test must pass.
 */

import { describe, it, expect } from "vitest";
import { nodeEval } from "../code-execution/node-eval.js";
import type { ToolContext } from "../types.js";

const ctx = {} as ToolContext;

describe("nodeEval — ESM import() bypass via eval() string concatenation (BUG-0205)", () => {
  it(
    "eval-concatenated ESM import of 'net' must be blocked",
    async () => {
      const tool = nodeEval();

      // The exploit: string concatenation defeats static import() detection.
      // A sandboxed implementation must intercept this at runtime.
      // After the fix, this must throw (or return an error payload) rather
      // than successfully returning a net.Socket or net module reference.
      await expect(
        tool.execute(
          {
            code: [
              'const mod = await eval("imp" + "ort(\'node:net\')");',
              "return typeof mod.Socket;",
            ].join("\n"),
          },
          ctx,
        ),
      ).rejects.toThrow();
    },
    15_000,
  );

  it(
    "eval-concatenated ESM import of 'http' must be blocked",
    async () => {
      const tool = nodeEval();

      await expect(
        tool.execute(
          {
            code: [
              'const mod = await eval("imp" + "ort(\'node:http\')");',
              "return typeof mod.request;",
            ].join("\n"),
          },
          ctx,
        ),
      ).rejects.toThrow();
    },
    15_000,
  );

  it(
    "eval-concatenated ESM import of 'https' must be blocked",
    async () => {
      const tool = nodeEval();

      await expect(
        tool.execute(
          {
            code: [
              'const mod = await eval("imp" + "ort(\'node:https\')");',
              "return typeof mod.request;",
            ].join("\n"),
          },
          ctx,
        ),
      ).rejects.toThrow();
    },
    15_000,
  );

  it(
    "legitimate code execution continues to work after sandbox hardening",
    async () => {
      const tool = nodeEval();

      // Ensure the sandbox hardening that blocks ESM network imports does not
      // break normal arithmetic / string operations.
      const result = await tool.execute(
        { code: "return 2 + 2;" },
        ctx,
      ) as { result: number };
      expect(result.result).toBe(4);
    },
    15_000,
  );
});
