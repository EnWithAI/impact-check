// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Report contract types (schema 2.0). Must stay in sync with schema/impact-check-report.schema.json (validated in tests).

export const SCHEMA_VERSION = "2.0" as const;

/** Where a claim comes from: observed = git diff; graph = resolver or parser; inferred = heuristic. */
export type Provenance = "observed" | "graph" | "inferred";
/** Review priority of a finding (not a probability). */
export type Severity = "high" | "medium" | "low" | "info";
/** Categorical confidence of a finding; never a percentage. */
export type Confidence = "high" | "medium" | "low";
/**
 * Epistemic status: verified_static_fact = determined by git/resolver/parser; hypothesis = inferred
 * from conventions or positions; unknown = the analyzer could not decide.
 */
export type FindingStatus = "verified_static_fact" | "hypothesis" | "unknown";
/** Change status of a file between base and head. */
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "type-changed" | "unmerged";
/** Language of a changed file, by extension. */
export type Language = "typescript" | "javascript" | "json" | "other";
/** Role of a changed file, by path convention (and `conventions.testPatterns`). */
export type FileKind = "source" | "test" | "config" | "other";
/** Where a change came from in working-tree mode; always "committed" in commit mode. */
export type Origin = "committed" | "staged" | "unstaged" | "untracked" | "mixed";
/** Finding categories (see docs/RULES.md). */
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

/** Inclusive 1-based line range. */
export interface LineRange {
  start: number;
  end: number;
}

/** One changed file (`changed_files[]`). */
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

/** Kind of evidence backing a finding or an affected module. */
export type EvidenceKind =
  | "diff-hunk"
  | "file-status"
  | "import-edge"
  | "export-declaration"
  | "path-pattern"
  | "manifest-field"
  | "graph-count"
  | "contract-element";

/**
 * A source reference: path and line range on one side of the comparison, the commit it refers to
 * (null for uncommitted content) and a short redacted descriptor (never file contents).
 */
export interface Evidence {
  kind: EvidenceKind;
  path: string;
  side: "base" | "head";
  line_start: number | null;
  line_end: number | null;
  commit: string | null;
  detail: string;
  /** Only on `contract-element` evidence (docs/CONTRACT_DIFF.md §6). */
  contract?: ContractLocation;
}

/** Where a contract difference sits: change class, JSON pointer and the line on each side. */
export interface ContractLocation {
  change: string;
  pointer: string;
  base_line: number | null;
  head_line: number | null;
}

/** A changed module (distance 0) or a module that depends on one (`affected_modules[]`). */
export interface AffectedModule {
  path: string;
  reason: "changed" | "dependent";
  distance: number;
  provenance: Provenance;
  via: string[];
  changed_roots: string[];
  evidence: Evidence[];
}

/** One finding (`findings[]`). `is_heuristic` is true exactly when `status` is not verified_static_fact. */
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

/** Why a test file is a candidate. */
export type TestReason = "changed-test" | "imports-affected-module" | "naming-convention";

/** A test file worth running for this change. Never executed by Impact Check. */
export interface TestCandidate {
  path: string;
  reasons: TestReason[];
  related_to: string[];
  provenance: Provenance;
  execution_status: "not_run";
}

/** Something the analysis could not see or decide (`coverage_limitations[]`). */
export interface Limitation {
  code: string;
  message: string;
  paths: string[];
  count: number;
}

/** Size of a dependency graph. */
export interface GraphStats {
  modules: number;
  edges: number;
  unresolved_local: number;
}

/** Detected repository context (names and counts only). */
export interface RepositoryContext {
  languages: { language: string; files: number }[];
  module_type: "module" | "commonjs" | "unknown";
  workspace_tools: string[];
  test_frameworks: string[];
  module_resolution: string | null;
}

/** The complete report (schema 2.0). */
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
    tool: "impact-check";
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

/** Numeric order of severities, used for sorting and policy thresholds. */
export const SEVERITY_ORDER: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
