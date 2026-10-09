// Generated-code detection (inferred): path conventions, configured globs, or a marker in the first lines.
import { matchesAny } from "../config.js";

const GENERATED_PATH = [
  /(^|\/)(__generated__|generated|gen)\//,
  /\.(gen|generated)\.[cm]?[jt]sx?$/,
  /\.pb\.[cm]?[jt]s$/,
  /_pb\.[cm]?[jt]s$/,
  /\.g\.[cm]?[jt]s$/,
];
const MARKER =
  /@generated\b|\bDO NOT EDIT\b|\bauto-?generated\b|\bThis file (was|is) (automatically )?generated\b/i;

export function isGenerated(path: string, text: string | null, extraGlobs: readonly string[]): boolean {
  if (GENERATED_PATH.some((re) => re.test(path))) return true;
  if (extraGlobs.length > 0 && matchesAny(path, extraGlobs)) return true;
  if (text === null) return false;
  return MARKER.test(text.split("\n", 5).join("\n"));
}
