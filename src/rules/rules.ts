import { createHash } from "node:crypto";
import type { FileHunks } from "../git/repo.js";
import type { ModuleGraph } from "../graph/graph.js";
import { exportDescriptor, findSpecifierLine } from "../graph/lexical.js";
import { manifestEntries, parseJsonObject } from "../graph/workspaces.js";
import type { Snapshot } from "../snapshot/snapshot.js";
import type {
  ChangedFile,
  Confidence,
  Evidence,
  Finding,
  FindingCategory,
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
  return { kind, path, side, line, endLine: endLine ?? line, detail };
}

function draft(
  ruleId: string,
  category: FindingCategory,
  severity: Severity,
  confidence: Confidence,
  isHeuristic: boolean,
  provenance: Provenance,
  title: string,
  explanation: string,
  evidence: Evidence[],
  relatedModules: string[] = []
): Draft {
  return {
    ruleId,
    category,
    severity,
    confidence,
    isHeuristic,
    provenance,
    title,
    explanation,
    evidence: evidence.slice(0, MAX_EVIDENCE),
    relatedModules: [...new Set(relatedModules)].sort(compareStrings),
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
      file.status === "deleted" ? file.path : file.status === "renamed" ? file.previousPath : null;
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

function exportChanges(ctx: RuleContext): Draft[] {
  const out: Draft[] = [];
  const entries = packageEntrySet(ctx);
  for (const file of ctx.files) {
    if (!isJsTs(file.path) || file.kind === "test" || file.status === "deleted" || file.status === "added")
      continue;
    const hunks = ctx.hunks.get(file.path);
    if (!hunks) continue;
    const added = hunks.added.flatMap((l) => {
      const d = exportDescriptor(l.text);
      return d ? [{ line: l.line, d }] : [];
    });
    const removed = hunks.removed.flatMap((l) => {
      const d = exportDescriptor(l.text);
      return d ? [{ line: l.line, d }] : [];
    });
    if (added.length + removed.length > 0) {
      const addedNames = new Set(added.map((a) => a.d));
      const removedNames = new Set(removed.map((r) => r.d));
      const evidence = [
        ...removed.map((r) =>
          ev(
            "export-declaration",
            file.previousPath ?? file.path,
            "base",
            `${addedNames.has(r.d) ? "modified" : "removed"}: ${r.d}`,
            r.line
          )
        ),
        ...added
          .filter((a) => !removedNames.has(a.d))
          .map((a) => ev("export-declaration", file.path, "head", `added: ${a.d}`, a.line)),
        ...added
          .filter((a) => removedNames.has(a.d))
          .map((a) => ev("export-declaration", file.path, "head", `modified: ${a.d}`, a.line)),
      ];
      const dependents = ctx.head.rdeps.get(file.path)?.size ?? 0;
      const entry = entries.get(file.path);
      const touchesExisting = removed.length > 0;
      const severity: Severity =
        touchesExisting && (dependents > 0 || entry !== undefined) ? "medium" : "low";
      out.push(
        draft(
          "export-surface-changed",
          "public-api",
          severity,
          "medium",
          true,
          "inferred",
          `Potential public interface change in ${file.path}`,
          `Diff lines that declare exports were ${touchesExisting ? "removed or modified" : "added"} (${removed.length} removed/modified, ${added.length} added line(s)). The module has ${dependents} direct dependent(s) in the head graph${entry ? ` and is an entry point of package ${entry.pkg}` : ""}. ChangeLens compares lines, not types: this may be fully compatible.`,
          evidence,
          [file.path, ...(ctx.head.rdeps.get(file.path) ?? [])]
        )
      );
    }
    const entry = entries.get(file.path);
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
      file.status === "added" ? {} : parseJsonObject(await ctx.readBase(file.previousPath ?? file.path));
    if (!head || !base) {
      out.push(
        draft(
          "package-manifest-changed",
          "package-manifest",
          "low",
          "low",
          true,
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
        true,
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
          f.changedLines[0]?.start ?? null,
          f.changedLines[0]?.end ?? null
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
        true,
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
    ...exportChanges(ctx),
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
      d.ruleId,
      `${d.title}\0${d.evidence.map((e) => `${e.path}:${e.line ?? ""}:${e.detail}`).join("|")}`
    ),
    ...d,
  }));
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      compareStrings(a.ruleId, b.ruleId) ||
      compareStrings(a.evidence[0]?.path ?? "", b.evidence[0]?.path ?? "") ||
      compareStrings(a.id, b.id)
  );
  return findings;
}
