import type { AgentCard, GenerateCardOptions } from "../types.js";

export function generateAgentCard(opts: GenerateCardOptions): AgentCard {
  return {
    name: opts.name,
    description: opts.description,
    url: opts.url,
    version: opts.version ?? "1.0.0",
    capabilities: {
      streaming: opts.streaming ?? false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: opts.skills ?? [],
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
  };
}
