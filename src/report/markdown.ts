import type { Finding, Report } from "../types.js";
import { code, text } from "./escape.js";

export interface MarkdownOptions {
  branding: boolean;
  /** Max rows per table section; the JSON report always has the full lists. */
  maxRows?: number;
  /** Hard cap on output size (characters). GitHub comments/job summaries are limited to ~1 MiB / 65k chars. */
  maxChars?: number;
}

const SEVERITY_LABEL: Record<Finding["severity"], string> = {
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};
const PROVENANCE_LABEL = {
  observed: "observed (git diff)",
  graph: "graph (resolved import)",
  inferred: "inferred (heuristic)",
} as const;

function short(sha: string | null): string {
  return sha ? code(sha.slice(0, 12)) : "—";
}

function more(total: number, shown: number, what: string): string[] {
  return total > shown ? ["", `_…and ${total - shown} more ${what} (see the JSON report)._`] : [];
}

function location(line: number | null, endLine: number | null): string {
  if (line === null) return "";
  return endLine !== null && endLine !== line ? `:${line}-${endLine}` : `:${line}`;
}

export function renderMarkdown(report: Report, options: MarkdownOptions): string {
  const maxRows = options.maxRows ?? 100;
  const maxChars = options.maxChars ?? 60_000;
  const c = report.comparison;
  const s = report.summary;
  const out: string[] = [];

  out.push("# ChangeLens impact report", "");
  out.push(
    "> Deterministic static analysis of module imports and diff lines. Findings marked **heuristic** are prompts for review, not proven defects. **No tests or repository code were executed.**",
    ""
  );
  const head =
    c.headKind === "worktree"
      ? `working tree (HEAD ${short(c.headCommit)} + uncommitted changes)`
      : `${code(c.headRef)} (${short(c.headCommit)})`;
  out.push(
    `**Comparison:** ${code(c.baseRef)} (${short(c.baseCommit)}) → ${head} · mode ${code(c.diffMode)}${c.mergeBase ? ` · merge-base ${short(c.mergeBase)}` : ""}`,
    ""
  );
  if (c.headKind === "worktree") {
    out.push(
      `**Uncommitted changes included:** ${c.worktree.staged} staged, ${c.worktree.unstaged} unstaged, ${c.worktree.untracked} untracked`,
      ""
    );
  }
  const sev = s.findingsBySeverity;
  out.push(
    "| Files changed | JS/TS files | Affected modules | Findings (high / medium / low / info) | Test candidates | Limitations |",
    "|---:|---:|---:|---|---:|---:|",
    `| ${s.filesChanged} | ${s.jsTsFilesChanged} | ${s.affectedModules} | ${sev.high} / ${sev.medium} / ${sev.low} / ${sev.info} | ${s.suggestedTests} | ${s.coverageLimitations} |`,
    ""
  );

  // Findings
  out.push("## Risk findings", "");
  if (report.riskFindings.length === 0) out.push("No findings.", "");
  for (const f of report.riskFindings.slice(0, maxRows)) {
    const kind = f.isHeuristic ? "heuristic" : "**confirmed by resolver**";
    out.push(`### ${SEVERITY_LABEL[f.severity]} · ${text(f.title)}`, "");
    out.push(
      `${code(f.ruleId)} · ${kind} · confidence ${f.confidence} · provenance ${PROVENANCE_LABEL[f.provenance]}`,
      ""
    );
    out.push(text(f.explanation), "");
    for (const e of f.evidence) {
      out.push(`- ${code(`${e.path}${location(e.line, e.endLine)}`)} (${e.side}) — ${text(e.detail)}`);
    }
    out.push("");
  }
  out.push(...more(report.riskFindings.length, Math.min(maxRows, report.riskFindings.length), "findings"));

  // Files
  out.push("## Changed files", "", "| Status | File | Kind | +/− | Origin |", "|---|---|---|---|---|");
  for (const f of report.filesChanged.slice(0, maxRows)) {
    const name = f.previousPath ? `${code(f.previousPath)} → ${code(f.path)}` : code(f.path);
    const delta = f.binary ? "binary" : f.additions === null ? "—" : `+${f.additions} / −${f.deletions ?? 0}`;
    out.push(`| ${f.status} | ${name} | ${f.kind} | ${delta} | ${f.origin} |`);
  }
  if (report.filesChanged.length === 0) out.push("| — | No changes | | | |");
  out.push(...more(report.filesChanged.length, Math.min(maxRows, report.filesChanged.length), "files"), "");

  // Affected modules
  const dependents = report.affectedModules.filter((m) => m.reason === "dependent");
  out.push("## Affected modules (reverse dependencies)", "");
  if (dependents.length === 0) {
    out.push(
      "No modules outside the change set depend on the changed modules (within the analyzed graph).",
      ""
    );
  } else {
    out.push("| Module | Hops | Provenance | Shortest path from a changed module |", "|---|---:|---|---|");
    for (const m of dependents.slice(0, maxRows)) {
      const via = m.via.length > 6 ? [...m.via.slice(0, 3), "…", ...m.via.slice(-2)] : m.via;
      out.push(
        `| ${code(m.path)} | ${m.distance} | ${m.provenance} | ${via.map((v) => (v === "…" ? "…" : code(v))).join(" ← ")} |`
      );
    }
    out.push(...more(dependents.length, Math.min(maxRows, dependents.length), "affected modules"), "");
  }

  // Tests
  out.push("## Suggested tests (not executed)", "");
  if (report.suggestedTests.length === 0) {
    out.push("No candidate tests found by import graph or naming convention.", "");
  } else {
    out.push("| Test file | Why | Provenance |", "|---|---|---|");
    for (const t of report.suggestedTests.slice(0, maxRows)) {
      out.push(`| ${code(t.path)} | ${t.reasons.join(", ")} | ${t.provenance} |`);
    }
    out.push(
      ...more(report.suggestedTests.length, Math.min(maxRows, report.suggestedTests.length), "tests"),
      ""
    );
  }

  // Limitations
  out.push("## Limitations and unknowns", "");
  for (const l of report.coverageLimitations) {
    const examples =
      l.paths.length > 0
        ? ` Examples: ${l.paths
            .slice(0, 5)
            .map((p) => code(p))
            .join(", ")}${l.count > 5 ? ` (${l.count} total)` : ""}`
        : "";
    out.push(`- ${code(l.code)} — ${text(l.message)}${examples}`);
  }
  out.push("");

  out.push(
    "<details><summary>Legend</summary>",
    "",
    "- **observed**: read directly from `git diff`.",
    "- **graph**: derived from imports resolved by dependency-cruiser.",
    "- **inferred**: heuristic (path conventions, lexical patterns, workspace mapping).",
    "- **confirmed by resolver**: a graph fact, e.g. an import that resolved in base no longer resolves in head.",
    "",
    "</details>",
    ""
  );
  const a = report.analysis;
  out.push(
    `<sub>ChangeLens ${text(report.toolVersion)} · schema ${report.schemaVersion} · dependency-cruiser ${text(a.engineVersion)} · TypeScript ${text(a.parserVersion)} · head graph ${a.headGraph.modules} modules / ${a.headGraph.edges} edges · offline, no telemetry</sub>`
  );
  if (options.branding) {
    out.push(
      "",
      "<sub>Built by EnWithAI · Part of CrewPE Engineering Commons · [crewpe.ai](https://crewpe.ai)</sub>"
    );
  }

  let md = out.join("\n") + "\n";
  if (md.length > maxChars) {
    const notice =
      "\n\n_Report truncated to fit size limits. The JSON report contains the complete results._\n";
    md = md.slice(0, maxChars - notice.length);
    md = md.slice(0, md.lastIndexOf("\n")) + notice;
  }
  return md;
}
