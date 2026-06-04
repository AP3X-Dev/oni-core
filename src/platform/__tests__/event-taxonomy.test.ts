import { describe, it, expect } from "vitest";
import {
  EXTERNAL_AGENT_EVENT_TAXONOMY,
  EXTERNAL_AGENT_EVENT_TAXONOMY_VERSION,
  externalAgentEventPhase,
  isTerminalExternalAgentEvent,
} from "../event-taxonomy.js";

const ALL_TYPES = [
  "external_agent_start",
  "external_agent_stdout",
  "external_agent_stderr",
  "external_agent_text_delta",
  "external_agent_thinking",
  "external_agent_tool_call",
  "external_agent_tool_result",
  "external_agent_diff",
  "external_agent_artifact",
  "external_agent_error",
  "external_agent_finish",
] as const;

describe("external-agent event taxonomy", () => {
  it("declares a stable schema version", () => {
    expect(EXTERNAL_AGENT_EVENT_TAXONOMY_VERSION).toBe(1);
  });

  it("maps every event type to a taxonomy entry", () => {
    for (const type of ALL_TYPES) {
      const entry = EXTERNAL_AGENT_EVENT_TAXONOMY[type];
      expect(entry).toBeDefined();
      expect(entry.description.length).toBeGreaterThan(0);
      expect(externalAgentEventPhase(type)).toBe(entry.phase);
    }
  });

  it("treats only the finish event as terminal", () => {
    expect(isTerminalExternalAgentEvent("external_agent_finish")).toBe(true);
    for (const type of ALL_TYPES.filter((t) => t !== "external_agent_finish")) {
      expect(isTerminalExternalAgentEvent(type)).toBe(false);
    }
  });

  it("assigns sensible phases to representative events", () => {
    expect(externalAgentEventPhase("external_agent_start")).toBe("starting");
    expect(externalAgentEventPhase("external_agent_text_delta")).toBe("streaming");
    expect(externalAgentEventPhase("external_agent_tool_call")).toBe("tool");
    expect(externalAgentEventPhase("external_agent_diff")).toBe("artifact");
    expect(externalAgentEventPhase("external_agent_error")).toBe("error");
  });
});
