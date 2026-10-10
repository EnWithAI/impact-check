#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Executable entry point for the `impact-check` command. Delegates to run() and sets the exit code.
 */
import { run } from "./run.js";

const code = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
});
process.exitCode = code;
