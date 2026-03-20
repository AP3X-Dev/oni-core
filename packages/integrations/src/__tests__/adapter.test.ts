import { describe, it, expect, vi } from "vitest";
import { adaptActivePiece, propsToJsonSchema } from "../adapter/index.js";
import { apiKeyAuthResolver, oauth2AuthResolver, storeAuthResolver } from "../adapter/auth-resolver.js";
import { PropertyType } from "../adapter/props-to-schema.js";
import { adaptedGmailTools } from "../pieces/gmail.js";

describe("propsToJsonSchema", () => {
  it("converts string properties", () => {
    const schema = propsToJsonSchema({
      name: { type: PropertyType.SHORT_TEXT, displayName: "Name", required: true },
    });
    expect(schema.properties!.name.type).toBe("string");
    expect(schema.required).toContain("name");
  });

  it("converts number properties", () => {
    const schema = propsToJsonSchema({
      count: { type: PropertyType.NUMBER, displayName: "Count", required: false },
    });
    expect(schema.properties!.count.type).toBe("number");
    expect(schema.required).not.toContain("count");
  });

  it("converts checkbox to boolean", () => {
    const schema = propsToJsonSchema({
      enabled: { type: PropertyType.CHECKBOX, displayName: "Enabled", required: false },
    });
    expect(schema.properties!.enabled.type).toBe("boolean");
  });

  it("converts dropdown to enum", () => {
    const schema = propsToJsonSchema({
      color: {
        type: PropertyType.STATIC_SELECT,
        displayName: "Color",
        required: true,
        options: { options: [{ label: "Red", value: "red" }, { label: "Blue", value: "blue" }] },
      },
    });
    expect(schema.properties!.color.enum).toEqual(["red", "blue"]);
  });

  it("converts file to object", () => {
    const schema = propsToJsonSchema({
      file: { type: PropertyType.FILE, displayName: "File", required: true },
    });
    expect(schema.properties!.file.type).toBe("object");
  });
});

describe("adaptActivePiece", () => {
  it("converts action to ToolDefinition shape", () => {
    const mockAction = {
      name: "test_action",
      displayName: "Test Action",
      description: "A test action",
      props: {
        input: { type: PropertyType.SHORT_TEXT, displayName: "Input", required: true },
      },
      run: vi.fn().mockResolvedValue({ result: "ok" }),
    };

    const resolver = apiKeyAuthResolver(() => "my-api-key");
    const tool = adaptActivePiece(mockAction, resolver);

    expect(tool.name).toBe("test_action");
    expect(tool.schema.type).toBe("object");
    expect(tool.parallelSafe).toBe(false); // "test" is not read-only
  });

  it("marks read-only actions as parallelSafe", () => {
    const mockAction = {
      name: "get_items",
      displayName: "Get Items",
      description: "Gets items",
      props: {},
      run: vi.fn().mockResolvedValue([]),
    };
    const tool = adaptActivePiece(mockAction, apiKeyAuthResolver(() => "key"));
    expect(tool.parallelSafe).toBe(true);
  });

  it("calls authResolver and passes to action.run", async () => {
    const mockRun = vi.fn().mockResolvedValue({ success: true });
    const mockAction = {
      name: "test_write",
      displayName: "Test",
      description: "Test",
      props: { text: { type: PropertyType.SHORT_TEXT, displayName: "Text", required: true } },
      run: mockRun,
    };
    const resolver = apiKeyAuthResolver(() => "resolved-key");
    const tool = adaptActivePiece(mockAction, resolver);
    await tool.execute({ text: "hello" }, {});
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ auth: "resolved-key", propsValue: { text: "hello" } }));
  });

  it("strips prototype-polluting keys from input before passing to action.run", async () => {
    const mockRun = vi.fn().mockResolvedValue({ ok: true });
    const mockAction = {
      name: "write_data",
      displayName: "Write",
      description: "Writes data",
      props: { text: { type: PropertyType.SHORT_TEXT, displayName: "Text", required: true } },
      run: mockRun,
    };
    const resolver = apiKeyAuthResolver(() => "key");
    const tool = adaptActivePiece(mockAction, resolver);

    await tool.execute({
      text: "safe",
      __proto__: { polluted: true },
      constructor: { polluted: true },
      prototype: { polluted: true },
      nested: { __proto__: { bad: true }, ok: "yes" },
    } as Record<string, unknown>, {});

    const passed = mockRun.mock.calls[0][0].propsValue;
    expect(passed).not.toHaveProperty("__proto__");
    expect(passed).not.toHaveProperty("constructor");
    expect(passed).not.toHaveProperty("prototype");
    expect(passed.text).toBe("safe");
    expect((passed.nested as Record<string, unknown>)).not.toHaveProperty("__proto__");
    expect((passed.nested as Record<string, unknown>).ok).toBe("yes");
  });
});

describe("storeAuthResolver", () => {
  it("throws when credentials not found", async () => {
    const mockStore = { get: vi.fn().mockResolvedValue(null) };
    const resolver = storeAuthResolver(mockStore, "gmail");
    await expect(resolver.resolve({}, {})).rejects.toThrow("No credentials found");
  });

  it("returns stored credentials", async () => {
    const mockStore = { get: vi.fn().mockResolvedValue({ value: { access_token: "tok" } }) };
    const resolver = storeAuthResolver(mockStore, "gmail");
    const creds = await resolver.resolve({}, {});
    expect(creds).toEqual({ access_token: "tok" });
  });
});

describe("adaptedGmailTools", () => {
  it("returns an array of ToolDefinitions", () => {
    const resolver = oauth2AuthResolver(async () => ({ accessToken: "tok" }));
    const tools = adaptedGmailTools(resolver);
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^gmail_/);
      expect(tool.schema.type).toBe("object");
    }
  });
});
