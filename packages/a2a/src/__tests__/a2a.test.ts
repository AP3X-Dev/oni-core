import { describe, it, expect } from "vitest";
import { generateAgentCard } from "../card/generator.js";
import { A2AClient } from "../client/index.js";
import { A2AServer } from "../server/index.js";
import { a2aAgent } from "../swarm/a2a-agent.js";

describe("generateAgentCard", () => {
  it("generates a valid agent card", () => {
    const card = generateAgentCard({
      name: "Test Agent",
      description: "A test agent",
      url: "http://localhost:3001",
      skills: [{ id: "test", name: "Test Skill" }],
    });
    expect(card.name).toBe("Test Agent");
    expect(card.capabilities).toBeDefined();
    expect(card.skills).toHaveLength(1);
  });
});

describe("A2AClient.asToolDefinition", () => {
  it("returns valid ToolDefinition shape", () => {
    const client = new A2AClient({ baseUrl: "http://localhost:3001" });
    const tool = client.asToolDefinition({ name: "remote_agent", description: "A remote agent" });
    expect(tool.name).toBe("remote_agent");
    expect(tool.schema.type).toBe("object");
    expect(tool.schema.required).toContain("message");
  });
});

describe("A2AServer + A2AClient round trip", () => {
  it("handles tasks/send in-process", async () => {
    const card = generateAgentCard({
      name: "Echo Agent",
      description: "Echoes messages",
      url: "http://test",
    });

    const server = new A2AServer(card, async (message) => `Echo: ${message}`);
    const handler = server.requestHandler();

    // Simulate a client request directly
    const reqBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/send",
      params: { id: "test-task", message: { role: "user", parts: [{ type: "text", text: "hello" }] } },
    };

    const req = new Request("http://test/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { result: { artifacts: Array<{ parts: Array<{ text: string }> }> } };
    expect(data.result.artifacts[0]!.parts[0]!.text).toBe("Echo: hello");
  });

  it("serves agent card at /.well-known/agent.json", async () => {
    const card = generateAgentCard({ name: "Test", description: "Test", url: "http://test" });
    const server = new A2AServer(card, async () => "ok");
    const handler = server.requestHandler();

    const req = new Request("http://test/.well-known/agent.json");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const returned = await res.json() as { name: string };
    expect(returned.name).toBe("Test");
  });
});

describe("a2aAgent", () => {
  it("creates an agent def with correct shape", () => {
    const agent = a2aAgent({
      id: "remote-researcher",
      role: "Researches topics using web search",
      clientConfig: { baseUrl: "http://remote-agent:3000" },
    });
    expect(agent.id).toBe("remote-researcher");
    expect(typeof agent.invoke).toBe("function");
    const tool = agent.asTool();
    expect(tool.name).toBe("remote-researcher");
  });
});
