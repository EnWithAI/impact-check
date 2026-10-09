import { createHash } from "node:crypto";
import type { FileHunks } from "../git/repo.js";
import type { ModuleGraph } from "../graph/graph.js";
import { findSpecifierLine } from "../graph/lexical.js";
import { extractExports, firstLineIn, importedNames, type ExportSet } from "../analyzers/exports.js";
import type { Limitations } from "../analysis/limitations.js";
import { manifestEntries, parseJsonObject } from "../graph/workspaces.js";
import type { Snapshot } from "../snapshot/snapshot.js";
import type {
  ChangedFile,
  Confidence,
  Evidence,
  Finding,
  FindingCategory,
  FindingStatus,
  Provenance,
  Severity,
} from "../types.js";
import { SEVERITY_ORDER } from "../types.js";
import { basenameOf, isConfigPath, isJsTs } from "../util/classify.js";
import { compareStrings } from "../analysis/limitations.js";
import { matchesAny } from "../config.js";

export interface RuleContext {
  files: ChangedFile[];
  hunks: Map<string, FileHunks>;
  head: ModuleGraph;
  base: ModuleGraph | null;
  headSnapshot: Snapshot;
  /** Reads a file from the comparison's starting commit (base side). */
  readBase: (path: string) => Promise<string | null>;
  dependentCounts: Map<string, number>;
  blastRadiusThreshold: number;
  maxDepth: number;
  securityPathPatterns: string[];
  limitations: Limitations;
}

type Draft = Omit<Finding, "id">;
const MAX_EVIDENCE = 25;

export function findingId(ruleId: string, key: string): string {
  return `${ruleId}:${createHash("sha256").update(`${ruleId}\0${key}`).digest("hex").slice(0, 8)}`;
}

function ev(
  kind: Evidence["kind"],
  path: string,
  side: Evidence["side"],
  detail: string,
  line: number | null = null,
  endLine: number | null = null
): Evidence {
  // `commit` is filled in by the analysis orchestrator, which knows which commit each side refers to.
  return { kind, path, side, line_start: line, line_end: endLine ?? line, commit: null, detail };
}

/** Fixed, rule-specific guidance for the reviewer (addendum: recommended_human_action). */
const ACTIONS: Record<string, string> = {
  "broken-import": "Update or remove the import, or restore the module; then run the listed test candidates.",
  "removed-export-still-imported": "Update the importing modules or restore the export before merging.",
  "export-removed":
    "Confirm the removal is intended and check consumers outside this repository (published packages, other services).",
  "export-surface-changed":
    "Check whether the signature change is backward compatible for every listed dependent.",
  "deleted-module-with-dependents":
    "Verify that no remaining code (including dynamic imports and other repositories) relies on the old path.",
  "package-entry-changed":
    "Review the change for effects on consumers of the package outside this repository.",
  "package-manifest-changed":
    "Review dependency, script and entry-point changes for compatibility and supply-chain impact.",
  "migration-changed":
    "Review migration ordering, reversibility and data impact, and plan the deployment sequence.",
  "api-contract-changed": "Check backward compatibility of the contract for all API consumers.",
  "config-changed":
    "Review the build, CI or runtime configuration change; confirm no credentials or permissions changed unintentionally.",
  "security-sensitive-change": "Request a focused security review of this change.",
  "tests-removed":
    "Confirm the deleted tests were obsolete or moved, and that coverage of the changed behavior remains.",
  "source-without-test-change": "Run the test candidates and consider adding tests for the changed behavior.",
  "wide-blast-radius":
    "Prioritize review and testing of the listed dependents; consider splitting the change.",
};

function draft(
  ruleId: string,
  category: FindingCategory,
  severity: Severity,
  confidence: Confidence,
  /** Boolean shorthand: true = hypothesis, false = verified_static_fact. */
  statusOrHeuristic: boolean | FindingStatus,
  provenance: Provenance,
  summary: string,
  explanation: string,
  evidence: Evidence[],
  affectedModules: string[] = []
): Draft {
  const status: FindingStatus =
    typeof statusOrHeuristic === "string"
      ? statusOrHeuristic
      : statusOrHeuristic
        ? "hypothesis"
        : "verified_static_fact";
  return {
    rule_id: ruleId,
    category,
    severity,
    status,
    confidence,
    is_heuristic: status !== "verified_static_fact",
    provenance,
    summary,
    explanation,
    recommended_human_action: ACTIONS[ruleId] ?? "Review the evidence.",
    evidence: evidence.slice(0, MAX_EVIDENCE),
    affected_modules: [...new Set(affectedModules)].sort(compareStrings),
  };
}

const live = (f: ChangedFile): boolean => f.status !== "deleted";

// ---------------------------------------------------------------------------------------------------------------
// broken-import + deleted-module-with-dependents (graph facts, not heuristics)

function deletedModules(ctx: RuleContext): Draft[] {
  if (!ctx.base) return [];
  const out: Draft[] = [];
  const changedPaths = new Set(ctx.files.map((f) => f.path));
  const headFiles = new Set(ctx.headSnapshot.files);
  for (const file of ctx.files) {
    const oldPath =
      file.status === "deleted" ? file.path : file.status === "renamed" ? file.previous_path : null;
    if (oldPath === null || !isJsTs(oldPath)) continue;
    const baseDependents = [...(ctx.base.rdeps.get(oldPath) ?? [])].sort(compareStrings);
    if (baseDependents.length === 0) continue;

    const broken: Evidence[] = [];
    const brokenModules: string[] = [];
    for (const dependent of baseDependents) {
      const specifiers = ctx.base.deps.get(dependent)?.get(oldPath)?.specifiers ?? [];
      const unresolved = ctx.head.unresolvedLocal.get(dependent) ?? [];
      for (const specifier of specifiers.filter((s) => unresolved.includes(s))) {
        const line = findSpecifierLine(ctx.headSnapshot.read(dependent) ?? "", specifier);
        broken.push(
          ev("import-edge", dependent, "head", `imports "${specifier}" (no longer resolves)`, line)
        );
        brokenModules.push(dependent);
      }
    }
    const verb = file.status === "renamed" ? `renamed to ${file.path}` : "deleted";
    if (broken.length > 0) {
      out.push(
        draft(
          "broken-import",
          "broken-import",
          "high",
          "high",
          false,
          "graph",
          `Import of ${verb === "deleted" ? "deleted" : "renamed"} module no longer resolves: ${oldPath}`,
          `In the base graph these modules resolved an import to ${oldPath}, which was ${verb}. In the head state the same import specifier cannot be resolved by dependency-cruiser. Unless resolution depends on configuration ChangeLens does not see (e.g. bundler aliases), this import is broken.`,
          [ev("file-status", oldPath, "base", verb), ...broken],
          [oldPath, ...brokenModules]
        )
      );
    }
    const stillPresent = baseDependents.filter((d) => headFiles.has(d));
    const untouched = stillPresent.filter((d) => !changedPaths.has(d));
    out.push(
      draft(
        "deleted-module-with-dependents",
        "deleted-module",
        untouched.length > 0 ? "medium" : "low",
        "high",
        false,
        "graph",
        `${file.status === "renamed" ? "Renamed" : "Deleted"} module had ${baseDependents.length} dependent(s) in base: ${oldPath}`,
        untouched.length > 0
          ? `${untouched.length} of these dependents were not modified in this change. Verify they no longer rely on ${oldPath}.`
          : `All dependents were also modified or removed in this change.`,
        [
          ev("file-status", oldPath, "base", verb),
          ...baseDependents.map((d) => {
            const spec = ctx.base?.deps.get(d)?.get(oldPath)?.specifiers[0] ?? "";
            return ev(
              "import-edge",
              d,
              "base",
              `imported "${spec}"${changedPaths.has(d) ? " (dependent also changed)" : ""}`
            );
          }),
        ],
        [oldPath, ...baseDependents]
      )
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// export-surface-changed + package-entry-changed

function packageEntrySet(ctx: RuleContext): Map<string, { pkg: string; declared: boolean }> {
  const entries = new Map<string, { pkg: string; declared: boolean }>();
  const files = new Set(ctx.headSnapshot.files);
  for (const pkg of ctx.head.packages) {
    for (const entry of manifestEntries(pkg))
      if (files.has(entry)) entries.set(entry, { pkg: pkg.name, declared: true });
    const prefix = pkg.dir ? `${pkg.dir}/` : "";
    for (const ext of ["ts", "tsx", "mts", "js", "mjs", "cjs", "jsx"]) {
      for (const candidate of [`${prefix}index.${ext}`, `${prefix}src/index.${ext}`]) {
        if (files.has(candidate) && !entries.has(candidate))
          entries.set(candidate, { pkg: pkg.name, declared: false });
      }
    }
  }
  return entries;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Parser-based export analysis for modified/renamed JS/TS modules: removed exports (fact), removed exports still
 * imported by direct dependents (fact), and changed signature lines of surviving exports (hypothesis).
 */
async function exportChanges(ctx: RuleContext): Promise<Draft[]> {
  const out: Draft[] = [];
  const entries = packageEntrySet(ctx);
  for (const file of ctx.files) {
    if (
      !isJsTs(file.path) ||
      file.kind === "test" ||
      (file.status !== "modified" && file.status !== "renamed")
    )
      continue;
    const basePath = file.previous_path ?? file.path;
    const [baseText, headText] = [await ctx.readBase(basePath), ctx.headSnapshot.read(file.path)];
    if (baseText === null || headText === null) {
      ctx.limitations.add(
        "export-analysis-incomplete",
        "Export analysis was skipped or incomplete for these modules (unreadable, too large, CommonJS exports, transitive re-exports or namespace imports).",
        file.path
      );
      continue;
    }
    const base = extractExports(baseText, basePath);
    const head = extractExports(headText, file.path);
    if (base.parseErrors + head.parseErrors > 0 || base.commonJs || head.commonJs) {
      ctx.limitations.add(
        "export-analysis-incomplete",
        "Export analysis was skipped or incomplete for these modules (unreadable, too large, CommonJS exports, transitive re-exports or namespace imports).",
        file.path
      );
    }
    const open = head.starReexports.length > 0 || head.commonJs;
    const dependents = [...(ctx.head.rdeps.get(file.path) ?? [])].sort(compareStrings);
    const entry = entries.get(file.path);
    const exposed = dependents.length > 0 || entry !== undefined;
    out.push(...removedExports(ctx, file.path, basePath, base, head, open, dependents, exposed));
    out.push(...signatureChanges(ctx, file.path, base, head, dependents, exposed));
    if (entry) {
      out.push(
        draft(
          "package-entry-changed",
          "public-api",
          "medium",
          entry.declared ? "medium" : "low",
          true,
          "inferred",
          `Package entry point changed: ${file.path}`,
          `${file.path} is ${entry.declared ? "declared in the package manifest" : "the conventional index"} of package ${entry.pkg}. Changes here may affect consumers outside this repository, which ChangeLens cannot see.`,
          [
            ev(
              "path-pattern",
              file.path,
              "head",
              entry.declared ? "manifest entry" : "conventional index entry"
            ),
          ],
          [file.path]
        )
      );
    }
  }
  return out;
}

function removedExports(
  ctx: RuleContext,
  path: string,
  basePath: string,
  base: ExportSet,
  head: ExportSet,
  open: boolean,
  dependents: string[],
  exposed: boolean
): Draft[] {
  const removed = [...base.exports.keys()].filter((n) => !head.exports.has(n)).sort(compareStrings);
  if (removed.length === 0) return [];
  const added = [...head.exports.keys()].filter((n) => !base.exports.has(n)).sort(compareStrings);
  const status: FindingStatus = open ? "unknown" : "verified_static_fact";
  const rename =
    removed.length === 1 &&
    added.length === 1 &&
    base.exports.get(removed[0] as string)?.kind === head.exports.get(added[0] as string)?.kind
      ? ` (possibly renamed to ${added[0]})`
      : "";
  const out: Draft[] = [];
  const openNote = open
    ? " The head module re-exports other modules (`export *`) or uses CommonJS, so the names may still be exported indirectly; status is unknown."
    : "";
  out.push(
    draft(
      "export-removed",
      "public-api",
      exposed ? "medium" : "low",
      "high",
      status,
      "graph",
      `Export removed from ${path}: ${removed.join(", ")}${rename}`,
      `The TypeScript parser finds ${plural(removed.length, "named export")} in the base version that ${removed.length === 1 ? "is" : "are"} absent in the head version. The module has ${plural(dependents.length, "direct dependent")}.${openNote}`,
      [
        ...removed.map((n) => {
          const info = base.exports.get(n);
          return ev(
            "export-declaration",
            basePath,
            "base",
            `removed: ${info?.kind ?? "export"} ${n}`,
            info?.line ?? null
          );
        }),
        ...(rename
          ? [
              ev(
                "export-declaration",
                path,
                "head",
                `added: ${head.exports.get(added[0] as string)?.kind ?? "export"} ${added[0]}`,
                head.exports.get(added[0] as string)?.line ?? null
              ),
            ]
          : []),
      ],
      [path, ...dependents]
    )
  );

  const removedSet = new Set(removed);
  const importers: Evidence[] = [];
  const importerPaths: string[] = [];
  for (const dependent of dependents) {
    const specifiers = ctx.head.deps.get(dependent)?.get(path)?.specifiers ?? [];
    const text = ctx.headSnapshot.read(dependent);
    if (text === null) continue;
    for (const imp of importedNames(text, dependent)) {
      if (!specifiers.includes(imp.specifier)) continue;
      if (imp.name === "*") {
        ctx.limitations.add(
          "export-analysis-incomplete",
          "Export analysis was skipped or incomplete for these modules (unreadable, too large, CommonJS exports, transitive re-exports or namespace imports).",
          dependent
        );
        continue;
      }
      if (!removedSet.has(imp.name)) continue;
      importers.push(
        ev(
          "import-edge",
          dependent,
          "head",
          `imports "${imp.name}" from "${imp.specifier}" (not exported in head)`,
          imp.line
        )
      );
      importerPaths.push(dependent);
    }
    // A dependent that re-exports everything (`export * from`) passes removed names on; its consumers are not followed.
    if (extractExports(text, dependent).starReexports.some((s) => specifiers.includes(s))) {
      ctx.limitations.add(
        "export-analysis-incomplete",
        "Export analysis was skipped or incomplete for these modules (unreadable, too large, CommonJS exports, transitive re-exports or namespace imports).",
        dependent
      );
    }
  }
  if (importers.length > 0) {
    out.push(
      draft(
        "removed-export-still-imported",
        "broken-import",
        open ? "medium" : "high",
        "high",
        status,
        "graph",
        `Removed export still imported by ${plural(new Set(importerPaths).size, "module")}: ${[...new Set(importers.map((e) => e.detail.split('"')[1]))].join(", ")} from ${path}`,
        `These dependents import names that the parser no longer finds among the exports of ${path}.${openNote || " Unless the names are provided some other way the parser cannot see, these imports are broken."}`,
        importers,
        [path, ...importerPaths]
      )
    );
  }
  return out;
}

function signatureChanges(
  ctx: RuleContext,
  path: string,
  base: ExportSet,
  head: ExportSet,
  dependents: string[],
  exposed: boolean
): Draft[] {
  const hunks = ctx.hunks.get(path);
  if (!hunks) return [];
  const addedLines = hunks.added.map((l) => l.line);
  const removedLines = hunks.removed.map((l) => l.line);
  const evidence: Evidence[] = [];
  const names: string[] = [];
  for (const [name, info] of [...head.exports.entries()].sort(([a], [b]) => compareStrings(a, b))) {
    const before = base.exports.get(name);
    if (!before) continue; // new exports do not change an existing interface
    const headLine = firstLineIn(info.signature, addedLines);
    const baseLine = firstLineIn(before.signature, removedLines);
    if (headLine === null && baseLine === null) continue;
    names.push(name);
    evidence.push(
      headLine !== null
        ? ev("export-declaration", path, "head", `signature lines changed: ${info.kind} ${name}`, headLine)
        : ev("export-declaration", path, "base", `signature lines changed: ${before.kind} ${name}`, baseLine)
    );
  }
  if (names.length === 0) return [];
  return [
    draft(
      "export-surface-changed",
      "public-api",
      exposed ? "medium" : "low",
      "medium",
      "hypothesis",
      "inferred",
      `Potential public interface change in ${path}: ${names.join(", ")}`,
      `Changed lines fall inside the signature of ${plural(names.length, "exported declaration")} (parameters, return type, type members or exported value). The module has ${plural(dependents.length, "direct dependent")}. ChangeLens does not type-check: the change may be fully compatible.`,
      evidence,
      [path, ...dependents]
    ),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// package-manifest-changed

const ENTRY_FIELDS = [
  "name",
  "exports",
  "main",
  "module",
  "types",
  "typings",
  "bin",
  "type",
  "engines",
  "peerDependencies",
  "files",
  "browser",
];
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function manifestChanges(ctx: RuleContext): Promise<Draft[]> {
  const out: Draft[] = [];
  for (const file of ctx.files) {
    if (basenameOf(file.path) !== "package.json" || !live(file)) continue;
    const head = parseJsonObject(ctx.headSnapshot.read(file.path));
    const base =
      file.status === "added" ? {} : parseJsonObject(await ctx.readBase(file.previous_path ?? file.path));
    if (!head || !base) {
      out.push(
        draft(
          "package-manifest-changed",
          "package-manifest",
          "low",
          "low",
          "unknown",
          "observed",
          `Package manifest changed (unparseable): ${file.path}`,
          "The manifest could not be parsed as JSON on one side; field-level comparison was skipped.",
          [ev("file-status", file.path, "head", file.status)],
          [file.path]
        )
      );
      continue;
    }
    const fields = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort(compareStrings);
    const evidence: Evidence[] = [];
    let severity: Severity = "low";
    for (const field of fields) {
      if (stableJson(base[field]) === stableJson(head[field])) continue;
      if (ENTRY_FIELDS.includes(field)) severity = "medium";
      let detail = `field "${field}" ${!(field in base) ? "added" : !(field in head) ? "removed" : "changed"}`;
      if (DEP_FIELDS.includes(field)) {
        const b = (base[field] ?? {}) as Record<string, unknown>;
        const h = (head[field] ?? {}) as Record<string, unknown>;
        const names = [...new Set([...Object.keys(b), ...Object.keys(h)])]
          .filter((n) => stableJson(b[n]) !== stableJson(h[n]))
          .sort(compareStrings);
        detail += `: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ` (+${names.length - 10} more)` : ""}`;
      }
      if (field === "scripts") detail += " (scripts are never executed by ChangeLens)";
      evidence.push(ev("manifest-field", file.path, "head", detail));
    }
    if (evidence.length === 0) continue;
    out.push(
      draft(
        "package-manifest-changed",
        "package-manifest",
        severity,
        "high",
        "verified_static_fact",
        "observed",
        `Package manifest fields changed: ${file.path}`,
        severity === "medium"
          ? "Fields that define the package's public entry points, identity or peer requirements changed. Consumers may be affected."
          : "Manifest fields changed (dependencies, scripts or metadata). Review for supply-chain and compatibility impact.",
        evidence,
        [file.path]
      )
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Path-pattern rules

const MIGRATION = [
  /(^|\/)(migrations?|migrate)\//i,
  /(^|\/)prisma\/migrations\//,
  /\.sql$/i,
  /(^|\/)db\/schema\.[a-z]+$/i,
  /(^|\/)alembic\/versions\//,
];
const CONTRACT = [
  /(^|\/)[^/]*(openapi|swagger)[^/]*\.(ya?ml|json)$/i,
  /\.(graphql|gql|proto|avsc|thrift)$/i,
  /(^|\/)schema\.prisma$/,
  /\.schema\.json$/i,
  /(^|\/)asyncapi[^/]*\.(ya?ml|json)$/i,
];
const ELEVATED_CONFIG = [
  /(^|\/)\.github\/workflows\//,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)(Dockerfile|docker-compose\.ya?ml)$/,
];
const SECURITY_PATH =
  /(^|[/._-])(auth[a-z]*|login|logout|signin|signup|sessions?|tokens?|jwt|oauth[a-z0-9]*|saml|sso|passw(?:or)?ds?|credentials?|secrets?|crypto[a-z]*|encrypt[a-z]*|decrypt[a-z]*|permissions?|rbac|acl|csrf|cors|security|sanitiz[a-z]*)([/._-]|$)/i;
const SECURITY_PACKAGES =
  /^(node:)?crypto$|^(jsonwebtoken|jose|bcrypt|bcryptjs|argon2|scrypt|helmet|cors|csurf|express-session|cookie-session|next-auth|passport(-[\w-]+)?|@auth\/[\w-]+|oauth[\w-]*|openid-client|@node-saml\/[\w-]+|crypto-js|tweetnacl|libsodium[\w-]*)$/;

function pathRule(
  ctx: RuleContext,
  ruleId: string,
  category: FindingCategory,
  patterns: RegExp[],
  title: string,
  explanation: string
): Draft[] {
  const matched = ctx.files.filter((f) => patterns.some((re) => re.test(f.path)));
  if (matched.length === 0) return [];
  return [
    draft(
      ruleId,
      category,
      "medium",
      "medium",
      true,
      "inferred",
      `${title} (${matched.length} file${matched.length === 1 ? "" : "s"})`,
      explanation,
      matched.map((f) =>
        ev(
          "path-pattern",
          f.path,
          f.status === "deleted" ? "base" : "head",
          f.status,
          f.changed_lines[0]?.start ?? null,
          f.changed_lines[0]?.end ?? null
        )
      ),
      matched.map((f) => f.path)
    ),
  ];
}

function configChanges(ctx: RuleContext): Draft[] {
  const matched = ctx.files.filter((f) => isConfigPath(f.path) && basenameOf(f.path) !== "package.json");
  const elevated = matched.filter((f) => ELEVATED_CONFIG.some((re) => re.test(f.path)));
  const normal = matched.filter((f) => !elevated.includes(f));
  const out: Draft[] = [];
  const evidence = (fs: ChangedFile[]): Evidence[] =>
    fs.map((f) => ev("path-pattern", f.path, f.status === "deleted" ? "base" : "head", f.status));
  if (elevated.length > 0) {
    out.push(
      draft(
        "config-changed",
        "configuration",
        "medium",
        "high",
        true,
        "inferred",
        `CI, environment or registry configuration changed (${elevated.length})`,
        "Workflow, container, .npmrc or environment files changed. These can alter build, release or runtime behavior and credentials. ChangeLens never reads the contents of environment files.",
        evidence(elevated),
        elevated.map((f) => f.path)
      )
    );
  }
  if (normal.length > 0) {
    out.push(
      draft(
        "config-changed",
        "configuration",
        "low",
        "high",
        true,
        "inferred",
        `Build/tooling configuration changed (${normal.length})`,
        "Compiler, bundler, linter, lockfile or workspace configuration changed. Effects are not modeled by the dependency graph.",
        evidence(normal),
        normal.map((f) => f.path)
      )
    );
  }
  return out;
}

function securityChanges(ctx: RuleContext): Draft[] {
  const out: Draft[] = [];
  for (const file of ctx.files) {
    if (file.kind === "test") continue;
    const evidence: Evidence[] = [];
    let provenance: Provenance = "inferred";
    const side = file.status === "deleted" ? "base" : "head";
    if (SECURITY_PATH.test(file.path))
      evidence.push(ev("path-pattern", file.path, side, "security-related path name"));
    if (ctx.securityPathPatterns.length > 0 && matchesAny(file.path, ctx.securityPathPatterns)) {
      evidence.push(ev("path-pattern", file.path, side, "matches securityPathPatterns from config"));
    }
    if (live(file) && isJsTs(file.path)) {
      const imports = (ctx.head.external.get(file.path) ?? []).filter((s) => SECURITY_PACKAGES.test(s));
      for (const spec of imports) {
        // The resolver normalizes core modules ("node:crypto" -> "crypto"); report the literal specifier.
        const text = ctx.headSnapshot.read(file.path) ?? "";
        const literal = [spec, `node:${spec}`].find((s) => findSpecifierLine(text, s) !== null) ?? spec;
        evidence.push(
          ev("import-edge", file.path, "head", `imports "${literal}"`, findSpecifierLine(text, literal))
        );
        provenance = "graph";
      }
    }
    if (evidence.length === 0) continue;
    out.push(
      draft(
        "security-sensitive-change",
        "security-sensitive",
        "medium",
        provenance === "graph" ? "medium" : "low",
        true,
        provenance,
        `Security-sensitive area changed: ${file.path}`,
        "The path name or imports suggest authentication, session, cryptography or access-control code. ChangeLens does not scan for vulnerabilities; this is a prompt for focused review.",
        evidence,
        [file.path]
      )
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// tests

function testChanges(ctx: RuleContext): Draft[] {
  const out: Draft[] = [];
  const removed = ctx.files.filter((f) => f.kind === "test" && f.status === "deleted");
  if (removed.length > 0) {
    out.push(
      draft(
        "tests-removed",
        "test-change",
        "medium",
        "high",
        true,
        "observed",
        `Test files deleted (${removed.length})`,
        "Deleting tests can reduce coverage of the changed behavior. Confirm the tests were obsolete or moved.",
        removed.map((f) => ev("file-status", f.path, "base", "deleted")),
        removed.map((f) => f.path)
      )
    );
  }
  const testsChanged = ctx.files.some((f) => f.kind === "test");
  const sources = ctx.files.filter((f) => f.kind === "source" && live(f));
  if (!testsChanged && sources.length > 0) {
    out.push(
      draft(
        "source-without-test-change",
        "test-change",
        "info",
        "medium",
        true,
        "inferred",
        `Source changed without test changes (${sources.length} module${sources.length === 1 ? "" : "s"})`,
        "No test file was modified in this change. Existing tests may still cover it; see suggested tests.",
        sources.map((f) => ev("file-status", f.path, "head", f.status)),
        sources.map((f) => f.path)
      )
    );
  }
  return out;
}

function blastRadius(ctx: RuleContext): Draft[] {
  const out: Draft[] = [];
  for (const [root, count] of [...ctx.dependentCounts.entries()].sort(([a], [b]) => compareStrings(a, b))) {
    if (count < ctx.blastRadiusThreshold) continue;
    out.push(
      draft(
        "wide-blast-radius",
        "blast-radius",
        count >= 50 ? "low" : "info",
        "high",
        "verified_static_fact",
        "graph",
        `${count} modules transitively depend on ${root}`,
        `Changes to ${root} can reach ${count} module(s) within ${ctx.maxDepth} reverse-dependency hops. Breadth is a review prompt, not evidence of breakage.`,
        [ev("graph-count", root, "head", `${count} transitive dependents`)],
        [root]
      )
    );
  }
  return out;
}

/** Run every rule and return findings sorted by severity, rule and id. */
export async function runRules(ctx: RuleContext): Promise<Finding[]> {
  const drafts: Draft[] = [
    ...deletedModules(ctx),
    ...(await exportChanges(ctx)),
    ...(await manifestChanges(ctx)),
    ...pathRule(
      ctx,
      "migration-changed",
      "migration",
      MIGRATION,
      "Database migration or schema files changed",
      "Migrations can be irreversible or require coordinated deploys. Check ordering, rollback and data impact. Detected by path convention only."
    ),
    ...pathRule(
      ctx,
      "api-contract-changed",
      "api-contract",
      CONTRACT,
      "API contract files changed",
      "OpenAPI/GraphQL/protobuf/schema files define contracts with external consumers. Detected by file name; compatibility was not evaluated."
    ),
    ...configChanges(ctx),
    ...securityChanges(ctx),
    ...testChanges(ctx),
    ...blastRadius(ctx),
  ];
  const findings = drafts.map((d) => ({
    id: findingId(
      d.rule_id,
      `${d.summary}\0${d.evidence.map((e) => `${e.path}:${e.line_start ?? ""}:${e.detail}`).join("|")}`
    ),
    ...d,
  }));
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      compareStrings(a.rule_id, b.rule_id) ||
      compareStrings(a.evidence[0]?.path ?? "", b.evidence[0]?.path ?? "") ||
      compareStrings(a.id, b.id)
  );
  return findings;
}
