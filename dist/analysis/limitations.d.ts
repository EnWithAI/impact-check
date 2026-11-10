/**
 * Collector for coverage limitations: what the analysis could not see or decide. Deterministic output
 * (sorted codes and paths, capped example lists with true counts).
 */
import type { Limitation } from "../types.js";
/** Collects coverage limitations deterministically (sorted codes and paths, capped examples). */
export declare class Limitations {
    private readonly entries;
    add(code: string, message: string, path?: string): void;
    /** Record a limitation with an explicit count (no paths). */
    addCount(code: string, message: string, count: number): void;
    has(code: string): boolean;
    merge(other: Limitations): void;
    toArray(maxPaths?: number): Limitation[];
}
/** Locale-independent string comparison used for every sort, so output order is identical on all machines. */
export declare function compareStrings(a: string, b: string): number;
