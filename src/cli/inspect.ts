// ============================================================
// @oni.bot/core CLI — inspect command
// Print graph topology as table or Mermaid
// ============================================================

import type { ParsedArgs } from "./router.js";
import type { GraphDescriptor } from "../inspect.js";

export function formatGraphTable(descriptor: GraphDescriptor): string {
  const lines: string[] = [];

  lines.push("  Graph Topology");
  lines.push("  " + "\u2500".repeat(50));

  // Nodes
  lines.push("\n  Nodes:");
  for (const node of descriptor.nodes) {
    const type = node.type === "start" ? " (entry)" : node.type === "end" ? " (exit)" : "";
    lines.push(`    ${node.id}${type}`);
  }

  // Edges
  lines.push("\n  Edges:");
  for (const edge of descriptor.edges) {
    const label = edge.type === "conditional" ? " (conditional)" : "";
    lines.push(`    ${edge.from} \u2192 ${edge.to}${label}`);
  }

  // Topology
  lines.push("\n  Topological Order:");
  if (descriptor.topoOrder) {
    lines.push(`    ${descriptor.topoOrder.join(" \u2192 ")}`);
  } else {
    lines.push("    (graph has cycles, no topological order)");
  }

  // Cycles
  lines.push("\n  Cycles:");
  if (descriptor.cycles.length === 0) {
    lines.push("    No cycles detected");
  } else {
    for (const cycle of descriptor.cycles) {
      lines.push(`    ${cycle.join(" \u2192 ")} \u2192 ${cycle[0]}`);
    }
  }

  // Terminals
  lines.push("\n  Terminal Nodes:");
  lines.push(`    ${descriptor.terminals.join(", ")}`);

  return lines.join("\n");
}

export async function inspectCommand(args: ParsedArgs): Promise<void> {
  const file = args.positional[0];
  if (!file) {
    console.error("  Error: file required\n  Usage: oni inspect <file>");
    process.exitCode = 1;
    return;
  }

  const format = args.flags.format ?? "table";

  try {
    // Dynamic import the file to get the graph
    const mod = await import(/* @vite-ignore */ file);

    // Look for exported graph or app
    const graph = mod.graph ?? mod.default ?? mod.app;
    if (!graph) {
      console.error("  Error: file must export a 'graph', 'app', or default export");
      process.exitCode = 1;
      return;
    }

    // Import inspect utilities
    const { buildGraphDescriptor, toMermaidDetailed } = await import("../inspect.js");

    // Access internal state (nodes + edges) to build descriptor
    const nodes = (graph as any).nodes ?? (graph as any)._nodes;
    const edges = (graph as any).edges ?? (graph as any)._edges;

    if (!nodes || !edges) {
      console.error("  Error: could not extract graph structure. Is this a StateGraph?");
      process.exitCode = 1;
      return;
    }

    const descriptor = buildGraphDescriptor(nodes, edges);

    if (format === "mermaid") {
      console.log(toMermaidDetailed(descriptor));
    } else {
      console.log(formatGraphTable(descriptor));
    }
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
