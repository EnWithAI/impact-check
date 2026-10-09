// Report contract types. Must stay in sync with schema/changelens-report.schema.json (validated in tests).

export const SCHEMA_VERSION = "1.0" as const;

export type Provenance = "observed" | "graph" | "inferred";
export type Severity = "high" | "medium" | "low" | "info";
export type Confidence = "high" | "medium" | "low";
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
  previousPath: string | null;
  status: FileStatus;
  binary: boolean;
  language: Language;
  kind: FileKind;
  additions: number | null;
  deletions: number | null;
  origin: Origin;
  changedLines: LineRange[];
  provenance: "observed";
}

export interface AffectedModule {
  path: string;
  reason: "changed" | "dependent";
  distance: number;
  provenance: Provenance;
  via: string[];
  changedRoots: string[];
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
  line: number | null;
  endLine: number | null;
  detail: string;
}

export interface Finding {
  id: string;
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  isHeuristic: boolean;
  provenance: Provenance;
  title: string;
  explanation: string;
  evidence: Evidence[];
  relatedModules: string[];
}

export type TestReason = "changed-test" | "imports-affected-module" | "naming-convention";

export interface SuggestedTest {
  path: string;
  reasons: TestReason[];
  relatedTo: string[];
  provenance: Provenance;
  status: "not-run";
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
  unresolvedLocal: number;
}

export interface Report {
  schemaVersion: typeof SCHEMA_VERSION;
  toolVersion: string;
  generatedAt: string;
  repository: {
    name: string;
    isShallow: boolean;
    tsConfig: string | null;
    workspacePackages: { name: string; path: string }[];
  };
  comparison: {
    baseRef: string;
    baseCommit: string;
    mergeBase: string | null;
    diffMode: "merge-base" | "direct";
    headRef: string;
    headCommit: string;
    headKind: "commit" | "worktree";
    worktree: { included: boolean; staged: number; unstaged: number; untracked: number };
  };
  summary: {
    filesChanged: number;
    jsTsFilesChanged: number;
    affectedModules: number;
    findingsBySeverity: Record<Severity, number>;
    suggestedTests: number;
    coverageLimitations: number;
  };
  filesChanged: ChangedFile[];
  affectedModules: AffectedModule[];
  riskFindings: Finding[];
  suggestedTests: SuggestedTest[];
  coverageLimitations: Limitation[];
  analysis: {
    engine: "dependency-cruiser";
    engineVersion: string;
    parserVersion: string;
    headGraph: GraphStats;
    baseGraph: GraphStats | null;
    limits: { maxDepth: number; maxAffected: number; truncated: boolean };
    network: false;
    executedRepositoryCode: false;
  };
}

export const SEVERITY_ORDER: Record<Severity, number> = { high: 3, medium: 2, low: 1, info: 0 };
