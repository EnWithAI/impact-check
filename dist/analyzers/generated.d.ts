/**
 * True when a file looks generated: a known generated path, a configured glob, or a marker such as
 * `@generated` or "DO NOT EDIT" in its first five lines.
 */
export declare function isGenerated(path: string, text: string | null, extraGlobs: readonly string[]): boolean;
