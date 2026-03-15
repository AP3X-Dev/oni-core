import type { AdaptedToolDefinition, ActivePiecesAction } from "../adapter/index.js";
import type { AuthResolver } from "../adapter/auth-resolver.js";
import { adaptActivePiece } from "../adapter/index.js";

export class ToolRegistry {
  private readonly actions = new Map<string, ActivePiecesAction>();
  private readonly resolvers = new Map<string, AuthResolver>();

  register(action: ActivePiecesAction, authResolver: AuthResolver): this {
    this.actions.set(action.name, action);
    this.resolvers.set(action.name, authResolver);
    return this;
  }

  get(name: string): AdaptedToolDefinition | undefined {
    const action = this.actions.get(name);
    const resolver = this.resolvers.get(name);
    if (!action || !resolver) return undefined;
    return adaptActivePiece(action, resolver);
  }

  list(): AdaptedToolDefinition[] {
    return Array.from(this.actions.entries()).map(([name]) => {
      const resolver = this.resolvers.get(name)!;
      return adaptActivePiece(this.actions.get(name)!, resolver);
    });
  }

  listNames(): string[] {
    return Array.from(this.actions.keys());
  }
}
