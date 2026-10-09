// Report contract types (schema 2.0). Must stay in sync with schema/changelens-report.schema.json (validated in tests).

export const SCHEMA_VERSION = "2.0" as const;

export type Provenance = "observed" | "graph" | "inferred";
export type Severity = "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
export type FindingStatus = "verified_static_fact" | "hypothesis" | "unknown";
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "type-changed" | "unmerged";
export type Language = "typescript" | "javascript" | "json" | "other";
export type FileKind = "source" | "test" | "config" | "other";
export type Origin = "committed" | "staged" | "unstaged" | "untracked" | "mixed";
export type FindingCategory =
  | "public-api"
  | "package-manifest"
  | "broken-import"
  | "deleted-module"
  | "migration"
  | "api-contract"
  | "configuration"
  | "security-sensitive"
  | "test-change"
  | "blast-radius";

export interface LineRange {
  start: number;
  end: number;
}

export interface ChangedFile {
  path: string;
  previous_path: string | null;
  status: FileStatus;
  binary: boolean;
  generated: boolean;
  language: Language;
  kind: FileKind;
  additions: number | null;
  deletions: number | null;
  origin: Origin;
  changed_lines: LineRange[];
  provenance: "observed";
}

export type EvidenceKind =
  | "diff-hunk"
  | "file-status"
  | "import-edge"
  | "export-declaration"
  | "path-pattern"
  | "manifest-field"
  | "graph-count";

export interface Evidence {
  kind: EvidenceKind;
  path: string;
  side: "base" | "head";
  line_start: number | null;
  line_end: number | null;
  commit: string | null;
  detail: string;
}

export interface AffectedModule {
  path: string;
  reason: "changed" | "dependent";
  distance: number;
  provenance: Provenance;
  via: string[];
  changed_roots: string[];
  evidence: Evidence[];
}

export interface Finding {
  id: string;
  rule_id: string;
  category: FindingCategory;
  severity: Severity;
  status: FindingStatus;
  confidence: Confidence;
  is_heuristic: boolean;
  provenance: Provenance;
  summary: string;
  explanation: string;
  recommended_human_action: string;
  evidence: Evidence[];
  affected_modules: string[];
}

export type TestReason = "changed-test" | "imports-affected-module" | "naming-convention";

export interface TestCandidate {
  path: string;
  reasons: TestReason[];
  related_to: string[];
  provenance: Provenance;
  execution_status: "not_run";
}

export interface Limitation {
  code: string;
  message: string;
  paths: string[];
  count: number;
}

export interface GraphStats {
  modules: number;
  edges: number;
  unresolved_local: number;
}

export interface RepositoryContext {
  languages: { language: string; files: number }[];
  module_type: "module" | "commonjs" | "unknown";
  workspace_tools: string[];
  test_frameworks: string[];
  module_resolution: string | null;
}

export interface Report {
  schema_version: typeof SCHEMA_VERSION;
  repo_revision: {
    ref: string;
    commit: string;
    kind: "commit" | "worktree";
    worktree: { included: boolean; staged: number; unstaged: number; untracked: number };
  };
  base_revision: {
    ref: string;
    commit: string;
    merge_base: string | null;
    diff_mode: "merge-base" | "direct";
  };
  repository: {
    name: string;
    is_shallow: boolean;
    ts_config: string | null;
    workspace_packages: { name: string; path: string }[];
    context: RepositoryContext;
  };
  summary: {
    analysis_mode: "full" | "degraded";
    files_changed: number;
    js_ts_files_changed: number;
    affected_modules: number;
    findings_by_severity: Record<Severity, number>;
    findings_by_status: Record<FindingStatus, number>;
    test_candidates: number;
    coverage_limitations: number;
  };
  changed_files: ChangedFile[];
  affected_modules: AffectedModule[];
  findings: Finding[];
  test_candidates: TestCandidate[];
  coverage_limitations: Limitation[];
  run_metadata: {
    tool: "changelens";
    tool_version: string;
    generated_at: string;
    duration_ms: number;
    timings_ms: Record<string, number>;
    node_version: string;
    engine: "dependency-cruiser";
    engine_version: string;
    parser_version: string;
    head_graph: GraphStats;
    base_graph: GraphStats | null;
    limits: { max_depth: number; max_affected: number; truncated: boolean };
    config_source: string;
    network: false;
    executed_repository_code: false;
    model_usage: null;
    review_effort: {
      files_to_review: number;
      findings_requiring_human_action: number;
      test_candidates: number;
    };
  };
}

export const SEVERITY_ORDER: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
