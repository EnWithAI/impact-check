/**
 * Build step: marks the compiled CLI entry point as executable.
 */
import { chmodSync } from "node:fs";
chmodSync(new URL("../dist/cli/main.js", import.meta.url), 0o755);
