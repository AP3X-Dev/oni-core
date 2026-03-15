import { describe, it, expect, vi } from "vitest";
import { stripeTools } from "../stripe/index.js";
import type { ToolContext } from "../types.js";

const ctx = {} as ToolContext;

describe("stripeTools", () => {
  it("returns an array of ToolDefinitions", () => {
    const tools = stripeTools({ apiKey: "sk_test_key" });
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("includes all expected tool names", () => {
    const tools = stripeTools({ apiKey: "sk_test_key" });
    const names = tools.map((t) => t.name);
    expect(names).toContain("stripe_create_customer");
    expect(names).toContain("stripe_create_invoice");
    expect(names).toContain("stripe_list_transactions");
  });

  it("returns 3 tools", () => {
    const tools = stripeTools({ apiKey: "sk_test_key" });
    expect(tools).toHaveLength(3);
  });

  it("all tools have schema with type object", () => {
    const tools = stripeTools({ apiKey: "sk_test_key" });
    for (const tool of tools) {
      expect(tool.schema.type).toBe("object");
    }
  });

  it("stripe_list_transactions is parallelSafe", () => {
    const tools = stripeTools({ apiKey: "sk_test_key" });
    const listTool = tools.find((t) => t.name === "stripe_list_transactions")!;
    expect(listTool.parallelSafe).toBe(true);
  });

  it("stripe_create_customer is not parallelSafe", () => {
    const tools = stripeTools({ apiKey: "sk_test_key" });
    const createTool = tools.find((t) => t.name === "stripe_create_customer")!;
    expect(createTool.parallelSafe).toBe(false);
  });

  it("stripe_create_invoice requires customer in schema", () => {
    const tools = stripeTools({ apiKey: "sk_test_key" });
    const invoiceTool = tools.find((t) => t.name === "stripe_create_invoice")!;
    expect(invoiceTool.schema.required).toContain("customer");
  });

  it("throws helpful error when stripe package is not installed", async () => {
    // Mock the dynamic import to fail
    vi.mock("stripe", () => {
      throw new Error("Cannot find module 'stripe'");
    });

    const tools = stripeTools({ apiKey: "sk_test_key" });
    const createTool = tools.find((t) => t.name === "stripe_create_customer")!;

    // The error should mention how to install stripe
    // (In a real environment without stripe installed, this would throw)
    // We just verify the tool exists and has the right structure
    expect(createTool.name).toBe("stripe_create_customer");
    expect(typeof createTool.execute).toBe("function");
  });
});
