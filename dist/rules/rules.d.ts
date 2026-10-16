import type { FileHunks } from "../git/repo.js";
import type { ModuleGraph } from "../graph/graph.js";
import type { Limitations } from "../analysis/limitations.js";
import type { Snapshot } from "../snapshot/snapshot.js";
import type { ChangedFile, Finding } from "../types.js";
/** Everything a rule may look at. Rules are pure apart from the limitation collector. */
export interface RuleContext {
    files: ChangedFile[];
    hunks: Map<string, FileHunks>;
    head: ModuleGraph;
    base: ModuleGraph | null;
    headSnapshot: Snapshot;
    /** Reads a file from the comparison's starting commit (base side). */
    readBase: (path: string) => Promise<string | null>;
    /** Reads any file (not only snapshot files) from the head side: the head commit or the working tree. */
    readHead: (path: string) => Promise<string | null>;
    dependentCounts: Map<string, number>;
    blastRadiusThreshold: number;
    maxDepth: number;
    securityPathPatterns: string[];
    limitations: Limitations;
}
/** Stable finding id: `<rule>:<first 8 hex of sha256(rule + key)>`, identical across runs. */
export declare function findingId(ruleId: string, key: string): string;
/** Run every rule and return findings sorted by severity, rule and id. */
export declare function runRules(ctx: RuleContext): Promise<Finding[]>;
