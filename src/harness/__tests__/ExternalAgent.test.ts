import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  ExternalAgentHost,
  ExternalAgentOptionPolicyError,
  ExternalAgentPathPolicyError,
  ExternalAgentRuntimeRegistry,
  assertExternalAgentPathAllowed,
  buildExternalAgentPrompt,
  buildClaudeCodeArgs,
  buildCodexExecArgs,
  createCliExternalAgentDriver,
  createCodexExecDriver,
  createClaudeCodeDriver,
  createDefaultExternalAgentRuntimeRegistry,
  externalAgentAsNode,
  parseClaudeJsonLine,
  parseCodexJsonLine,
  parseGenericJsonAgentLine,
  runExternalAgent,
  validateClaudeCodeDriverOptions,
  validateCodexExecDriverOptions,
} from "../external-agent.js";
import type {
  ExternalAgentDriver,
  ExternalAgentRunRequest,
  ExternalAgentEvent,
  ExternalAgentCapabilities,
} from "../external-agent.js";
import type { BaseSwarmState } from "../../swarm/config.js";

function lossyCaps(overrides: Partial<ExternalAgentCapabilities> = {}): ExternalAgentCapabilities {
  return {
    structuredMessages: false,
    toolSchemas: false,
    tokenStreaming: false,
    reasoningText: false,
    reasoningEncrypted: false,
    toolCallEvents: false,
    diffStreaming: false,
    workspaceWrites: true,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ExternalAgentRunRequest> = {}): ExternalAgentRunRequest {
  return {
    agentId: "worker",
    provider: "codex",
    mode: "conductor",
    prompt: "Implement the feature",
    ...overrides,
  };
}

function makeState(overrides: Partial<BaseSwarmState> = {}): BaseSwarmState {
  return {
    task: "Build the auth flow",
    context: {},
    agentResults: {},
    messages: [],
    swarmMessages: [],
    supervisorRound: 0,
    currentAgent: null,
    done: false,
    handoffHistory: [],
    ...overrides,
  };
}

describe("external agent support", () => {
  it("buildExternalAgentPrompt creates a conductor contract with ownership and transcript", () => {
    const prompt = buildExternalAgentPrompt(makeRequest({
      role: "builder",
      systemPrompt: "Be precise.",
      ownership: {
        allowedPaths: ["src/auth"],
        disallowedPaths: ["dist"],
        description: "Auth module only",
      },
      mergePolicy: "manual",
      sharedContext: { topology: "fanout", owner: "harness" },
      messages: [
        { role: "user", content: "Previous request" },
        { role: "assistant", content: "Previous answer" },
      ],
    }));

    expect(prompt).toContain("ONI is acting as the conductor");
    expect(prompt).toContain('"agentId": "worker"');
    expect(prompt).toContain('"allowedPaths"');
    expect(prompt).toContain("src/auth");
    expect(prompt).toContain("Previous request");
    expect(prompt).toContain("Implement the feature");
  });

  it("runExternalAgent wraps a lossy driver with start and finish events", async () => {
    const driverEvents: ExternalAgentEvent[] = [];
    const driver: ExternalAgentDriver = {
      provider: "codex",
      name: "fake-codex",
      capabilities: lossyCaps({ reasoningEncrypted: true }),
      async run(request, emit) {
        emit({
          type: "external_agent_text_delta",
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          timestamp: Date.now(),
          content: "done",
        });
        return {
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          status: "completed",
          output: "done",
          startedAt: Date.now(),
          endedAt: Date.now(),
          events: driverEvents,
        };
      },
    };

    const seen: ExternalAgentEvent[] = [];
    const result = await runExternalAgent(driver, makeRequest(), (event) => seen.push(event));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("done");
    expect(seen[0]?.type).toBe("external_agent_start");
    expect(seen.at(-1)?.type).toBe("external_agent_finish");
    expect(result.events.map((e) => e.type)).toContain("external_agent_text_delta");
  });

  it("externalAgentAsNode stores provider output in swarm state and passes shared context", async () => {
    let capturedRequest: ExternalAgentRunRequest | null = null;
    const driver: ExternalAgentDriver = {
      provider: "claude",
      capabilities: lossyCaps(),
      async run(request, emit) {
        capturedRequest = request;
        emit({
          type: "external_agent_text_delta",
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          timestamp: Date.now(),
          content: "changed src/auth.ts",
        });
        return {
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          status: "completed",
          output: "changed src/auth.ts",
          startedAt: 1,
          endedAt: 2,
          events: [],
        };
      },
    };

    const node = externalAgentAsNode(driver, {
      id: "claude-builder",
      provider: "claude",
      role: "builder",
      ownership: { allowedPaths: ["src/auth.ts"] },
      sharedContext: { mergeLane: "feature/auth" },
      contextSelector: (state) => ({ featureId: state.context.featureId }),
    });

    const result = await node(makeState({
      context: {
        featureId: "feat-auth",
        externalAgents: {
          previous: { provider: "codex" },
        },
      },
      messages: [{ role: "user", content: "Keep auth isolated" }],
    }));

    expect(result.agentResults?.["claude-builder"]).toBe("changed src/auth.ts");
    const externalAgents = result.context?.externalAgents as Record<string, Record<string, unknown>>;
    expect(externalAgents.previous?.provider).toBe("codex");
    expect(externalAgents["claude-builder"]?.provider).toBe("claude");
    expect(capturedRequest?.ownership?.allowedPaths).toEqual(["src/auth.ts"]);
    expect(capturedRequest?.sharedContext).toEqual({
      mergeLane: "feature/auth",
      featureId: "feat-auth",
    });
    expect(capturedRequest?.messages).toHaveLength(1);
  });

  it("ExternalAgentHost registers Codex and Claude drivers as named providers", async () => {
    const driver: ExternalAgentDriver = {
      provider: "codex",
      capabilities: lossyCaps(),
      async run(request) {
        return {
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          status: "completed",
          output: "host result",
          startedAt: 1,
          endedAt: 2,
          events: [],
        };
      },
    };

    const host = new ExternalAgentHost({ drivers: [driver] });
    const result = await host.run("do work", {
      agentId: "codex-worker",
      provider: "codex",
    });

    expect(result.output).toBe("host result");
    expect(result.provider).toBe("codex");
    expect(() => host.getDriver("claude")).toThrow("No external agent driver");
  });

  it("ExternalAgentRuntimeRegistry builds configured hosts from runtime factories", async () => {
    const registry = new ExternalAgentRuntimeRegistry();
    registry.register({
      provider: "local",
      name: "Local Worker",
      description: "test runtime",
      createDriver: (options) => {
        const suffix = typeof (options as { suffix?: unknown } | undefined)?.suffix === "string"
          ? (options as { suffix: string }).suffix
          : "default";
        return {
          provider: "local",
          name: `local-${suffix}`,
          capabilities: lossyCaps({ tokenStreaming: true }),
          async run(request, emit) {
            emit({
              type: "external_agent_text_delta",
              agentId: request.agentId,
              provider: request.provider,
              mode: request.mode,
              timestamp: Date.now(),
              content: `result-${suffix}`,
            });
            return {
              agentId: request.agentId,
              provider: request.provider,
              mode: request.mode,
              status: "completed",
              output: `result-${suffix}`,
              startedAt: 1,
              endedAt: 2,
              events: [],
            };
          },
        };
      },
    });

    expect(registry.has("local")).toBe(true);
    expect(registry.list()).toEqual([
      expect.objectContaining({
        provider: "local",
        name: "Local Worker",
        description: "test runtime",
        capabilities: expect.objectContaining({ tokenStreaming: true }),
      }),
    ]);
    expect(() => registry.registerDriver({
      provider: "local",
      capabilities: lossyCaps(),
      async run(request) {
        return {
          agentId: request.agentId,
          provider: request.provider,
          mode: request.mode,
          status: "completed",
          output: "",
          startedAt: 1,
          endedAt: 2,
          events: [],
        };
      },
    })).toThrow("already registered");

    const seen: ExternalAgentEvent[] = [];
    const host = registry.createHost({
      providers: ["local"],
      driverOptions: { local: { suffix: "custom" } },
      onEvent: (event) => seen.push(event),
    });
    const result = await host.run("do work", { agentId: "local-worker", provider: "local" });

    expect(host.getDriver("local").name).toBe("local-custom");
    expect(result.output).toBe("result-custom");
    expect(seen.map((event) => event.type)).toEqual([
      "external_agent_start",
      "external_agent_text_delta",
      "external_agent_finish",
    ]);
  });

  it("createDefaultExternalAgentRuntimeRegistry exposes Codex and Claude Code adapters", () => {
    const registry = createDefaultExternalAgentRuntimeRegistry({
      codex: { name: "codex-default", model: "gpt-5.2" },
      claude: { name: "claude-default", model: "sonnet" },
    });

    expect(registry.has("codex")).toBe(true);
    expect(registry.has("claude")).toBe(true);
    expect(registry.list().map((runtime) => runtime.provider)).toEqual(["codex", "claude"]);
    expect(registry.createDriver("codex", { name: "codex-runtime" }).name).toBe("codex-runtime");
    expect(registry.createDriver("claude").name).toBe("claude-default");

    const codexOnly = createDefaultExternalAgentRuntimeRegistry({ claude: false });
    expect(codexOnly.has("codex")).toBe(true);
    expect(codexOnly.has("claude")).toBe(false);
  });

  it("Codex and Claude convenience drivers default to lossy black-box capabilities", () => {
    const codex = createCodexExecDriver();
    const claude = createClaudeCodeDriver();

    expect(codex.provider).toBe("codex");
    expect(codex.capabilities.structuredMessages).toBe(false);
    expect(codex.capabilities.toolSchemas).toBe(false);
    expect(codex.capabilities.reasoningEncrypted).toBe(true);
    expect(claude.provider).toBe("claude");
    expect(claude.capabilities.structuredMessages).toBe(false);
    expect(claude.capabilities.workspaceWrites).toBe(true);
  });

  it("buildCodexExecArgs maps ONI options to the Codex exec CLI contract", () => {
    const args = buildCodexExecArgs("do work", makeRequest({ cwd: "/repo/worktree" }), {
      model: "gpt-5.2",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      addDirs: ["/repo/shared"],
      skipGitRepoCheck: true,
      ephemeral: true,
      outputSchema: "schema.json",
      extraArgs: ["--color", "never"],
      unsafe: { allowExtraArgs: true },
    });

    expect(args).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-5.2",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "--cd",
      "/repo/worktree",
      "--add-dir",
      "/repo/shared",
      "--skip-git-repo-check",
      "--ephemeral",
      "--output-schema",
      "schema.json",
      "--color",
      "never",
      "do work",
    ]);
  });

  it("buildClaudeCodeArgs maps ONI options to the Claude Code print CLI contract", () => {
    const args = buildClaudeCodeArgs("do work", makeRequest(), {
      model: "sonnet",
      permissionMode: "acceptEdits",
      allowedTools: ["Read", "Edit"],
      disallowedTools: ["Bash(rm *)"],
      addDirs: ["/repo/shared"],
      mcpConfig: ["amp-mcp.json"],
      strictMcpConfig: true,
      includePartialMessages: true,
      includeHookEvents: true,
      maxBudgetUsd: 2.5,
      sessionName: "oni-worker",
      worktree: "task-auth",
      extraArgs: ["--verbose"],
      unsafe: { allowExtraArgs: true },
    });

    expect(args).toEqual([
      "--print",
      "--output-format",
      "stream-json",
      "--model",
      "sonnet",
      "--permission-mode",
      "acceptEdits",
      "--allowed-tools",
      "Read,Edit",
      "--disallowed-tools",
      "Bash(rm *)",
      "--add-dir",
      "/repo/shared",
      "--mcp-config",
      "amp-mcp.json",
      "--strict-mcp-config",
      "--include-partial-messages",
      "--include-hook-events",
      "--max-budget-usd",
      "2.5",
      "--name",
      "oni-worker",
      "--worktree",
      "task-auth",
      "--verbose",
      "do work",
    ]);
  });

  it("blocks unsafe Codex CLI bypass options unless explicitly allowed", () => {
    expect(() => validateCodexExecDriverOptions({
      dangerouslyBypassApprovalsAndSandbox: true,
    })).toThrow(ExternalAgentOptionPolicyError);
    expect(() => buildCodexExecArgs("do work", makeRequest(), {
      extraArgs: ["--dangerous-flag"],
    })).toThrow("extraArgs");

    const args = buildCodexExecArgs("do work", makeRequest(), {
      dangerouslyBypassApprovalsAndSandbox: true,
      extraArgs: ["--color", "never"],
      unsafe: {
        allowDangerousSandboxBypass: true,
        allowExtraArgs: true,
      },
    });

    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).toContain("--color");
  });

  it("blocks unsafe Claude Code permission bypass options unless explicitly allowed", () => {
    expect(() => validateClaudeCodeDriverOptions({
      permissionMode: "bypassPermissions",
    })).toThrow(ExternalAgentOptionPolicyError);
    expect(() => buildClaudeCodeArgs("do work", makeRequest(), {
      extraArgs: ["--verbose"],
    })).toThrow("extraArgs");

    const args = buildClaudeCodeArgs("do work", makeRequest(), {
      permissionMode: "bypassPermissions",
      extraArgs: ["--verbose"],
      unsafe: {
        allowPermissionBypass: true,
        allowExtraArgs: true,
      },
    });

    expect(args).toContain("--permission-mode");
    expect(args).toContain("bypassPermissions");
    expect(args).toContain("--verbose");
  });

  it("validates external-agent cwd before spawning a CLI provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-external-agent-scope-"));
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    let builtArgs = false;
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      args: () => {
        builtArgs = true;
        return ["-e", "console.log('should not spawn')"];
      },
      stdin: "none",
    });

    await expect(driver.run(makeRequest({
      provider: "test-cli",
      cwd: outside,
      ownership: { allowedPaths: [allowed] },
    }), () => undefined)).rejects.toThrow(ExternalAgentPathPolicyError);
    expect(builtArgs).toBe(false);
  });

  it("validates provider path flags against external-agent ownership", async () => {
    const root = await mkdtemp(join(tmpdir(), "oni-external-agent-provider-paths-"));
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    const request = makeRequest({
      cwd: allowed,
      ownership: { allowedPaths: [allowed] },
    });

    expect(assertExternalAgentPathAllowed("nested", request.ownership, "path", allowed))
      .toBe(join(allowed, "nested"));
    expect(() => buildCodexExecArgs("do work", request, {
      addDirs: [outside],
    })).toThrow("addDirs denied");
    expect(() => buildClaudeCodeArgs("do work", request, {
      mcpConfig: [join(outside, "mcp.json")],
    })).toThrow("mcpConfig denied");
    expect(() => buildClaudeCodeArgs("do work", request, {
      worktree: outside,
    })).toThrow("worktree denied");

    expect(buildCodexExecArgs("do work", request, {
      addDirs: [join(allowed, "shared")],
    })).toContain(join(allowed, "shared"));
  });

  it("parseGenericJsonAgentLine maps JSONL text, tool calls, and encrypted reasoning", () => {
    const request = makeRequest();

    const text = parseGenericJsonAgentLine(
      JSON.stringify({ type: "message", content: [{ type: "output_text", text: "hello" }] }),
      request,
    ) as ExternalAgentEvent[];
    expect(text[0]?.type).toBe("external_agent_text_delta");
    expect(text[0]?.content).toBe("hello");

    const tool = parseGenericJsonAgentLine(
      JSON.stringify({ type: "tool_call", name: "Edit", id: "tc1" }),
      request,
    ) as ExternalAgentEvent[];
    expect(tool[0]?.type).toBe("external_agent_tool_call");
    expect(tool[0]?.toolName).toBe("Edit");

    const reasoning = parseGenericJsonAgentLine(
      JSON.stringify({ type: "reasoning", encrypted_content: "opaque" }),
      request,
    ) as ExternalAgentEvent[];
    expect(reasoning[0]?.type).toBe("external_agent_thinking");
    expect(reasoning[0]?.data?.encrypted).toBe(true);
  });

  it("maps provider-style Codex JSONL frames to external-agent events", () => {
    const request = makeRequest();

    const text = parseCodexJsonLine(
      JSON.stringify({ type: "response.output_text.delta", delta: "codex says hi" }),
      request,
    ) as ExternalAgentEvent[];
    const tool = parseCodexJsonLine(
      JSON.stringify({
        type: "response.function_call_arguments.done",
        call_id: "call_1",
        name: "shell",
        arguments: "{\"command\":\"pnpm test\"}",
      }),
      request,
    ) as ExternalAgentEvent[];
    const diff = parseCodexJsonLine(
      JSON.stringify({
        type: "response.output_item.done",
        item: { type: "diff", path: "src/index.ts", content: "diff --git a/src/index.ts b/src/index.ts" },
      }),
      request,
    ) as ExternalAgentEvent[];

    expect(text[0]).toEqual(expect.objectContaining({
      type: "external_agent_text_delta",
      content: "codex says hi",
    }));
    expect(tool[0]).toEqual(expect.objectContaining({
      type: "external_agent_tool_call",
      toolName: "shell",
      toolCallId: "call_1",
    }));
    expect(diff[0]).toEqual(expect.objectContaining({
      type: "external_agent_diff",
      path: "src/index.ts",
      content: "diff --git a/src/index.ts b/src/index.ts",
    }));
  });

  it("maps provider-style Claude stream-json frames to external-agent events", () => {
    const request = makeRequest({ provider: "claude" });

    const text = parseClaudeJsonLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "claude says hi" }] },
      }),
      request,
    ) as ExternalAgentEvent[];
    const tool = parseClaudeJsonLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "src/index.ts" } }] },
      }),
      request,
    ) as ExternalAgentEvent[];
    const thinking = parseClaudeJsonLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "thinking", encrypted_content: "opaque" }] },
      }),
      request,
    ) as ExternalAgentEvent[];

    expect(text[0]).toEqual(expect.objectContaining({
      type: "external_agent_text_delta",
      content: "claude says hi",
    }));
    expect(tool[0]).toEqual(expect.objectContaining({
      type: "external_agent_tool_call",
      toolName: "Read",
      toolCallId: "toolu_1",
    }));
    expect(thinking[0]).toEqual(expect.objectContaining({
      type: "external_agent_thinking",
      content: "[encrypted reasoning omitted]",
    }));
    expect(thinking[0]?.data?.encrypted).toBe(true);
  });

  it("keeps malformed and non-object JSONL frames observable", () => {
    const request = makeRequest();

    const malformed = parseGenericJsonAgentLine("{not json", request) as ExternalAgentEvent;
    const scalar = parseGenericJsonAgentLine(JSON.stringify(["unexpected", "array"]), request) as ExternalAgentEvent;

    expect(malformed).toEqual(expect.objectContaining({
      type: "external_agent_text_delta",
      content: "{not json",
    }));
    expect(scalar).toEqual(expect.objectContaining({
      type: "external_agent_artifact",
      content: "[\n  \"unexpected\",\n  \"array\"\n]",
    }));
  });

  it("createCliExternalAgentDriver executes JSONL CLIs and normalizes final output", async () => {
    const payload = JSON.stringify({ type: "message", content: "hello from cli" });
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      args: () => ["-e", `console.log(${JSON.stringify(payload)})`],
      stdin: "none",
      output: "jsonl",
    });

    const result = await runExternalAgent(driver, makeRequest({
      agentId: "cli-worker",
      provider: "test-cli",
    }));

    expect(result.status).toBe("completed");
    expect(result.output).toBe("hello from cli");
    expect(result.events.map((event) => event.type)).toContain("external_agent_stdout");
    expect(result.events.map((event) => event.type)).toContain("external_agent_text_delta");
  });

  it("createCliExternalAgentDriver can disable inherited env and redact event content", async () => {
    const previousSecret = process.env.ONI_TEST_INHERITED_SECRET;
    process.env.ONI_TEST_INHERITED_SECRET = "outside-secret-value";
    const script = [
      "const allowed = process.env.ONI_TEST_ALLOWED_SECRET ?? 'missing';",
      "const inherited = process.env.ONI_TEST_INHERITED_SECRET ?? 'missing';",
      "console.log(JSON.stringify({ type: 'message', content: `allowed=${allowed}; inherited=${inherited}` }));",
      "console.error(`stderr allowed=${allowed}; inherited=${inherited}`);",
    ].join("\n");
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      args: () => ["-e", script],
      stdin: "none",
      output: "jsonl",
      inheritProcessEnv: false,
    });

    try {
      const result = await runExternalAgent(driver, makeRequest({
        agentId: "cli-worker",
        provider: "test-cli",
        env: {
          ONI_TEST_ALLOWED_SECRET: "allowed-secret-value",
          SystemRoot: process.env.SystemRoot,
        },
        redactValues: ["allowed-secret-value"],
      }));

      expect(result.status).toBe("completed");
      expect(result.output).toContain("allowed=[REDACTED_SECRET]");
      expect(result.output).toContain("inherited=missing");
      expect(JSON.stringify(result.events)).not.toContain("allowed-secret-value");
      expect(JSON.stringify(result.events)).not.toContain("outside-secret-value");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.ONI_TEST_INHERITED_SECRET;
      } else {
        process.env.ONI_TEST_INHERITED_SECRET = previousSecret;
      }
    }
  });

  it("createCliExternalAgentDriver caps retained events and captured output", async () => {
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      args: () => ["-e", "for (let i = 0; i < 20; i++) console.log(`line-${i}-${'x'.repeat(80)}`);"],
      stdin: "none",
      maxEvents: 3,
      maxOutputChars: 80,
      maxEventContentChars: 24,
    });

    const result = await driver.run(makeRequest({ provider: "test-cli" }), () => undefined);

    expect(result.status).toBe("completed");
    expect(result.events).toHaveLength(3);
    expect(result.output.length).toBeLessThanOrEqual(80);
    expect(result.metadata?.droppedEventCount).toBeGreaterThan(0);
    expect(result.metadata?.truncatedContentCount).toBeGreaterThan(0);
    expect(result.events.some((event) => event.data?.truncated)).toBe(true);
  });

  it("createCliExternalAgentDriver terminates long-running providers on timeout", async () => {
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      args: () => ["-e", "setInterval(() => console.log('tick'), 10);"],
      stdin: "none",
      timeoutMs: 75,
      maxEvents: 10,
    });

    const result = await driver.run(makeRequest({ provider: "test-cli" }), () => undefined);

    expect(result.status).toBe("failed");
    expect(result.events.some((event) => event.content?.includes("timed out"))).toBe(true);
  });

  it("createCliExternalAgentDriver terminates idle providers that produce no output", async () => {
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      // Stays alive but never writes to stdout/stderr — the idle watchdog fires.
      args: () => ["-e", "setTimeout(() => {}, 5000);"],
      stdin: "none",
      idleTimeoutMs: 100,
      maxEvents: 10,
    });

    const result = await driver.run(makeRequest({ provider: "test-cli" }), () => undefined);

    expect(result.status).toBe("failed");
    expect(result.events.some((event) => event.content?.includes("idle for"))).toBe(true);
  });

  it("createCliExternalAgentDriver keeps running while output resets the idle watchdog", async () => {
    const driver = createCliExternalAgentDriver({
      provider: "test-cli",
      command: process.execPath,
      // Emits lines on an interval shorter than the idle window, then exits.
      args: () => [
        "-e",
        "let n=0;const t=setInterval(()=>{console.log('tick');if(++n>=4)clearInterval(t);},20);",
      ],
      stdin: "none",
      idleTimeoutMs: 300,
      maxEvents: 50,
    });

    const result = await driver.run(makeRequest({ provider: "test-cli" }), () => undefined);

    expect(result.events.some((event) => event.content?.includes("idle for"))).toBe(false);
    expect(result.status).toBe("completed");
  });

  it("externalAgentAsNode throws when the provider process fails", async () => {
    const driver: ExternalAgentDriver = {
      provider: "codex",
      capabilities: lossyCaps(),
      run: vi.fn(async (request) => ({
        agentId: request.agentId,
        provider: request.provider,
        mode: request.mode,
        status: "failed",
        output: "",
        error: "boom",
        startedAt: 1,
        endedAt: 2,
        events: [],
      })),
    };

    const node = externalAgentAsNode(driver, { id: "bad-worker", provider: "codex" });
    await expect(node(makeState())).rejects.toThrow("bad-worker");
  });
});
