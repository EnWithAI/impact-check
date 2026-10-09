// Lightweight lexical helpers. These never evaluate code; they are used only to locate lines and to
// flag constructs the resolver cannot see. Results are treated as inferred evidence.

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

const NON_LITERAL = /(?:\bimport|\brequire)\s*\(\s*(?:[^\s'"`)]|`[^`]*\$\{)/g;

/** Count dynamic import()/require() calls whose argument is not a plain string literal. */
export function scanNonLiteralImports(text: string): number {
  const cleaned = stripComments(text);
  let count = 0;
  for (const match of cleaned.matchAll(NON_LITERAL)) {
    const before = cleaned.slice(Math.max(0, (match.index ?? 0) - 1), match.index ?? 0);
    if (before === "." || before === "#") continue; // obj.require(...), private fields
    count++;
  }
  return count;
}

/** 1-based line of the first import/require/export-from referencing `specifier` as a string literal. */
export function findSpecifierLine(text: string, specifier: string): number | null {
  const lines = text.split("\n");
  for (const quote of ['"', "'", "`"]) {
    const needle = `${quote}${specifier}${quote}`;
    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] as string).includes(needle)) return i + 1;
    }
  }
  return null;
}

const EXPORT_DECL =
  /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(const|let|var|function\*?|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST = /^\s*export\s*(?:type\s*)?\{([^}]*)\}/;
const EXPORT_STAR = /^\s*export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from/;
const EXPORT_DEFAULT = /^\s*export\s+default\b/;
const CJS_EXPORT = /^\s*(?:module\.exports(?:\.([A-Za-z_$][\w$]*))?|exports\.([A-Za-z_$][\w$]*))\s*=/;

/** If the line declares exports, return a short descriptor of the exported name(s); never the value. */
export function exportDescriptor(line: string): string | null {
  let m = EXPORT_DECL.exec(line);
  if (m) return `${(m[1] ?? "").replace("*", "")} ${m[2] ?? ""}`;
  m = EXPORT_LIST.exec(line);
  if (m) {
    const names = (m[1] ?? "")
      .split(",")
      .map(
        (n) =>
          n
            .trim()
            .split(/\s+as\s+/)
            .pop() ?? ""
      )
      .map((n) => n.replace(/^type\s+/, "").trim())
      .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
    return names.length > 0 ? `{ ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""} }` : "{ }";
  }
  m = EXPORT_STAR.exec(line);
  if (m) return m[1] ? `* as ${m[1]}` : "* (re-export)";
  if (EXPORT_DEFAULT.test(line)) return "default";
  m = CJS_EXPORT.exec(line);
  if (m) return m[1] ? `module.exports.${m[1]}` : m[2] ? `exports.${m[2]}` : "module.exports";
  return null;
}
