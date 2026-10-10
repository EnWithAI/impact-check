// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
/**
 * Build step: removes dist/ so stale compiled files never ship.
 */
import { rmSync } from "node:fs";
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
