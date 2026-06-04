// ============================================================
// @oni.bot/core/platform - Durable filesystem stores
// ============================================================
// JSON-file stores for local and single-node deployments. They are
// intentionally dependency-free and use atomic replace writes.
// ============================================================

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AgentSession,
  AgentSessionStatus,
  AgentSessionStore,
  ArtifactStore,
  OutputArtifact,
} from "./types.js";

interface SessionFileData {
  version: 1;
  sessions: Record<string, AgentSession>;
}

interface ArtifactFileData {
  version: 1;
  artifacts: Record<string, OutputArtifact[]>;
}

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return cloneRecord(fallback);
    throw error;
  }
}

async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

class JsonFileLock {
  private pending: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class JsonFileAgentSessionStore implements AgentSessionStore {
  private readonly lock = new JsonFileLock();

  constructor(private readonly filePath: string) {}

  async create(session: AgentSession): Promise<void> {
    await this.lock.run(async () => {
      const data = await this.load();
      if (data.sessions[session.id]) {
        throw new Error(`Session already exists: ${session.id}`);
      }
      data.sessions[session.id] = cloneRecord(session);
      await this.writeData(data);
    });
  }

  async save(session: AgentSession): Promise<void> {
    await this.lock.run(async () => {
      const data = await this.load();
      if (!data.sessions[session.id]) {
        throw new Error(`Session not found: ${session.id}`);
      }
      data.sessions[session.id] = cloneRecord(session);
      await this.writeData(data);
    });
  }

  async get(sessionId: string): Promise<AgentSession | null> {
    const data = await this.load();
    const session = data.sessions[sessionId];
    return session ? cloneRecord(session) : null;
  }

  async list(filter?: { status?: AgentSessionStatus }): Promise<AgentSession[]> {
    const data = await this.load();
    const sessions = Object.values(data.sessions)
      .filter((session) => !filter?.status || session.status === filter.status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return sessions.map((session) => cloneRecord(session));
  }

  private async load(): Promise<SessionFileData> {
    return readJsonFile<SessionFileData>(this.filePath, { version: 1, sessions: {} });
  }

  private async writeData(data: SessionFileData): Promise<void> {
    await writeJsonFile(this.filePath, data);
  }
}

export class JsonFileArtifactStore implements ArtifactStore {
  private readonly lock = new JsonFileLock();

  constructor(private readonly filePath: string) {}

  async put(artifact: OutputArtifact): Promise<void> {
    await this.lock.run(async () => {
      const data = await this.load();
      const artifacts = data.artifacts[artifact.sessionId] ?? [];
      const existingIndex = artifacts.findIndex((item) => item.id === artifact.id);
      if (existingIndex >= 0) {
        artifacts[existingIndex] = cloneRecord(artifact);
      } else {
        artifacts.push(cloneRecord(artifact));
      }
      data.artifacts[artifact.sessionId] = artifacts;
      await this.save(data);
    });
  }

  async list(sessionId: string): Promise<OutputArtifact[]> {
    const data = await this.load();
    return (data.artifacts[sessionId] ?? []).map((artifact) => cloneRecord(artifact));
  }

  private async load(): Promise<ArtifactFileData> {
    return readJsonFile<ArtifactFileData>(this.filePath, { version: 1, artifacts: {} });
  }

  private async save(data: ArtifactFileData): Promise<void> {
    await writeJsonFile(this.filePath, data);
  }
}
