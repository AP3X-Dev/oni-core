import process from "node:process";
import { describe, expect, it } from "vitest";
import { StdioTransport } from "../mcp/transport.js";
import type { JsonRpcNotification } from "../mcp/types.js";

function frame(message: unknown): string {
  const payload = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
}

function stdioServerScript(): string {
  return `
let buffer = Buffer.alloc(0);
function write(message) {
  process.stdout.write(${JSON.stringify("Content-Length: ")} + Buffer.byteLength(JSON.stringify(message)) + ${JSON.stringify("\r\n\r\n")} + JSON.stringify(message));
}
function processBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf(${JSON.stringify("\r\n\r\n")});
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + Number(match[1]);
    if (buffer.length < bodyEnd) return;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    const message = JSON.parse(body);
    if (message.id !== undefined) {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          method: message.method,
          params: message.params ?? {},
          allowedEnv: process.env.ALLOWED_ENV ?? null,
          inheritedSecret: process.env.SECRET_TOKEN ?? null
        }
      });
    } else if (message.method === "test/notify") {
      write({ jsonrpc: "2.0", method: "server/notice", params: message.params ?? {} });
    }
  }
}
process.stdin.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  processBuffer();
});
setInterval(() => {}, 1000);
`;
}

async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs = 1000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("StdioTransport real stdio integration", () => {
  it("spawns with minimal env, exchanges framed requests, and receives notifications", async () => {
    process.env.SECRET_TOKEN = "must-not-leak";
    const notifications: JsonRpcNotification[] = [];
    const transport = new StdioTransport({
      command: process.execPath,
      args: ["-e", stdioServerScript()],
      env: { ALLOWED_ENV: "allowed" },
      spawnTimeout: 1000,
      onNotification: (notification) => notifications.push(notification),
    });

    try {
      await transport.start();
      expect(transport.isConnected()).toBe(true);

      const response = await transport.send("test/ping", { value: 42 }, 1000);
      expect(response.result).toEqual({
        method: "test/ping",
        params: { value: 42 },
        allowedEnv: "allowed",
        inheritedSecret: null,
      });

      transport.notify("test/notify", { value: "seen" });
      await expect(waitFor(() => notifications[0])).resolves.toMatchObject({
        method: "server/notice",
        params: { value: "seen" },
      });
    } finally {
      transport.stop();
      delete process.env.SECRET_TOKEN;
    }
  });

  it("rejects dangerous command strings before spawning", async () => {
    const transport = new StdioTransport({
      command: "node && whoami",
      spawnTimeout: 50,
    });

    await expect(transport.start()).rejects.toThrow("dangerous characters");
  });

  it("preserves incomplete frame bytes until the rest of the body arrives", () => {
    const notifications: JsonRpcNotification[] = [];
    const transport = new StdioTransport({
      command: "echo",
      onNotification: (notification) => notifications.push(notification),
    });

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method: "server/partial",
      params: { ok: true },
    });
    const framed = frame(JSON.parse(payload));

    (transport as unknown as { buffer: Buffer }).buffer = Buffer.from(framed.slice(0, -2));
    (transport as unknown as { processBuffer: () => void }).processBuffer();
    expect(notifications).toHaveLength(0);

    (transport as unknown as { buffer: Buffer }).buffer = Buffer.from(framed);
    (transport as unknown as { processBuffer: () => void }).processBuffer();
    expect(notifications).toEqual([
      expect.objectContaining({ method: "server/partial" }),
    ]);
  });
});
