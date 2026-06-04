import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "examples/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
        "src/harness/external-agent.ts": {
          lines: 85,
          functions: 80,
          statements: 80,
          branches: 75,
        },
        "src/lsp/**": {
          lines: 50,
          functions: 50,
          statements: 50,
          branches: 45,
        },
        "src/mcp/**": {
          lines: 70,
          functions: 65,
          statements: 65,
          branches: 60,
        },
        "src/platform/**": {
          lines: 85,
          functions: 80,
          statements: 80,
          branches: 70,
        },
        "src/prebuilt/**": {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 90,
        },
        "src/tools/**": {
          lines: 90,
          functions: 95,
          statements: 90,
          branches: 75,
        },
        "packages/integrations/src/adapter/auth-resolver.ts": {
          lines: 55,
          functions: 30,
          statements: 55,
          branches: 60,
        },
        "packages/tools/src/github/**": {
          lines: 50,
          functions: 50,
          statements: 50,
          branches: 35,
        },
      },
    },
  },
});
