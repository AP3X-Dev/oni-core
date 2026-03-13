// ============================================================
// @oni.bot/core CLI — Argument Parser & Router
// Zero-dep argument parsing and command dispatch
// ============================================================

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help", positional: [], flags: {} };

  const first = argv[0]!;
  if (first === "--help" || first === "-h") return { command: "help", positional: [], flags: {} };
  if (first === "--version" || first === "-v") return { command: "version", positional: [], flags: {} };

  const command = first;
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        // --flag=value
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else {
        // --flag or --flag value
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      // Short flag: -p value
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { command, positional, flags };
}

const VERSION = "0.8.1";

export function getVersionText(): string {
  return `@oni.bot/core v${VERSION}`;
}

export function getHelpText(): string {
  return `
  ${getVersionText()} — Agent Swarm Framework

  Usage: oni <command> [options]

  Commands:
    init <name>          Create a new ONI project
    dev [file]           Start dev server with hot-reload
    run <file>           Execute an agent or swarm
    inspect <file>       Print graph topology
    test [pattern]       Run agent tests
    build                Build and validate project

  Options:
    --help, -h           Show this help
    --version, -v        Show version

  Examples:
    oni init my-swarm
    oni dev src/agent.ts
    oni run src/agent.ts --verbose
    oni inspect src/graph.ts --format mermaid
    oni test
    oni build
`;
}

export type CommandHandler = (args: ParsedArgs) => Promise<void>;

export interface CommandRegistry {
  [command: string]: CommandHandler;
}

export async function runCLI(argv: string[], commands: CommandRegistry): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help") {
    console.log(getHelpText());
    return;
  }

  if (parsed.command === "version") {
    console.log(getVersionText());
    return;
  }

  const handler = commands[parsed.command];
  if (!handler) {
    console.error(`  Unknown command: ${parsed.command}\n`);
    console.log(getHelpText());
    process.exitCode = 1;
    return;
  }

  await handler(parsed);
}
