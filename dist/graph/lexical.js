// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Lightweight lexical helpers. These never evaluate code; they are used only to locate lines and to
// flag constructs the resolver cannot see. Results are treated as inferred evidence.
function stripComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}
const NON_LITERAL = /(?:\bimport|\brequire)\s*\(\s*(?:[^\s'"`)]|`[^`]*\$\{)/g;
/** Count dynamic import()/require() calls whose argument is not a plain string literal. */
export function scanNonLiteralImports(text) {
    const cleaned = stripComments(text);
    let count = 0;
    for (const match of cleaned.matchAll(NON_LITERAL)) {
        const before = cleaned.slice(Math.max(0, (match.index ?? 0) - 1), match.index ?? 0);
        if (before === "." || before === "#")
            continue; // obj.require(...), private fields
        count++;
    }
    return count;
}
/** 1-based line of the first import/require/export-from referencing `specifier` as a string literal. */
export function findSpecifierLine(text, specifier) {
    const lines = text.split("\n");
    for (const quote of ['"', "'", "`"]) {
        const needle = `${quote}${specifier}${quote}`;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(needle))
                return i + 1;
        }
    }
    return null;
}
const EXPORT_DECL = /^\s*export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(const|let|var|function\*?|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST = /^\s*export\s*(?:type\s*)?\{([^}]*)\}/;
const EXPORT_STAR = /^\s*export\s*\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?from/;
const EXPORT_DEFAULT = /^\s*export\s+default\b/;
const CJS_EXPORT = /^\s*(?:module\.exports(?:\.([A-Za-z_$][\w$]*))?|exports\.([A-Za-z_$][\w$]*))\s*=/;
/** If the line declares exports, return a short descriptor of the exported name(s); never the value. */
export function exportDescriptor(line) {
    let m = EXPORT_DECL.exec(line);
    if (m)
        return `${(m[1] ?? "").replace("*", "")} ${m[2] ?? ""}`;
    m = EXPORT_LIST.exec(line);
    if (m) {
        const names = (m[1] ?? "")
            .split(",")
            .map((n) => n
            .trim()
            .split(/\s+as\s+/)
            .pop() ?? "")
            .map((n) => n.replace(/^type\s+/, "").trim())
            .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
        return names.length > 0 ? `{ ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""} }` : "{ }";
    }
    m = EXPORT_STAR.exec(line);
    if (m)
        return m[1] ? `* as ${m[1]}` : "* (re-export)";
    if (EXPORT_DEFAULT.test(line))
        return "default";
    m = CJS_EXPORT.exec(line);
    if (m)
        return m[1] ? `module.exports.${m[1]}` : m[2] ? `exports.${m[2]}` : "module.exports";
    return null;
}
const LITERAL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])([^"'\n]{1,300})\1/g;
/** String-literal import/require specifiers found lexically (used to cross-check the parser's extraction). */
export function literalSpecifiers(text) {
    const cleaned = stripComments(text);
    const out = new Set();
    for (const m of cleaned.matchAll(LITERAL_IMPORT))
        out.add(m[2] ?? "");
    out.delete("");
    return [...out].sort();
}
const DYNAMIC_LOADING = /\brequire\s*\)?\s*(?:as\s+any\s*\)\s*)?\.context\s*\(|\bimport\.meta\s*\)?\s*(?:as\s+any\s*\)\s*)?\.glob(?:Eager)?\s*\(|(?<![.\w])eval\s*\(|\bnew\s+Function\s*\(/;
/** Detects module loading the resolver cannot follow: require.context, import.meta.glob, eval, new Function. */
export function hasDynamicLoading(text) {
    return DYNAMIC_LOADING.test(stripComments(text));
}
