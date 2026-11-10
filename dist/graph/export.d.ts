import { type Config } from "../config.js";
import type { FileKind, GraphStats, Language, Limitation } from "../types.js";
/** Graph document version (independent of the report schema). */
export declare const GRAPH_SCHEMA_VERSION: "1.0";
/** One import specifier and the first line that contains it. */
export interface GraphImport {
    specifier: string;
    line: number | null;
}
/** An import that is not a resolved local edge (unresolved local, npm package or Node built-in). */
export interface GraphModuleImport extends GraphImport {
    from: string;
}
/** The `impact-check graph --format json` document (graph schema 1.0). */
export interface GraphExport {
    schema_version: typeof GRAPH_SCHEMA_VERSION;
    repo_revision: {
        ref: string;
        commit: string;
        kind: "commit" | "worktree";
    };
    repository: {
        name: string;
        ts_config: string | null;
        workspace_packages: {
            name: string;
            path: string;
        }[];
    };
    modules: {
        path: string;
        language: Language;
        kind: FileKind;
        package: string | null;
    }[];
    edges: {
        from: string;
        to: string;
        provenance: "graph" | "inferred";
        type_only: boolean;
        imports: GraphImport[];
    }[];
    unresolved_imports: GraphModuleImport[];
    external_imports: GraphModuleImport[];
    stats: GraphStats;
    coverage_limitations: Limitation[];
    run_metadata: {
        tool: "impact-check";
        tool_version: string;
        generated_at: string;
        node_version: string;
        engine: "dependency-cruiser";
        engine_version: string;
        parser_version: string;
        network: false;
        executed_repository_code: false;
    };
}
/** Options for exportGraph(). */
export interface GraphOptions {
    cwd: string;
    /** Head ref; null = the working tree. */
    head: string | null;
    tsConfig?: string | null;
    config?: Config;
    now?: () => Date;
    log?: (message: string) => void;
}
/** Builds the module graph of one revision. */
export declare function exportGraph(options: GraphOptions): Promise<GraphExport>;
