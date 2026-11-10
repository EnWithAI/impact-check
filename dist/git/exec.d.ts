/** Options for a single git invocation. */
export interface GitOptions {
    cwd: string;
    input?: Buffer | string;
    timeoutMs?: number;
    maxBytes?: number;
    /** Return result instead of throwing on non-zero exit. */
    allowFailure?: boolean;
}
/** Raw result of a git invocation. */
export interface GitResult {
    code: number;
    stdout: Buffer;
    stderr: string;
}
/**
 * Minimal environment for git: only what it needs to locate itself and the repository, plus variables
 * that disable prompts, optional locks, pagers and lazy (network) object fetches.
 */
export declare function gitEnv(): NodeJS.ProcessEnv;
/** Run git with an argument array (never a shell string). */
export declare function runGit(args: readonly string[], options: GitOptions): Promise<GitResult>;
/** First non-empty line of a message, capped at 300 characters (used to summarize git stderr). */
export declare function firstLine(text: string): string;
/** Split NUL-separated git output. */
export declare function splitZ(buffer: Buffer): string[];
