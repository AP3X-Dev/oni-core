import type { ToolPermissions } from "../tools/types.js";

export class ToolPermissionError extends Error {
  constructor(public readonly agent: string, public readonly tool: string) {
    super(`Agent "${agent}" is not permitted to use tool "${tool}"`);
    this.name = "ToolPermissionError";
  }
}

export function checkToolPermission(permissions: ToolPermissions, agentName: string, toolName: string): void {
  const allowed = permissions[agentName];
  if (allowed === undefined) throw new ToolPermissionError(agentName, toolName);
  if (allowed === "*") return;
  if (Array.isArray(allowed) && allowed.includes(toolName)) return;
  throw new ToolPermissionError(agentName, toolName);
}

export function getPermittedTools(permissions: ToolPermissions, agentName: string, allTools: string[]): string[] {
  const allowed = permissions[agentName];
  if (allowed === undefined) return [];
  if (allowed === "*") return allTools;
  return allowed.filter(t => allTools.includes(t));
}
