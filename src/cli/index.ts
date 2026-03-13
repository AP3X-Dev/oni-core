#!/usr/bin/env node
// ============================================================
// @oni.bot/core CLI — entry point
// ============================================================

import { runCLI } from "./router.js";
import { initCommand } from "./init.js";
import { runCommand } from "./run.js";
import { inspectCommand } from "./inspect.js";
import { devCommand } from "./dev.js";
import { testCommand } from "./test.js";
import { buildCommand } from "./build.js";
import type { CommandRegistry } from "./router.js";

const commands: CommandRegistry = {
  init: initCommand,
  dev: devCommand,
  run: runCommand,
  inspect: inspectCommand,
  test: testCommand,
  build: buildCommand,
};

await runCLI(process.argv.slice(2), commands);
