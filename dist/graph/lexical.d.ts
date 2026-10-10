/** Count dynamic import()/require() calls whose argument is not a plain string literal. */
export declare function scanNonLiteralImports(text: string): number;
/** 1-based line of the first import/require/export-from referencing `specifier` as a string literal. */
export declare function findSpecifierLine(text: string, specifier: string): number | null;
/** If the line declares exports, return a short descriptor of the exported name(s); never the value. */
export declare function exportDescriptor(line: string): string | null;
/** String-literal import/require specifiers found lexically (used to cross-check the parser's extraction). */
export declare function literalSpecifiers(text: string): string[];
/** Detects module loading the resolver cannot follow: require.context, import.meta.glob, eval, new Function. */
export declare function hasDynamicLoading(text: string): boolean;
