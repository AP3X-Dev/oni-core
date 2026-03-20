import { describe, it, expect, vi, afterEach } from "vitest";
import { openai } from "../models/openai.js";

describe("BUG-0045: OpenAI empty API key throws at construction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("BUG-0045: should throw descriptive error when API key is empty string", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => openai("gpt-4")).toThrow(/API key/i);
  });

  it("BUG-0045: should throw when API key is undefined and env is unset", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => openai("gpt-4", { apiKey: undefined })).toThrow(/API key/i);
  });

  it("BUG-0045: should not throw when a valid API key is provided", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => openai("gpt-4", { apiKey: "sk-test-key" })).not.toThrow();
  });
});
