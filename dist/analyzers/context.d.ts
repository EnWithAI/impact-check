import type { Snapshot } from "../snapshot/snapshot.js";
import type { RepositoryContext } from "../types.js";
/**
 * Detects languages (by file count), module type, workspace tools, test frameworks and the tsconfig
 * module resolution of the analyzed snapshot.
 */
export declare function detectContext(snapshot: Snapshot, tsConfig: string | null): RepositoryContext;
