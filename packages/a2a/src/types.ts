// A2A Protocol types (based on A2A spec)
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version?: string;
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}

export interface A2AMessage {
  role: "user" | "agent";
  parts: Array<{ type: "text"; text: string } | { type: "data"; data: unknown }>;
}

export interface A2ATask {
  id: string;
  status: { state: "submitted" | "working" | "completed" | "failed"; message?: A2AMessage };
  artifacts?: Array<{ name?: string; parts: A2AMessage["parts"] }>;
}

export interface A2AClientConfig {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface GenerateCardOptions {
  name: string;
  description: string;
  url: string;
  version?: string;
  skills?: AgentSkill[];
  streaming?: boolean;
}
