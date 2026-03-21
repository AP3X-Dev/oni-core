// ============================================================
// @oni.bot/core/swarm — AgentRegistry
// ============================================================
// A live catalog of agents in the swarm. Runtime injectable —
// register/deregister agents without recompiling the graph.
// ============================================================

import type { SwarmAgentDef, AgentStatus, AgentCapability } from "./types.js";

export interface AgentManifestEntry {
  id:           string;
  role:         string;
  capabilities: AgentCapability[];
  status:       AgentStatus;
  activeTasks:  number;
  totalRuns:    number;
  errors:       number;
}

export interface AgentRecord<S extends Record<string, unknown>> {
  def:         SwarmAgentDef<S>;
  status:      AgentStatus;
  activeTasks: number;
  totalRuns:   number;
  lastActive:  number | null;
  errors:      number;
}

export class AgentRegistry<S extends Record<string, unknown> = Record<string, unknown>> {
  private agents = new Map<string, AgentRecord<S>>();

  // ---- Registration ----

  register(def: SwarmAgentDef<S>): this {
    if (this.agents.has(def.id)) {
      throw new Error(`Agent "${def.id}" is already registered.`);
    }
    this.agents.set(def.id, {
      def,
      status:      "idle",
      activeTasks: 0,
      totalRuns:   0,
      lastActive:  null,
      errors:      0,
    });
    return this;
  }

  deregister(agentId: string): boolean {
    const rec = this.agents.get(agentId);
    if (!rec) return false;
    if (rec.activeTasks > 0) {
      throw new Error(
        `Cannot deregister agent "${agentId}": ${rec.activeTasks} active task(s) still in flight. ` +
          `Wait for tasks to complete (markIdle/markError) before deregistering.`,
      );
    }
    return this.agents.delete(agentId);
  }

  // ---- Lookups ----

  get(agentId: string): AgentRecord<S> | null {
    return this.agents.get(agentId) ?? null;
  }

  getDef(agentId: string): SwarmAgentDef<S> | null {
    return this.agents.get(agentId)?.def ?? null;
  }

  getAll(): AgentRecord<S>[] {
    return [...this.agents.values()];
  }

  /** Find agents by role (exact or partial match) */
  findByRole(role: string): AgentRecord<S>[] {
    return [...this.agents.values()].filter((a) =>
      a.def.role.toLowerCase().includes(role.toLowerCase())
    );
  }

  /** Find agents that have a specific capability by name */
  findByCapability(capabilityName: string): AgentRecord<S>[] {
    return [...this.agents.values()].filter((a) =>
      a.def.capabilities.some((c) =>
        c.name.toLowerCase().includes(capabilityName.toLowerCase())
      )
    );
  }

  /** Find idle agents ready to accept work */
  findIdle(): AgentRecord<S>[] {
    return [...this.agents.values()].filter(
      (a) => a.status !== "terminated" && a.status !== "error" &&
        (a.status === "idle" || a.activeTasks < (a.def.maxConcurrency ?? 1))
    );
  }

  /** Find the least-busy agent across all registered agents */
  leastBusy(): AgentRecord<S> | null {
    const available = [...this.agents.values()].filter(
      (a) => a.status !== "terminated" && a.status !== "error"
    );
    if (!available.length) return null;
    return available.reduce((a, b) => (a.activeTasks <= b.activeTasks ? a : b));
  }

  // ---- Status management ----

  setStatus(agentId: string, status: AgentStatus): void {
    const rec = this.agents.get(agentId);
    if (rec) rec.status = status;
  }

  markBusy(agentId: string): void {
    const rec = this.agents.get(agentId);
    if (rec) {
      rec.status = "busy";
      rec.activeTasks++;
      rec.totalRuns++;
      rec.lastActive = Date.now();
    }
  }

  markIdle(agentId: string): void {
    const rec = this.agents.get(agentId);
    if (rec) {
      rec.activeTasks = Math.max(0, rec.activeTasks - 1);
      if (rec.activeTasks === 0) rec.status = "idle";
      rec.lastActive = Date.now();
    }
  }

  markError(agentId: string): void {
    const rec = this.agents.get(agentId);
    if (rec) {
      rec.errors++;
      rec.activeTasks = Math.max(0, rec.activeTasks - 1);
      rec.status = "error";
    }
  }

  // ---- Structured manifest ----

  manifest(): AgentManifestEntry[] {
    return [...this.agents.values()]
      .filter((a) => a.status !== "terminated")
      .map((a) => ({
        id:           a.def.id,
        role:         a.def.role,
        capabilities: a.def.capabilities,
        status:       a.status,
        activeTasks:  a.activeTasks,
        totalRuns:    a.totalRuns,
        errors:       a.errors,
      }));
  }

  // ---- Capability manifest (for LLM routing prompt) ----

  toManifest(): string {
    const sanitize = (s: string): string =>
      s.replace(/[\n\r]/g, " ").replace(/[<>]/g, "");

    return [...this.agents.values()]
      .filter((a) => a.status !== "terminated")
      .map((a) => {
        const caps = a.def.capabilities
          .map((c) => `    - ${sanitize(c.name)}: ${sanitize(c.description)}`)
          .join("\n");
        return `Agent ID: "${a.def.id}" | Role: ${sanitize(a.def.role)}\n  Capabilities:\n${caps}\n  Status: ${a.status} (active tasks: ${a.activeTasks})`;
      })
      .join("\n\n");
  }

  // ---- Stats ----

  stats(): Record<string, { status: AgentStatus; activeTasks: number; totalRuns: number; errors: number }> {
    const out: Record<string, ReturnType<typeof this.stats>[string]> = {};
    for (const [id, rec] of this.agents) {
      out[id] = {
        status:      rec.status,
        activeTasks: rec.activeTasks,
        totalRuns:   rec.totalRuns,
        errors:      rec.errors,
      };
    }
    return out;
  }
}
