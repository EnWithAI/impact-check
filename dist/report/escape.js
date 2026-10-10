// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 EnWithAI Technologies
// Markdown escaping for untrusted, repository-derived strings.
/** Make control characters (incl. newlines, tabs, bidi overrides) visible and inert. */
export function visible(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, (ch) => {
        const code = ch.charCodeAt(0);
        if (code === 0x0a)
            return "\\n";
        if (code === 0x09)
            return "\\t";
        if (code === 0x0d)
            return "\\r";
        return `\\u${code.toString(16).padStart(4, "0")}`;
    });
}
/**
 * Render a string as an inline code span. Inside code spans GitHub does not interpret Markdown, HTML, links or
 * @mentions. A fence longer than any backtick run in the content is used, and pipes are escaped for tables.
 */
export function code(text, maxLength = 300) {
    let value = visible(text);
    if (value.length > maxLength)
        value = `${value.slice(0, maxLength)}…`;
    const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = "`".repeat(longest + 1);
    const pad = value.startsWith("`") || value.endsWith("`") || value.startsWith(" ") ? " " : "";
    return `${fence}${pad}${value.replace(/\|/g, "\\|")}${pad}${fence}`;
}
/**
 * Escape free text (not code) for Markdown paragraphs and tables. Input is single-line after `visible`.
 * Block-level markers (headings, lists, quotes) are only escaped when the text starts a line.
 */
export function text(value, options = {}) {
    let out = visible(value);
    const maxLength = options.maxLength ?? 2000;
    if (out.length > maxLength)
        out = `${out.slice(0, maxLength)}…`;
    out = out
        .replace(/[\\`*_[\]<>|~]/g, "\\$&")
        .replace(/&/g, "&amp;")
        .replace(/@/g, "@\u200b");
    if (options.lineStart)
        out = out.replace(/^([#+=-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
    return out;
}
