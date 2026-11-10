/** Make control characters (incl. newlines, tabs, bidi overrides) visible and inert. */
export declare function visible(text: string): string;
/**
 * Render a string as an inline code span. Inside code spans GitHub does not interpret Markdown, HTML, links or
 * @mentions. A fence longer than any backtick run in the content is used, and pipes are escaped for tables.
 */
export declare function code(text: string, maxLength?: number): string;
/**
 * Escape free text (not code) for Markdown paragraphs and tables. Input is single-line after `visible`.
 * Block-level markers (headings, lists, quotes) are only escaped when the text starts a line.
 */
export declare function text(value: string, options?: {
    maxLength?: number;
    lineStart?: boolean;
}): string;
