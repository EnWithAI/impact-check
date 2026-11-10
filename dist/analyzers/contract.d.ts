/** One classified difference, reported as one evidence item. */
export interface ContractItem {
    kind: "break" | "unclassified" | "unknown";
    change: string;
    pointer: string;
    side: "base" | "head";
    baseLine: number | null;
    headLine: number | null;
    detail: string;
}
/** Result for one file: not a contract (callers fall back to path rules) or the classified items. */
export type ContractResult = {
    contract: false;
} | {
    contract: true;
    items: ContractItem[];
};
type Format = "openapi" | "asyncapi";
/** A parsed document side with its pointer → line map. */
interface Doc {
    format: Format;
    /** Major.minor, e.g. "3.1". */
    minor: string;
    root: unknown;
    lines: Map<string, number>;
    rootLine: number;
}
type Side = {
    state: "absent";
} | {
    state: "not-contract";
} | {
    state: "unparseable";
    reason: string;
} | {
    state: "unsupported";
    format: Format | "swagger";
    version: string;
    line: number;
} | ({
    state: "contract";
} & Doc);
/** RFC 6901 escaping of one reference token. */
export declare const escapeToken: (token: string) => string;
/** Parses one side and classifies it (docs/CONTRACT_DIFF.md §1). Never throws. */
export declare function parseSide(text: string | null | undefined): Side;
/** True if the text declares an OpenAPI/AsyncAPI document at the top level (cheap sniff, no parse). */
export declare function looksLikeContract(path: string, text: string | null): boolean;
/**
 * Compares two revisions of one file. `undefined` = the side does not exist (added/deleted file); `null` = exists
 * but could not be read.
 */
export declare function diffContract(baseText: string | null | undefined, headText: string | null | undefined): ContractResult;
export {};
