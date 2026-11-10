// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Generated-code detection (inferred): path conventions, configured globs, or a marker in the first lines.
import { matchesAny } from "../config.js";
const GENERATED_PATH = [
    /(^|\/)(__generated__|generated|gen)\//,
    /\.(gen|generated)\.[cm]?[jt]sx?$/,
    /\.pb\.[cm]?[jt]s$/,
    /_pb\.[cm]?[jt]s$/,
    /\.g\.[cm]?[jt]s$/,
];
const MARKER = /@generated\b|\bDO NOT EDIT\b|\bauto-?generated\b|\bThis file (was|is) (automatically )?generated\b/i;
/**
 * True when a file looks generated: a known generated path, a configured glob, or a marker such as
 * `@generated` or "DO NOT EDIT" in its first five lines.
 */
export function isGenerated(path, text, extraGlobs) {
    if (GENERATED_PATH.some((re) => re.test(path)))
        return true;
    if (extraGlobs.length > 0 && matchesAny(path, extraGlobs))
        return true;
    if (text === null)
        return false;
    return MARKER.test(text.split("\n", 5).join("\n"));
}
