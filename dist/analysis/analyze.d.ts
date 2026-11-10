import { type Config } from "../config.js";
import type { Report } from "../types.js";
/** Options for analyze(). Explicit options take precedence over the config file. */
export interface AnalyzeOptions {
    cwd: string;
    /** Base ref; null = config or default ("main", falling back to origin/main, master, origin/master). */
    base: string | null;
    /** Head ref; null = analyze the working tree. */
    head: string | null;
    diffMode: "merge-base" | "direct";
    maxDepth?: number;
    maxAffected?: number;
    tsConfig?: string | null;
    config?: Config;
    now?: () => Date;
    log?: (message: string) => void;
    /** Where the config came from, recorded in run_metadata (e.g. ".impact-check.json"). */
    configSource?: string;
}
/** Maximum number of changed files analyzed and listed; the rest are reported as a limitation. */
export declare const MAX_FILES_CHANGED = 5000;
/** Run the full deterministic analysis. Never executes repository code and never uses the network. */
export declare function analyze(options: AnalyzeOptions): Promise<Report>;
